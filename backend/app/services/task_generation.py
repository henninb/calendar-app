"""
Task generation service.

For events with generates_tasks=True, a Task is created for each Occurrence
max(reminder_days) days before the occurrence_date.

Entry points:
  generate_pending_tasks(db)            — run by the daily scheduler
  cancel_tasks_for_occurrence(db, occ)  — called when occurrence is skipped/deleted
  next_task_due_date(task)              — compute next recurrence date for a task
  spawn_recurring_task(db, task)        — create the successor task after completion
"""
import calendar as cal_mod
import logging
from datetime import date, datetime, timedelta

from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from ..models import Event, Occurrence, OccurrenceStatus, Subtask, Task, TaskRecurrence, TaskStatus

log = logging.getLogger(__name__)

_RECURRENCE_DELTA: dict[TaskRecurrence, timedelta | None] = {
    TaskRecurrence.daily: timedelta(days=1),
    TaskRecurrence.weekly: timedelta(weeks=1),
    TaskRecurrence.biweekly: timedelta(weeks=2),
    TaskRecurrence.monthly: None,
    TaskRecurrence.quarterly: None,
    TaskRecurrence.semiannual: None,
    TaskRecurrence.yearly: None,
}

_MONTH_INCREMENTS: dict[TaskRecurrence, int] = {
    TaskRecurrence.monthly: 1,
    TaskRecurrence.bimonthly: 2,
    TaskRecurrence.quarterly: 3,
    TaskRecurrence.semiannual: 6,
}


def next_task_due_date(task: Task) -> date | None:
    """Return the next due date for a recurring task, or None if one-time.

    When recurrence_anchor_day is set, the spawned task lands on that fixed
    day of the next period rather than rolling forward from the (possibly
    moved) due_date.  For yearly recurrence, recurrence_anchor_month is also
    used when set.
    """
    if task.recurrence == TaskRecurrence.none or not task.due_date:
        return None
    delta = _RECURRENCE_DELTA.get(task.recurrence)
    if delta is not None:
        # daily / weekly / biweekly — no anchor support (day-of-month doesn't apply)
        return task.due_date + delta
    today = task.due_date
    if task.recurrence in _MONTH_INCREMENTS:
        months = _MONTH_INCREMENTS[task.recurrence]
        month = today.month + months
        year = today.year + (month - 1) // 12
        month = ((month - 1) % 12) + 1
        anchor_day = task.recurrence_anchor_day
        day = min(anchor_day if anchor_day else today.day, cal_mod.monthrange(year, month)[1])
        return date(year, month, day)
    if task.recurrence == TaskRecurrence.yearly:
        anchor_month = task.recurrence_anchor_month or today.month
        anchor_day = task.recurrence_anchor_day or today.day
        # Advance year; if the anchor month/day is still in the future this
        # year, stay in the current year — otherwise go to next year.
        target_year = today.year
        candidate = date(target_year, anchor_month, min(anchor_day, cal_mod.monthrange(target_year, anchor_month)[1]))
        if candidate <= today:
            target_year += 1
        day = min(anchor_day, cal_mod.monthrange(target_year, anchor_month)[1])
        return date(target_year, anchor_month, day)
    return None


def spawn_recurring_task(db: Session, task: Task) -> None:
    """Flush (but do NOT commit) the next task for a recurring task. Caller commits.

    Keeping spawn inside the caller's transaction makes the status-change and
    the new-task creation atomic — a crash between them can no longer leave a
    task permanently 'done' without a successor.
    """
    next_date = next_task_due_date(task)
    if not next_date:
        return
    already_exists = db.query(Task).filter(Task.parent_task_id == task.id).first()
    if already_exists:
        log.debug(
            "Skipping spawn for task %d — next instance already exists as task %d",
            task.id,
            already_exists.id,
        )
        return
    new_task = Task(
        parent_task_id=task.id,
        title=task.title,
        description=task.description,
        priority=task.priority,
        assignee_id=task.assignee_id,
        category_id=task.category_id,
        due_date=next_date,
        estimated_minutes=task.estimated_minutes,
        recurrence=task.recurrence,
        recurrence_anchor_day=task.recurrence_anchor_day,
        recurrence_anchor_month=task.recurrence_anchor_month,
    )
    db.add(new_task)
    db.flush()
    for subtask in task.subtasks:
        db.add(Subtask(
            task_id=new_task.id,
            title=subtask.title,
            status=TaskStatus.todo,
            order=subtask.order,
        ))
    log.info(
        "Spawned next %s task %d (due %s) from completed task %d",
        task.recurrence,
        new_task.id,
        next_date,
        task.id,
    )


def _lead_days(event: Event) -> int:
    days = event.reminder_days or []
    return max(days) if days else 7


def generate_pending_tasks(db: Session) -> int:
    """Create tasks for upcoming occurrences whose lead window opens today.

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

    event_thresholds = {event.id: today + timedelta(days=_lead_days(event)) for event in events}
    event_map = {event.id: event for event in events}
    max_threshold = max(event_thresholds.values())

    qualifying_occs = (
        db.query(Occurrence)
        .filter(
            Occurrence.event_id.in_(event_thresholds.keys()),
            Occurrence.occurrence_date >= today,
            Occurrence.occurrence_date <= max_threshold,
            Occurrence.status == OccurrenceStatus.upcoming,
        )
        .all()
    )

    occ_ids_to_check = [
        occ.id
        for occ in qualifying_occs
        if occ.occurrence_date <= event_thresholds[occ.event_id]
    ]
    if not occ_ids_to_check:
        return 0

    existing_occ_ids = {
        row[0]
        for row in db.query(Task.occurrence_id).filter(Task.occurrence_id.in_(occ_ids_to_check)).all()
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


def archive_old_tasks(db: Session, days: int = 7) -> int:
    """Archive done/cancelled tasks older than `days` days.

    A task qualifies when either its due_date or (if no due_date) its
    completed_at timestamp is past the cutoff.  Tasks that have neither
    field are left alone.

    Returns the count of tasks archived.
    """
    cutoff_date = date.today() - timedelta(days=days)
    cutoff_dt = datetime(cutoff_date.year, cutoff_date.month, cutoff_date.day)
    count = (
        db.query(Task)
        .filter(
            Task.is_archived.is_(False),
            Task.status.in_([TaskStatus.done, TaskStatus.cancelled]),
            or_(
                Task.due_date <= cutoff_date,
                and_(
                    Task.due_date.is_(None),
                    Task.completed_at.isnot(None),
                    Task.completed_at <= cutoff_dt,
                ),
            ),
        )
        .update({"is_archived": True}, synchronize_session=False)
    )
    if count:
        db.commit()
    log.info("Archived %d completed/cancelled tasks (cutoff %s)", count, cutoff_date)
    return count


def cancel_tasks_for_occurrence(db: Session, occurrence: Occurrence) -> int:
    """Cancel all non-terminal tasks linked to this occurrence.

    Returns count cancelled.
    """
    count = (
        db.query(Task)
        .filter(
            Task.occurrence_id == occurrence.id,
            Task.status.notin_([TaskStatus.done, TaskStatus.cancelled]),
        )
        .update({"status": TaskStatus.cancelled}, synchronize_session=False)
    )
    if count:
        db.commit()
    return count
