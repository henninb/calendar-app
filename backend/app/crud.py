from __future__ import annotations

from typing import Any, TypeVar

from fastapi import HTTPException
from sqlalchemy.orm import Session, joinedload

from .models import Event, GroceryItem, GroceryList, GroceryListItem, Occurrence, OnHand, Task

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
