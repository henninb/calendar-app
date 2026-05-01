from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..crud import apply_patch, get_or_404
from ..database import get_db
from ..models import Category
from ..schemas import CategoryCreate, CategoryOut, CategoryUpdate

log = logging.getLogger(__name__)
router = APIRouter(prefix="/categories", tags=["categories"])


@router.get("", response_model=list[CategoryOut])
def list_categories(db: Session = Depends(get_db)) -> list[Category]:
    return db.query(Category).order_by(Category.name).all()


@router.post("", response_model=CategoryOut, status_code=status.HTTP_201_CREATED)
def create_category(body: CategoryCreate, db: Session = Depends(get_db)) -> Category:
    if db.query(Category).filter(Category.name == body.name).first():
        raise HTTPException(status_code=409, detail="Category name already exists")
    cat = Category(**body.model_dump())
    db.add(cat)
    db.commit()
    db.refresh(cat)
    log.info("Created category %d (%s)", cat.id, cat.name)
    return cat


@router.get("/{category_id}", response_model=CategoryOut)
def get_category(category_id: int, db: Session = Depends(get_db)) -> Category:
    return get_or_404(db, Category, category_id, "Category not found")


@router.put("/{category_id}", response_model=CategoryOut)
def update_category(
    category_id: int, body: CategoryUpdate, db: Session = Depends(get_db)
) -> Category:
    cat = get_or_404(db, Category, category_id, "Category not found")
    apply_patch(cat, body.model_dump(exclude_unset=True))
    db.commit()
    db.refresh(cat)
    log.info("Updated category %d (%s)", cat.id, cat.name)
    return cat


@router.delete("/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_category(category_id: int, db: Session = Depends(get_db)) -> None:
    cat = get_or_404(db, Category, category_id, "Category not found")
    log.info("Deleted category %d (%s)", cat.id, cat.name)
    db.delete(cat)
    db.commit()
