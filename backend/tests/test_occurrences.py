from __future__ import annotations

from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models import Category, Event, Occurrence, OccurrenceStatus


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture
def category(db: Session) -> Category:
    cat = Category(name="household", color="#3b82f6")
    db.add(cat)
    db.commit()
    return cat


@pytest.fixture
def event(db: Session, category: Category) -> Event:
    ev = Event(
        title="Weekly Vacuum",
        category_id=category.id,
        dtstart=date(2026, 5, 1),
        rrule="FREQ=WEEKLY",
        priority="medium",
        is_active=True,
    )
    db.add(ev)
    db.commit()
    return ev


@pytest.fixture
def occurrence(db: Session, event: Event) -> Occurrence:
    occ = Occurrence(
        event_id=event.id,
        occurrence_date=date(2026, 5, 8),
        status=OccurrenceStatus.upcoming,
    )
    db.add(occ)
    db.commit()
    return occ


# ── update_occurrence ─────────────────────────────────────────────────────────

def test_update_occurrence_status(client: TestClient, occurrence: Occurrence) -> None:
    resp = client.patch(
        f"/api/occurrences/{occurrence.id}",
        json={"status": "completed"},
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "completed"


def test_update_occurrence_notes(client: TestClient, occurrence: Occurrence) -> None:
    resp = client.patch(
        f"/api/occurrences/{occurrence.id}",
        json={"notes": "Done early"},
    )
    assert resp.status_code == 200
    assert resp.json()["notes"] == "Done early"


def test_update_occurrence_not_found_returns_404(client: TestClient) -> None:
    resp = client.patch("/api/occurrences/99999", json={"status": "completed"})
    assert resp.status_code == 404


# ── create_task_from_occurrence ───────────────────────────────────────────────

def test_create_task_from_occurrence_returns_201(
    client: TestClient, occurrence: Occurrence
) -> None:
    resp = client.post(f"/api/occurrences/{occurrence.id}/task")
    assert resp.status_code == 201
    data = resp.json()
    assert data["title"] == "Weekly Vacuum"
    assert data["due_date"] == "2026-05-08"


def test_create_task_from_occurrence_includes_category(
    client: TestClient, occurrence: Occurrence
) -> None:
    resp = client.post(f"/api/occurrences/{occurrence.id}/task")
    assert resp.status_code == 201
    data = resp.json()
    assert data["category"] is not None
    assert data["category"]["name"] == "household"


def test_create_task_from_occurrence_is_idempotent(
    client: TestClient, occurrence: Occurrence
) -> None:
    resp1 = client.post(f"/api/occurrences/{occurrence.id}/task")
    resp2 = client.post(f"/api/occurrences/{occurrence.id}/task")
    assert resp1.status_code == 201
    assert resp2.status_code == 201
    assert resp1.json()["id"] == resp2.json()["id"]


def test_create_task_from_nonexistent_occurrence_returns_404(
    client: TestClient,
) -> None:
    resp = client.post("/api/occurrences/99999/task")
    assert resp.status_code == 404
