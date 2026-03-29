from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session, joinedload

from ..database import get_db
from ..models import Event, Occurrence, OccurrenceStatus
from ..schemas import GenerateResult, OccurrenceOut, OccurrenceUpdate
from ..services.recurrence import generate_all_occurrences, mark_overdue

router = APIRouter(prefix="/occurrences", tags=["occurrences"])


@router.get("", response_model=list[OccurrenceOut])
def list_occurrences(
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    status: Optional[OccurrenceStatus] = Query(None),
    category_id: Optional[int] = Query(None),
    event_id: Optional[int] = Query(None),
    limit: int = Query(200, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    q = (
        db.query(Occurrence)
        .options(joinedload(Occurrence.event).joinedload(Event.category))
        .order_by(Occurrence.occurrence_date)
    )
    if start_date:
        q = q.filter(Occurrence.occurrence_date >= start_date)
    if end_date:
        q = q.filter(Occurrence.occurrence_date <= end_date)
    if status:
        q = q.filter(Occurrence.status == status)
    if event_id:
        q = q.filter(Occurrence.event_id == event_id)
    if category_id:
        q = q.join(Occurrence.event).filter(Event.category_id == category_id)

    return q.offset(offset).limit(limit).all()


@router.get("/{occurrence_id}", response_model=OccurrenceOut)
def get_occurrence(occurrence_id: int, db: Session = Depends(get_db)):
    occ = (
        db.query(Occurrence)
        .options(joinedload(Occurrence.event).joinedload(Event.category))
        .filter(Occurrence.id == occurrence_id)
        .first()
    )
    if not occ:
        raise HTTPException(status_code=404, detail="Occurrence not found")
    return occ


@router.patch("/{occurrence_id}", response_model=OccurrenceOut)
def update_occurrence(
    occurrence_id: int, body: OccurrenceUpdate, db: Session = Depends(get_db)
):
    occ = db.query(Occurrence).get(occurrence_id)
    if not occ:
        raise HTTPException(status_code=404, detail="Occurrence not found")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(occ, field, value)
    db.commit()
    db.refresh(occ)
    return occ


@router.post("/generate-all", response_model=GenerateResult)
def generate_all(
    lookahead_days: int = Query(365, ge=1, le=1825),
    db: Session = Depends(get_db),
):
    """Generate occurrences for all active events and mark overdue ones."""
    mark_overdue(db)
    result = generate_all_occurrences(db, lookahead_days)
    return GenerateResult(**result)
