import os
import subprocess
from pathlib import Path

import yaml

_CONFIG_FILE = Path(__file__).parent.parent / "config.yml"


def _gopass(path: str) -> str:
    result = subprocess.run(
        ["gopass", "show", "-o", path],
        capture_output=True, text=True, check=True,
    )
    return result.stdout.strip()


def _load_yaml() -> dict:
    with open(_CONFIG_FILE) as f:
        return yaml.safe_load(f)


class Settings:
    def __init__(self):
        if os.environ.get("DB_PASSWORD"):
            self._init_from_env()
        else:
            self._init_from_gopass()

    def _init_from_env(self):
        host = os.environ["DB_HOST"]
        port = os.environ["DB_PORT"]
        name = os.environ["DB_NAME"]
        user = os.environ["DB_USERNAME"]
        pwd  = os.environ["DB_PASSWORD"]
        self.database_url             = f"postgresql://{user}:{pwd}@{host}:{port}/{name}"
        self.google_client_id         = os.environ.get("GOOGLE_CLIENT_ID", "")
        self.google_client_secret     = os.environ.get("GOOGLE_CLIENT_SECRET", "")
        self.google_token_file        = os.environ.get("GOOGLE_TOKEN_FILE", "token.json")
        self.google_redirect_uri      = os.environ.get("GOOGLE_REDIRECT_URI", "http://localhost:8000/api/sync/auth/callback")
        self.occurrence_lookahead_days = int(os.environ.get("OCCURRENCE_LOOKAHEAD_DAYS", "365"))
        self.scheduler_interval_hours  = int(os.environ.get("SCHEDULER_INTERVAL_HOURS", "24"))
        self.timezone                  = os.environ.get("TIMEZONE", "America/New_York")

    def _init_from_gopass(self):
        cfg = _load_yaml()

        db = cfg["database"]
        db_user = _gopass(db["gopass_username_path"])
        db_pass = _gopass(db["gopass_password_path"])
        self.database_url = (
            f"postgresql://{db_user}:{db_pass}"
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

        self.timezone = cfg["timezone"]


settings = Settings()
