import logging
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
log = logging.getLogger(__name__)

from .database import Base, engine, SessionLocal
from .models import CreditCard, Person
from .config import settings
from .routers import categories, events, occurrences, sync, credit_cards, persons, tasks
from .services.recurrence import generate_all_occurrences, mark_overdue
from .services.credit_card import generate_credit_card_occurrences
from .services.task_generation import generate_pending_tasks
from .services.scheduler import start_scheduler, stop_scheduler


@asynccontextmanager
async def lifespan(app: FastAPI):
    # ── Startup ────────────────────────────────────────────────────────────
    Base.metadata.create_all(bind=engine)

    # Add columns that may not exist on pre-existing tables
    # TODO: replace with Alembic for proper multi-worker-safe migrations
    with engine.connect() as conn:
        try:
            conn.execute(text(
                "ALTER TABLE events ADD COLUMN IF NOT EXISTS generates_tasks BOOLEAN NOT NULL DEFAULT FALSE"
            ))
            conn.execute(text(
                "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS recurrence VARCHAR NOT NULL DEFAULT 'none'"
            ))
            conn.execute(text(
                "ALTER TABLE subtasks ADD COLUMN IF NOT EXISTS gtask_id VARCHAR"
            ))
            conn.commit()
            log.info("Schema migrations applied")
        except Exception:
            log.exception("Schema migration failed")
            conn.rollback()

    db = SessionLocal()
    try:
        # Seed default person if none exist and a name is configured
        if not db.query(Person).first() and settings.default_person_name:
            db.add(Person(name=settings.default_person_name))
            db.commit()
            log.info("Seeded default person: %s", settings.default_person_name)

        mark_overdue(db)
        generate_all_occurrences(db)
        for card in db.query(CreditCard).filter(CreditCard.is_active.isnot(False)).all():
            generate_credit_card_occurrences(db, card)
        generate_pending_tasks(db)
        log.info("Startup data generation complete")
    finally:
        db.close()

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

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def log_requests(request: Request, call_next):
    start = time.perf_counter()
    response = await call_next(request)
    elapsed = time.perf_counter() - start
    log.info("%s %s %d %.3fs", request.method, request.url.path, response.status_code, elapsed)
    return response

app.include_router(categories.router, prefix="/api")
app.include_router(events.router, prefix="/api")
app.include_router(occurrences.router, prefix="/api")
app.include_router(sync.router, prefix="/api")
app.include_router(credit_cards.router, prefix="/api")
app.include_router(persons.router, prefix="/api")
app.include_router(tasks.router, prefix="/api")


@app.get("/health")
def health():
    return {"status": "ok"}
