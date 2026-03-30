#!/usr/bin/env bash
set -euo pipefail

HOST="${HOST:-localhost}"
PORT="${PORT:-5173}"

echo "Starting Vite dev server on http://$HOST:$PORT"
exec npx vite --host "$HOST" --port "$PORT"
