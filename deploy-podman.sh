#!/usr/bin/env bash
set -euo pipefail

IMAGE="calendar-app:latest"

# ── Create secrets (run once, then comment out) ───────────────────────────────
# Secret name must match the env var name exactly.
#
# echo "postgresql://user:pass@postgresql.bhenning.com:5432/calendar_db" \
#   | podman secret create DATABASE_URL -
#
# echo "your-google-client-id" \
#   | podman secret create GOOGLE_CLIENT_ID -
#
# echo "your-google-client-secret" \
#   | podman secret create GOOGLE_CLIENT_SECRET -
# ─────────────────────────────────────────────────────────────────────────────

podman build -t "$IMAGE" .

TOKEN_DIR="$HOME/.config/calendar-app"
mkdir -p "$TOKEN_DIR"

podman run -d \
  --name calendar-app \
  --replace \
  --userns=keep-id \
  -p 8000:8000 \
  -e DB_HOST=postgresql.bhenning.com \
  -e DB_PORT=5432 \
  -e DB_NAME=calendar_db \
  -e GOOGLE_TOKEN_FILE=/token/token.json \
  -v "$TOKEN_DIR":/token:Z \
  --secret DB_USERNAME,type=env \
  --secret DB_PASSWORD,type=env \
  --secret GOOGLE_CLIENT_ID,type=env \
  --secret GOOGLE_CLIENT_SECRET,type=env \
  "$IMAGE"

echo "Container started: http://localhost:8000"
