from __future__ import annotations

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.crud import apply_patch, get_or_404
from app.models import Store


# ── get_or_404 ────────────────────────────────────────────────────────────────

def test_get_or_404_returns_object_when_found(db: Session) -> None:
    store = Store(name="ALDI", is_active=True)
    db.add(store)
    db.commit()

    result = get_or_404(db, Store, store.id, "Store not found")

    assert result.id == store.id
    assert result.name == "ALDI"


def test_get_or_404_raises_404_when_missing(db: Session) -> None:
    with pytest.raises(HTTPException) as exc_info:
        get_or_404(db, Store, 99999, "Store not found")

    assert exc_info.value.status_code == 404
    assert exc_info.value.detail == "Store not found"


def test_get_or_404_uses_custom_detail(db: Session) -> None:
    with pytest.raises(HTTPException) as exc_info:
        get_or_404(db, Store, 1, "Custom detail message")

    assert exc_info.value.detail == "Custom detail message"


def test_get_or_404_uses_default_detail_when_omitted(db: Session) -> None:
    with pytest.raises(HTTPException) as exc_info:
        get_or_404(db, Store, 1)

    assert exc_info.value.detail == "Not found"


# ── apply_patch ───────────────────────────────────────────────────────────────

def test_apply_patch_updates_specified_fields(db: Session) -> None:
    store = Store(name="Old Name", location="Old Location", is_active=True)
    db.add(store)
    db.commit()

    apply_patch(store, {"name": "New Name"})
    db.commit()
    db.refresh(store)

    assert store.name == "New Name"
    assert store.location == "Old Location"


def test_apply_patch_with_empty_dict_changes_nothing(db: Session) -> None:
    store = Store(name="Unchanged", is_active=True)
    db.add(store)
    db.commit()

    apply_patch(store, {})
    db.commit()
    db.refresh(store)

    assert store.name == "Unchanged"


def test_apply_patch_updates_multiple_fields(db: Session) -> None:
    store = Store(name="Old", location="Old Location", is_active=True)
    db.add(store)
    db.commit()

    apply_patch(store, {"name": "New", "location": "New Location", "is_active": False})
    db.commit()
    db.refresh(store)

    assert store.name == "New"
    assert store.location == "New Location"
    assert store.is_active is False


# ── Integration: 404 responses via HTTP ───────────────────────────────────────

def test_get_store_returns_404_via_api(client: TestClient) -> None:
    resp = client.get("/api/stores/99999")
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Store not found"


def test_delete_store_returns_404_via_api(client: TestClient) -> None:
    resp = client.delete("/api/stores/99999")
    assert resp.status_code == 404
