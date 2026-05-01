from __future__ import annotations

from typing import Any, TypeVar

from fastapi import HTTPException
from sqlalchemy.orm import Session

T = TypeVar("T")


def get_or_404(db: Session, model: type[T], obj_id: int, detail: str = "Not found") -> T:
    """Fetch a row by primary key or raise HTTP 404."""
    obj = db.get(model, obj_id)
    if obj is None:
        raise HTTPException(status_code=404, detail=detail)
    return obj


def apply_patch(obj: Any, data: dict[str, Any]) -> None:
    """Apply a partial-update dict to a model instance in place."""
    for field, value in data.items():
        setattr(obj, field, value)
