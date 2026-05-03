"""Integration tests for the /api/credit-cards router."""
import pytest
from sqlalchemy.orm import Session

from app.models import Category


def _create_cc_category(db: Session) -> Category:
    cat = Category(name="credit_card", color="#FF6B6B", icon="credit-card")
    db.add(cat)
    db.commit()
    db.refresh(cat)
    return cat


def _card_payload(**overrides) -> dict:
    base = {
        "name": "Chase Sapphire",
        "issuer": "Chase",
        "statement_close_day": 15,
        "grace_period_days": 21,
    }
    base.update(overrides)
    return base


# ── GET /api/credit-cards ──────────────────────────────────────────────────────

class TestListCreditCards:
    def test_empty_list(self, client):
        r = client.get("/api/credit-cards")
        assert r.status_code == 200
        assert r.json() == []

    def test_lists_created_cards(self, client, db):
        _create_cc_category(db)
        client.post("/api/credit-cards", json=_card_payload(name="Card A"))
        client.post("/api/credit-cards", json=_card_payload(name="Card B"))
        r = client.get("/api/credit-cards")
        assert r.status_code == 200
        names = [c["name"] for c in r.json()]
        assert "Card A" in names
        assert "Card B" in names

    def test_sorted_alphabetically(self, client, db):
        _create_cc_category(db)
        client.post("/api/credit-cards", json=_card_payload(name="Zebra"))
        client.post("/api/credit-cards", json=_card_payload(name="Apple"))
        names = [c["name"] for c in client.get("/api/credit-cards").json()]
        assert names == sorted(names)


# ── POST /api/credit-cards ─────────────────────────────────────────────────────

class TestCreateCreditCard:
    def test_creates_and_returns_201(self, client, db):
        _create_cc_category(db)
        r = client.post("/api/credit-cards", json=_card_payload())
        assert r.status_code == 201
        data = r.json()
        assert data["name"] == "Chase Sapphire"
        assert data["issuer"] == "Chase"
        assert data["id"] > 0

    def test_with_last_four(self, client, db):
        _create_cc_category(db)
        r = client.post("/api/credit-cards", json=_card_payload(last_four="9999"))
        assert r.status_code == 201
        assert r.json()["last_four"] == "9999"

    def test_with_annual_fee_month(self, client, db):
        _create_cc_category(db)
        r = client.post("/api/credit-cards", json=_card_payload(annual_fee_month=3))
        assert r.status_code == 201
        assert r.json()["annual_fee_month"] == 3

    def test_with_due_day_next_month(self, client, db):
        _create_cc_category(db)
        payload = _card_payload(due_day_next_month=20, grace_period_days=None)
        r = client.post("/api/credit-cards", json=payload)
        assert r.status_code == 201
        assert r.json()["due_day_next_month"] == 20

    def test_invalid_last_four_rejected(self, client, db):
        _create_cc_category(db)
        r = client.post("/api/credit-cards", json=_card_payload(last_four="12"))
        assert r.status_code == 422

    def test_invalid_statement_close_day_rejected(self, client, db):
        _create_cc_category(db)
        r = client.post("/api/credit-cards", json=_card_payload(statement_close_day=32))
        assert r.status_code == 422

    def test_missing_credit_card_category_returns_500(self, client):
        # No category seeded → _cc_category_id raises HTTPException 500
        r = client.post("/api/credit-cards", json=_card_payload())
        assert r.status_code == 500


# ── GET /api/credit-cards/{id} ─────────────────────────────────────────────────

class TestGetCreditCard:
    def test_get_existing(self, client, db):
        _create_cc_category(db)
        card_id = client.post("/api/credit-cards", json=_card_payload()).json()["id"]
        r = client.get(f"/api/credit-cards/{card_id}")
        assert r.status_code == 200
        assert r.json()["id"] == card_id

    def test_get_not_found(self, client):
        r = client.get("/api/credit-cards/99999")
        assert r.status_code == 404


# ── PUT /api/credit-cards/{id} ─────────────────────────────────────────────────

class TestUpdateCreditCard:
    def test_update_name(self, client, db):
        _create_cc_category(db)
        card_id = client.post("/api/credit-cards", json=_card_payload()).json()["id"]
        r = client.put(f"/api/credit-cards/{card_id}", json={"name": "New Name"})
        assert r.status_code == 200
        assert r.json()["name"] == "New Name"

    def test_update_issuer(self, client, db):
        _create_cc_category(db)
        card_id = client.post("/api/credit-cards", json=_card_payload()).json()["id"]
        r = client.put(f"/api/credit-cards/{card_id}", json={"issuer": "Amex"})
        assert r.status_code == 200
        assert r.json()["issuer"] == "Amex"

    def test_update_is_active(self, client, db):
        _create_cc_category(db)
        card_id = client.post("/api/credit-cards", json=_card_payload()).json()["id"]
        r = client.put(f"/api/credit-cards/{card_id}", json={"is_active": False})
        assert r.status_code == 200
        assert r.json()["is_active"] is False

    def test_update_not_found(self, client):
        r = client.put("/api/credit-cards/99999", json={"name": "x"})
        assert r.status_code == 404


# ── DELETE /api/credit-cards/{id} ─────────────────────────────────────────────

class TestDeleteCreditCard:
    def test_delete_returns_204(self, client, db):
        _create_cc_category(db)
        card_id = client.post("/api/credit-cards", json=_card_payload()).json()["id"]
        r = client.delete(f"/api/credit-cards/{card_id}")
        assert r.status_code == 204

    def test_deleted_card_not_found(self, client, db):
        _create_cc_category(db)
        card_id = client.post("/api/credit-cards", json=_card_payload()).json()["id"]
        client.delete(f"/api/credit-cards/{card_id}")
        assert client.get(f"/api/credit-cards/{card_id}").status_code == 404

    def test_delete_not_found(self, client):
        r = client.delete("/api/credit-cards/99999")
        assert r.status_code == 404


# ── GET /api/credit-cards/tracker ─────────────────────────────────────────────

class TestTrackerEndpoint:
    def test_tracker_empty(self, client):
        r = client.get("/api/credit-cards/tracker")
        assert r.status_code == 200
        assert r.json() == []

    def test_tracker_returns_row_for_active_card(self, client, db):
        _create_cc_category(db)
        client.post("/api/credit-cards", json=_card_payload())
        r = client.get("/api/credit-cards/tracker")
        assert r.status_code == 200
        rows = r.json()
        assert len(rows) == 1
        row = rows[0]
        assert "next_close" in row
        assert "next_due" in row
        assert "grace" in row
        assert "prev_due_overdue" in row

    def test_tracker_excludes_inactive_card(self, client, db):
        _create_cc_category(db)
        client.post("/api/credit-cards", json=_card_payload(is_active=False))
        r = client.get("/api/credit-cards/tracker")
        assert r.status_code == 200
        assert r.json() == []


# ── POST /api/credit-cards/{id}/generate ──────────────────────────────────────

class TestGenerateOccurrences:
    def test_generate_returns_result(self, client, db):
        _create_cc_category(db)
        card_id = client.post("/api/credit-cards", json=_card_payload()).json()["id"]
        r = client.post(f"/api/credit-cards/{card_id}/generate?lookahead_days=30")
        assert r.status_code == 200
        data = r.json()
        assert data["events_processed"] == 1
        assert isinstance(data["occurrences_created"], int)

    def test_generate_idempotent(self, client, db):
        _create_cc_category(db)
        card_id = client.post("/api/credit-cards", json=_card_payload()).json()["id"]
        r1 = client.post(f"/api/credit-cards/{card_id}/generate?lookahead_days=30")
        r2 = client.post(f"/api/credit-cards/{card_id}/generate?lookahead_days=30")
        assert r1.status_code == 200
        assert r2.status_code == 200
        assert r2.json()["occurrences_created"] == 0

    def test_generate_not_found(self, client):
        r = client.post("/api/credit-cards/99999/generate")
        assert r.status_code == 404


# ── POST /api/credit-cards/generate-all ───────────────────────────────────────

class TestGenerateAll:
    def test_generate_all_empty(self, client):
        r = client.post("/api/credit-cards/generate-all?lookahead_days=30")
        assert r.status_code == 200
        data = r.json()
        assert data["events_processed"] == 0
        assert data["occurrences_created"] == 0

    def test_generate_all_with_card(self, client, db):
        _create_cc_category(db)
        client.post("/api/credit-cards", json=_card_payload())
        r = client.post("/api/credit-cards/generate-all?lookahead_days=30")
        assert r.status_code == 200
        assert r.json()["events_processed"] >= 1
