"""
APScheduler background jobs.

Jobs run inside the FastAPI process via AsyncIOScheduler so they share
the same database connection pool.
"""
import logging
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger

from ..config import settings
from ..database import SessionLocal
from ..models import CreditCard
from .recurrence import generate_all_occurrences, mark_overdue
from .credit_card import generate_credit_card_occurrences

log = logging.getLogger(__name__)
scheduler = AsyncIOScheduler()


def _run_daily_job() -> None:
    """Expand recurrences and mark overdue — runs once per scheduler interval."""
    db = SessionLocal()
    try:
        overdue = mark_overdue(db)

        result = generate_all_occurrences(db)

        cards = db.query(CreditCard).filter(CreditCard.is_active == True).all()
        cc_new = sum(generate_credit_card_occurrences(db, card) for card in cards)

        log.info(
            "Scheduler: marked %d overdue | events: %d new across %d | credit cards: %d new across %d",
            overdue,
            result["occurrences_created"],
            result["events_processed"],
            cc_new,
            len(cards),
        )
    except Exception:
        log.exception("Scheduler job failed")
    finally:
        db.close()


def start_scheduler() -> None:
    scheduler.add_job(
        _run_daily_job,
        trigger=IntervalTrigger(hours=settings.scheduler_interval_hours),
        id="daily_occurrence_generation",
        replace_existing=True,
        max_instances=1,
    )
    scheduler.start()
    log.info(
        "Scheduler started — occurrence generation every %d hour(s)",
        settings.scheduler_interval_hours,
    )


def stop_scheduler() -> None:
    scheduler.shutdown(wait=False)
