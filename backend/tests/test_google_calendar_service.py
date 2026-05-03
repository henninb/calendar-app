"""Tests for app/services/google_calendar.py"""
from __future__ import annotations

import json
import os
import time
from datetime import date
from pathlib import Path
from unittest.mock import MagicMock, Mock, patch

import pytest
from googleapiclient.errors import HttpError

import app.services.google_calendar as gcal_svc
from app.services.google_calendar import (
    CATEGORY_COLOR_MAP,
    _invalidate_auth_cache,
    _code_verifier_file,
    _execute,
    _resolve_gcal_id,
    _build_flow,
    _save_token,
    exchange_code,
    get_auth_url,
    get_credentials,
    is_authenticated,
    sync_occurrence,
    delete_gcal_event,
    wipe_all_gcal_events,
    validate_state,
)
from app.models import OccurrenceStatus


# ── Helpers ───────────────────────────────────────────────────────────────────

def _http_error(status: int, reason: str = "") -> HttpError:
    resp = Mock()
    resp.status = status
    resp.reason = reason  # str(HttpError) uses resp.reason for the retryable-reason check
    content = json.dumps({"error": {"errors": [{"reason": reason}]}}).encode()
    return HttpError(resp, content)


def _make_occurrence(occ_date=None, gcal_event_id=None, status=OccurrenceStatus.upcoming):
    occ_date = occ_date or date(2026, 5, 10)
    occ = MagicMock()
    occ.id = 42
    occ.occurrence_date = occ_date
    occ.gcal_event_id = gcal_event_id
    occ.status = status
    occ.synced_at = None
    cat = MagicMock()
    cat.name = "medical"
    event = MagicMock()
    event.title = "Test Event"
    event.description = "desc"
    event.duration_days = 1
    event.category = cat
    event.gcal_calendar_id = None
    event.reminder_days = [1]
    event.location = None
    occ.event = event
    return occ


@pytest.fixture(autouse=True)
def reset_auth_cache():
    _invalidate_auth_cache()
    yield
    _invalidate_auth_cache()


@pytest.fixture(autouse=True)
def reset_pending_flow():
    gcal_svc._pending_flow = None
    yield
    gcal_svc._pending_flow = None


# ── _invalidate_auth_cache ────────────────────────────────────────────────────

def test_invalidate_auth_cache_clears_state():
    gcal_svc._auth_cache = (True, "user@example.com")
    gcal_svc._auth_cache_time = time.monotonic()
    _invalidate_auth_cache()
    assert gcal_svc._auth_cache is None
    assert gcal_svc._auth_cache_time == 0.0


# ── _code_verifier_file ───────────────────────────────────────────────────────

def test_code_verifier_file_returns_path_in_token_dir():
    result = _code_verifier_file()
    assert isinstance(result, Path)
    assert result.name == ".pending_code_verifier"


# ── _build_flow ───────────────────────────────────────────────────────────────

def test_build_flow_uses_settings_redirect_uri():
    with patch("app.services.google_calendar.Flow.from_client_config") as mock_flow:
        mock_flow.return_value = MagicMock()
        _build_flow()
        mock_flow.assert_called_once()
        _, kwargs = mock_flow.call_args
        assert "redirect_uri" in kwargs


def test_build_flow_uses_custom_redirect_uri():
    custom_uri = "http://example.com/callback"
    with patch("app.services.google_calendar.Flow.from_client_config") as mock_flow:
        mock_flow.return_value = MagicMock()
        _build_flow(redirect_uri=custom_uri)
        _, kwargs = mock_flow.call_args
        assert kwargs["redirect_uri"] == custom_uri


# ── _save_token ───────────────────────────────────────────────────────────────

def test_save_token_writes_credentials_to_file(tmp_path):
    token_file = str(tmp_path / "token.json")
    creds = MagicMock()
    creds.to_json.return_value = '{"token": "abc"}'
    with patch("app.services.google_calendar.settings") as mock_settings:
        mock_settings.google_token_file = token_file
        _save_token(creds)
    assert os.path.exists(token_file)
    with open(token_file) as f:
        assert '"token": "abc"' in f.read()


# ── get_credentials ───────────────────────────────────────────────────────────

def test_get_credentials_returns_none_when_token_missing():
    with patch("app.services.google_calendar.settings") as mock_settings:
        mock_settings.google_token_file = "/nonexistent/path/token.json"
        result = get_credentials()
    assert result is None


def test_get_credentials_returns_valid_credentials(tmp_path):
    token_file = str(tmp_path / "token.json")
    Path(token_file).write_text("{}")
    creds = MagicMock()
    creds.expired = False
    creds.valid = True
    with patch("app.services.google_calendar.settings") as mock_settings, \
         patch("app.services.google_calendar.Credentials.from_authorized_user_file", return_value=creds):
        mock_settings.google_token_file = token_file
        result = get_credentials()
    assert result is creds


def test_get_credentials_refreshes_expired_token(tmp_path):
    token_file = str(tmp_path / "token.json")
    Path(token_file).write_text("{}")
    creds = MagicMock()
    creds.expired = True
    creds.refresh_token = "refresh_tok"
    creds.valid = True
    creds.to_json.return_value = '{"refreshed": true}'
    with patch("app.services.google_calendar.settings") as mock_settings, \
         patch("app.services.google_calendar.Credentials.from_authorized_user_file", return_value=creds), \
         patch("app.services.google_calendar.Request"):
        mock_settings.google_token_file = token_file
        result = get_credentials()
    creds.refresh.assert_called_once()
    assert result is creds


def test_get_credentials_removes_token_on_refresh_error(tmp_path):
    from google.auth.exceptions import RefreshError
    token_file = str(tmp_path / "token.json")
    Path(token_file).write_text("{}")
    creds = MagicMock()
    creds.expired = True
    creds.refresh_token = "refresh_tok"
    creds.refresh.side_effect = RefreshError("token expired")
    with patch("app.services.google_calendar.settings") as mock_settings, \
         patch("app.services.google_calendar.Credentials.from_authorized_user_file", return_value=creds), \
         patch("app.services.google_calendar.Request"):
        mock_settings.google_token_file = token_file
        result = get_credentials()
    assert result is None
    assert not os.path.exists(token_file)


def test_get_credentials_returns_none_for_invalid_creds(tmp_path):
    token_file = str(tmp_path / "token.json")
    Path(token_file).write_text("{}")
    creds = MagicMock()
    creds.expired = False
    creds.valid = False
    with patch("app.services.google_calendar.settings") as mock_settings, \
         patch("app.services.google_calendar.Credentials.from_authorized_user_file", return_value=creds):
        mock_settings.google_token_file = token_file
        result = get_credentials()
    assert result is None


# ── is_authenticated ──────────────────────────────────────────────────────────

def test_is_authenticated_returns_false_when_no_credentials():
    with patch("app.services.google_calendar.get_credentials", return_value=None):
        auth, email = is_authenticated()
    assert auth is False
    assert email is None


def test_is_authenticated_returns_true_with_valid_credentials():
    creds = MagicMock()
    cal_svc = MagicMock()
    tasks_svc = MagicMock()
    with patch("app.services.google_calendar.get_credentials", return_value=creds), \
         patch("app.services.google_calendar.build", side_effect=[cal_svc, tasks_svc]):
        auth, email = is_authenticated()
    assert auth is True
    assert email is None


def test_is_authenticated_uses_cache_on_second_call():
    creds = MagicMock()
    cal_svc = MagicMock()
    tasks_svc = MagicMock()
    with patch("app.services.google_calendar.get_credentials", return_value=creds), \
         patch("app.services.google_calendar.build", side_effect=[cal_svc, tasks_svc]) as mock_build:
        first = is_authenticated()
        second = is_authenticated()
    assert first == second == (True, None)
    # build called exactly twice (calendar+tasks on first call); second call hit cache
    assert mock_build.call_count == 2


def test_is_authenticated_clears_token_on_401(tmp_path):
    creds = MagicMock()
    token_file = str(tmp_path / "token.json")
    Path(token_file).write_text("{}")
    cal_svc = MagicMock()
    cal_svc.calendarList.return_value.list.return_value.execute.side_effect = _http_error(401)
    tasks_svc = MagicMock()
    with patch("app.services.google_calendar.get_credentials", return_value=creds), \
         patch("app.services.google_calendar.build", side_effect=[cal_svc, tasks_svc]), \
         patch("app.services.google_calendar.settings") as mock_settings:
        mock_settings.google_token_file = token_file
        auth, email = is_authenticated()
    assert auth is False
    assert not os.path.exists(token_file)


def test_is_authenticated_returns_true_on_non_401_http_error():
    creds = MagicMock()
    cal_svc = MagicMock()
    cal_svc.calendarList.return_value.list.return_value.execute.side_effect = _http_error(500)
    tasks_svc = MagicMock()
    with patch("app.services.google_calendar.get_credentials", return_value=creds), \
         patch("app.services.google_calendar.build", side_effect=[cal_svc, tasks_svc]):
        auth, email = is_authenticated()
    assert auth is True


def test_is_authenticated_returns_true_on_unexpected_exception():
    creds = MagicMock()
    cal_svc = MagicMock()
    cal_svc.calendarList.return_value.list.return_value.execute.side_effect = ConnectionError("down")
    tasks_svc = MagicMock()
    with patch("app.services.google_calendar.get_credentials", return_value=creds), \
         patch("app.services.google_calendar.build", side_effect=[cal_svc, tasks_svc]):
        auth, email = is_authenticated()
    assert auth is True


# ── validate_state ────────────────────────────────────────────────────────────

def test_validate_state_returns_false_when_file_missing(tmp_path):
    with patch("app.services.google_calendar._code_verifier_file", return_value=tmp_path / "nope"):
        assert validate_state("mystate") is False


def test_validate_state_returns_true_for_matching_state(tmp_path):
    cvf = tmp_path / ".pending_code_verifier"
    cvf.write_text(json.dumps({"state": "mystate", "code_verifier": "cv"}))
    with patch("app.services.google_calendar._code_verifier_file", return_value=cvf):
        assert validate_state("mystate") is True


def test_validate_state_returns_false_for_wrong_state(tmp_path):
    cvf = tmp_path / ".pending_code_verifier"
    cvf.write_text(json.dumps({"state": "correct_state", "code_verifier": "cv"}))
    with patch("app.services.google_calendar._code_verifier_file", return_value=cvf):
        assert validate_state("wrong_state") is False


def test_validate_state_returns_false_for_empty_expected_state(tmp_path):
    cvf = tmp_path / ".pending_code_verifier"
    cvf.write_text(json.dumps({"state": "", "code_verifier": "cv"}))
    with patch("app.services.google_calendar._code_verifier_file", return_value=cvf):
        assert validate_state("") is False


def test_validate_state_returns_false_on_json_error(tmp_path):
    cvf = tmp_path / ".pending_code_verifier"
    cvf.write_text("not-json")
    with patch("app.services.google_calendar._code_verifier_file", return_value=cvf):
        assert validate_state("mystate") is False


# ── get_auth_url ──────────────────────────────────────────────────────────────

def test_get_auth_url_returns_url_and_persists_verifier(tmp_path):
    flow = MagicMock()
    flow.authorization_url.return_value = ("https://accounts.google.com/o/oauth2/auth?foo", "state")
    flow.code_verifier = "verifier123"
    cvf = tmp_path / ".pending_code_verifier"
    with patch("app.services.google_calendar._build_flow", return_value=flow), \
         patch("app.services.google_calendar._code_verifier_file", return_value=cvf), \
         patch("app.services.google_calendar.settings") as mock_settings:
        mock_settings.google_redirect_uri = "http://localhost:8000/callback"
        url = get_auth_url(state="teststate")
    assert url == "https://accounts.google.com/o/oauth2/auth?foo"
    assert cvf.exists()
    data = json.loads(cvf.read_text())
    assert data["state"] == "teststate"
    assert data["code_verifier"] == "verifier123"


def test_get_auth_url_handles_no_code_verifier(tmp_path):
    flow = MagicMock()
    flow.authorization_url.return_value = ("https://accounts.google.com/auth", "state")
    flow.code_verifier = None
    cvf = tmp_path / ".pending_code_verifier"
    with patch("app.services.google_calendar._build_flow", return_value=flow), \
         patch("app.services.google_calendar._code_verifier_file", return_value=cvf), \
         patch("app.services.google_calendar.settings") as mock_settings:
        mock_settings.google_redirect_uri = "http://localhost:8000/callback"
        url = get_auth_url()
    assert url == "https://accounts.google.com/auth"


# ── exchange_code ─────────────────────────────────────────────────────────────

def test_exchange_code_uses_pending_flow(tmp_path):
    creds = MagicMock()
    creds.to_json.return_value = "{}"
    flow = MagicMock()
    flow.code_verifier = "verifier"
    flow.credentials = creds
    gcal_svc._pending_flow = flow
    cvf = tmp_path / ".pending_code_verifier"
    with patch("app.services.google_calendar._code_verifier_file", return_value=cvf), \
         patch("app.services.google_calendar._save_token") as mock_save, \
         patch("app.services.google_calendar._invalidate_auth_cache") as mock_inv:
        result = exchange_code("auth_code", redirect_uri="http://localhost/callback")
    flow.fetch_token.assert_called_once()
    mock_save.assert_called_once_with(creds)
    mock_inv.assert_called_once()
    assert result is creds
    assert gcal_svc._pending_flow is None


def test_exchange_code_falls_back_to_new_flow_when_no_pending(tmp_path):
    gcal_svc._pending_flow = None
    creds = MagicMock()
    creds.to_json.return_value = "{}"
    flow = MagicMock()
    flow.code_verifier = None
    flow.credentials = creds
    cvf = tmp_path / ".pending_code_verifier"
    cvf.write_text(json.dumps({"code_verifier": "cv", "redirect_uri": "http://cb", "state": "s"}))
    with patch("app.services.google_calendar._code_verifier_file", return_value=cvf), \
         patch("app.services.google_calendar._build_flow", return_value=flow), \
         patch("app.services.google_calendar._save_token"), \
         patch("app.services.google_calendar._invalidate_auth_cache"):
        result = exchange_code("auth_code")
    assert result is creds


def test_exchange_code_restores_code_verifier_from_file(tmp_path):
    gcal_svc._pending_flow = None
    creds = MagicMock()
    creds.to_json.return_value = "{}"
    flow = MagicMock()
    flow.code_verifier = None
    flow.credentials = creds
    cvf = tmp_path / ".pending_code_verifier"
    cvf.write_text(json.dumps({"code_verifier": "saved_cv", "redirect_uri": "http://cb", "state": "s"}))
    with patch("app.services.google_calendar._code_verifier_file", return_value=cvf), \
         patch("app.services.google_calendar._build_flow", return_value=flow), \
         patch("app.services.google_calendar._save_token"), \
         patch("app.services.google_calendar._invalidate_auth_cache"):
        exchange_code("auth_code")
    assert flow.code_verifier == "saved_cv"


# ── _execute ──────────────────────────────────────────────────────────────────

def test_execute_returns_result_on_success():
    request = MagicMock()
    request.execute.return_value = {"items": []}
    assert _execute(request) == {"items": []}


def test_execute_raises_immediately_on_non_rate_limit_status():
    request = MagicMock()
    request.execute.side_effect = _http_error(404)
    with pytest.raises(HttpError):
        _execute(request)


def test_execute_raises_immediately_on_403_without_retryable_reason():
    request = MagicMock()
    request.execute.side_effect = _http_error(403, "forbidden")
    with pytest.raises(HttpError):
        _execute(request)


def test_execute_retries_on_rate_limit_then_succeeds():
    request = MagicMock()
    error = _http_error(429, "rateLimitExceeded")
    request.execute.side_effect = [error, {"id": "abc"}]
    with patch("app.services.google_calendar.time.sleep"):
        result = _execute(request)
    assert result == {"id": "abc"}
    assert request.execute.call_count == 2


def test_execute_raises_after_max_retries_exhausted():
    request = MagicMock()
    request.execute.side_effect = _http_error(429, "rateLimitExceeded")
    with patch("app.services.google_calendar.time.sleep"), pytest.raises(HttpError):
        _execute(request)
    assert request.execute.call_count == 6  # _MAX_RETRIES


def test_execute_retries_on_403_quota_exceeded():
    request = MagicMock()
    error = _http_error(403, "quotaExceeded")
    request.execute.side_effect = [error, {"id": "ok"}]
    with patch("app.services.google_calendar.time.sleep"):
        result = _execute(request)
    assert result == {"id": "ok"}


def test_execute_retries_on_user_rate_limit():
    request = MagicMock()
    error = _http_error(429, "userRateLimitExceeded")
    request.execute.side_effect = [error, {"done": True}]
    with patch("app.services.google_calendar.time.sleep"):
        result = _execute(request)
    assert result == {"done": True}


# ── _resolve_gcal_id ──────────────────────────────────────────────────────────

def test_resolve_gcal_id_updates_existing_event():
    occ = _make_occurrence(gcal_event_id="evt123")
    svc = MagicMock()
    call_count = [0]
    def mock_exec(request):
        call_count[0] += 1
        return {"id": "evt123"}
    with patch("app.services.google_calendar._execute", side_effect=mock_exec):
        gcal_id, action = _resolve_gcal_id(svc, occ, "primary", {})
    assert gcal_id == "evt123"
    assert action == "updated"
    assert call_count[0] == 1


def test_resolve_gcal_id_inserts_when_stored_event_missing_in_gcal():
    occ = _make_occurrence(gcal_event_id="missing_evt")
    svc = MagicMock()
    call_count = [0]
    def mock_exec(request):
        call_count[0] += 1
        if call_count[0] == 1:
            raise _http_error(404)
        if call_count[0] == 2:
            return {"items": []}
        return {"id": "new_evt_id"}
    with patch("app.services.google_calendar._execute", side_effect=mock_exec):
        gcal_id, action = _resolve_gcal_id(svc, occ, "primary", {})
    assert gcal_id == "new_evt_id"
    assert action == "inserted"


def test_resolve_gcal_id_inserts_when_no_gcal_event_id():
    occ = _make_occurrence(gcal_event_id=None)
    svc = MagicMock()
    call_count = [0]
    def mock_exec(request):
        call_count[0] += 1
        if call_count[0] == 1:
            return {"items": []}
        return {"id": "brand_new"}
    with patch("app.services.google_calendar._execute", side_effect=mock_exec):
        gcal_id, action = _resolve_gcal_id(svc, occ, "primary", {})
    assert gcal_id == "brand_new"
    assert action == "inserted"


def test_resolve_gcal_id_updates_found_event_with_matching_date():
    occ = _make_occurrence(gcal_event_id=None)
    occ.occurrence_date = date(2026, 5, 10)
    svc = MagicMock()
    found_event = {"id": "found_evt", "start": {"date": "2026-05-10"}}
    call_count = [0]
    def mock_exec(request):
        call_count[0] += 1
        if call_count[0] == 1:
            return {"items": [found_event]}
        return {"id": "found_evt"}
    with patch("app.services.google_calendar._execute", side_effect=mock_exec):
        gcal_id, action = _resolve_gcal_id(svc, occ, "primary", {})
    assert gcal_id == "found_evt"
    assert action == "updated"


def test_resolve_gcal_id_replaces_stale_event_with_wrong_date():
    occ = _make_occurrence(gcal_event_id=None)
    occ.occurrence_date = date(2026, 5, 10)
    svc = MagicMock()
    found_event = {"id": "stale_evt", "start": {"date": "2025-01-01"}}
    call_count = [0]
    def mock_exec(request):
        call_count[0] += 1
        if call_count[0] == 1:
            return {"items": [found_event]}
        return {"id": "fresh_evt"}
    with patch("app.services.google_calendar._execute", side_effect=mock_exec):
        gcal_id, action = _resolve_gcal_id(svc, occ, "primary", {})
    assert action == "inserted"
    assert gcal_id == "fresh_evt"
    svc.events.return_value.delete.assert_called_once()


# ── sync_occurrence ───────────────────────────────────────────────────────────

def test_sync_occurrence_raises_when_not_authenticated():
    db = MagicMock()
    occ = _make_occurrence()
    with patch("app.services.google_calendar.get_credentials", return_value=None):
        with pytest.raises(RuntimeError, match="Not authenticated"):
            sync_occurrence(db, occ)


def test_sync_occurrence_inserts_new_event():
    db = MagicMock()
    occ = _make_occurrence()
    creds = MagicMock()
    svc = MagicMock()
    with patch("app.services.google_calendar.get_credentials", return_value=creds), \
         patch("app.services.google_calendar.build", return_value=svc), \
         patch("app.services.google_calendar._resolve_gcal_id", return_value=("new_id", "inserted")):
        result = sync_occurrence(db, occ)
    assert result == "inserted"
    assert occ.gcal_event_id == "new_id"
    db.commit.assert_called_once()


def test_sync_occurrence_skips_get_credentials_when_creds_provided():
    db = MagicMock()
    occ = _make_occurrence()
    creds = MagicMock()
    svc = MagicMock()
    with patch("app.services.google_calendar.get_credentials") as mock_get_creds, \
         patch("app.services.google_calendar.build", return_value=svc), \
         patch("app.services.google_calendar._resolve_gcal_id", return_value=("evt_id", "updated")):
        sync_occurrence(db, occ, creds=creds)
    mock_get_creds.assert_not_called()


def test_sync_occurrence_adds_location_to_body():
    db = MagicMock()
    occ = _make_occurrence()
    occ.event.location = "Central Park"
    creds = MagicMock()
    svc = MagicMock()
    captured = {}
    def capture_resolve(service, occurrence, calendar_id, body):
        captured.update(body)
        return ("evt_id", "inserted")
    with patch("app.services.google_calendar.get_credentials", return_value=creds), \
         patch("app.services.google_calendar.build", return_value=svc), \
         patch("app.services.google_calendar._resolve_gcal_id", side_effect=capture_resolve):
        sync_occurrence(db, occ)
    assert captured.get("location") == "Central Park"


def test_sync_occurrence_raises_on_http_error():
    db = MagicMock()
    occ = _make_occurrence()
    creds = MagicMock()
    svc = MagicMock()
    with patch("app.services.google_calendar.get_credentials", return_value=creds), \
         patch("app.services.google_calendar.build", return_value=svc), \
         patch("app.services.google_calendar._resolve_gcal_id", side_effect=_http_error(500)):
        with pytest.raises(RuntimeError, match="Google Calendar API error"):
            sync_occurrence(db, occ)


def test_sync_occurrence_preserves_completed_status():
    db = MagicMock()
    occ = _make_occurrence(status=OccurrenceStatus.completed)
    creds = MagicMock()
    svc = MagicMock()
    with patch("app.services.google_calendar.get_credentials", return_value=creds), \
         patch("app.services.google_calendar.build", return_value=svc), \
         patch("app.services.google_calendar._resolve_gcal_id", return_value=("evt_id", "updated")):
        sync_occurrence(db, occ)
    assert occ.status == OccurrenceStatus.completed


def test_sync_occurrence_sets_upcoming_status_for_non_terminal():
    db = MagicMock()
    occ = _make_occurrence(status=OccurrenceStatus.overdue)
    creds = MagicMock()
    svc = MagicMock()
    with patch("app.services.google_calendar.get_credentials", return_value=creds), \
         patch("app.services.google_calendar.build", return_value=svc), \
         patch("app.services.google_calendar._resolve_gcal_id", return_value=("evt_id", "updated")):
        sync_occurrence(db, occ)
    # overdue is in the terminal set, so status is NOT reset to upcoming
    assert occ.status == OccurrenceStatus.overdue


# ── delete_gcal_event ─────────────────────────────────────────────────────────

def test_delete_gcal_event_noop_when_no_gcal_event_id():
    occ = _make_occurrence(gcal_event_id=None)
    with patch("app.services.google_calendar.get_credentials") as mock_creds:
        delete_gcal_event(occ)
    mock_creds.assert_not_called()


def test_delete_gcal_event_raises_when_not_authenticated():
    occ = _make_occurrence(gcal_event_id="evt123")
    with patch("app.services.google_calendar.get_credentials", return_value=None):
        with pytest.raises(RuntimeError, match="Not authenticated"):
            delete_gcal_event(occ)


def test_delete_gcal_event_calls_api():
    occ = _make_occurrence(gcal_event_id="evt123")
    creds = MagicMock()
    svc = MagicMock()
    with patch("app.services.google_calendar.get_credentials", return_value=creds), \
         patch("app.services.google_calendar.build", return_value=svc):
        delete_gcal_event(occ)
    svc.events.return_value.delete.assert_called_once_with(
        calendarId="primary", eventId="evt123"
    )


def test_delete_gcal_event_raises_on_http_error():
    occ = _make_occurrence(gcal_event_id="evt123")
    creds = MagicMock()
    svc = MagicMock()
    svc.events.return_value.delete.return_value.execute.side_effect = _http_error(500)
    with patch("app.services.google_calendar.get_credentials", return_value=creds), \
         patch("app.services.google_calendar.build", return_value=svc):
        with pytest.raises(RuntimeError, match="Google Calendar API error"):
            delete_gcal_event(occ)


# ── wipe_all_gcal_events ──────────────────────────────────────────────────────

def test_wipe_all_gcal_events_raises_when_not_authenticated():
    with patch("app.services.google_calendar.get_credentials", return_value=None):
        with pytest.raises(RuntimeError, match="Not authenticated"):
            wipe_all_gcal_events()


def test_wipe_all_gcal_events_returns_deleted_count():
    creds = MagicMock()
    svc = MagicMock()
    svc.events.return_value.list.return_value.execute.return_value = {
        "items": [{"id": "e1", "summary": "E1"}, {"id": "e2", "summary": "E2"}],
    }
    with patch("app.services.google_calendar.get_credentials", return_value=creds), \
         patch("app.services.google_calendar.build", return_value=svc), \
         patch("app.services.google_calendar.settings") as mock_settings:
        mock_settings.gcal_max_results = 250
        count = wipe_all_gcal_events()
    assert count == 2


def test_wipe_all_gcal_events_handles_pagination():
    creds = MagicMock()
    svc = MagicMock()
    svc.events.return_value.list.return_value.execute.side_effect = [
        {"items": [{"id": "e1"}], "nextPageToken": "tok1"},
        {"items": [{"id": "e2"}, {"id": "e3"}]},
    ]
    with patch("app.services.google_calendar.get_credentials", return_value=creds), \
         patch("app.services.google_calendar.build", return_value=svc), \
         patch("app.services.google_calendar.settings") as mock_settings:
        mock_settings.gcal_max_results = 250
        count = wipe_all_gcal_events()
    assert count == 3


def test_wipe_all_gcal_events_skips_failed_deletes():
    creds = MagicMock()
    svc = MagicMock()
    svc.events.return_value.list.return_value.execute.return_value = {
        "items": [{"id": "e1"}, {"id": "e2"}],
    }
    svc.events.return_value.delete.return_value.execute.side_effect = [
        _http_error(403),
        None,
    ]
    with patch("app.services.google_calendar.get_credentials", return_value=creds), \
         patch("app.services.google_calendar.build", return_value=svc), \
         patch("app.services.google_calendar.settings") as mock_settings:
        mock_settings.gcal_max_results = 250
        count = wipe_all_gcal_events()
    assert count == 1


def test_wipe_all_gcal_events_empty_calendar():
    creds = MagicMock()
    svc = MagicMock()
    svc.events.return_value.list.return_value.execute.return_value = {"items": []}
    with patch("app.services.google_calendar.get_credentials", return_value=creds), \
         patch("app.services.google_calendar.build", return_value=svc), \
         patch("app.services.google_calendar.settings") as mock_settings:
        mock_settings.gcal_max_results = 250
        count = wipe_all_gcal_events()
    assert count == 0


# ── CATEGORY_COLOR_MAP ────────────────────────────────────────────────────────

def test_category_color_map_has_expected_categories():
    expected = {
        "birthday", "car_maintenance", "house_maintenance", "holiday", "finance",
        "medical", "dental", "payment", "property_tax", "tax", "credit_card",
        "software", "other", "mlb", "nba", "nhl",
    }
    assert set(CATEGORY_COLOR_MAP.keys()) == expected


def test_category_color_map_values_are_strings_1_to_11():
    for key, val in CATEGORY_COLOR_MAP.items():
        assert val.isdigit(), f"{key!r} has non-digit colorId {val!r}"
        assert 1 <= int(val) <= 11, f"{key!r} colorId {val!r} out of range"
