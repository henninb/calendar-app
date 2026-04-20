import asyncio
import logging
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from sqlalchemy import text

from .config import settings
from .database import Base, engine, SessionLocal
from .limiter import limiter
from .models import CreditCard, Person
from .routers import categories, events, occurrences, sync, credit_cards, persons, tasks, stores, grocery
from .security import require_api_key
from .services.credit_card import generate_credit_card_occurrences
from .services.recurrence import generate_all_occurrences, mark_overdue
from .services.scheduler import start_scheduler, stop_scheduler
from .services.task_generation import generate_pending_tasks

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
log = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # ── Startup ────────────────────────────────────────────────────────────
    Base.metadata.create_all(bind=engine)

    # Add columns that may not exist on pre-existing tables
    # TODO: replace with Alembic for proper multi-worker-safe migrations
    _migrations = [
        "ALTER TABLE events ADD COLUMN IF NOT EXISTS generates_tasks BOOLEAN NOT NULL DEFAULT FALSE",
        "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS recurrence VARCHAR NOT NULL DEFAULT 'none'",
        "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS parent_task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL",
        "ALTER TABLE subtasks ADD COLUMN IF NOT EXISTS gtask_id VARCHAR",
        "ALTER TABLE subtasks ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP WITH TIME ZONE",
        "ALTER TABLE credit_cards ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT now()",
        "UPDATE credit_cards SET created_at = now() WHERE created_at IS NULL",
        'ALTER TABLE tasks ADD COLUMN IF NOT EXISTS "order" INTEGER NOT NULL DEFAULT 0',
    ]
    with engine.connect() as conn:
        for stmt in _migrations:
            try:
                conn.execute(text(stmt))
            except Exception:
                log.exception("Schema migration failed — aborting startup\n  stmt: %s", stmt)
                conn.rollback()
                raise
        conn.commit()
        log.info("Schema migrations applied")

    def _startup_data_generation() -> None:
        db = SessionLocal()
        try:
            if not db.query(Person).first() and settings.default_person_name:
                db.add(Person(name=settings.default_person_name))
                db.commit()
                log.info("Seeded default person: %s", settings.default_person_name)

            mark_overdue(db)
            generate_all_occurrences(db)
            for card in db.query(CreditCard).filter(CreditCard.is_active.is_(True)).all():
                generate_credit_card_occurrences(db, card)
            generate_pending_tasks(db)
            log.info("Startup data generation complete")
        finally:
            db.close()

    await asyncio.to_thread(_startup_data_generation)

    if not settings.api_key:
        log.warning(
            "API_KEY is not configured — server is running in OPEN mode. "
            "All endpoints are unauthenticated. Set API_KEY to require authentication."
        )

    _SUSPICIOUS_DIRS = {"static", "dist", "public", "www", "html", "frontend"}
    token_parts = set(Path(settings.google_token_file).resolve().parts)
    if token_parts & _SUSPICIOUS_DIRS:
        log.warning(
            "google_token_file %r may be inside a web-accessible directory. "
            "Move it outside the web root to prevent token exposure.",
            settings.google_token_file,
        )

    start_scheduler()

    yield

    # ── Shutdown ───────────────────────────────────────────────────────────
    stop_scheduler()


app = FastAPI(
    title="Calendar App API",
    description="Recurring event management with Google Calendar sync",
    version="0.1.0",
    lifespan=lifespan,
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    return response


@app.middleware("http")
async def log_requests(request: Request, call_next):
    start = time.perf_counter()
    response = await call_next(request)
    elapsed = time.perf_counter() - start
    log.info("%s %s %d %.3fs", request.method, request.url.path, response.status_code, elapsed)
    return response

_auth = [Depends(require_api_key)]
app.include_router(categories.router, prefix="/api", dependencies=_auth)
app.include_router(events.router, prefix="/api", dependencies=_auth)
app.include_router(occurrences.router, prefix="/api", dependencies=_auth)
app.include_router(sync.router, prefix="/api", dependencies=_auth)
app.include_router(credit_cards.router, prefix="/api", dependencies=_auth)
app.include_router(persons.router, prefix="/api", dependencies=_auth)
app.include_router(tasks.router, prefix="/api", dependencies=_auth)
app.include_router(stores.router, prefix="/api", dependencies=_auth)
app.include_router(grocery.router, prefix="/api", dependencies=_auth)


@app.get("/health")
def health(response: Response):
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        result = {"status": "ok"}
    except Exception:
        log.exception("Health check: database unreachable")
        response.status_code = 503
        result = {"status": "error", "detail": "database unavailable"}
    if not settings.api_key:
        result["auth"] = "open"
    return result
