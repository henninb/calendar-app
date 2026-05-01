from __future__ import annotations

import logging
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from ..config import settings
from ..crud import apply_patch, get_or_404
from ..database import get_db
from ..models import Category, CreditCard
from ..schemas import (
    CreditCardCreate,
    CreditCardOut,
    CreditCardTrackerRow,
    CreditCardUpdate,
    GenerateResult,
)
from ..services.credit_card import (
    ensure_card_events,
    generate_credit_card_occurrences,
    tracker_row,
)

log = logging.getLogger(__name__)

router = APIRouter(prefix="/credit-cards", tags=["credit-cards"])


def _cc_category_id(db: Session) -> int:
    cat = db.query(Category).filter(Category.name == "credit_card").first()
    if not cat:
        raise HTTPException(
            status_code=500,
            detail="credit_card category not found — run seed_data.py",
        )
    return cat.id


@router.get("", response_model=list[CreditCardOut])
def list_cards(db: Session = Depends(get_db)) -> list[CreditCard]:
    return db.query(CreditCard).order_by(CreditCard.name).all()


@router.post("", response_model=CreditCardOut, status_code=status.HTTP_201_CREATED)
def create_card(body: CreditCardCreate, db: Session = Depends(get_db)) -> CreditCard:
    card = CreditCard(**body.model_dump())
    db.add(card)
    db.commit()
    db.refresh(card)
    ensure_card_events(db, card, _cc_category_id(db))
    generate_credit_card_occurrences(db, card)
    log.info("Created credit card %d (%s)", card.id, card.name)
    return card


@router.get("/tracker", response_model=list[CreditCardTrackerRow])
def tracker(db: Session = Depends(get_db)) -> list[CreditCardTrackerRow]:
    """Return the tracker view for all active cards (mirrors credit-card-tracker.py output)."""
    today = date.today()
    cards = db.query(CreditCard).filter(CreditCard.is_active.isnot(False)).order_by(CreditCard.name).all()
    rows = []
    for card in cards:
        try:
            rows.append(tracker_row(card, today))
        except Exception as exc:
            log.warning("Skipping tracker row for card %d (%s): %s", card.id, card.name, exc)
    return rows


@router.get("/{card_id}", response_model=CreditCardOut)
def get_card(card_id: int, db: Session = Depends(get_db)) -> CreditCard:
    return get_or_404(db, CreditCard, card_id, "Credit card not found")


@router.put("/{card_id}", response_model=CreditCardOut)
def update_card(card_id: int, body: CreditCardUpdate, db: Session = Depends(get_db)) -> CreditCard:
    card = get_or_404(db, CreditCard, card_id, "Credit card not found")
    apply_patch(card, body.model_dump(exclude_unset=True))
    db.commit()
    db.refresh(card)
    ensure_card_events(db, card, _cc_category_id(db))
    log.info("Updated credit card %d (%s)", card.id, card.name)
    return card


@router.delete("/{card_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_card(card_id: int, db: Session = Depends(get_db)) -> None:
    card = get_or_404(db, CreditCard, card_id, "Credit card not found")
    log.info("Deleted credit card %d (%s)", card.id, card.name)
    db.delete(card)
    db.commit()


@router.post("/{card_id}/generate", response_model=GenerateResult)
def generate_occurrences(
    card_id: int,
    lookahead_days: int = Query(settings.occurrence_lookahead_days, ge=1, le=1825),
    db: Session = Depends(get_db),
) -> GenerateResult:
    card = get_or_404(db, CreditCard, card_id, "Credit card not found")
    created = generate_credit_card_occurrences(db, card, lookahead_days)
    return GenerateResult(events_processed=1, occurrences_created=created)


@router.post("/generate-all", response_model=GenerateResult)
def generate_all(
    lookahead_days: int = Query(settings.occurrence_lookahead_days, ge=1, le=1825),
    db: Session = Depends(get_db),
) -> GenerateResult:
    """Generate occurrences for all active credit cards."""
    cards = db.query(CreditCard).filter(CreditCard.is_active.isnot(False)).all()
    total = sum(generate_credit_card_occurrences(db, card, lookahead_days) for card in cards)
    return GenerateResult(events_processed=len(cards), occurrences_created=total)
