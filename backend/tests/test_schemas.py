from __future__ import annotations

from datetime import date

import pytest
from pydantic import ValidationError

from app.schemas import (
    CategoryCreate,
    CategoryUpdate,
    CreditCardCreate,
    EventCreate,
    PersonCreate,
    SubtaskCreate,
    TaskCreate,
)


def test_category_name_accepts_up_to_50_chars() -> None:
    cat = CategoryCreate(name="A" * 50, color="#3b82f6", icon="📅")
    assert len(cat.name) == 50


def test_category_name_rejects_51_chars() -> None:
    with pytest.raises(ValidationError):
        CategoryCreate(name="A" * 51, color="#3b82f6", icon="📅")


def test_category_update_name_rejects_51_chars() -> None:
    with pytest.raises(ValidationError):
        CategoryUpdate(name="B" * 51)


def test_category_color_must_be_hex() -> None:
    with pytest.raises(ValidationError):
        CategoryCreate(name="Bills", color="blue", icon="📅")


def test_category_color_accepts_valid_hex() -> None:
    cat = CategoryCreate(name="Bills", color="#ff0000", icon="📅")
    assert cat.color == "#ff0000"


def test_category_via_api_rejects_long_name(client) -> None:
    resp = client.post(
        "/api/categories",
        json={"name": "X" * 51, "color": "#3b82f6", "icon": "📅"},
    )
    assert resp.status_code == 422


# ── EventCreate ───────────────────────────────────────────────────────────────

def test_event_title_accepts_255_chars() -> None:
    e = EventCreate(title="A" * 255, category_id=1, dtstart=date.today())
    assert len(e.title) == 255


def test_event_title_rejects_256_chars() -> None:
    with pytest.raises(ValidationError):
        EventCreate(title="A" * 256, category_id=1, dtstart=date.today())


def test_event_rrule_prefix_stripped() -> None:
    e = EventCreate(title="X", category_id=1, dtstart=date.today(), rrule="RRULE:FREQ=WEEKLY")
    assert e.rrule == "FREQ=WEEKLY"


def test_event_rrule_none_stays_none() -> None:
    e = EventCreate(title="X", category_id=1, dtstart=date.today(), rrule=None)
    assert e.rrule is None


def test_event_rrule_no_prefix_unchanged() -> None:
    e = EventCreate(title="X", category_id=1, dtstart=date.today(), rrule="FREQ=MONTHLY")
    assert e.rrule == "FREQ=MONTHLY"


def test_event_description_accepts_4096_chars() -> None:
    e = EventCreate(title="X", category_id=1, dtstart=date.today(), description="D" * 4096)
    assert len(e.description) == 4096


def test_event_description_rejects_4097_chars() -> None:
    with pytest.raises(ValidationError):
        EventCreate(title="X", category_id=1, dtstart=date.today(), description="D" * 4097)


def test_event_defaults() -> None:
    e = EventCreate(title="X", category_id=1, dtstart=date.today())
    assert e.is_active is True
    assert e.generates_tasks is False
    assert e.duration_days == 1
    assert e.priority.value == "medium"


# ── PersonCreate ──────────────────────────────────────────────────────────────

def test_person_valid_email() -> None:
    p = PersonCreate(name="Alice", email="alice@example.com")
    assert "@" in str(p.email)


def test_person_invalid_email_raises() -> None:
    with pytest.raises(ValidationError):
        PersonCreate(name="Alice", email="not-an-email")


def test_person_email_optional() -> None:
    p = PersonCreate(name="Alice")
    assert p.email is None


def test_person_name_max_255() -> None:
    PersonCreate(name="A" * 255)


def test_person_name_rejects_256_chars() -> None:
    with pytest.raises(ValidationError):
        PersonCreate(name="A" * 256)


# ── TaskCreate ────────────────────────────────────────────────────────────────

def test_task_title_accepts_255_chars() -> None:
    t = TaskCreate(title="A" * 255)
    assert len(t.title) == 255


def test_task_title_rejects_256_chars() -> None:
    with pytest.raises(ValidationError):
        TaskCreate(title="A" * 256)


def test_task_description_accepts_4096_chars() -> None:
    t = TaskCreate(title="X", description="D" * 4096)
    assert len(t.description) == 4096


def test_task_description_rejects_4097_chars() -> None:
    with pytest.raises(ValidationError):
        TaskCreate(title="X", description="D" * 4097)


def test_task_defaults() -> None:
    t = TaskCreate(title="X")
    assert t.status.value == "todo"
    assert t.priority.value == "medium"
    assert t.recurrence.value == "none"


# ── SubtaskCreate ─────────────────────────────────────────────────────────────

def test_subtask_title_accepts_255_chars() -> None:
    SubtaskCreate(title="A" * 255)


def test_subtask_title_rejects_256_chars() -> None:
    with pytest.raises(ValidationError):
        SubtaskCreate(title="A" * 256)


def test_subtask_defaults() -> None:
    s = SubtaskCreate(title="X")
    assert s.status.value == "todo"
    assert s.order == 0


# ── CreditCardCreate ──────────────────────────────────────────────────────────

def test_credit_card_last_four_valid() -> None:
    c = CreditCardCreate(name="Card", last_four="1234")
    assert c.last_four == "1234"


def test_credit_card_last_four_too_short_rejected() -> None:
    with pytest.raises(ValidationError):
        CreditCardCreate(name="Card", last_four="12")


def test_credit_card_last_four_non_digits_rejected() -> None:
    with pytest.raises(ValidationError):
        CreditCardCreate(name="Card", last_four="abcd")


def test_credit_card_last_four_five_digits_rejected() -> None:
    with pytest.raises(ValidationError):
        CreditCardCreate(name="Card", last_four="12345")


def test_credit_card_statement_close_day_min() -> None:
    with pytest.raises(ValidationError):
        CreditCardCreate(name="Card", statement_close_day=0)


def test_credit_card_statement_close_day_max() -> None:
    with pytest.raises(ValidationError):
        CreditCardCreate(name="Card", statement_close_day=32)


def test_credit_card_statement_close_day_valid_boundaries() -> None:
    CreditCardCreate(name="Card", statement_close_day=1)
    CreditCardCreate(name="Card", statement_close_day=31)


def test_credit_card_annual_fee_month_min() -> None:
    with pytest.raises(ValidationError):
        CreditCardCreate(name="Card", annual_fee_month=0)


def test_credit_card_annual_fee_month_max() -> None:
    with pytest.raises(ValidationError):
        CreditCardCreate(name="Card", annual_fee_month=13)


def test_credit_card_annual_fee_month_valid_boundaries() -> None:
    CreditCardCreate(name="Card", annual_fee_month=1)
    CreditCardCreate(name="Card", annual_fee_month=12)


def test_credit_card_grace_period_non_negative() -> None:
    with pytest.raises(ValidationError):
        CreditCardCreate(name="Card", grace_period_days=-1)


def test_credit_card_is_active_defaults_true() -> None:
    c = CreditCardCreate(name="Card")
    assert c.is_active is True


def test_credit_card_is_active_coerced_from_none() -> None:
    c = CreditCardCreate(name="Card", is_active=None)
    assert c.is_active is True
