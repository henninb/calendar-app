"""
Google Calendar API wrapper.

OAuth credentials are loaded from the file pointed to by settings.google_credentials_file.
The access/refresh token is persisted at settings.google_token_file.
"""
from __future__ import annotations

import json
import os
from datetime import date, timedelta, datetime
from typing import Optional

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from sqlalchemy.orm import Session

from ..config import settings
from ..models import Occurrence, OccurrenceStatus

SCOPES = ["https://www.googleapis.com/auth/calendar"]

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
}


def get_auth_url(state: str = "") -> str:
    """Return the Google OAuth consent URL."""
    flow = _build_flow()
    auth_url, _ = flow.authorization_url(
        access_type="offline",
        state=state,
        prompt="consent",
    )
    return auth_url


def exchange_code(code: str) -> Credentials:
    """Exchange an authorization code for credentials and persist the token."""
    flow = _build_flow()
    flow.fetch_token(code=code)
    creds = flow.credentials
    _save_token(creds)
    return creds


def get_credentials() -> Optional[Credentials]:
    """Load credentials from token file, refreshing if expired."""
    token_path = settings.google_token_file
    if not os.path.exists(token_path):
        return None

    creds = Credentials.from_authorized_user_file(token_path, SCOPES)
    if creds.expired and creds.refresh_token:
        creds.refresh(Request())
        _save_token(creds)
    return creds if creds.valid else None


def is_authenticated() -> tuple[bool, Optional[str]]:
    """Returns (authenticated, email)."""
    creds = get_credentials()
    if not creds:
        return False, None
    try:
        service = build("oauth2", "v2", credentials=creds)
        info = service.userinfo().get().execute()
        return True, info.get("email")
    except Exception:
        return True, None


def sync_occurrence(db: Session, occurrence: Occurrence) -> bool:
    """
    Push a single Occurrence to Google Calendar as an all-day event.
    Updates occurrence.gcal_event_id and occurrence.synced_at on success.
    Returns True on success.
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
        "reminders": {
            "useDefault": False,
            "overrides": reminder_overrides,
        },
        "extendedProperties": {
            "private": {
                "calendarAppId": str(occurrence.id),
                "category": event.category.name,
            }
        },
    }

    try:
        if occurrence.gcal_event_id:
            # Update existing
            service.events().update(
                calendarId=calendar_id,
                eventId=occurrence.gcal_event_id,
                body=body,
            ).execute()
        else:
            # Create new
            result = service.events().insert(
                calendarId=calendar_id, body=body
            ).execute()
            occurrence.gcal_event_id = result["id"]

        occurrence.synced_at = datetime.utcnow()
        occurrence.status = OccurrenceStatus.upcoming
        db.commit()
        return True
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
            maxResults=250,
        ).execute()
        for event in response.get("items", []):
            try:
                service.events().delete(calendarId="primary", eventId=event["id"]).execute()
                deleted += 1
                print(f"[gcal wipe] deleted event {event['id']} ({event.get('summary', '—')})")
            except HttpError as e:
                print(f"[gcal wipe] FAILED to delete event {event['id']}: {e}")
        page_token = response.get("nextPageToken")
        if not page_token:
            break
    return deleted


# ── Internals ────────────────────────────────────────────────────────────────

def _build_flow() -> Flow:
    client_config = {
        "web": {
            "client_id": settings.google_client_id,
            "client_secret": settings.google_client_secret,
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "redirect_uris": [settings.google_redirect_uri],
        }
    }
    return Flow.from_client_config(
        client_config,
        scopes=SCOPES,
        redirect_uri=settings.google_redirect_uri,
    )


def _save_token(creds: Credentials) -> None:
    with open(settings.google_token_file, "w") as f:
        f.write(creds.to_json())
