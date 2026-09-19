from __future__ import annotations

from datetime import date
from typing import Any, TypeVar

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from .models import Event, GroceryItem, GroceryList, GroceryListItem, Occurrence, OnHand, Task, TaskStatus

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


_OPEN_STATUSES = (TaskStatus.todo, TaskStatus.in_progress)


def find_duplicate_task(
    db: Session,
    title: str,
    due_date: date | None,
    status: TaskStatus,
    exclude_id: int | None = None,
) -> Task | None:
    """Return an open task with the same title, due date and status, if any.

    Mirrors the uq_task_open_title_due_status partial unique index: title is
    compared trimmed and case-insensitive; archived and terminal tasks never
    collide.  A task with no due date can't collide (NULLs are distinct in the
    index), so None is returned for them.
    """
    if due_date is None or status not in _OPEN_STATUSES:
        return None
    q = db.query(Task).filter(
        func.lower(func.trim(Task.title)) == title.strip().lower(),
        Task.due_date == due_date,
        Task.status == status,
        Task.is_archived.is_(False),
    )
    if exclude_id is not None:
        q = q.filter(Task.id != exclude_id)
    return q.first()


def duplicate_task_error(existing: Task) -> HTTPException:
    """409 with a message the UI can show verbatim."""
    return HTTPException(
        status_code=409,
        detail=(
            f"A task titled \u201c{existing.title}\u201d already exists on "
            f"{existing.due_date} with status {existing.status.value} (task #{existing.id})."
        ),
    )


# ── Grocery eager-load options and loaders ───────────────────────────────────

GROCERY_ITEM_LOAD_OPTIONS = [
    joinedload(GroceryItem.default_store),
]

GROCERY_LIST_ITEM_LOAD_OPTIONS = [
    joinedload(GroceryListItem.item).joinedload(GroceryItem.default_store),
]

GROCERY_LIST_LOAD_OPTIONS = [
    joinedload(GroceryList.store),
    joinedload(GroceryList.items)
    .joinedload(GroceryListItem.item)
    .joinedload(GroceryItem.default_store),
]

ON_HAND_LOAD_OPTIONS = [
    joinedload(OnHand.item).joinedload(GroceryItem.default_store),
]


def load_grocery_item(db: Session, item_id: int) -> GroceryItem:
    item = (
        db.query(GroceryItem)
        .options(*GROCERY_ITEM_LOAD_OPTIONS)
        .filter(GroceryItem.id == item_id)
        .first()
    )
    if item is None:
        raise HTTPException(status_code=404, detail="Grocery item not found")
    return item


def load_grocery_list(db: Session, list_id: int) -> GroceryList:
    lst = (
        db.query(GroceryList)
        .options(*GROCERY_LIST_LOAD_OPTIONS)
        .filter(GroceryList.id == list_id)
        .first()
    )
    if lst is None:
        raise HTTPException(status_code=404, detail="Grocery list not found")
    return lst


def load_grocery_list_item(db: Session, list_item_id: int) -> GroceryListItem:
    item = (
        db.query(GroceryListItem)
        .options(*GROCERY_LIST_ITEM_LOAD_OPTIONS)
        .filter(GroceryListItem.id == list_item_id)
        .first()
    )
    if item is None:
        raise HTTPException(status_code=404, detail="Grocery list item not found")
    return item


def load_on_hand(db: Session, item_id: int) -> OnHand:
    record = (
        db.query(OnHand)
        .options(*ON_HAND_LOAD_OPTIONS)
        .filter(OnHand.item_id == item_id)
        .first()
    )
    if record is None:
        raise HTTPException(status_code=404, detail="On-hand record not found")
    return record
