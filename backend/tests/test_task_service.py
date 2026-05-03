from __future__ import annotations

from datetime import date

import pytest
from sqlalchemy.orm import Session

from datetime import timedelta

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
