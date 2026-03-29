#!/usr/bin/env bash
set -euo pipefail

HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-8000}"
WORKERS="${WORKERS:-1}"

if [[ "${1:-}" == "--prod" ]]; then
  echo "Starting uvicorn (production, $WORKERS worker(s)) on $HOST:$PORT"
  exec uvicorn app.main:app \
    --host "$HOST" \
    --port "$PORT" \
    --workers "$WORKERS"
else
  echo "Starting uvicorn (dev/reload) on $HOST:$PORT"
  exec uvicorn app.main:app \
    --host "$HOST" \
    --port "$PORT" \
    --reload
fi
