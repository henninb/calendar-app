import logging
import os
import subprocess
import warnings
from pathlib import Path
from urllib.parse import quote_plus

import yaml

_log = logging.getLogger(__name__)

_CONFIG_FILE = Path(__file__).parent.parent / "config.yml"


def _gopass(path: str) -> str:
    result = subprocess.run(
        ["gopass", "show", "-o", path],
        capture_output=True, text=True, check=True,
        timeout=10,
    )
    return result.stdout.strip()


def _load_yaml() -> dict:
    with open(_CONFIG_FILE) as f:
        return yaml.safe_load(f)


class Settings:
    def __init__(self):
        # Defer all I/O (gopass subprocess, YAML read) to first attribute access
        # so that importing this module does not block at startup or in tests.
        self.__dict__['_ready'] = False

    def _ensure_ready(self) -> None:
        if self.__dict__['_ready']:
            return
        if os.environ.get("DB_PASSWORD"):
            self._init_from_env()
        else:
            self._init_from_gopass()
        self.__dict__['_ready'] = True

    def __getattr__(self, name: str):
        if name.startswith('_'):
            raise AttributeError(name)
        self._ensure_ready()
        try:
            return self.__dict__[name]
        except KeyError:
            raise AttributeError(f"Settings has no attribute {name!r}") from None

    def _init_from_env(self):
        _log.info("Config loaded from environment variables")
        host = os.environ["DB_HOST"]
        port = os.environ["DB_PORT"]
        name = os.environ["DB_NAME"]
        user = os.environ["DB_USERNAME"]
        pwd  = os.environ["DB_PASSWORD"]
        self.database_url             = f"postgresql://{quote_plus(user)}:{quote_plus(pwd)}@{host}:{port}/{name}"
        self.google_client_id         = os.environ.get("GOOGLE_CLIENT_ID", "")
        self.google_client_secret     = os.environ.get("GOOGLE_CLIENT_SECRET", "")
        self.google_token_file        = os.environ.get("GOOGLE_TOKEN_FILE", "token.json")
        self.google_redirect_uri      = os.environ.get("GOOGLE_REDIRECT_URI", "http://localhost:8000/api/sync/auth/callback")
        self.occurrence_lookahead_days = int(os.environ.get("OCCURRENCE_LOOKAHEAD_DAYS", "365"))
        self.scheduler_interval_hours  = int(os.environ.get("SCHEDULER_INTERVAL_HOURS", "24"))
        self.timezone                  = os.environ.get("TIMEZONE", "America/Chicago")
        origins_raw                    = os.environ.get("ALLOWED_ORIGINS", "")
        self.allowed_origins           = [o.strip() for o in origins_raw.split(",") if o.strip()]
        if not self.allowed_origins:
            warnings.warn(
                "ALLOWED_ORIGINS is not set — all cross-origin requests will be blocked by CORS middleware.",
                RuntimeWarning,
                stacklevel=2,
            )
        self.gcal_max_results          = int(os.environ.get("GCAL_MAX_RESULTS", "250"))
        self.cc_history_days           = int(os.environ.get("CC_HISTORY_DAYS", "31"))
        self.default_person_name       = os.environ.get("DEFAULT_PERSON_NAME", "")
        self.categories                = _load_yaml()["categories"]

    def _init_from_gopass(self):
        _log.info("Config loaded from gopass + config.yml")
        cfg = _load_yaml()

        db = cfg["database"]
        db_user = _gopass(db["gopass_username_path"])
        db_pass = _gopass(db["gopass_password_path"])
        self.database_url = (
            f"postgresql://{quote_plus(db_user)}:{quote_plus(db_pass)}"
            f"@{db['host']}:{db['port']}/{db['name']}"
        )

        google = cfg["google"]
        self.google_client_id     = _gopass(google["gopass_client_id_path"])
        self.google_client_secret = _gopass(google["gopass_client_secret_path"])
        self.google_token_file    = google["token_file"]
        self.google_redirect_uri  = google["redirect_uri"]

        scheduler = cfg["scheduler"]
        self.occurrence_lookahead_days = scheduler["occurrence_lookahead_days"]
        self.scheduler_interval_hours  = scheduler["interval_hours"]

        self.timezone        = cfg["timezone"]
        self.allowed_origins = cfg["cors"]["allowed_origins"]
        self.gcal_max_results     = cfg["google"]["gcal_max_results"]
        self.cc_history_days      = cfg["credit_cards"]["history_days"]
        self.default_person_name  = cfg.get("default_person_name", "")
        self.categories           = cfg["categories"]


settings = Settings()
