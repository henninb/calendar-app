"""Tests for the API key security middleware."""
from unittest.mock import patch

import pytest
from fastapi import HTTPException


class TestOpenMode:
    """When API_KEY is empty (conftest default), all requests are allowed."""

    def test_request_without_header_passes(self, client):
        r = client.get("/api/categories")
        assert r.status_code == 200

    def test_request_with_any_key_passes(self, client):
        r = client.get("/api/categories", headers={"X-Api-Key": "arbitrary"})
        assert r.status_code == 200

    def test_request_with_empty_header_passes(self, client):
        r = client.get("/api/categories", headers={"X-Api-Key": ""})
        assert r.status_code == 200


class TestEnforcedMode:
    """When API_KEY is set, only requests with the correct key are allowed."""

    def test_correct_key_passes(self, client):
        from app.config import settings
        with patch.object(settings, "api_key", "supersecret"):
            r = client.get("/api/categories", headers={"X-Api-Key": "supersecret"})
        assert r.status_code == 200

    def test_wrong_key_returns_401(self, client):
        from app.config import settings
        with patch.object(settings, "api_key", "supersecret"):
            r = client.get("/api/categories", headers={"X-Api-Key": "wrongkey"})
        assert r.status_code == 401

    def test_missing_key_returns_401(self, client):
        from app.config import settings
        with patch.object(settings, "api_key", "supersecret"):
            r = client.get("/api/categories")
        assert r.status_code == 401

    def test_401_includes_www_authenticate_header(self, client):
        from app.config import settings
        with patch.object(settings, "api_key", "supersecret"):
            r = client.get("/api/categories")
        assert r.status_code == 401
        assert "WWW-Authenticate" in r.headers

    def test_401_detail_message(self, client):
        from app.config import settings
        with patch.object(settings, "api_key", "supersecret"):
            r = client.get("/api/categories")
        assert "API key" in r.json()["detail"]


class TestRequireApiKeyUnit:
    """Direct unit tests for the require_api_key coroutine."""

    def _run(self, coro):
        import asyncio
        return asyncio.run(coro)

    def test_open_mode_allows_none_key(self):
        from app.config import settings
        from app.security import require_api_key
        with patch.object(settings, "api_key", ""):
            self._run(require_api_key(x_api_key=None))

    def test_open_mode_allows_any_key(self):
        from app.config import settings
        from app.security import require_api_key
        with patch.object(settings, "api_key", ""):
            self._run(require_api_key(x_api_key="garbage"))

    def test_correct_key_does_not_raise(self):
        from app.config import settings
        from app.security import require_api_key
        with patch.object(settings, "api_key", "mykey"):
            self._run(require_api_key(x_api_key="mykey"))

    def test_wrong_key_raises_401(self):
        from app.config import settings
        from app.security import require_api_key
        with patch.object(settings, "api_key", "mykey"):
            with pytest.raises(HTTPException) as exc_info:
                self._run(require_api_key(x_api_key="notmykey"))
            assert exc_info.value.status_code == 401

    def test_none_key_when_required_raises_401(self):
        from app.config import settings
        from app.security import require_api_key
        with patch.object(settings, "api_key", "mykey"):
            with pytest.raises(HTTPException) as exc_info:
                self._run(require_api_key(x_api_key=None))
            assert exc_info.value.status_code == 401
