from __future__ import annotations

from datetime import date, timedelta

import pytest
from sqlalchemy.orm import Session

from app.models import Category, Event, Occurrence, OccurrenceStatus, Person, Priority, Subtask, Task, TaskRecurrence, TaskStatus
from app.services.task_generation import (
    cancel_tasks_for_occurrence,
    generate_pending_tasks,
    next_task_due_date,
    spawn_recurring_task,
)


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture
def category(db: Session) -> Category:
    cat = Category(name="personal", color="#3b82f6")
    db.add(cat)
    db.commit()
    return cat


def _make_task(
    db: Session,
    category: Category,
    *,
    due_date: date,
    recurrence: TaskRecurrence = TaskRecurrence.weekly,
) -> Task:
    task = Task(
        title="Test Task",
        category_id=category.id,
        due_date=due_date,
        recurrence=recurrence,
        status=TaskStatus.todo,
    )
    db.add(task)
    db.commit()
    db.refresh(task)
    return task


# ── next_task_due_date ────────────────────────────────────────────────────────

@pytest.mark.parametrize("recurrence,due,expected", [
    (TaskRecurrence.daily,     date(2026, 4, 30), date(2026, 5,  1)),
    (TaskRecurrence.weekly,    date(2026, 4, 30), date(2026, 5,  7)),
    (TaskRecurrence.biweekly,  date(2026, 4, 30), date(2026, 5, 14)),
    (TaskRecurrence.monthly,   date(2026, 4, 30), date(2026, 5, 30)),
    (TaskRecurrence.quarterly, date(2026, 4, 30), date(2026, 7, 30)),
    (TaskRecurrence.semiannual,date(2026, 4, 30), date(2026, 10,30)),
    (TaskRecurrence.yearly,    date(2026, 4, 30), date(2027, 4, 30)),
])
def test_next_task_due_date(recurrence: TaskRecurrence, due: date, expected: date) -> None:
    task = Task(due_date=due, recurrence=recurrence)
    assert next_task_due_date(task) == expected


def test_next_task_due_date_returns_none_for_non_recurring() -> None:
    task = Task(due_date=date(2026, 4, 30), recurrence=TaskRecurrence.none)
    assert next_task_due_date(task) is None


def test_next_task_due_date_returns_none_without_due_date() -> None:
    task = Task(due_date=None, recurrence=TaskRecurrence.weekly)
    assert next_task_due_date(task) is None


def test_next_task_due_date_monthly_clamps_to_end_of_month() -> None:
    """Jan 31 + 1 month → Feb 28 (non-leap year)."""
    task = Task(due_date=date(2026, 1, 31), recurrence=TaskRecurrence.monthly)
    assert next_task_due_date(task) == date(2026, 2, 28)


def test_next_task_due_date_yearly_clamps_leap_to_nonleap() -> None:
    """Feb 29 (leap year) + 1 year → Feb 28 (non-leap)."""
    task = Task(due_date=date(2024, 2, 29), recurrence=TaskRecurrence.yearly)
    assert next_task_due_date(task) == date(2025, 2, 28)


# ── spawn_recurring_task ──────────────────────────────────────────────────────

def test_spawn_recurring_task_creates_successor(db: Session, category: Category) -> None:
    task = _make_task(db, category, due_date=date(2026, 4, 30), recurrence=TaskRecurrence.weekly)

    spawn_recurring_task(db, task)
    db.commit()

    successor = db.query(Task).filter(Task.parent_task_id == task.id).first()
    assert successor is not None
    assert successor.due_date == date(2026, 5, 7)
    assert successor.title == task.title
    assert successor.recurrence == TaskRecurrence.weekly


def test_spawn_recurring_task_skips_if_successor_exists(db: Session, category: Category) -> None:
    task = _make_task(db, category, due_date=date(2026, 4, 30), recurrence=TaskRecurrence.weekly)
    spawn_recurring_task(db, task)
    db.commit()

    spawn_recurring_task(db, task)
    db.commit()

    count = db.query(Task).filter(Task.parent_task_id == task.id).count()
    assert count == 1


def test_spawn_recurring_task_is_noop_for_non_recurring(db: Session, category: Category) -> None:
    task = _make_task(db, category, due_date=date(2026, 4, 30), recurrence=TaskRecurrence.none)

    spawn_recurring_task(db, task)
    db.commit()

    assert db.query(Task).filter(Task.parent_task_id == task.id).count() == 0


def test_spawn_recurring_task_copies_subtasks(db: Session, category: Category) -> None:
    from app.models import Subtask

    task = _make_task(db, category, due_date=date(2026, 4, 30), recurrence=TaskRecurrence.weekly)
    sub = Subtask(task_id=task.id, title="Sub step", order=0)
    db.add(sub)
    db.commit()
    db.refresh(task)

    spawn_recurring_task(db, task)
    db.commit()

    successor = db.query(Task).filter(Task.parent_task_id == task.id).first()
    assert successor is not None
    subtasks = db.query(Subtask).filter(Subtask.task_id == successor.id).all()
    assert len(subtasks) == 1
    assert subtasks[0].title == "Sub step"
    assert subtasks[0].status == TaskStatus.todo


# ── cancel_tasks_for_occurrence ───────────────────────────────────────────────

def _make_occurrence(db: Session, category: Category, occ_date: date) -> Occurrence:
    event = Event(
        title="Test Event",
        category_id=category.id,
        dtstart=occ_date,
        priority=Priority.medium,
        is_active=True,
        generates_tasks=True,
        reminder_days=[7],
    )
    db.add(event)
    db.flush()
    occ = Occurrence(
        event_id=event.id,
        occurrence_date=occ_date,
        status=OccurrenceStatus.upcoming,
    )
    db.add(occ)
    db.commit()
    db.refresh(occ)
    return occ


def test_cancel_tasks_for_occurrence_cancels_todo_tasks(db: Session, category: Category) -> None:
    occ = _make_occurrence(db, category, date.today() + timedelta(days=3))
    task = Task(
        occurrence_id=occ.id,
        title="To cancel",
        priority=Priority.medium,
        due_date=occ.occurrence_date,
        status=TaskStatus.todo,
    )
    db.add(task)
    db.commit()

    count = cancel_tasks_for_occurrence(db, occ)
    assert count == 1
    db.refresh(task)
    assert task.status == TaskStatus.cancelled


def test_cancel_tasks_for_occurrence_cancels_in_progress(db: Session, category: Category) -> None:
    occ = _make_occurrence(db, category, date.today() + timedelta(days=3))
    task = Task(
        occurrence_id=occ.id,
        title="In progress",
        priority=Priority.medium,
        due_date=occ.occurrence_date,
        status=TaskStatus.in_progress,
    )
    db.add(task)
    db.commit()

    count = cancel_tasks_for_occurrence(db, occ)
    assert count == 1
    db.refresh(task)
    assert task.status == TaskStatus.cancelled


def test_cancel_tasks_for_occurrence_skips_done_tasks(db: Session, category: Category) -> None:
    occ = _make_occurrence(db, category, date.today() + timedelta(days=3))
    task = Task(
        occurrence_id=occ.id,
        title="Already done",
        priority=Priority.medium,
        due_date=occ.occurrence_date,
        status=TaskStatus.done,
    )
    db.add(task)
    db.commit()

    count = cancel_tasks_for_occurrence(db, occ)
    assert count == 0
    db.refresh(task)
    assert task.status == TaskStatus.done


def test_cancel_tasks_for_occurrence_skips_already_cancelled(db: Session, category: Category) -> None:
    occ = _make_occurrence(db, category, date.today() + timedelta(days=3))
    task = Task(
        occurrence_id=occ.id,
        title="Already cancelled",
        priority=Priority.medium,
        due_date=occ.occurrence_date,
        status=TaskStatus.cancelled,
    )
    db.add(task)
    db.commit()

    count = cancel_tasks_for_occurrence(db, occ)
    assert count == 0


def test_cancel_tasks_for_occurrence_no_tasks_returns_zero(db: Session, category: Category) -> None:
    occ = _make_occurrence(db, category, date.today() + timedelta(days=3))
    assert cancel_tasks_for_occurrence(db, occ) == 0


# ── generate_pending_tasks ────────────────────────────────────────────────────

def test_generate_pending_tasks_no_events_returns_zero(db: Session) -> None:
    assert generate_pending_tasks(db) == 0


def test_generate_pending_tasks_creates_task_within_lead_window(db: Session, category: Category) -> None:
    # Event with 7-day lead; occurrence 5 days away → within window
    lead_days = 7
    occ_date = date.today() + timedelta(days=5)
    event = Event(
        title="Upcoming Task Event",
        category_id=category.id,
        dtstart=occ_date,
        priority=Priority.medium,
        is_active=True,
        generates_tasks=True,
        reminder_days=[lead_days],
    )
    db.add(event)
    db.flush()
    occ = Occurrence(
        event_id=event.id,
        occurrence_date=occ_date,
        status=OccurrenceStatus.upcoming,
    )
    db.add(occ)
    db.commit()

    count = generate_pending_tasks(db)
    assert count == 1
    task = db.query(Task).filter(Task.occurrence_id == occ.id).first()
    assert task is not None
    assert task.title == "Upcoming Task Event"
    assert task.due_date == occ_date


def test_generate_pending_tasks_skips_event_without_generates_tasks(db: Session, category: Category) -> None:
    occ_date = date.today() + timedelta(days=3)
    event = Event(
        title="Non-generating Event",
        category_id=category.id,
        dtstart=occ_date,
        priority=Priority.medium,
        is_active=True,
        generates_tasks=False,   # should be skipped
        reminder_days=[7],
    )
    db.add(event)
    db.flush()
    db.add(Occurrence(
        event_id=event.id,
        occurrence_date=occ_date,
        status=OccurrenceStatus.upcoming,
    ))
    db.commit()

    assert generate_pending_tasks(db) == 0


def test_next_task_due_date_returns_none_for_unknown_recurrence() -> None:
    from unittest.mock import MagicMock

    task = MagicMock()
    # "unknown" is not a valid TaskRecurrence value so none of the branches match
    task.recurrence = "unknown_recurrence"
    task.due_date = date(2026, 3, 15)
    result = next_task_due_date(task)
    assert result is None


def test_generate_pending_tasks_skips_occurrence_beyond_individual_threshold(
    db: Session, category: Category
) -> None:
    today = date.today()
    event_a = Event(
        title="Short Lead Event",
        category_id=category.id,
        dtstart=today,
        priority=Priority.medium,
        is_active=True,
        generates_tasks=True,
        reminder_days=[7],
    )
    event_b = Event(
        title="Long Lead Event",
        category_id=category.id,
        dtstart=today,
        priority=Priority.medium,
        is_active=True,
        generates_tasks=True,
        reminder_days=[14],
    )
    db.add_all([event_a, event_b])
    db.flush()

    # Occurrence for Event A at today+10: beyond event_a threshold (today+7)
    # but within max_threshold (today+14) → included in query but skipped in loop
    occ_a = Occurrence(
        event_id=event_a.id,
        occurrence_date=today + timedelta(days=10),
        status=OccurrenceStatus.upcoming,
    )
    # Occurrence for Event B at today+3: within both thresholds → task created
    occ_b = Occurrence(
        event_id=event_b.id,
        occurrence_date=today + timedelta(days=3),
        status=OccurrenceStatus.upcoming,
    )
    db.add_all([occ_a, occ_b])
    db.commit()

    count = generate_pending_tasks(db)
    assert count == 1
    assert db.query(Task).filter(Task.occurrence_id == occ_b.id).first() is not None
    assert db.query(Task).filter(Task.occurrence_id == occ_a.id).first() is None


def test_generate_pending_tasks_idempotent(db: Session, category: Category) -> None:
    occ_date = date.today() + timedelta(days=5)
    event = Event(
        title="Idempotent Event",
        category_id=category.id,
        dtstart=occ_date,
        priority=Priority.medium,
        is_active=True,
        generates_tasks=True,
        reminder_days=[7],
    )
    db.add(event)
    db.flush()
    db.add(Occurrence(
        event_id=event.id,
        occurrence_date=occ_date,
        status=OccurrenceStatus.upcoming,
    ))
    db.commit()

    assert generate_pending_tasks(db) == 1
    assert generate_pending_tasks(db) == 0  # second call creates nothing


def test_generate_pending_tasks_skips_past_occurrences(db: Session, category: Category) -> None:
    occ_date = date.today() - timedelta(days=1)  # yesterday
    event = Event(
        title="Past Event",
        category_id=category.id,
        dtstart=occ_date,
        priority=Priority.medium,
        is_active=True,
        generates_tasks=True,
        reminder_days=[7],
    )
    db.add(event)
    db.flush()
    db.add(Occurrence(
        event_id=event.id,
        occurrence_date=occ_date,
        status=OccurrenceStatus.upcoming,
    ))
    db.commit()

    assert generate_pending_tasks(db) == 0
