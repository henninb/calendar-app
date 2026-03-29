from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .database import Base, engine, SessionLocal
from .models import CreditCard
from .routers import categories, events, occurrences, sync, credit_cards
from .services.recurrence import generate_all_occurrences, mark_overdue
from .services.credit_card import generate_credit_card_occurrences
from .services.scheduler import start_scheduler, stop_scheduler


@asynccontextmanager
async def lifespan(app: FastAPI):
    # ── Startup ────────────────────────────────────────────────────────────
    Base.metadata.create_all(bind=engine)

    db = SessionLocal()
    try:
        mark_overdue(db)
        generate_all_occurrences(db)
        for card in db.query(CreditCard).filter(CreditCard.is_active == True).all():
            generate_credit_card_occurrences(db, card)
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
    allow_origins=["http://localhost:3000", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(categories.router, prefix="/api")
app.include_router(events.router, prefix="/api")
app.include_router(occurrences.router, prefix="/api")
app.include_router(sync.router, prefix="/api")
app.include_router(credit_cards.router, prefix="/api")


@app.get("/health")
def health():
    return {"status": "ok"}
