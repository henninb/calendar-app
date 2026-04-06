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

    Uses 3 queries regardless of event count (no N+1):
      1. Load all qualifying events.
      2. Batch-load all candidate occurrences up to the max threshold.
      3. Batch-check which occurrence IDs already have tasks.
    """
    today = date.today()

    events = db.query(Event).filter(
        Event.is_active.is_(True),
        Event.generates_tasks.is_(True),
    ).all()

    if not events:
        return 0

    # Per-event thresholds and lookup map
    event_thresholds = {event.id: today + timedelta(days=_lead_days(event)) for event in events}
    event_map = {event.id: event for event in events}
    max_threshold = max(event_thresholds.values())

    # Batch-load all candidate occurrences across all events in one query
    qualifying_occs = (
        db.query(Occurrence)
        .filter(
            Occurrence.event_id.in_(event_thresholds.keys()),
            Occurrence.occurrence_date >= today,
            Occurrence.occurrence_date <= max_threshold,
            Occurrence.status.in_([OccurrenceStatus.upcoming, OccurrenceStatus.overdue]),
        )
        .all()
    )

    # Filter per-event threshold in Python, then batch-check existing tasks
    occ_ids_to_check = [
        occ.id for occ in qualifying_occs
        if occ.occurrence_date <= event_thresholds[occ.event_id]
    ]
    if not occ_ids_to_check:
        return 0

    existing_occ_ids = {
        row[0] for row in
        db.query(Task.occurrence_id).filter(Task.occurrence_id.in_(occ_ids_to_check)).all()
    }

    new_tasks = []
    for occ in qualifying_occs:
        if occ.occurrence_date > event_thresholds[occ.event_id]:
            continue
        if occ.id in existing_occ_ids:
            continue
        event = event_map[occ.event_id]
        new_tasks.append(Task(
            occurrence_id=occ.id,
            title=event.title,
            description=event.description,
            priority=event.priority,
            due_date=occ.occurrence_date,
        ))

    if new_tasks:
        db.bulk_save_objects(new_tasks)
        db.commit()
    return len(new_tasks)


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
