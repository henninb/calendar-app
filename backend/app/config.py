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
