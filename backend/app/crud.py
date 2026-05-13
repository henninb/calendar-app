from __future__ import annotations

from typing import Any, TypeVar

from fastapi import HTTPException
from sqlalchemy.orm import Session, joinedload

from .models import Event, Occurrence, Task

T = TypeVar("T")


def get_or_404(db: Session, model: type[T], obj_id: int, detail: str = "Not found") -> T:
    """Fetch a row by primary key or raise HTTP 404."""
    obj = db.get(model, obj_id)
    if obj is None:
        raise HTTPException(status_code=404, detail=detail)
    return obj


def assert_exists(db: Session, model: type, obj_id: int, detail: str = "Not found") -> None:
    """Raise 404 if obj_id is not present — use when only existence needs to be confirmed."""
    if db.get(model, obj_id) is None:
        raise HTTPException(status_code=404, detail=detail)


def apply_patch(obj: object, data: dict[str, Any]) -> None:
    """Apply a partial-update dict to a model instance in place."""
    for field, value in data.items():
        setattr(obj, field, value)


# ── Shared eager-load options and loaders ────────────────────────────────────

TASK_LOAD_OPTIONS = [
    joinedload(Task.assignee),
    joinedload(Task.category),
    joinedload(Task.subtasks),
]

OCCURRENCE_LOAD_OPTIONS = [
    joinedload(Occurrence.event).joinedload(Event.category),
]


def load_occurrence(db: Session, occurrence_id: int) -> Occurrence:
    occ = (
        db.query(Occurrence)
        .options(*OCCURRENCE_LOAD_OPTIONS)
        .filter(Occurrence.id == occurrence_id)
        .first()
    )
    if occ is None:
        raise HTTPException(status_code=404, detail="Occurrence not found")
    return occ


def load_task(db: Session, task_id: int) -> Task:
    task = (
        db.query(Task)
        .options(*TASK_LOAD_OPTIONS)
        .filter(Task.id == task_id)
        .first()
    )
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return task
