from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

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
    with engine.connect() as conn:
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

    db = SessionLocal()
    try:
        # Seed default person if none exist
        if not db.query(Person).first():
            db.add(Person(name="Brian"))
            db.commit()

        mark_overdue(db)
        generate_all_occurrences(db)
        for card in db.query(CreditCard).filter(CreditCard.is_active.isnot(False)).all():
            generate_credit_card_occurrences(db, card)
        generate_pending_tasks(db)
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
