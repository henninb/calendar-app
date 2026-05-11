"""Tests for app/routers/sync.py"""
from __future__ import annotations

import json
from datetime import date, timedelta
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient


# ── Helpers ───────────────────────────────────────────────────────────────────

def _make_occurrence(occ_id: int = 1, gcal_event_id: str | None = None):
    occ = MagicMock()
    occ.id = occ_id
    occ.occurrence_date = date(2026, 6, 1)
    occ.gcal_event_id = gcal_event_id
    occ.synced_at = None
    occ.event = MagicMock()
    occ.event.title = "Test Event"
    occ.event.description = None
    occ.event.location = None
    occ.event.duration_days = 1
    occ.event.amount = None
    occ.event.category = MagicMock()
    occ.event.category.name = "general"
    return occ


# ── _redirect_uri ─────────────────────────────────────────────────────────────

class TestRedirectUri:
    def test_uses_forwarded_headers(self, client: TestClient):
        from app.routers.sync import _redirect_uri
        from starlette.testclient import TestClient as StarletteClient
        from starlette.requests import Request

        scope = {
            "type": "http",
            "method": "GET",
            "path": "/api/sync/auth",
            "headers": [
                (b"x-forwarded-proto", b"https"),
                (b"x-forwarded-host", b"calendar.example.com"),
                (b"host", b"localhost"),
            ],
            "query_string": b"",
        }
        request = Request(scope)
        with patch("app.routers.sync.settings") as mock_settings:
            mock_settings.google_redirect_uri = "https://calendar.example.com/api/sync/auth/callback"
            result = _redirect_uri(request)
        assert result == "https://calendar.example.com/api/sync/auth/callback"

    def test_falls_back_to_configured_when_mismatch(self):
        from app.routers.sync import _redirect_uri
        from starlette.requests import Request

        scope = {
            "type": "http",
            "method": "GET",
            "path": "/api/sync/auth",
            "headers": [
                (b"host", b"spoofed.evil.com"),
            ],
            "query_string": b"",
        }
        request = Request(scope)
        with patch("app.routers.sync.settings") as mock_settings:
            mock_settings.google_redirect_uri = "https://real.example.com/api/sync/auth/callback"
            result = _redirect_uri(request)
        assert result == "https://real.example.com/api/sync/auth/callback"


# ── OAuth endpoints ───────────────────────────────────────────────────────────

class TestAuthStatus:
    def test_authenticated(self, client: TestClient):
        with patch("app.routers.sync.gcal.is_authenticated", return_value=(True, "user@example.com")):
            resp = client.get("/api/sync/auth/status")
        assert resp.status_code == 200
        data = resp.json()
        assert data["authenticated"] is True
        assert data["email"] == "user@example.com"

    def test_not_authenticated(self, client: TestClient):
        with patch("app.routers.sync.gcal.is_authenticated", return_value=(False, None)):
            resp = client.get("/api/sync/auth/status")
        assert resp.status_code == 200
        assert resp.json()["authenticated"] is False


class TestStartAuth:
    def test_redirects_to_google(self, client: TestClient):
        with patch("app.routers.sync.gcal.get_auth_url", return_value="https://accounts.google.com/o/oauth2/auth?foo=1"):
            with patch("app.routers.sync.settings") as mock_settings:
                mock_settings.google_redirect_uri = "http://localhost:8000/api/sync/auth/callback"
                resp = client.get("/api/sync/auth", follow_redirects=False)
        assert resp.status_code in (302, 307)
        assert "google" in resp.headers["location"]


class TestAuthCallback:
    def test_valid_code_redirects_home(self, client: TestClient):
        with patch("app.routers.sync.gcal.validate_state", return_value=True):
            with patch("app.routers.sync.gcal.exchange_code"):
                with patch("app.routers.sync.settings") as mock_settings:
                    mock_settings.google_redirect_uri = "http://localhost:8000/api/sync/auth/callback"
                    resp = client.get(
                        "/api/sync/auth/callback",
                        params={"code": "auth-code", "state": "valid-state"},
                        follow_redirects=False,
                    )
        assert resp.status_code in (302, 307)
        assert resp.headers["location"] == "/"

    def test_invalid_state_returns_400(self, client: TestClient):
        with patch("app.routers.sync.gcal.validate_state", return_value=False):
            resp = client.get(
                "/api/sync/auth/callback",
                params={"code": "some-code", "state": "bad-state"},
            )
        assert resp.status_code == 400
        assert "CSRF" in resp.json()["detail"] or "state" in resp.json()["detail"].lower()

    def test_exchange_failure_returns_400(self, client: TestClient):
        with patch("app.routers.sync.gcal.validate_state", return_value=True):
            with patch("app.routers.sync.gcal.exchange_code", side_effect=Exception("oauth error")):
                with patch("app.routers.sync.settings") as mock_settings:
                    mock_settings.google_redirect_uri = "http://testserver/api/sync/auth/callback"
                    resp = client.get(
                        "/api/sync/auth/callback",
                        params={"code": "bad-code", "state": "ok"},
                    )
        assert resp.status_code == 400


# ── ICS export ────────────────────────────────────────────────────────────────

class TestExportIcs:
    def test_returns_ics_content_type(self, client: TestClient):
        resp = client.get("/api/sync/export/ics")
        assert resp.status_code == 200
        assert "text/calendar" in resp.headers["content-type"]

    def test_returns_ics_with_occurrences(self, client: TestClient):
        resp = client.get("/api/sync/export/ics")
        assert resp.status_code == 200
        content = resp.content.decode()
        assert "BEGIN:VCALENDAR" in content

    def test_end_before_start_returns_400(self, client: TestClient):
        resp = client.get(
            "/api/sync/export/ics",
            params={"start_date": "2026-12-01", "end_date": "2026-01-01"},
        )
        assert resp.status_code == 400
        assert "end_date" in resp.json()["detail"]

    def test_range_exceeding_5_years_returns_400(self, client: TestClient):
        resp = client.get(
            "/api/sync/export/ics",
            params={"start_date": "2020-01-01", "end_date": "2026-01-01"},
        )
        assert resp.status_code == 400
        assert "5 years" in resp.json()["detail"]

    def test_custom_date_range(self, client: TestClient):
        resp = client.get(
            "/api/sync/export/ics",
            params={"start_date": "2026-01-01", "end_date": "2026-03-01"},
        )
        assert resp.status_code == 200

    def test_content_disposition_header(self, client: TestClient):
        resp = client.get("/api/sync/export/ics")
        assert "attachment" in resp.headers.get("content-disposition", "")
        assert ".ics" in resp.headers.get("content-disposition", "")


# ── GCal sync endpoints ───────────────────────────────────────────────────────

class TestDeleteAllGcalEvents:
    def test_returns_sync_result(self, client: TestClient):
        resp = client.delete("/api/sync/gcal")
        assert resp.status_code == 200
        data = resp.json()
        assert "synced" in data
        assert "failed" in data

    def test_background_message_in_response(self, client: TestClient):
        resp = client.delete("/api/sync/gcal")
        assert "background" in resp.json().get("message", "").lower()


class TestWipeAllGcalEvents:
    def test_missing_confirm_header_returns_400(self, client: TestClient):
        resp = client.delete("/api/sync/gcal/wipe-all")
        assert resp.status_code == 400
        assert "X-Confirm-Delete" in resp.json()["detail"]

    def test_wrong_confirm_value_returns_400(self, client: TestClient):
        resp = client.delete("/api/sync/gcal/wipe-all", headers={"X-Confirm-Delete": "no"})
        assert resp.status_code == 400

    def test_correct_header_triggers_wipe(self, client: TestClient):
        with patch("app.routers.sync.gcal.wipe_all_gcal_events", return_value=5):
            resp = client.delete("/api/sync/gcal/wipe-all", headers={"X-Confirm-Delete": "yes"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["synced"] == 5

    def test_gcal_error_returns_500(self, client: TestClient):
        with patch("app.routers.sync.gcal.wipe_all_gcal_events", side_effect=Exception("api down")):
            resp = client.delete("/api/sync/gcal/wipe-all", headers={"X-Confirm-Delete": "yes"})
        assert resp.status_code == 500


class TestSyncSingle:
    def test_not_found_returns_404(self, client: TestClient):
        resp = client.post("/api/sync/gcal/99999")
        assert resp.status_code == 404

    def test_sync_error_returns_502(self, client: TestClient):
        from app.models import Base, Occurrence, Event, Category
        from tests.conftest import _TestSession

        db = _TestSession()
        try:
            # Insert the minimum required records
            cat = Category(name="work", color="#000", icon="w")
            db.add(cat)
            db.flush()
            event = Event(
                title="Test",
                category_id=cat.id,
                dtstart=date(2026, 6, 1),
            )
            db.add(event)
            db.flush()
            occ = Occurrence(
                event_id=event.id,
                occurrence_date=date(2026, 6, 1),
            )
            db.add(occ)
            db.commit()
            occ_id = occ.id
        finally:
            db.close()

        with patch("app.routers.sync.gcal.sync_occurrence", side_effect=Exception("gcal error")):
            resp = client.post(f"/api/sync/gcal/{occ_id}")
        assert resp.status_code == 502


# ── _gcal_sync_events (SSE generator) ────────────────────────────────────────

class TestGcalSyncEvents:
    def test_not_authenticated_yields_done_with_error(self):
        from app.routers.sync import _gcal_sync_events

        with patch("app.routers.sync.SessionLocal") as mock_sl:
            mock_db = MagicMock()
            # _gcal_sync_events chains: .query().filter().filter().all() (force=False adds second filter)
            mock_db.query.return_value.filter.return_value.filter.return_value.all.return_value = [MagicMock(id=1)]
            mock_sl.return_value = mock_db

            with patch("app.routers.sync.gcal.get_credentials", return_value=None):
                events = list(_gcal_sync_events(days_ahead=30))

        payloads = [json.loads(e.replace("data: ", "").strip()) for e in events if e.strip()]
        done = next(p for p in payloads if p["type"] == "done")
        assert done["failed"] >= 1
        assert len(done["errors"]) > 0

    def test_empty_occurrence_list_yields_done_immediately(self):
        from app.routers.sync import _gcal_sync_events

        with patch("app.routers.sync.SessionLocal") as mock_sl:
            mock_db = MagicMock()
            mock_db.query.return_value.filter.return_value.all.return_value = []
            mock_sl.return_value = mock_db

            with patch("app.routers.sync.gcal.get_credentials", return_value=MagicMock()):
                events = list(_gcal_sync_events(days_ahead=30))

        payloads = [json.loads(e.replace("data: ", "").strip()) for e in events if e.strip()]
        types = [p["type"] for p in payloads]
        assert "start" in types
        assert "done" in types
        assert "progress" not in types


# ── _gtasks_sync_events (SSE generator) ──────────────────────────────────────

class TestGtasksSyncEvents:
    def test_tasklist_error_yields_done_with_error(self):
        from app.routers.sync import _gtasks_sync_events

        with patch("app.routers.sync.SessionLocal") as mock_sl:
            mock_db = MagicMock()
            mock_db.query.return_value.filter.return_value.all.return_value = [MagicMock(id=1)]
            mock_sl.return_value = mock_db

            with patch("app.routers.sync.gtasks.get_or_create_tasklist", side_effect=Exception("auth error")):
                events = list(_gtasks_sync_events())

        payloads = [json.loads(e.replace("data: ", "").strip()) for e in events if e.strip()]
        done = next(p for p in payloads if p["type"] == "done")
        assert done["failed"] >= 1

    def test_empty_task_list_yields_done(self):
        from app.routers.sync import _gtasks_sync_events

        with patch("app.routers.sync.SessionLocal") as mock_sl:
            mock_db = MagicMock()
            mock_db.query.return_value.filter.return_value.all.return_value = []
            mock_sl.return_value = mock_db

            with patch("app.routers.sync.gtasks.get_or_create_tasklist", return_value=(MagicMock(), "list-id")):
                events = list(_gtasks_sync_events())

        payloads = [json.loads(e.replace("data: ", "").strip()) for e in events if e.strip()]
        types = [p["type"] for p in payloads]
        assert "done" in types


# ── _sync_one ─────────────────────────────────────────────────────────────────

class TestSyncOne:
    def test_returns_skipped_when_occurrence_not_found(self):
        from app.routers.sync import _sync_one

        with patch("app.routers.sync.SessionLocal") as mock_sl:
            mock_db = MagicMock()
            mock_db.query.return_value.options.return_value.filter.return_value.first.return_value = None
            mock_sl.return_value = mock_db

            result = _sync_one(999)

        assert result[1] == "skipped"

    def test_returns_action_on_success(self):
        from app.routers.sync import _sync_one

        occ = _make_occurrence(occ_id=10, gcal_event_id="gcal-abc")

        with patch("app.routers.sync.SessionLocal") as mock_sl:
            mock_db = MagicMock()
            mock_db.query.return_value.options.return_value.filter.return_value.first.return_value = occ
            mock_sl.return_value = mock_db

            with patch("app.routers.sync.gcal.sync_occurrence", return_value="inserted"):
                result = _sync_one(10)

        assert result[0] == 10
        assert result[1] == "inserted"

    def test_returns_failed_on_exception(self):
        from app.routers.sync import _sync_one

        with patch("app.routers.sync.SessionLocal") as mock_sl:
            mock_db = MagicMock()
            mock_db.query.return_value.options.return_value.filter.return_value.first.side_effect = Exception("db crash")
            mock_sl.return_value = mock_db

            result = _sync_one(5)

        assert result[1] == "failed"
        assert result[4] != ""


# ── _sync_one_task ────────────────────────────────────────────────────────────

class TestSyncOneTask:
    def test_returns_skipped_when_task_not_found(self):
        from app.routers.sync import _sync_one_task

        with patch("app.routers.sync.SessionLocal") as mock_sl:
            mock_db = MagicMock()
            mock_db.query.return_value.filter.return_value.first.return_value = None
            mock_sl.return_value = mock_db

            result = _sync_one_task(999, "list-id")

        assert result[1] == "skipped"

    def test_returns_action_on_success(self):
        from app.routers.sync import _sync_one_task

        mock_task = MagicMock()
        mock_task.id = 7
        mock_task.title = "Do the thing"

        with patch("app.routers.sync.SessionLocal") as mock_sl:
            mock_db = MagicMock()
            mock_db.query.return_value.filter.return_value.first.return_value = mock_task
            mock_sl.return_value = mock_db

            with patch("app.routers.sync.gtasks.sync_task", return_value="inserted"):
                result = _sync_one_task(7, "list-id")

        assert result[0] == 7
        assert result[1] == "inserted"

    def test_returns_failed_on_exception(self):
        from app.routers.sync import _sync_one_task

        with patch("app.routers.sync.SessionLocal") as mock_sl:
            mock_db = MagicMock()
            mock_db.query.return_value.filter.return_value.first.side_effect = Exception("crash")
            mock_sl.return_value = mock_db

            result = _sync_one_task(3, "list-id")

        assert result[1] == "failed"
