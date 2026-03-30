#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"

# FastAPI backend — internal only, not reachable outside the container
cd "$ROOT/backend"
uvicorn app.main:app --host 127.0.0.1 --port 9000 &
BACKEND_PID=$!

# Vite dev server — exposed on port 8000, proxies /api → localhost:9000
cd "$ROOT/frontend"
BACKEND_PORT=9000 npx vite --host :: --port 8000 &
VITE_PID=$!

# Exit the container if either process dies
wait -n $BACKEND_PID $VITE_PID
