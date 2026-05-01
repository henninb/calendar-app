from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..crud import apply_patch, get_or_404
from ..database import get_db
from ..models import Store
from ..schemas import StoreCreate, StoreOut, StoreUpdate

log = logging.getLogger(__name__)

router = APIRouter(prefix="/stores", tags=["stores"])


@router.get("", response_model=list[StoreOut])
def list_stores(db: Session = Depends(get_db)) -> list[Store]:
    return db.query(Store).order_by(Store.name).all()


@router.post("", response_model=StoreOut, status_code=status.HTTP_201_CREATED)
def create_store(body: StoreCreate, db: Session = Depends(get_db)) -> Store:
    if db.query(Store).filter(Store.name == body.name).first():
        raise HTTPException(status_code=409, detail="Store with this name already exists")
    store = Store(**body.model_dump())
    db.add(store)
    db.commit()
    db.refresh(store)
    log.info("Created store %d (%s)", store.id, store.name)
    return store


@router.get("/{store_id}", response_model=StoreOut)
def get_store(store_id: int, db: Session = Depends(get_db)) -> Store:
    return get_or_404(db, Store, store_id, "Store not found")


@router.patch("/{store_id}", response_model=StoreOut)
def update_store(store_id: int, body: StoreUpdate, db: Session = Depends(get_db)) -> Store:
    store = get_or_404(db, Store, store_id, "Store not found")
    apply_patch(store, body.model_dump(exclude_unset=True))
    db.commit()
    db.refresh(store)
    log.info("Updated store %d (%s)", store.id, store.name)
    return store


@router.delete("/{store_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_store(store_id: int, db: Session = Depends(get_db)) -> None:
    store = get_or_404(db, Store, store_id, "Store not found")
    log.info("Deleted store %d (%s)", store_id, store.name)
    db.delete(store)
    db.commit()
