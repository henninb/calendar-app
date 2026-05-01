from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.schemas import CategoryCreate, CategoryUpdate


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
