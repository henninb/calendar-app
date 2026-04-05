"""
Task generation service.

For events with generates_tasks=True, a Task is created for each Occurrence
max(reminder_days) days before the occurrence_date.

Entry points:
  generate_pending_tasks(db)         — run by the daily scheduler
  cancel_tasks_for_occurrence(db, occ) — called when occurrence is skipped/deleted
"""
from datetime import date, timedelta

from sqlalchemy.orm import Session

from ..models import Event, Occurrence, OccurrenceStatus, Task, TaskStatus


def _lead_days(event: Event) -> int:
    days = event.reminder_days or []
    return max(days) if days else 7


def generate_pending_tasks(db: Session) -> int:
    """
    For every active generates_tasks event, create tasks for occurrences
    whose occurrence_date falls within the next max(reminder_days) days
    and that don't already have a linked task.
    Returns the count of tasks created.
    """
    today = date.today()
    created = 0

    events = db.query(Event).filter(
        Event.is_active == True,
        Event.generates_tasks == True,
    ).all()

    for event in events:
        threshold = today + timedelta(days=_lead_days(event))
        occurrences = (
            db.query(Occurrence)
            .filter(
                Occurrence.event_id == event.id,
                Occurrence.occurrence_date >= today,
                Occurrence.occurrence_date <= threshold,
                Occurrence.status.in_([OccurrenceStatus.upcoming, OccurrenceStatus.overdue]),
            )
            .all()
        )
        if not occurrences:
            continue
        occ_ids = [occ.id for occ in occurrences]
        existing_ids = {
            row[0] for row in
            db.query(Task.occurrence_id).filter(Task.occurrence_id.in_(occ_ids)).all()
        }
        for occ in occurrences:
            if occ.id in existing_ids:
                continue
            db.add(Task(
                occurrence_id=occ.id,
                title=event.title,
                description=event.description,
                priority=event.priority,
                due_date=occ.occurrence_date,
            ))
            created += 1

    if created:
        db.commit()
    return created


def cancel_tasks_for_occurrence(db: Session, occurrence: Occurrence) -> int:
    """
    Cancel all non-terminal tasks linked to this occurrence.
    Returns count cancelled.
    """
    tasks = (
        db.query(Task)
        .filter(
            Task.occurrence_id == occurrence.id,
            Task.status.notin_([TaskStatus.done, TaskStatus.cancelled]),
        )
        .all()
    )
    for task in tasks:
        task.status = TaskStatus.cancelled
    if tasks:
        db.commit()
    return len(tasks)
