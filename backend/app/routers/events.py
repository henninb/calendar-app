from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session, joinedload

from ..config import settings
from ..crud import apply_patch, get_or_404
from ..database import get_db
from ..models import Category, Event
from ..schemas import EventCreate, EventOut, EventUpdate, EventWithOccurrences, GenerateResult
from ..services.recurrence import generate_occurrences

log = logging.getLogger(__name__)

router = APIRouter(prefix="/events", tags=["events"])


@router.get("", response_model=list[EventOut])
def list_events(
    category_id: int | None = Query(None),
    is_active: bool | None = Query(None),
    search: str | None = Query(None),
    db: Session = Depends(get_db),
) -> list[Event]:
    q = db.query(Event).options(joinedload(Event.category))
    if category_id is not None:
        q = q.filter(Event.category_id == category_id)
    if is_active is not None:
        q = q.filter(Event.is_active == is_active)
    if search:
        q = q.filter(Event.title.ilike(f"%{search}%"))
    return q.order_by(Event.title).all()


@router.post("", response_model=EventOut, status_code=status.HTTP_201_CREATED)
def create_event(body: EventCreate, db: Session = Depends(get_db)) -> Event:
    _assert_category(db, body.category_id)
    event = Event(**body.model_dump())
    db.add(event)
    db.commit()
    db.refresh(event)
    generate_occurrences(db, event)
    db.refresh(event)
    log.info("Created event %d (%s)", event.id, event.title)
    return event


@router.get("/{event_id}", response_model=EventWithOccurrences)
def get_event(event_id: int, db: Session = Depends(get_db)) -> Event:
    return get_or_404(db, Event, event_id, "Event not found")


@router.patch("/{event_id}", response_model=EventOut)
def update_event(event_id: int, body: EventUpdate, db: Session = Depends(get_db)) -> Event:
    event = get_or_404(db, Event, event_id, "Event not found")
    changes = body.model_dump(exclude_unset=True)
    if "category_id" in changes:
        _assert_category(db, changes["category_id"])
    apply_patch(event, changes)
    db.commit()
    db.refresh(event)
    recurrence_fields = {"rrule", "dtstart", "dtend_rule"}
    if recurrence_fields & changes.keys():
        generate_occurrences(db, event)
        db.refresh(event)
    log.info("Updated event %d (%s)", event.id, event.title)
    return event


@router.delete("/{event_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_event(event_id: int, db: Session = Depends(get_db)) -> None:
    event = get_or_404(db, Event, event_id, "Event not found")
    log.info("Deleted event %d (%s)", event.id, event.title)
    db.delete(event)
    db.commit()


@router.post("/{event_id}/generate", response_model=GenerateResult)
def generate_event_occurrences(
    event_id: int,
    lookahead_days: int = Query(settings.occurrence_lookahead_days, ge=1, le=1825),
    db: Session = Depends(get_db),
) -> GenerateResult:
    """Manually trigger occurrence generation for a single event."""
    event = get_or_404(db, Event, event_id, "Event not found")
    created = generate_occurrences(db, event, lookahead_days)
    return GenerateResult(events_processed=1, occurrences_created=created)


# ── helpers ──────────────────────────────────────────────────────────────────

def _assert_category(db: Session, category_id: int) -> None:
    if not db.get(Category, category_id):
        raise HTTPException(status_code=404, detail="Category not found")
