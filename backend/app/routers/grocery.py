from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..crud import (
    apply_patch,
    get_or_404,
    GROCERY_ITEM_LOAD_OPTIONS,
    GROCERY_LIST_LOAD_OPTIONS,
    load_grocery_item,
    load_grocery_list,
    load_grocery_list_item,
    load_on_hand,
    ON_HAND_LOAD_OPTIONS,
)
from ..database import get_db
from ..models import GroceryItem, GroceryList, GroceryListItem, GroceryListStatus, OnHand, Store
from ..schemas import (
    GroceryItemCreate,
    GroceryItemOut,
    GroceryItemUpdate,
    GroceryListCreate,
    GroceryListItemCreate,
    GroceryListItemOut,
    GroceryListItemUpdate,
    GroceryListOut,
    GroceryListUpdate,
    OnHandOut,
    OnHandUpsert,
)

log = logging.getLogger(__name__)

router = APIRouter(prefix="/grocery", tags=["grocery"])


def _get_list_item_or_404(db: Session, list_id: int, item_id: int) -> GroceryListItem:
    list_item = (
        db.query(GroceryListItem)
        .filter(GroceryListItem.list_id == list_id, GroceryListItem.item_id == item_id)
        .first()
    )
    if not list_item:
        raise HTTPException(status_code=404, detail="Item not on this list")
    return list_item


# ── Items ─────────────────────────────────────────────────────────────────────

@router.get("/items", response_model=list[GroceryItemOut])
def list_grocery_items(
    search: str | None = Query(None),
    db: Session = Depends(get_db),
) -> list[GroceryItem]:
    q = db.query(GroceryItem).options(*GROCERY_ITEM_LOAD_OPTIONS)
    if search:
        q = q.filter(GroceryItem.name.ilike(f"%{search}%"))
    return q.order_by(GroceryItem.name).all()


@router.post("/items", response_model=GroceryItemOut, status_code=status.HTTP_201_CREATED)
def create_grocery_item(body: GroceryItemCreate, db: Session = Depends(get_db)) -> GroceryItem:
    if body.default_store_id:
        get_or_404(db, Store, body.default_store_id, "Store not found")
    item = GroceryItem(**body.model_dump())
    db.add(item)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Item with this name already exists")
    return load_grocery_item(db, item.id)


@router.get("/items/{item_id}", response_model=GroceryItemOut)
def get_grocery_item(item_id: int, db: Session = Depends(get_db)) -> GroceryItem:
    return load_grocery_item(db, item_id)


@router.patch("/items/{item_id}", response_model=GroceryItemOut)
def update_grocery_item(
    item_id: int, body: GroceryItemUpdate, db: Session = Depends(get_db)
) -> GroceryItem:
    item = get_or_404(db, GroceryItem, item_id, "Grocery item not found")
    data = body.model_dump(exclude_unset=True)
    if data.get("default_store_id"):
        get_or_404(db, Store, data["default_store_id"], "Store not found")
    apply_patch(item, data)
    db.commit()
    return load_grocery_item(db, item_id)


@router.delete("/items/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_grocery_item(item_id: int, db: Session = Depends(get_db)) -> None:
    item = get_or_404(db, GroceryItem, item_id, "Grocery item not found")
    db.delete(item)
    db.commit()


# ── On Hand ───────────────────────────────────────────────────────────────────

@router.get("/on-hand", response_model=list[OnHandOut])
def list_on_hand(db: Session = Depends(get_db)) -> list[OnHand]:
    return (
        db.query(OnHand)
        .options(*ON_HAND_LOAD_OPTIONS)
        .join(GroceryItem)
        .order_by(GroceryItem.name)
        .all()
    )


@router.put("/on-hand/{item_id}", response_model=OnHandOut)
def upsert_on_hand(item_id: int, body: OnHandUpsert, db: Session = Depends(get_db)) -> OnHand:
    """Set the on-hand quantity for an item, creating the record if it doesn't exist."""
    get_or_404(db, GroceryItem, item_id, "Grocery item not found")
    record = db.query(OnHand).filter(OnHand.item_id == item_id).first()
    if record:
        record.quantity = body.quantity
        record.unit = body.unit
    else:
        record = OnHand(item_id=item_id, quantity=body.quantity, unit=body.unit)
        db.add(record)
    db.commit()
    return load_on_hand(db, item_id)


@router.delete("/on-hand/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_on_hand(item_id: int, db: Session = Depends(get_db)) -> None:
    record = load_on_hand(db, item_id)
    db.delete(record)
    db.commit()


# ── Grocery Lists ─────────────────────────────────────────────────────────────

@router.get("/lists", response_model=list[GroceryListOut])
def list_grocery_lists(
    status: GroceryListStatus | None = Query(None),
    db: Session = Depends(get_db),
) -> list[GroceryList]:
    q = db.query(GroceryList).options(*GROCERY_LIST_LOAD_OPTIONS)
    if status:
        q = q.filter(GroceryList.status == status)
    return q.order_by(GroceryList.created_at.desc()).all()


@router.post("/lists", response_model=GroceryListOut, status_code=status.HTTP_201_CREATED)
def create_grocery_list(body: GroceryListCreate, db: Session = Depends(get_db)) -> GroceryList:
    if body.store_id:
        get_or_404(db, Store, body.store_id, "Store not found")
    lst = GroceryList(**body.model_dump())
    db.add(lst)
    db.commit()
    log.info("Created grocery list %d (%s)", lst.id, lst.name)
    return load_grocery_list(db, lst.id)


@router.get("/lists/{list_id}", response_model=GroceryListOut)
def get_grocery_list(list_id: int, db: Session = Depends(get_db)) -> GroceryList:
    return load_grocery_list(db, list_id)


@router.patch("/lists/{list_id}", response_model=GroceryListOut)
def update_grocery_list(
    list_id: int, body: GroceryListUpdate, db: Session = Depends(get_db)
) -> GroceryList:
    lst = get_or_404(db, GroceryList, list_id, "Grocery list not found")
    data = body.model_dump(exclude_unset=True)
    if data.get("store_id"):
        get_or_404(db, Store, data["store_id"], "Store not found")
    apply_patch(lst, data)
    db.commit()
    return load_grocery_list(db, list_id)


@router.delete("/lists/{list_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_grocery_list(list_id: int, db: Session = Depends(get_db)) -> None:
    lst = get_or_404(db, GroceryList, list_id, "Grocery list not found")
    db.delete(lst)
    db.commit()
    log.info("Deleted grocery list %d", list_id)


# ── List Items ────────────────────────────────────────────────────────────────

@router.post(
    "/lists/{list_id}/items",
    response_model=GroceryListItemOut,
    status_code=status.HTTP_201_CREATED,
)
def add_list_item(
    list_id: int, body: GroceryListItemCreate, db: Session = Depends(get_db)
) -> GroceryListItem:
    get_or_404(db, GroceryList, list_id, "Grocery list not found")
    get_or_404(db, GroceryItem, body.item_id, "Grocery item not found")
    list_item = GroceryListItem(list_id=list_id, **body.model_dump())
    db.add(list_item)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Item already on this list")
    return load_grocery_list_item(db, list_item.id)


@router.patch("/lists/{list_id}/items/{item_id}", response_model=GroceryListItemOut)
def update_list_item(
    list_id: int,
    item_id: int,
    body: GroceryListItemUpdate,
    db: Session = Depends(get_db),
) -> GroceryListItem:
    list_item = _get_list_item_or_404(db, list_id, item_id)
    apply_patch(list_item, body.model_dump(exclude_unset=True))
    db.commit()
    return load_grocery_list_item(db, list_item.id)


@router.delete("/lists/{list_id}/items/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_list_item(list_id: int, item_id: int, db: Session = Depends(get_db)) -> None:
    list_item = _get_list_item_or_404(db, list_id, item_id)
    db.delete(list_item)
    db.commit()
