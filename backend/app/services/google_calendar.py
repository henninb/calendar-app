"""
Google Calendar API wrapper.

OAuth credentials are loaded from the file pointed to by settings.google_credentials_file.
The access/refresh token is persisted at settings.google_token_file.
"""
from __future__ import annotations

import json
import logging
import os
import random
import secrets
import time
from datetime import date, timedelta, datetime, timezone
from pathlib import Path
from typing import Optional

log = logging.getLogger(__name__)

from google.auth.exceptions import RefreshError
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from sqlalchemy.orm import Session

from ..config import settings
from ..models import Occurrence, OccurrenceStatus

# Module-level flow kept alive between get_auth_url() and exchange_code()
# so the PKCE code_verifier generated during authorization is available at
# token exchange time.
_pending_flow: Optional[Flow] = None

# Persisted alongside the token file so the PKCE code_verifier survives
# a server restart or multi-worker deployment between /auth and /auth/callback.
_CODE_VERIFIER_FILE = Path(settings.google_token_file).parent / ".pending_code_verifier"

SCOPES = [
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/tasks",
]

# Maps category name → Google Calendar colorId (1-11)
CATEGORY_COLOR_MAP = {
    "birthday": "11",          # Tomato
    "car_maintenance": "6",    # Tangerine
    "house_maintenance": "5",  # Banana
    "holiday": "2",            # Sage
    "finance": "9",            # Blueberry
    "medical": "4",            # Flamingo
    "dental": "7",             # Peacock
    "payment": "3",            # Grape
    "property_tax": "10",      # Basil
    "tax": "10",               # Basil
    "credit_card": "1",        # Lavender
    "software": "8",           # Graphite
    "other": "8",
    "mlb":  "11",              # Tomato  (Twins red)
    "nba":  "9",               # Blueberry (Wolves blue)
    "nhl":  "10",              # Basil (Wild green)
}


def get_auth_url(state: str = "", redirect_uri: Optional[str] = None) -> str:
    """Return the Google OAuth consent URL."""
    global _pending_flow
    _pending_flow = _build_flow(redirect_uri=redirect_uri)
    auth_url, _ = _pending_flow.authorization_url(
        access_type="offline",
        state=state,
        prompt="consent",
    )
    # Persist code_verifier + redirect_uri so both survive across
    # process boundaries (multi-worker / restart) between /auth and /auth/callback.
    cv = getattr(_pending_flow, "code_verifier", None)
    state_data = json.dumps({
        "code_verifier": cv,
        "redirect_uri": redirect_uri or settings.google_redirect_uri,
        "state": state,
    })
    fd = os.open(str(_CODE_VERIFIER_FILE), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        f.write(state_data)
    return auth_url


def exchange_code(code: str, redirect_uri: Optional[str] = None) -> Credentials:
    """Exchange an authorization code for credentials and persist the token."""
    global _pending_flow

    # Restore persisted state when the callback lands on a different process.
    saved_cv: Optional[str] = None
    saved_uri: Optional[str] = None
    if _CODE_VERIFIER_FILE.exists():
        try:
            data = json.loads(_CODE_VERIFIER_FILE.read_text())
            saved_cv = data.get("code_verifier")
            saved_uri = data.get("redirect_uri")
        except Exception:
            pass
        try:
            _CODE_VERIFIER_FILE.unlink(missing_ok=True)
        except Exception:
            pass

    effective_uri = redirect_uri or saved_uri or settings.google_redirect_uri
    flow = _pending_flow if _pending_flow is not None else _build_flow(redirect_uri=effective_uri)
    _pending_flow = None

    if not getattr(flow, "code_verifier", None) and saved_cv:
        flow.code_verifier = saved_cv

    fetch_kwargs: dict = {"code": code}
    if getattr(flow, "code_verifier", None):
        fetch_kwargs["code_verifier"] = flow.code_verifier
    flow.fetch_token(**fetch_kwargs)
    creds = flow.credentials
    _save_token(creds)
    return creds


def validate_state(state: str) -> bool:
    """Validate the OAuth state parameter against the persisted expected value."""
    if not _CODE_VERIFIER_FILE.exists():
        return False
    try:
        data = json.loads(_CODE_VERIFIER_FILE.read_text())
        expected = data.get("state", "")
        return bool(expected) and secrets.compare_digest(state, expected)
    except Exception:
        return False


def get_credentials() -> Optional[Credentials]:
    """Load credentials from token file, refreshing if expired.

    Returns None if the token is missing, invalid, or covers a different
    scope than what is currently requested (triggers re-authentication).
    """
    token_path = settings.google_token_file
    if not os.path.exists(token_path):
        return None

    creds = Credentials.from_authorized_user_file(token_path, SCOPES)
    if creds.expired and creds.refresh_token:
        try:
            creds.refresh(Request())
            _save_token(creds)
        except RefreshError:
            # Token is revoked or covers wrong scopes — force re-auth
            os.remove(token_path)
            return None
    return creds if creds.valid else None


def is_authenticated() -> tuple[bool, Optional[str]]:
    """
    Returns (authenticated, email).

    Verifies credentials by calling the Calendar API (a scope we actually own).
    The userinfo/email endpoint requires the 'email' or 'profile' OAuth scope,
    which is not in our SCOPES list, so it must not be used here.
    """
    creds = get_credentials()
    if not creds:
        return False, None
    try:
        cal_svc = build("calendar", "v3", credentials=creds)
        tasks_svc = build("tasks", "v1", credentials=creds)
        cal_svc.calendarList().list(maxResults=1).execute()
        tasks_svc.tasklists().list(maxResults=1).execute()
        return True, None
    except HttpError as e:
        if e.resp.status == 401:
            log.warning("Google credentials rejected with 401 — clearing token and requiring re-auth")
            try:
                os.remove(settings.google_token_file)
            except OSError:
                pass
            return False, None
        log.warning("Failed to verify Google credentials (HTTP %s)", e.resp.status)
        return True, None
    except Exception:
        log.warning("Failed to verify Google credentials", exc_info=True)
        return True, None


def sync_occurrence(db: Session, occurrence: Occurrence) -> str:
    """
    Push a single Occurrence to Google Calendar as an all-day event.
    Updates occurrence.gcal_event_id and occurrence.synced_at on success.
    Returns "inserted" or "updated".

    Duplicate-safe decision tree (see _resolve_gcal_id):
      1. gcal_event_id set in DB → attempt update directly
         2xx → done
         404 → event deleted from GCal; fall through to step 2
      2. Search GCal by privateExtendedProperty calendarAppId={id}
         found + date matches → update in-place (content may be stale)
         found + date wrong   → stale/reused ID; delete it, insert fresh
         not found            → insert fresh
    """
    creds = get_credentials()
    if not creds:
        raise RuntimeError("Not authenticated with Google Calendar")

    service = build("calendar", "v3", credentials=creds)
    event = occurrence.event
    calendar_id = event.gcal_calendar_id or "primary"

    end_date = occurrence.occurrence_date + timedelta(days=event.duration_days)
    color_id = CATEGORY_COLOR_MAP.get(event.category.name, "8")
    reminder_overrides = [
        {"method": "popup", "minutes": days * 24 * 60}
        for days in (event.reminder_days or [1])
    ]
    body = {
        "summary": event.title,
        "description": event.description or "",
        "start": {"date": occurrence.occurrence_date.isoformat()},
        "end": {"date": end_date.isoformat()},
        "colorId": color_id,
        "reminders": {"useDefault": False, "overrides": reminder_overrides},
        "extendedProperties": {
            "private": {
                "calendarAppId": str(occurrence.id),
                "category": event.category.name,
            }
        },
    }
    if event.location:
        body["location"] = event.location

    try:
        gcal_id, action = _resolve_gcal_id(service, occurrence, calendar_id, body)
        occurrence.gcal_event_id = gcal_id
        occurrence.synced_at = datetime.now(timezone.utc)
        occurrence.status = OccurrenceStatus.upcoming
        db.commit()
        return action
    except HttpError as e:
        raise RuntimeError(f"Google Calendar API error: {e}") from e


def delete_gcal_event(occurrence: Occurrence) -> None:
    """Delete the Google Calendar event for an occurrence (if it exists)."""
    if not occurrence.gcal_event_id:
        return
    creds = get_credentials()
    if not creds:
        raise RuntimeError("Not authenticated with Google Calendar")
    service = build("calendar", "v3", credentials=creds)
    calendar_id = occurrence.event.gcal_calendar_id or "primary"
    try:
        service.events().delete(
            calendarId=calendar_id, eventId=occurrence.gcal_event_id
        ).execute()
    except HttpError as e:
        raise RuntimeError(f"Google Calendar API error: {e}") from e


def wipe_all_gcal_events() -> int:
    """Delete every event from the primary Google Calendar, regardless of DB tracking."""
    creds = get_credentials()
    if not creds:
        raise RuntimeError("Not authenticated with Google Calendar")
    service = build("calendar", "v3", credentials=creds)
    deleted = 0
    page_token = None
    while True:
        response = service.events().list(
            calendarId="primary",
            pageToken=page_token,
            maxResults=settings.gcal_max_results,
        ).execute()
        for event in response.get("items", []):
            try:
                service.events().delete(calendarId="primary", eventId=event["id"]).execute()
                deleted += 1
                log.info("Wiped event %s (%s)", event["id"], event.get("summary", "—"))
            except HttpError as e:
                log.error("Failed to wipe event %s: %s", event["id"], e)
        page_token = response.get("nextPageToken")
        if not page_token:
            break
    return deleted


# ── Internals ────────────────────────────────────────────────────────────────

_MAX_RETRIES = 6
_RETRY_BASE_DELAY = 2.0  # seconds; doubles each attempt, capped at 60s


_RETRYABLE_REASONS = ("rateLimitExceeded", "userRateLimitExceeded", "quotaExceeded")


def _execute(request) -> dict:
    """
    Call request.execute() with exponential backoff + jitter on rate-limit errors.
    Retries up to _MAX_RETRIES times on HTTP 429 or 403 with a retryable reason.
    All other HttpErrors propagate immediately.

    Google APIs may return any of:
      rateLimitExceeded      — per-project QPS burst
      userRateLimitExceeded  — per-user QPS burst
      quotaExceeded          — also used for per-second user limits on Tasks API
    """
    delay = _RETRY_BASE_DELAY
    for attempt in range(_MAX_RETRIES):
        try:
            return request.execute()
        except HttpError as e:
            err_str = str(e)
            is_rate_limit = e.resp.status in (429, 403) and any(r in err_str for r in _RETRYABLE_REASONS)
            if not is_rate_limit or attempt == _MAX_RETRIES - 1:
                raise
            sleep_time = delay + random.uniform(0, delay * 0.5)
            log.warning("Rate limit hit, backing off %.1fs (attempt %d/%d)…", sleep_time, attempt + 1, _MAX_RETRIES)
            time.sleep(sleep_time)
            delay = min(delay * 2, 60)


def _resolve_gcal_id(service, occurrence: Occurrence, calendar_id: str, body: dict) -> tuple[str, str]:
    """
    Ensure exactly one GCal event exists for this occurrence with current content.
    Returns (gcal_event_id, action) where action is "inserted" or "updated".

    Step 1 — gcal_event_id set in DB:
      Attempt events().update() directly (one API call, immediately consistent).
      Success → return same ID.
      404     → event was deleted from GCal; fall through to step 2.

    Step 2 — No confirmed GCal ID:
      Search by privateExtendedProperty calendarAppId={occurrence.id}.
      Found + date matches → update in-place, return its ID.
      Found + date wrong   → stale/reused DB ID; delete it, insert fresh.
      Not found            → insert fresh.
    """
    gcal_id = occurrence.gcal_event_id

    if gcal_id:
        try:
            _execute(service.events().update(
                calendarId=calendar_id, eventId=gcal_id, body=body
            ))
            return gcal_id, "updated"
        except HttpError as e:
            if e.resp.status != 404:
                raise
            log.warning("occ %d: stored event %s not found in GCal (404) — re-resolving", occurrence.id, gcal_id)

    # gcal_event_id was None or just confirmed missing — search by private tag
    expected_date = occurrence.occurrence_date.isoformat()
    search = _execute(service.events().list(
        calendarId=calendar_id,
        privateExtendedProperty=f"calendarAppId={occurrence.id}",
    ))
    existing = search.get("items", [])

    if existing:
        found = existing[0]
        found_id = found["id"]
        found_date = found.get("start", {}).get("date", "")

        if found_date == expected_date:
            # Correct event — update to ensure content is current
            _execute(service.events().update(
                calendarId=calendar_id, eventId=found_id, body=body
            ))
            return found_id, "updated"

        # Date mismatch → stale event from a previous DB lifecycle; replace it
        log.warning(
            "occ %d: stale event %s (GCal date=%r, expected=%r) — replacing",
            occurrence.id, found_id, found_date, expected_date,
        )
        try:
            service.events().delete(calendarId=calendar_id, eventId=found_id).execute()
        except HttpError:
            pass  # already gone from GCal — safe to proceed

    result = _execute(service.events().insert(calendarId=calendar_id, body=body))
    new_id = result["id"]
    return new_id, "inserted"


def _build_flow(redirect_uri: Optional[str] = None) -> Flow:
    uri = redirect_uri or settings.google_redirect_uri
    client_config = {
        "web": {
            "client_id": settings.google_client_id,
            "client_secret": settings.google_client_secret,
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "redirect_uris": [uri],
        }
    }
    return Flow.from_client_config(
        client_config,
        scopes=SCOPES,
        redirect_uri=uri,
    )


def _save_token(creds: Credentials) -> None:
    fd = os.open(settings.google_token_file, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        f.write(creds.to_json())
