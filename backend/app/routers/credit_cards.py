from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Category, CreditCard
from ..schemas import (
    CreditCardCreate, CreditCardOut, CreditCardUpdate,
    CreditCardTrackerRow, GenerateResult,
)
from ..services.credit_card import (
    ensure_card_events,
    generate_credit_card_occurrences,
    tracker_row,
)

router = APIRouter(prefix="/credit-cards", tags=["credit-cards"])


def _cc_category_id(db: Session) -> int:
    cat = db.query(Category).filter(Category.name == "credit_card").first()
    if not cat:
        raise HTTPException(status_code=500, detail="credit_card category not found — run seed_data.py")
    return cat.id


@router.get("", response_model=list[CreditCardOut])
def list_cards(db: Session = Depends(get_db)):
    return db.query(CreditCard).order_by(CreditCard.name).all()


@router.post("", response_model=CreditCardOut, status_code=status.HTTP_201_CREATED)
def create_card(body: CreditCardCreate, db: Session = Depends(get_db)):
    card = CreditCard(**body.model_dump())
    db.add(card)
    db.commit()
    db.refresh(card)
    ensure_card_events(db, card, _cc_category_id(db))
    generate_credit_card_occurrences(db, card)
    return card


@router.get("/tracker", response_model=list[CreditCardTrackerRow])
def tracker(db: Session = Depends(get_db)):
    """Return the tracker view for all active cards (mirrors credit-card-tracker.py output)."""
    today = date.today()
    cards = db.query(CreditCard).filter(CreditCard.is_active == True).order_by(CreditCard.name).all()
    return [tracker_row(card, today) for card in cards]


@router.get("/{card_id}", response_model=CreditCardOut)
def get_card(card_id: int, db: Session = Depends(get_db)):
    card = db.query(CreditCard).get(card_id)
    if not card:
        raise HTTPException(status_code=404, detail="Credit card not found")
    return card


@router.put("/{card_id}", response_model=CreditCardOut)
def update_card(card_id: int, body: CreditCardUpdate, db: Session = Depends(get_db)):
    card = db.query(CreditCard).get(card_id)
    if not card:
        raise HTTPException(status_code=404, detail="Credit card not found")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(card, field, value)
    db.commit()
    db.refresh(card)
    ensure_card_events(db, card, _cc_category_id(db))
    return card


@router.delete("/{card_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_card(card_id: int, db: Session = Depends(get_db)):
    card = db.query(CreditCard).get(card_id)
    if not card:
        raise HTTPException(status_code=404, detail="Credit card not found")
    db.delete(card)
    db.commit()


@router.post("/{card_id}/generate", response_model=GenerateResult)
def generate_occurrences(
    card_id: int,
    lookahead_days: int = Query(365, ge=1, le=1825),
    db: Session = Depends(get_db),
):
    card = db.query(CreditCard).get(card_id)
    if not card:
        raise HTTPException(status_code=404, detail="Credit card not found")
    created = generate_credit_card_occurrences(db, card, lookahead_days)
    return GenerateResult(events_processed=1, occurrences_created=created)


@router.post("/generate-all", response_model=GenerateResult)
def generate_all(
    lookahead_days: int = Query(365, ge=1, le=1825),
    db: Session = Depends(get_db),
):
    """Generate occurrences for all active credit cards."""
    cards = db.query(CreditCard).filter(CreditCard.is_active == True).all()
    total = 0
    for card in cards:
        total += generate_credit_card_occurrences(db, card, lookahead_days)
    return GenerateResult(events_processed=len(cards), occurrences_created=total)
