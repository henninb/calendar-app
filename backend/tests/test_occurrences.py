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


# ── list_occurrences ──────────────────────────────────────────────────────────

def test_list_occurrences_empty(client: TestClient) -> None:
    resp = client.get("/api/occurrences")
    assert resp.status_code == 200
    assert resp.json() == []


def test_list_occurrences_returns_created(client: TestClient, occurrence: Occurrence) -> None:
    resp = client.get("/api/occurrences")
    assert resp.status_code == 200
    ids = [o["id"] for o in resp.json()]
    assert occurrence.id in ids


def test_list_occurrences_filter_by_event_id(
    client: TestClient, db: Session, category: Category, event: Event, occurrence: Occurrence
) -> None:
    other_event = Event(
        title="Other Event",
        category_id=category.id,
        dtstart=date(2026, 5, 1),
        priority="low",
        is_active=True,
    )
    db.add(other_event)
    db.flush()
    other_occ = Occurrence(
        event_id=other_event.id,
        occurrence_date=date(2026, 5, 15),
        status=OccurrenceStatus.upcoming,
    )
    db.add(other_occ)
    db.commit()

    resp = client.get(f"/api/occurrences?event_id={event.id}")
    assert resp.status_code == 200
    ids = [o["id"] for o in resp.json()]
    assert occurrence.id in ids
    assert other_occ.id not in ids


def test_list_occurrences_filter_by_status(
    client: TestClient, db: Session, event: Event, occurrence: Occurrence
) -> None:
    completed_occ = Occurrence(
        event_id=event.id,
        occurrence_date=date(2026, 5, 15),
        status=OccurrenceStatus.completed,
    )
    db.add(completed_occ)
    db.commit()

    resp = client.get("/api/occurrences?status=completed")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["status"] == "completed"


def test_list_occurrences_filter_by_date_range(
    client: TestClient, db: Session, event: Event
) -> None:
    for d in (date(2026, 4, 1), date(2026, 5, 10), date(2026, 6, 1)):
        db.add(Occurrence(event_id=event.id, occurrence_date=d, status=OccurrenceStatus.upcoming))
    db.commit()

    resp = client.get("/api/occurrences?start_date=2026-05-01&end_date=2026-05-31")
    assert resp.status_code == 200
    dates = [o["occurrence_date"] for o in resp.json()]
    assert "2026-05-10" in dates
    assert "2026-04-01" not in dates
    assert "2026-06-01" not in dates


def test_list_occurrences_pagination(
    client: TestClient, db: Session, event: Event
) -> None:
    for i in range(5):
        db.add(Occurrence(
            event_id=event.id,
            occurrence_date=date(2026, 5, i + 1),
            status=OccurrenceStatus.upcoming,
        ))
    db.commit()

    r1 = client.get("/api/occurrences?limit=2&offset=0")
    r2 = client.get("/api/occurrences?limit=2&offset=2")
    assert len(r1.json()) == 2
    assert len(r2.json()) == 2
    assert {o["id"] for o in r1.json()}.isdisjoint({o["id"] for o in r2.json()})


# ── get_occurrence ────────────────────────────────────────────────────────────

def test_get_occurrence(client: TestClient, occurrence: Occurrence) -> None:
    resp = client.get(f"/api/occurrences/{occurrence.id}")
    assert resp.status_code == 200
    assert resp.json()["id"] == occurrence.id


def test_get_occurrence_not_found(client: TestClient) -> None:
    resp = client.get("/api/occurrences/99999")
    assert resp.status_code == 404


def test_get_occurrence_includes_event_and_category(
    client: TestClient, occurrence: Occurrence
) -> None:
    resp = client.get(f"/api/occurrences/{occurrence.id}")
    assert resp.status_code == 200
    data = resp.json()
    assert data["event"]["title"] == "Weekly Vacuum"
    assert data["event"]["category"]["name"] == "household"


# ── delete_occurrence ─────────────────────────────────────────────────────────

def test_delete_occurrence(client: TestClient, occurrence: Occurrence) -> None:
    resp = client.delete(f"/api/occurrences/{occurrence.id}")
    assert resp.status_code == 204
    assert client.get(f"/api/occurrences/{occurrence.id}").status_code == 404


def test_delete_occurrence_not_found(client: TestClient) -> None:
    resp = client.delete("/api/occurrences/99999")
    assert resp.status_code == 404


# ── update_occurrence: skip cancels linked tasks ──────────────────────────────

def test_skip_occurrence_cancels_tasks(
    client: TestClient, occurrence: Occurrence
) -> None:
    client.post(f"/api/occurrences/{occurrence.id}/task")
    resp = client.patch(f"/api/occurrences/{occurrence.id}", json={"status": "skipped"})
    assert resp.status_code == 200
    assert resp.json()["status"] == "skipped"


# ── generate-all ──────────────────────────────────────────────────────────────

def test_generate_all_occurrences(client: TestClient, event: Event) -> None:
    resp = client.post("/api/occurrences/generate-all?lookahead_days=30")
    assert resp.status_code == 200
    data = resp.json()
    assert "events_processed" in data
    assert "occurrences_created" in data
    assert isinstance(data["occurrences_created"], int)


def test_list_occurrences_filter_by_category_id(
    client: TestClient, db: Session, occurrence: Occurrence, event: Event, category: Category
) -> None:
    other_cat = Category(name="other_cat", color="#ff0000")
    db.add(other_cat)
    db.flush()
    other_event = Event(
        title="Other Cat Event",
        category_id=other_cat.id,
        dtstart=date(2026, 5, 1),
        priority="low",
        is_active=True,
    )
    db.add(other_event)
    db.flush()
    other_occ = Occurrence(
        event_id=other_event.id,
        occurrence_date=date(2026, 5, 20),
        status=OccurrenceStatus.upcoming,
    )
    db.add(other_occ)
    db.commit()

    resp = client.get(f"/api/occurrences?category_id={category.id}")
    assert resp.status_code == 200
    ids = [o["id"] for o in resp.json()]
    assert occurrence.id in ids
    assert other_occ.id not in ids
