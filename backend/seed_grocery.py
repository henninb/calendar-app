#!/usr/bin/env python3
"""
seed_grocery.py — Seed grocery catalog items, on-hand quantities, and ALDI store.

Idempotent: items and stores are looked up by name; existing records are updated,
not duplicated. Re-running the script is safe.
"""
from __future__ import annotations

from decimal import Decimal

from app.database import SessionLocal, Base, engine
from app.models import Store, GroceryItem, OnHand, GroceryUnit

Base.metadata.create_all(bind=engine)

# ── Seed data ─────────────────────────────────────────────────────────────────
#
# ALDI Store #86, Coon Rapids MN — receipt 04/18/2026
#
# Each entry: (name, default_unit, on_hand_qty)
# on_hand_qty is how much came home from this shopping trip.
# For weight items the quantity is what was purchased (lb).
# For multiples (x2) the quantity reflects actual count.

ALDI_ITEMS: list[tuple[str, str, Decimal]] = [
    ("Ground Coffee",            "each", Decimal("1")),
    ("Cherub Tomatoes",          "each", Decimal("1")),
    ("Chicken Noodle Soup",      "can",  Decimal("2")),
    ("Family Chicken Nuggets",   "bag",  Decimal("1")),
    ("Red Grapes",               "lb",   Decimal("2.49")),
    ("Dill Pickles",             "jar",  Decimal("1")),
    ("Organic Ketchup",          "each", Decimal("2")),
    ("Green Grapes",             "lb",   Decimal("2.64")),
    ("Mandarins",                "bag",  Decimal("1")),
    ("Lemons",                   "bag",  Decimal("1")),
    ("Kiwi",                     "bag",  Decimal("1")),
    ("Garden Salad",             "each", Decimal("2")),
    ("Thin Sliced Pork Chops",   "each", Decimal("1")),
]


def upsert_store(db, name: str, location: str) -> Store:
    store = db.query(Store).filter(Store.name == name).first()
    if not store:
        store = Store(name=name, location=location)
        db.add(store)
        db.flush()
        print(f"  + Store created: {name}")
    else:
        print(f"  = Store exists:  {name}")
    return store


def upsert_grocery_item(db, name: str, unit: str, default_store_id: int) -> GroceryItem:
    item = db.query(GroceryItem).filter(GroceryItem.name == name).first()
    if not item:
        item = GroceryItem(
            name=name,
            default_unit=GroceryUnit(unit),
            default_store_id=default_store_id,
        )
        db.add(item)
        db.flush()
        print(f"  + Item created:  {name} ({unit})")
    else:
        print(f"  = Item exists:   {name} ({item.default_unit})")
    return item


def upsert_on_hand(db, item: GroceryItem, qty: Decimal, unit: str) -> None:
    record = db.query(OnHand).filter(OnHand.item_id == item.id).first()
    if not record:
        record = OnHand(item_id=item.id, quantity=qty, unit=GroceryUnit(unit))
        db.add(record)
        print(f"  + On-hand set:   {item.name} → {qty} {unit}")
    else:
        record.quantity = qty
        record.unit = GroceryUnit(unit)
        print(f"  ~ On-hand update:{item.name} → {qty} {unit}")


def seed() -> None:
    db = SessionLocal()
    try:
        print("Seeding ALDI store…")
        store = upsert_store(db, "ALDI", "Coon Rapids, MN")

        print("\nSeeding grocery catalog + on-hand inventory…")
        for name, unit, qty in ALDI_ITEMS:
            item = upsert_grocery_item(db, name, unit, store.id)
            upsert_on_hand(db, item, qty, unit)

        db.commit()
        print(f"\nDone — {len(ALDI_ITEMS)} items seeded.")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed()
