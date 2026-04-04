from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session, joinedload

from ..config import settings
from ..database import get_db
from ..models import Event, Occurrence, OccurrenceStatus, Task
from ..schemas import GenerateResult, OccurrenceOut, OccurrenceUpdate, TaskOut
from ..services.recurrence import generate_all_occurrences, mark_overdue
from ..services.task_generation import cancel_tasks_for_occurrence

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
    new_status = body.model_dump(exclude_unset=True).get("status")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(occ, field, value)
    db.commit()
    if new_status == OccurrenceStatus.skipped:
        cancel_tasks_for_occurrence(db, occ)
    db.refresh(occ)
    return occ


@router.post("/{occurrence_id}/task", response_model=TaskOut, status_code=status.HTTP_201_CREATED)
def create_task_from_occurrence(occurrence_id: int, db: Session = Depends(get_db)):
    """Create a task linked to this occurrence, or return the existing one if already created."""
    occ = (
        db.query(Occurrence)
        .options(joinedload(Occurrence.event).joinedload(Event.category))
        .filter(Occurrence.id == occurrence_id)
        .first()
    )
    if not occ:
        raise HTTPException(status_code=404, detail="Occurrence not found")
    existing = db.query(Task).filter(Task.occurrence_id == occurrence_id).first()
    if existing:
        return existing
    task = Task(
        occurrence_id=occ.id,
        title=occ.event.title,
        description=occ.event.description,
        priority=occ.event.priority,
        due_date=occ.occurrence_date,
        category_id=occ.event.category_id,
    )
    db.add(task)
    db.commit()
    db.refresh(task)
    return task


@router.delete("/{occurrence_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_occurrence(occurrence_id: int, db: Session = Depends(get_db)):
    occ = db.query(Occurrence).get(occurrence_id)
    if not occ:
        raise HTTPException(status_code=404, detail="Occurrence not found")
    db.delete(occ)
    db.commit()


@router.post("/generate-all", response_model=GenerateResult)
def generate_all(
    lookahead_days: int = Query(settings.occurrence_lookahead_days, ge=1, le=1825),
    db: Session = Depends(get_db),
):
    """Generate occurrences for all active events and mark overdue ones."""
    mark_overdue(db)
    result = generate_all_occurrences(db, lookahead_days)
    return GenerateResult(**result)
