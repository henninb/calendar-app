#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"

BACKEND_HOST="${BACKEND_HOST:-127.0.0.1}"
BACKEND_PORT="${BACKEND_PORT:-9000}"
FRONTEND_PORT="${FRONTEND_PORT:-8000}"

# FastAPI backend — internal only, not reachable outside the container
cd "$ROOT/backend"
uvicorn app.main:app --host "$BACKEND_HOST" --port "$BACKEND_PORT" &
BACKEND_PID=$!

# Wait for the backend to accept connections before starting Vite
echo "Waiting for backend on $BACKEND_HOST:$BACKEND_PORT…"
until python3 -c "import socket; s=socket.create_connection(('$BACKEND_HOST', $BACKEND_PORT), timeout=1); s.close()" 2>/dev/null; do
    sleep 0.5
done
echo "Backend ready."

# Vite dev server — exposed on FRONTEND_PORT, proxies /api → localhost:BACKEND_PORT
cd "$ROOT/frontend"
BACKEND_PORT="$BACKEND_PORT" npx vite --host :: --port "$FRONTEND_PORT" &
VITE_PID=$!

# Exit the container if either process dies
wait -n $BACKEND_PID $VITE_PID
