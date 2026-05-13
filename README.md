# Calendar App

A full-stack personal calendar and task management application with recurring event scheduling, Google Calendar sync, credit card payment tracking, and grocery list management.

## Stack

| Layer | Technology |
|---|---|
| Backend | Python 3.14, FastAPI, SQLAlchemy, PostgreSQL |
| Frontend | Next.js 16, React 19, TypeScript, Tailwind CSS v4 |
| Calendar UI | FullCalendar 6 |
| Container | Podman / Docker (single image, port 8000) |
| Orchestration | Kubernetes or Podman |

## Features

- **Recurring events** — RFC 5545 RRULE strings (`FREQ=MONTHLY;BYMONTHDAY=15`) plus Easter sentinels (`EASTER`, `EASTER-7`)
- **Occurrence tracking** — per-instance status: `upcoming`, `completed`, `skipped`, `overdue`
- **Task management** — subtasks, assignees, priorities, recurrence, archiving, drag-and-drop ordering
- **Google Calendar & Tasks sync** — OAuth2 flow, push occurrences and tasks to Google
- **Credit card tracker** — statement close dates, grace periods, rolling cycles, weekend-shift rules
- **Grocery lists** — item catalog, on-hand inventory, per-store shopping lists
- **Background scheduler** — APScheduler regenerates occurrences and marks overdue events on a configurable interval
- **API key auth** — optional; server warns and runs open if `API_KEY` is unset
- **Rate limiting** — slowapi, applied per endpoint
- **Security headers** — HSTS, X-Frame-Options, Referrer-Policy, no-store cache on API routes

## Project Structure

```
calendar-app/
├── backend/
│   ├── app/
│   │   ├── main.py          # FastAPI app, lifespan, middleware, router mounts
│   │   ├── models.py        # SQLAlchemy ORM models
│   │   ├── schemas.py       # Pydantic request/response schemas
│   │   ├── crud.py          # DB helper functions
│   │   ├── config.py        # Settings (gopass or env vars)
│   │   ├── security.py      # API key dependency
│   │   ├── limiter.py       # Rate limiter instance
│   │   ├── database.py      # Engine and session factory
│   │   ├── routers/         # categories, events, occurrences, sync,
│   │   │                    #   credit_cards, persons, tasks, stores, grocery
│   │   └── services/        # recurrence, credit_card, scheduler,
│   │                        #   task_generation, google_calendar, google_tasks
│   ├── tests/               # pytest test suite
│   ├── config.yml           # Local config (gopass paths, CORS, scheduler)
│   ├── .env.example         # Environment variable reference
│   ├── requirements.txt
│   ├── run.sh               # Dev/prod uvicorn launcher
│   └── seed_data.py         # Optional seed script
├── frontend/
│   ├── app/                 # Next.js app router (layout, page, globals.css)
│   ├── components/          # AppHeader, CalendarView, EventPanel,
│   │                        #   OccurrenceList, CreditCardTracker,
│   │                        #   CalendarActions, ConfigPage
│   ├── lib/api.ts           # Typed API client
│   ├── next.config.mjs
│   └── vitest.config.ts
├── Containerfile            # Single image: Python 3.14 + Node 22
├── container-entrypoint.sh
├── deploy-podman.sh         # Podman run with secrets
├── deploy-k8.sh             # Kubernetes deploy (gopass + kubectl)
├── run-frontend.sh          # Frontend dev server launcher
└── test-coverage.sh
```

## Local Development

### Prerequisites

- Python 3.14+
- Node.js 22+
- PostgreSQL database
- (Optional) gopass for secret management

### Backend

```bash
cd backend
cp .env.example .env          # fill in DATABASE_URL and Google OAuth creds
pip install -r requirements.txt
./run.sh                       # dev mode with auto-reload on :8000
./run.sh --prod                # production mode
```

### Frontend

```bash
./run-frontend.sh              # installs deps if needed, starts Next.js on :5173
```

The frontend proxies `/api/*` to `http://localhost:8000` in dev mode.

### Tests

```bash
# Backend
cd backend && pytest

# Frontend
cd frontend && npm test

# Coverage report
./test-coverage.sh
```

## Configuration

The backend supports two configuration sources, selected automatically:

**Environment variables** (used when `DB_PASSWORD` is set — container/CI):

| Variable | Default | Description |
|---|---|---|
| `DB_HOST` | — | PostgreSQL host |
| `DB_PORT` | — | PostgreSQL port |
| `DB_NAME` | — | Database name |
| `DB_USERNAME` | — | Database user |
| `DB_PASSWORD` | — | Database password |
| `GOOGLE_CLIENT_ID` | — | OAuth2 client ID |
| `GOOGLE_CLIENT_SECRET` | — | OAuth2 client secret |
| `GOOGLE_TOKEN_FILE` | `token.json` | Path to OAuth token file |
| `GOOGLE_REDIRECT_URI` | `http://localhost:8000/api/sync/auth/callback` | OAuth redirect |
| `API_KEY` | *(empty — open mode)* | Require this key in `X-API-Key` header |
| `ALLOWED_ORIGINS` | — | Comma-separated CORS origins |
| `OCCURRENCE_LOOKAHEAD_DAYS` | `365` | How far ahead to generate occurrences |
| `SCHEDULER_INTERVAL_HOURS` | `24` | Background job interval |
| `TIMEZONE` | `America/Chicago` | Application timezone |
| `DEFAULT_PERSON_NAME` | — | Auto-seeded person on first start |

**gopass + config.yml** (used locally when `DB_PASSWORD` is not set):

Edit `backend/config.yml` with gopass paths for all secrets. The config module reads them at first attribute access.

## Deployment

### Podman

```bash
./deploy-podman.sh
```

Creates Podman secrets for `DB_USERNAME`, `DB_PASSWORD`, `GOOGLE_CLIENT_ID`, and `GOOGLE_CLIENT_SECRET`, builds the image, and runs the container on port 8000. The Google OAuth token is bind-mounted from `~/.config/calendar-app/`.

### Kubernetes

```bash
./deploy-k8.sh
```

Reads secrets from gopass, builds the image, imports it into the cluster via containerd (no registry required), and applies a Deployment + Service manifest. The pod is pinned to `debian-k8s-worker-01` and uses a hostPath volume for the OAuth token.

**View logs:**
```bash
kubectl logs -n default -l app=calendar-app -f
```

**Port-forward for local access:**
```bash
kubectl port-forward -n default svc/calendar-app 8000:8000
```

## API

The FastAPI app serves all routes under `/api/`. Interactive docs are available at `http://localhost:8000/docs` in development.

**Health check:**
```
GET /health
```

Returns `{"status": "ok"}` when the database is reachable, `503` otherwise. Includes `"auth": "open"` when no API key is configured.

**Main routers:** `/api/categories`, `/api/events`, `/api/occurrences`, `/api/sync`, `/api/credit-cards`, `/api/persons`, `/api/tasks`, `/api/stores`, `/api/grocery`
