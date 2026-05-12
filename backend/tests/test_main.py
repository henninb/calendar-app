"""Tests for app/main.py — health endpoint, middleware, and lifespan."""
from __future__ import annotations

import asyncio
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient


# ── Health endpoint ───────────────────────────────────────────────────────────

class TestHealthEndpoint:
    def test_health_ok(self, client: TestClient):
        resp = client.get("/health")
        assert resp.status_code == 200
        assert resp.json()["status"] == "ok"

    def test_health_db_error_returns_503(self, client: TestClient):
        with patch("app.main.engine") as mock_engine:
            mock_engine.connect.side_effect = Exception("db down")
            resp = client.get("/health")
        assert resp.status_code == 503
        data = resp.json()
        assert data["status"] == "error"
        assert "database" in data["detail"]

    def test_health_includes_auth_open_when_no_api_key(self, client: TestClient):
        # Conftest sets API_KEY="" (falsy), so auth:open is always present in tests
        resp = client.get("/health")
        assert resp.status_code == 200
        assert resp.json().get("auth") == "open"

    def test_health_no_auth_field_when_api_key_set(self, client: TestClient):
        conn = MagicMock()
        conn.__enter__ = lambda s: conn
        conn.__exit__ = MagicMock(return_value=False)
        mock_engine = MagicMock()
        mock_engine.connect.return_value = conn
        with patch("app.main.settings") as mock_settings, \
             patch("app.main.engine", mock_engine):
            mock_settings.api_key = "secret-key"
            resp = client.get("/health")
        assert "auth" not in resp.json()


# ── Security headers middleware ───────────────────────────────────────────────

class TestSecurityHeadersMiddleware:
    def test_security_headers_present(self, client: TestClient):
        resp = client.get("/health")
        assert resp.headers.get("X-Content-Type-Options") == "nosniff"
        assert resp.headers.get("X-Frame-Options") == "DENY"
        assert resp.headers.get("Referrer-Policy") == "strict-origin-when-cross-origin"
        assert "max-age=31536000" in resp.headers.get("Strict-Transport-Security", "")

    def test_cache_control_on_api_routes(self, client: TestClient):
        with patch("app.routers.sync.gcal.is_authenticated", return_value=(False, None)):
            resp = client.get("/api/sync/auth/status")
        assert resp.headers.get("Cache-Control") == "no-store"

    def test_no_cache_control_header_on_non_api_routes(self, client: TestClient):
        resp = client.get("/health")
        assert resp.headers.get("Cache-Control") != "no-store"


# ── Lifespan ──────────────────────────────────────────────────────────────────

class TestLifespan:
    def _run_lifespan(self, *, api_key="test-key", token_path="/safe/path/token.json",
                      default_person="", person_exists=True):
        """Run the actual lifespan context manager in an event loop with mocked deps."""
        from app.main import lifespan

        async def _inner():
            conn = MagicMock()
            conn.__enter__ = lambda s: conn
            conn.__exit__ = MagicMock(return_value=False)
            mock_engine = MagicMock()
            mock_engine.connect.return_value = conn

            mock_db = MagicMock()
            mock_db.query.return_value.first.return_value = (
                MagicMock() if person_exists else None
            )
            mock_db.query.return_value.filter.return_value.all.return_value = []

            mock_start = MagicMock()
            mock_stop = MagicMock()
            mock_log = MagicMock()

            with patch("app.main.Base.metadata.create_all"), \
                 patch("app.main.engine", mock_engine), \
                 patch("app.main.SessionLocal", return_value=mock_db), \
                 patch("app.main.mark_overdue"), \
                 patch("app.main.generate_all_occurrences"), \
                 patch("app.main.generate_credit_card_occurrences"), \
                 patch("app.main.generate_pending_tasks"), \
                 patch("app.main.start_scheduler", mock_start), \
                 patch("app.main.stop_scheduler", mock_stop), \
                 patch("app.main.log", mock_log), \
                 patch("app.main.settings") as mock_settings:

                mock_settings.api_key = api_key
                mock_settings.google_token_file = token_path
                mock_settings.default_person_name = default_person

                async with lifespan(MagicMock()):
                    pass

            return mock_start, mock_stop, mock_log

        return asyncio.run(_inner())

    def test_lifespan_calls_start_and_stop_scheduler(self):
        mock_start, mock_stop, _ = self._run_lifespan()
        mock_start.assert_called_once()
        mock_stop.assert_called_once()

    def test_lifespan_warns_when_no_api_key(self):
        _, _, mock_log = self._run_lifespan(api_key="")
        warning_messages = [str(call) for call in mock_log.warning.call_args_list]
        assert any("API_KEY" in msg or "open" in msg for msg in warning_messages)

    def test_lifespan_warns_on_suspicious_token_dir(self):
        _, _, mock_log = self._run_lifespan(token_path="/var/www/static/token.json")
        warning_messages = [str(call) for call in mock_log.warning.call_args_list]
        assert any("web-accessible" in msg or "static" in msg.lower() for msg in warning_messages)

    def test_lifespan_seeds_default_person_when_absent(self):
        from app.main import lifespan

        async def _inner():
            conn = MagicMock()
            conn.__enter__ = lambda s: conn
            conn.__exit__ = MagicMock(return_value=False)
            mock_engine = MagicMock()
            mock_engine.connect.return_value = conn

            mock_db = MagicMock()
            mock_db.query.return_value.first.return_value = None  # no Person yet
            mock_db.query.return_value.filter.return_value.all.return_value = []

            with patch("app.main.Base.metadata.create_all"), \
                 patch("app.main.engine", mock_engine), \
                 patch("app.main.SessionLocal", return_value=mock_db), \
                 patch("app.main.mark_overdue"), \
                 patch("app.main.generate_all_occurrences"), \
                 patch("app.main.generate_credit_card_occurrences"), \
                 patch("app.main.generate_pending_tasks"), \
                 patch("app.main.start_scheduler"), \
                 patch("app.main.stop_scheduler"), \
                 patch("app.main.settings") as mock_settings:

                mock_settings.api_key = "key"
                mock_settings.google_token_file = "/safe/token.json"
                mock_settings.default_person_name = "Alice"

                async with lifespan(MagicMock()):
                    pass

            return mock_db.add.called, mock_db.commit.called

        added, committed = asyncio.run(_inner())
        assert added
        assert committed

    def test_lifespan_calls_generate_credit_card_occurrences_for_active_cards(self):
        from app.main import lifespan

        async def _inner():
            conn = MagicMock()
            conn.__enter__ = lambda s: conn
            conn.__exit__ = MagicMock(return_value=False)
            mock_engine = MagicMock()
            mock_engine.connect.return_value = conn

            mock_card = MagicMock()
            mock_db = MagicMock()
            mock_db.query.return_value.first.return_value = MagicMock()  # Person exists
            mock_db.query.return_value.filter.return_value.all.return_value = [mock_card]

            mock_gen_card = MagicMock()

            with patch("app.main.Base.metadata.create_all"), \
                 patch("app.main.engine", mock_engine), \
                 patch("app.main.SessionLocal", return_value=mock_db), \
                 patch("app.main.mark_overdue"), \
                 patch("app.main.generate_all_occurrences"), \
                 patch("app.main.generate_credit_card_occurrences", mock_gen_card), \
                 patch("app.main.generate_pending_tasks"), \
                 patch("app.main.start_scheduler"), \
                 patch("app.main.stop_scheduler"), \
                 patch("app.main.settings") as mock_settings:

                mock_settings.api_key = "key"
                mock_settings.google_token_file = "/safe/token.json"
                mock_settings.default_person_name = ""

                async with lifespan(MagicMock()):
                    pass

            return mock_gen_card.called

        called = asyncio.run(_inner())
        assert called

    def test_lifespan_migration_error_raises(self):
        from app.main import lifespan

        async def _inner():
            conn = MagicMock()
            conn.__enter__ = lambda s: conn
            conn.__exit__ = MagicMock(return_value=False)
            conn.execute.side_effect = Exception("migration failed")
            mock_engine = MagicMock()
            mock_engine.connect.return_value = conn

            with patch("app.main.Base.metadata.create_all"), \
                 patch("app.main.engine", mock_engine), \
                 patch("app.main.start_scheduler"), \
                 patch("app.main.stop_scheduler"), \
                 patch("app.main.settings") as mock_settings:

                mock_settings.api_key = "key"
                mock_settings.google_token_file = "/safe/token.json"
                mock_settings.default_person_name = ""

                try:
                    async with lifespan(MagicMock()):
                        pass
                    return False  # did not raise
                except Exception:
                    return True  # raised as expected

        raised = asyncio.run(_inner())
        assert raised
