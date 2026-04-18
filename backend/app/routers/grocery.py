from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session, joinedload

from ..database import get_db
from ..models import GroceryItem, GroceryList, GroceryListItem, OnHand, Store
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


# ── Items ─────────────────────────────────────────────────────────────────────

@router.get("/items", response_model=list[GroceryItemOut])
def list_grocery_items(
    search: str | None = Query(None),
    db: Session = Depends(get_db),
) -> list[GroceryItem]:
    """Return all grocery catalog items, optionally filtered by name."""
    q = db.query(GroceryItem).options(joinedload(GroceryItem.default_store))
    if search:
        q = q.filter(GroceryItem.name.ilike(f"%{search}%"))
    return q.order_by(GroceryItem.name).all()


@router.post("/items", response_model=GroceryItemOut, status_code=status.HTTP_201_CREATED)
def create_grocery_item(body: GroceryItemCreate, db: Session = Depends(get_db)) -> GroceryItem:
    """Add a new item to the grocery catalog."""
    if db.query(GroceryItem).filter(GroceryItem.name == body.name).first():
        raise HTTPException(status_code=409, detail="Item with this name already exists")
    if body.default_store_id and not db.get(Store, body.default_store_id):
        raise HTTPException(status_code=404, detail="Store not found")
    item = GroceryItem(**body.model_dump())
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.get("/items/{item_id}", response_model=GroceryItemOut)
def get_grocery_item(item_id: int, db: Session = Depends(get_db)) -> GroceryItem:
    """Return a single grocery catalog item."""
    item = db.query(GroceryItem).options(joinedload(GroceryItem.default_store)).filter(GroceryItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Grocery item not found")
    return item


@router.patch("/items/{item_id}", response_model=GroceryItemOut)
def update_grocery_item(
    item_id: int, body: GroceryItemUpdate, db: Session = Depends(get_db)
) -> GroceryItem:
    """Partially update a grocery catalog item."""
    item = db.get(GroceryItem, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Grocery item not found")
    data = body.model_dump(exclude_unset=True)
    if "default_store_id" in data and data["default_store_id"] and not db.get(Store, data["default_store_id"]):
        raise HTTPException(status_code=404, detail="Store not found")
    for field, value in data.items():
        setattr(item, field, value)
    db.commit()
    db.refresh(item)
    return item


@router.delete("/items/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_grocery_item(item_id: int, db: Session = Depends(get_db)) -> None:
    """Remove an item from the grocery catalog."""
    item = db.get(GroceryItem, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Grocery item not found")
    db.delete(item)
    db.commit()


# ── On Hand ───────────────────────────────────────────────────────────────────

@router.get("/on-hand", response_model=list[OnHandOut])
def list_on_hand(db: Session = Depends(get_db)) -> list[OnHand]:
    """Return all items currently on hand at home."""
    return (
        db.query(OnHand)
        .options(joinedload(OnHand.item).joinedload(GroceryItem.default_store))
        .join(GroceryItem)
        .order_by(GroceryItem.name)
        .all()
    )


@router.put("/on-hand/{item_id}", response_model=OnHandOut)
def upsert_on_hand(item_id: int, body: OnHandUpsert, db: Session = Depends(get_db)) -> OnHand:
    """Set the on-hand quantity for an item, creating the record if it doesn't exist."""
    if not db.get(GroceryItem, item_id):
        raise HTTPException(status_code=404, detail="Grocery item not found")
    record = db.query(OnHand).filter(OnHand.item_id == item_id).first()
    if record:
        record.quantity = body.quantity
        record.unit = body.unit
    else:
        record = OnHand(item_id=item_id, quantity=body.quantity, unit=body.unit)
        db.add(record)
    db.commit()
    db.refresh(record)
    return record


@router.delete("/on-hand/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_on_hand(item_id: int, db: Session = Depends(get_db)) -> None:
    """Remove an on-hand record (item consumed or no longer tracked)."""
    record = db.query(OnHand).filter(OnHand.item_id == item_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="On-hand record not found")
    db.delete(record)
    db.commit()


# ── Grocery Lists ─────────────────────────────────────────────────────────────

def _load_list(list_id: int, db: Session) -> GroceryList:
    lst = (
        db.query(GroceryList)
        .options(
            joinedload(GroceryList.store),
            joinedload(GroceryList.items)
            .joinedload(GroceryListItem.item)
            .joinedload(GroceryItem.default_store),
        )
        .filter(GroceryList.id == list_id)
        .first()
    )
    if not lst:
        raise HTTPException(status_code=404, detail="Grocery list not found")
    return lst


@router.get("/lists", response_model=list[GroceryListOut])
def list_grocery_lists(
    status: str | None = Query(None, description="Filter by status: draft, active, completed"),
    db: Session = Depends(get_db),
) -> list[GroceryList]:
    """Return all grocery lists, newest first."""
    q = (
        db.query(GroceryList)
        .options(
            joinedload(GroceryList.store),
            joinedload(GroceryList.items)
            .joinedload(GroceryListItem.item)
            .joinedload(GroceryItem.default_store),
        )
    )
    if status:
        q = q.filter(GroceryList.status == status)
    return q.order_by(GroceryList.created_at.desc()).all()


@router.post("/lists", response_model=GroceryListOut, status_code=status.HTTP_201_CREATED)
def create_grocery_list(body: GroceryListCreate, db: Session = Depends(get_db)) -> GroceryList:
    """Create a new grocery list."""
    if body.store_id and not db.get(Store, body.store_id):
        raise HTTPException(status_code=404, detail="Store not found")
    lst = GroceryList(**body.model_dump())
    db.add(lst)
    db.commit()
    db.refresh(lst)
    log.info("Created grocery list %d (%s)", lst.id, lst.name)
    return _load_list(lst.id, db)


@router.get("/lists/{list_id}", response_model=GroceryListOut)
def get_grocery_list(list_id: int, db: Session = Depends(get_db)) -> GroceryList:
    """Return a grocery list with all its items."""
    return _load_list(list_id, db)


@router.patch("/lists/{list_id}", response_model=GroceryListOut)
def update_grocery_list(
    list_id: int, body: GroceryListUpdate, db: Session = Depends(get_db)
) -> GroceryList:
    """Partially update a grocery list (e.g., advance status)."""
    lst = db.get(GroceryList, list_id)
    if not lst:
        raise HTTPException(status_code=404, detail="Grocery list not found")
    data = body.model_dump(exclude_unset=True)
    if "store_id" in data and data["store_id"] and not db.get(Store, data["store_id"]):
        raise HTTPException(status_code=404, detail="Store not found")
    for field, value in data.items():
        setattr(lst, field, value)
    db.commit()
    return _load_list(list_id, db)


@router.delete("/lists/{list_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_grocery_list(list_id: int, db: Session = Depends(get_db)) -> None:
    """Delete a grocery list and all its items."""
    lst = db.get(GroceryList, list_id)
    if not lst:
        raise HTTPException(status_code=404, detail="Grocery list not found")
    db.delete(lst)
    db.commit()
    log.info("Deleted grocery list %d", list_id)


# ── List Items ────────────────────────────────────────────────────────────────

@router.post("/lists/{list_id}/items", response_model=GroceryListItemOut, status_code=status.HTTP_201_CREATED)
def add_list_item(
    list_id: int, body: GroceryListItemCreate, db: Session = Depends(get_db)
) -> GroceryListItem:
    """Add an item to a grocery list."""
    if not db.get(GroceryList, list_id):
        raise HTTPException(status_code=404, detail="Grocery list not found")
    if not db.get(GroceryItem, body.item_id):
        raise HTTPException(status_code=404, detail="Grocery item not found")
    existing = (
        db.query(GroceryListItem)
        .filter(GroceryListItem.list_id == list_id, GroceryListItem.item_id == body.item_id)
        .first()
    )
    if existing:
        raise HTTPException(status_code=409, detail="Item already on this list")
    list_item = GroceryListItem(list_id=list_id, **body.model_dump())
    db.add(list_item)
    db.commit()
    db.refresh(list_item)
    return (
        db.query(GroceryListItem)
        .options(joinedload(GroceryListItem.item).joinedload(GroceryItem.default_store))
        .filter(GroceryListItem.id == list_item.id)
        .one()
    )


@router.patch("/lists/{list_id}/items/{item_id}", response_model=GroceryListItemOut)
def update_list_item(
    list_id: int,
    item_id: int,
    body: GroceryListItemUpdate,
    db: Session = Depends(get_db),
) -> GroceryListItem:
    """Update a list item (e.g., mark purchased, adjust quantity or price)."""
    list_item = (
        db.query(GroceryListItem)
        .filter(GroceryListItem.list_id == list_id, GroceryListItem.item_id == item_id)
        .first()
    )
    if not list_item:
        raise HTTPException(status_code=404, detail="Item not on this list")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(list_item, field, value)
    db.commit()
    db.refresh(list_item)
    return (
        db.query(GroceryListItem)
        .options(joinedload(GroceryListItem.item).joinedload(GroceryItem.default_store))
        .filter(GroceryListItem.id == list_item.id)
        .one()
    )


@router.delete("/lists/{list_id}/items/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_list_item(list_id: int, item_id: int, db: Session = Depends(get_db)) -> None:
    """Remove an item from a grocery list."""
    list_item = (
        db.query(GroceryListItem)
        .filter(GroceryListItem.list_id == list_id, GroceryListItem.item_id == item_id)
        .first()
    )
    if not list_item:
        raise HTTPException(status_code=404, detail="Item not on this list")
    db.delete(list_item)
    db.commit()
