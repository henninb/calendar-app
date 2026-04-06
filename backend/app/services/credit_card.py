"""
Credit card billing calculation service.

Ported from credit-card-tracker.py with the same logic for:
  - Fixed statement close days with weekend shifting
  - Rolling cycle cards (e.g. 29-day cycles)
  - Payment due dates (grace period, fixed same-month, fixed next-month)
  - Annual fee dates

Additionally provides generate_credit_card_occurrences() which writes
Occurrence rows to the database for close, due, and annual fee dates.
"""
import calendar as cal_mod
from datetime import date, timedelta, datetime
from typing import Optional

from sqlalchemy.orm import Session

from ..config import settings
from ..models import CreditCard, Event, Occurrence, OccurrenceStatus, Priority, WeekendShift


# ── Date calculation helpers (mirrors credit-card-tracker.py) ─────────────────

def adjust_weekend(d: date, shift: str) -> date:
    if shift == WeekendShift.back_sat_only:
        return d - timedelta(days=1) if d.weekday() == 5 else d
    if shift == WeekendShift.nearest:
        if d.weekday() == 5:
            return d - timedelta(days=1)
        if d.weekday() == 6:
            return d + timedelta(days=1)
        return d
    if d.weekday() == 5:
        return d - timedelta(days=1) if shift == WeekendShift.back else d + timedelta(days=2)
    if d.weekday() == 6:
        return d - timedelta(days=2) if shift == WeekendShift.back else d + timedelta(days=1)
    return d


def close_date_for_month(year: int, month: int, close_day: int, weekend_shift: Optional[str]) -> date:
    last_day = cal_mod.monthrange(year, month)[1]
    d = date(year, month, min(close_day, last_day))
    if weekend_shift:
        d = adjust_weekend(d, weekend_shift)
    return d


def rolling_close_for_month(year: int, month: int, card: CreditCard) -> Optional[date]:
    ref = card.cycle_reference_date
    cycle = card.cycle_days
    target_start = date(year, month, 1)
    days_diff = (target_start - ref).days
    n = round(days_diff / cycle)
    for offset in range(n - 2, n + 3):
        candidate = ref + timedelta(days=offset * cycle)
        if candidate.year == year and candidate.month == month:
            return candidate
    return None


def due_date_for_close(close: date, card: CreditCard) -> date:
    if card.due_day_same_month:
        last_day = cal_mod.monthrange(close.year, close.month)[1]
        return date(close.year, close.month, min(card.due_day_same_month, last_day))
    if card.due_day_next_month:
        if close.month == 12:
            return date(close.year + 1, 1, card.due_day_next_month)
        last_day = cal_mod.monthrange(close.year, close.month + 1)[1]
        return date(close.year, close.month + 1, min(card.due_day_next_month, last_day))
    if card.grace_period_days is None:
        raise ValueError(
            f"Card '{card.name}' has no due_day_same_month, due_day_next_month, "
            "or grace_period_days configured — cannot compute due date."
        )
    return close + timedelta(days=card.grace_period_days)


def next_statement_close(card: CreditCard, ref_date: Optional[date] = None) -> date:
    if ref_date is None:
        ref_date = date.today()
    if card.cycle_days:
        y, m = ref_date.year, ref_date.month
        for _ in range(3):
            d = rolling_close_for_month(y, m, card)
            if d is not None and d >= ref_date:
                return d
            m += 1
            if m > 12:
                m, y = 1, y + 1
        raise ValueError(
            f"Card '{card.name}' (cycle={card.cycle_days} days): could not find a "
            f"rolling close date on or after {ref_date} within 3 months."
        )
    close_day = card.statement_close_day
    ws = card.weekend_shift
    d = close_date_for_month(ref_date.year, ref_date.month, close_day, ws)
    if d < ref_date:
        if ref_date.month == 12:
            d = close_date_for_month(ref_date.year + 1, 1, close_day, ws)
        else:
            d = close_date_for_month(ref_date.year, ref_date.month + 1, close_day, ws)
    return d


def previous_statement_close(card: CreditCard, ref_date: Optional[date] = None) -> date:
    if ref_date is None:
        ref_date = date.today()
    next_close = next_statement_close(card, ref_date)
    if card.cycle_days:
        return next_close - timedelta(days=card.cycle_days)
    close_day = card.statement_close_day
    ws = card.weekend_shift
    if next_close.month == 1:
        return close_date_for_month(next_close.year - 1, 12, close_day, ws)
    return close_date_for_month(next_close.year, next_close.month - 1, close_day, ws)


def next_annual_fee_date(card: CreditCard, ref_date: Optional[date] = None) -> Optional[date]:
    if not card.annual_fee_month:
        return None
    if ref_date is None:
        ref_date = date.today()
    month = card.annual_fee_month
    for year in [ref_date.year, ref_date.year + 1]:
        if card.cycle_days:
            d = rolling_close_for_month(year, month, card)
        else:
            d = close_date_for_month(year, month, card.statement_close_day, card.weekend_shift)
        if d is not None and d >= ref_date:
            return d
    return None


def grace_str(card: CreditCard) -> str:
    """Return the display string for the grace period column."""
    if card.due_day_same_month or card.due_day_next_month:
        today = date.today()
        prev = previous_statement_close(card, today)
        due = due_date_for_close(prev, card)
        return f"{(due - prev).days}V"
    return str(card.grace_period_days)


# ── Tracker view ──────────────────────────────────────────────────────────────

def tracker_row(card: CreditCard, today: Optional[date] = None) -> dict:
    """Return a single tracker row as a dict (mirrors the script's table row)."""
    if today is None:
        today = date.today()
    prev_close = previous_statement_close(card, today)
    next_close = next_statement_close(card, today)
    prev_due = due_date_for_close(prev_close, card)
    next_due = due_date_for_close(next_close, card)
    fee_date = next_annual_fee_date(card, today)

    return {
        "id": card.id,
        "name": card.name,
        "issuer": card.issuer,
        "last_four": card.last_four,
        "grace": grace_str(card),
        "prev_close": prev_close.isoformat(),
        "prev_due": prev_due.isoformat(),
        "next_close": next_close.isoformat(),
        "next_close_days": (next_close - today).days,
        "next_due": next_due.isoformat(),
        "next_due_days": (next_due - today).days,
        "annual_fee_date": fee_date.isoformat() if fee_date else None,
        "annual_fee_days": (fee_date - today).days if fee_date else None,
        "prev_due_overdue": prev_due < today,
    }


# ── Occurrence generation ──────────────────────────────────────────────────────

def generate_credit_card_occurrences(
    db: Session, card: CreditCard, lookahead_days: int | None = None
) -> int:
    """
    Generate statement close, payment due, and annual fee Occurrence rows
    for a card, up to lookahead_days from today.
    Returns the count of new rows inserted.
    """
    today = date.today()
    until = today + timedelta(days=lookahead_days or settings.occurrence_lookahead_days)

    events = db.query(Event).filter(Event.credit_card_id == card.id).all()
    close_event = next((e for e in events if "Statement Close" in e.title), None)
    due_event = next((e for e in events if "Payment Due" in e.title), None)
    fee_event = next((e for e in events if "Annual Fee" in e.title), None)

    # Collect all (event_id, date) pairs to potentially insert
    planned: list[tuple[int, date]] = []
    ref = date(today.year, today.month, 1)  # start from beginning of current month

    while True:
        close = next_statement_close(card, ref)
        if close > until:
            break
        due = due_date_for_close(close, card)

        if close_event and close >= today - timedelta(days=settings.cc_history_days):
            planned.append((close_event.id, close))
        if due_event:
            planned.append((due_event.id, due))

        ref = close + timedelta(days=1)

    if fee_event:
        fee_date = next_annual_fee_date(card, today)
        if fee_date and fee_date <= until:
            planned.append((fee_event.id, fee_date))

    if not planned:
        return 0

    # Batch-check existing occurrences in a single query
    event_ids = list({eid for eid, _ in planned})
    existing = {
        (row.event_id, row.occurrence_date)
        for row in db.query(Occurrence.event_id, Occurrence.occurrence_date)
        .filter(Occurrence.event_id.in_(event_ids))
        .all()
    }

    new_occurrences = [
        Occurrence(
            event_id=event_id,
            occurrence_date=occ_date,
            status=OccurrenceStatus.overdue if occ_date < today else OccurrenceStatus.upcoming,
        )
        for event_id, occ_date in planned
        if (event_id, occ_date) not in existing
    ]

    if new_occurrences:
        db.bulk_save_objects(new_occurrences)
        db.commit()
    return len(new_occurrences)


def ensure_card_events(db: Session, card: CreditCard, credit_card_category_id: int) -> None:
    """
    Create the close, due, and (if applicable) annual fee Event records
    for a card if they don't already exist.
    """
    existing_titles = {e.title for e in db.query(Event.title).filter(Event.credit_card_id == card.id).all()}
    today = date.today()

    def _make(title: str, description: str, reminder_days: list) -> None:
        if title not in existing_titles:
            db.add(Event(
                title=title,
                category_id=credit_card_category_id,
                credit_card_id=card.id,
                dtstart=today,
                rrule=None,
                description=description,
                reminder_days=reminder_days,
                priority=Priority.high,
                is_active=True,
            ))

    _make(f"{card.name} — Statement Close", f"Statement closing date for {card.name} ({card.issuer})", [1])
    _make(f"{card.name} — Payment Due", f"Payment due for {card.name} ({card.issuer})", [7, 3, 1])
    if card.annual_fee_month:
        _make(f"{card.name} — Annual Fee", f"Annual fee posts for {card.name} ({card.issuer})", [30, 7])

    db.commit()
