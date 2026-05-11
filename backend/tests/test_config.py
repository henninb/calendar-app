"""Tests for app/config.py"""
from __future__ import annotations

import subprocess
import warnings
from unittest.mock import MagicMock, patch

import pytest


# ── _gopass ───────────────────────────────────────────────────────────────────

class TestGopass:
    def test_returns_stripped_stdout(self):
        from app.config import _gopass

        mock_result = MagicMock()
        mock_result.stdout = "  secret-value\n"
        with patch("subprocess.run", return_value=mock_result) as mock_run:
            result = _gopass("some/path")

        assert result == "secret-value"
        mock_run.assert_called_once_with(
            ["gopass", "show", "-o", "some/path"],
            capture_output=True,
            text=True,
            check=True,
            timeout=10,
        )

    def test_raises_on_subprocess_error(self):
        from app.config import _gopass

        with patch("subprocess.run", side_effect=subprocess.CalledProcessError(1, "gopass")):
            with pytest.raises(subprocess.CalledProcessError):
                _gopass("bad/path")


# ── Settings._init_from_env ───────────────────────────────────────────────────

class TestInitFromEnv:
    def _make_fresh_settings(self):
        from app.config import Settings
        s = Settings()
        return s

    def _env(self, extra: dict | None = None) -> dict:
        base = {
            "DB_HOST": "db-host",
            "DB_PORT": "5432",
            "DB_NAME": "mydb",
            "DB_USERNAME": "user",
            "DB_PASSWORD": "pass",
            "GOOGLE_CLIENT_ID": "gcid",
            "GOOGLE_CLIENT_SECRET": "gcsecret",
            "GOOGLE_TOKEN_FILE": "tok.json",
            "GOOGLE_REDIRECT_URI": "http://localhost/cb",
            "OCCURRENCE_LOOKAHEAD_DAYS": "90",
            "SCHEDULER_INTERVAL_HOURS": "12",
            "TIMEZONE": "UTC",
            "ALLOWED_ORIGINS": "http://localhost:3000",
            "GCAL_MAX_RESULTS": "100",
            "CC_HISTORY_DAYS": "60",
            "DEFAULT_PERSON_NAME": "Alice",
            "API_KEY": "testkey",
        }
        if extra:
            base.update(extra)
        return base

    def test_database_url_built_correctly(self):
        s = self._make_fresh_settings()
        with patch.dict("os.environ", self._env(), clear=False):
            with patch("app.config._load_yaml", return_value={"categories": []}):
                s._init_from_env()
        assert "db-host:5432/mydb" in s.database_url
        assert "user" in s.database_url

    def test_google_fields_populated(self):
        s = self._make_fresh_settings()
        with patch.dict("os.environ", self._env(), clear=False):
            with patch("app.config._load_yaml", return_value={"categories": []}):
                s._init_from_env()
        assert s.google_client_id == "gcid"
        assert s.google_client_secret == "gcsecret"
        assert s.google_token_file == "tok.json"
        assert s.google_redirect_uri == "http://localhost/cb"

    def test_numeric_fields_cast(self):
        s = self._make_fresh_settings()
        with patch.dict("os.environ", self._env(), clear=False):
            with patch("app.config._load_yaml", return_value={"categories": []}):
                s._init_from_env()
        assert s.occurrence_lookahead_days == 90
        assert s.scheduler_interval_hours == 12
        assert s.gcal_max_results == 100
        assert s.cc_history_days == 60

    def test_allowed_origins_parsed(self):
        s = self._make_fresh_settings()
        env = self._env({"ALLOWED_ORIGINS": "http://a.com, http://b.com"})
        with patch.dict("os.environ", env, clear=False):
            with patch("app.config._load_yaml", return_value={"categories": []}):
                s._init_from_env()
        assert s.allowed_origins == ["http://a.com", "http://b.com"]

    def test_empty_allowed_origins_warns(self):
        s = self._make_fresh_settings()
        env = self._env({"ALLOWED_ORIGINS": ""})
        with patch.dict("os.environ", env, clear=False):
            with patch("app.config._load_yaml", return_value={"categories": []}):
                with pytest.warns(RuntimeWarning, match="ALLOWED_ORIGINS"):
                    s._init_from_env()

    def test_wildcard_allowed_origins_raises(self):
        s = self._make_fresh_settings()
        env = self._env({"ALLOWED_ORIGINS": "*"})
        with patch.dict("os.environ", env, clear=False):
            with patch("app.config._load_yaml", return_value={"categories": []}):
                with pytest.raises(ValueError, match="Wildcard"):
                    s._init_from_env()

    def test_default_values_used_when_optional_vars_absent(self):
        s = self._make_fresh_settings()
        env = {k: v for k, v in self._env().items()
               if k not in ("GOOGLE_TOKEN_FILE", "GOOGLE_REDIRECT_URI",
                            "OCCURRENCE_LOOKAHEAD_DAYS", "SCHEDULER_INTERVAL_HOURS",
                            "TIMEZONE", "GCAL_MAX_RESULTS", "CC_HISTORY_DAYS",
                            "DEFAULT_PERSON_NAME", "API_KEY")}
        with patch.dict("os.environ", env, clear=False):
            # Remove optional env vars from the actual environment
            import os
            keys_to_remove = ["GOOGLE_TOKEN_FILE", "GOOGLE_REDIRECT_URI",
                              "OCCURRENCE_LOOKAHEAD_DAYS", "SCHEDULER_INTERVAL_HOURS",
                              "TIMEZONE", "GCAL_MAX_RESULTS", "CC_HISTORY_DAYS",
                              "DEFAULT_PERSON_NAME"]
            saved = {k: os.environ.pop(k, None) for k in keys_to_remove}
            try:
                with patch("app.config._load_yaml", return_value={"categories": []}):
                    s._init_from_env()
                assert s.google_token_file == "token.json"
                assert s.occurrence_lookahead_days == 365
                assert s.scheduler_interval_hours == 24
                assert s.timezone == "America/Chicago"
                assert s.gcal_max_results == 250
                assert s.cc_history_days == 31
            finally:
                for k, v in saved.items():
                    if v is not None:
                        os.environ[k] = v


# ── Settings._init_from_gopass ────────────────────────────────────────────────

class TestInitFromGopass:
    def _make_yaml(self) -> dict:
        return {
            "database": {
                "gopass_username_path": "db/user",
                "gopass_password_path": "db/pass",
                "host": "pghost",
                "port": 5432,
                "name": "caldb",
            },
            "google": {
                "gopass_client_id_path": "goog/id",
                "gopass_client_secret_path": "goog/secret",
                "token_file": "token.json",
                "redirect_uri": "http://example.com/cb",
                "gcal_max_results": 200,
            },
            "scheduler": {
                "occurrence_lookahead_days": 180,
                "interval_hours": 6,
            },
            "timezone": "UTC",
            "cors": {"allowed_origins": ["http://app.example.com"]},
            "credit_cards": {"history_days": 45},
            "default_person_name": "Bob",
            "categories": ["work", "personal"],
            "api_key": {"gopass_path": "api/key"},
        }

    def test_database_url_built_from_gopass(self):
        from app.config import Settings
        s = Settings()
        gopass_vals = {
            "db/user": "dbuser",
            "db/pass": "dbpass",
            "goog/id": "client-id",
            "goog/secret": "client-secret",
            "api/key": "the-api-key",
        }
        with patch("app.config._load_yaml", return_value=self._make_yaml()):
            with patch("app.config._gopass", side_effect=lambda p: gopass_vals[p]):
                s._init_from_gopass()
        assert "pghost:5432/caldb" in s.database_url
        assert "dbuser" in s.database_url

    def test_google_credentials_from_gopass(self):
        from app.config import Settings
        s = Settings()
        gopass_vals = {
            "db/user": "u", "db/pass": "p",
            "goog/id": "my-client-id",
            "goog/secret": "my-client-secret",
            "api/key": "k",
        }
        with patch("app.config._load_yaml", return_value=self._make_yaml()):
            with patch("app.config._gopass", side_effect=lambda p: gopass_vals[p]):
                s._init_from_gopass()
        assert s.google_client_id == "my-client-id"
        assert s.google_client_secret == "my-client-secret"

    def test_numeric_fields_from_yaml(self):
        from app.config import Settings
        s = Settings()
        gopass_vals = {
            "db/user": "u", "db/pass": "p",
            "goog/id": "i", "goog/secret": "s",
            "api/key": "k",
        }
        with patch("app.config._load_yaml", return_value=self._make_yaml()):
            with patch("app.config._gopass", side_effect=lambda p: gopass_vals[p]):
                s._init_from_gopass()
        assert s.occurrence_lookahead_days == 180
        assert s.scheduler_interval_hours == 6
        assert s.gcal_max_results == 200
        assert s.cc_history_days == 45

    def test_wildcard_cors_raises(self):
        from app.config import Settings
        s = Settings()
        yaml_data = self._make_yaml()
        yaml_data["cors"]["allowed_origins"] = ["*"]
        gopass_vals = {
            "db/user": "u", "db/pass": "p",
            "goog/id": "i", "goog/secret": "s",
            "api/key": "k",
        }
        with patch("app.config._load_yaml", return_value=yaml_data):
            with patch("app.config._gopass", side_effect=lambda p: gopass_vals[p]):
                with pytest.raises(ValueError, match="Wildcard"):
                    s._init_from_gopass()

    def test_api_key_falls_back_to_env_when_no_gopass_path(self):
        from app.config import Settings
        import os
        s = Settings()
        yaml_data = self._make_yaml()
        yaml_data["api_key"] = {}  # no gopass_path
        gopass_vals = {
            "db/user": "u", "db/pass": "p",
            "goog/id": "i", "goog/secret": "s",
        }
        saved = os.environ.get("API_KEY")
        os.environ["API_KEY"] = "env-api-key"
        try:
            with patch("app.config._load_yaml", return_value=yaml_data):
                with patch("app.config._gopass", side_effect=lambda p: gopass_vals[p]):
                    s._init_from_gopass()
            assert s.api_key == "env-api-key"
        finally:
            if saved is None:
                os.environ.pop("API_KEY", None)
            else:
                os.environ["API_KEY"] = saved


# ── Settings lazy init / __getattr__ ──────────────────────────────────────────

class TestSettingsLazyInit:
    def test_private_attribute_raises_attribute_error_without_init(self):
        from app.config import Settings
        s = Settings()
        with pytest.raises(AttributeError):
            _ = s._nonexistent_private

    def test_unknown_public_attribute_raises_attribute_error(self):
        from app.config import Settings
        s = Settings()
        env = {
            "DB_HOST": "h", "DB_PORT": "5432", "DB_NAME": "db",
            "DB_USERNAME": "u", "DB_PASSWORD": "p",
            "ALLOWED_ORIGINS": "http://localhost:3000",
        }
        with patch.dict("os.environ", env, clear=False):
            with patch("app.config._load_yaml", return_value={"categories": []}):
                with pytest.raises(AttributeError, match="no attribute"):
                    _ = s.completely_unknown_field

    def test_env_path_taken_when_db_password_set(self):
        from app.config import Settings
        s = Settings()
        env = {
            "DB_HOST": "h", "DB_PORT": "5432", "DB_NAME": "db",
            "DB_USERNAME": "u", "DB_PASSWORD": "secret",
            "ALLOWED_ORIGINS": "http://localhost:3000",
        }
        with patch.dict("os.environ", env, clear=False):
            with patch("app.config._load_yaml", return_value={"categories": []}):
                with patch.object(s, "_init_from_env", wraps=s._init_from_env) as spy_env:
                    with patch.object(s, "_init_from_gopass") as spy_gopass:
                        _ = s.database_url
        spy_env.assert_called_once()
        spy_gopass.assert_not_called()

    def test_gopass_path_taken_when_db_password_not_set(self):
        from app.config import Settings
        import os
        s = Settings()
        saved = os.environ.pop("DB_PASSWORD", None)
        try:
            with patch.object(s, "_init_from_gopass") as spy_gopass:
                with patch.object(s, "_init_from_env") as spy_env:
                    spy_gopass.side_effect = lambda: s.__dict__.update({"database_url": "x"})
                    _ = s.database_url
            spy_gopass.assert_called_once()
            spy_env.assert_not_called()
        finally:
            if saved is not None:
                os.environ["DB_PASSWORD"] = saved
