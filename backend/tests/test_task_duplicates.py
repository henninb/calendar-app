from __future__ import annotations

from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import Category, Event, Occurrence, Task, TaskRecurrence, TaskStatus
from app.services.task_generation import generate_pending_tasks, spawn_recurring_task

DAY = "2026-09-20"


def _post(client: TestClient, **over):
    return client.post("/api/tasks", json={"title": "Pay rent", "due_date": DAY, **over})


# ── POST /tasks ───────────────────────────────────────────────────────────────

def test_duplicate_create_returns_409_with_existing_id(client: TestClient):
    first = _post(client)
    assert first.status_code == 201
    second = _post(client)
    assert second.status_code == 409
    assert f"#{first.json()['id']}" in second.json()["detail"]


def test_title_match_ignores_case_and_whitespace(client: TestClient):
    assert _post(client).status_code == 201
    assert _post(client, title="  PAY RENT ").status_code == 409


def test_different_day_or_status_is_allowed(client: TestClient):
    assert _post(client).status_code == 201
    assert _post(client, due_date="2026-09-21").status_code == 201
    assert _post(client, status="in_progress").status_code == 201


def test_done_task_does_not_block_new_one(client: TestClient):
    assert _post(client, status="done").status_code == 201
    assert _post(client, status="done").status_code == 201
    assert _post(client).status_code == 201


def test_undated_tasks_are_not_blocked(client: TestClient):
    assert client.post("/api/tasks", json={"title": "Someday"}).status_code == 201
    assert client.post("/api/tasks", json={"title": "Someday"}).status_code == 201


# ── PATCH /tasks/{id} ─────────────────────────────────────────────────────────

def test_patch_due_date_onto_existing_task_is_409(client: TestClient):
    _post(client)
    other = _post(client, due_date="2026-09-21").json()
    resp = client.patch(f"/api/tasks/{other['id']}", json={"due_date": DAY})
    assert resp.status_code == 409


def test_patch_reopening_done_task_onto_open_twin_is_409(client: TestClient):
    _post(client)
    done = _post(client, status="done").json()
    assert client.patch(f"/api/tasks/{done['id']}", json={"status": "todo"}).status_code == 409


def test_patch_unrelated_field_on_task_is_fine(client: TestClient):
    t = _post(client).json()
    assert client.patch(f"/api/tasks/{t['id']}", json={"priority": "high"}).status_code == 200
    assert client.patch(f"/api/tasks/{t['id']}", json={"title": "Pay rent"}).status_code == 200


# ── Database index (the race backstop) ────────────────────────────────────────

def test_unique_index_rejects_duplicate_written_around_the_api(db: Session):
    db.add(Task(title="Pay rent", due_date=date(2026, 9, 20), status=TaskStatus.todo))
    db.commit()
    db.add(Task(title=" pay RENT", due_date=date(2026, 9, 20), status=TaskStatus.todo))
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()


def test_unique_index_ignores_archived_and_terminal(db: Session):
    d = date(2026, 9, 20)
    db.add_all([
        Task(title="Pay rent", due_date=d, status=TaskStatus.todo),
        Task(title="Pay rent", due_date=d, status=TaskStatus.done),
        Task(title="Pay rent", due_date=d, status=TaskStatus.done),
        Task(title="Pay rent", due_date=d, status=TaskStatus.cancelled, is_archived=True),
    ])
    db.commit()


# ── Recurrence spawn ──────────────────────────────────────────────────────────

def test_spawn_skips_when_successor_date_is_already_taken(db: Session):
    db.add(Task(title="Fill water", due_date=date(2026, 9, 21), status=TaskStatus.todo))
    parent = Task(
        title="Fill water", due_date=date(2026, 9, 20),
        status=TaskStatus.done, recurrence=TaskRecurrence.daily,
    )
    db.add(parent)
    db.commit()

    spawn_recurring_task(db, parent)
    db.commit()

    assert db.query(Task).filter(Task.title == "Fill water").count() == 2


# ── Scheduler generation ──────────────────────────────────────────────────────

def test_generate_pending_tasks_skips_occurrence_already_covered_by_a_task(db: Session):
    cat = Category(name="bills")
    db.add(cat)
    db.flush()
    event = Event(
        title="Pay rent", category_id=cat.id, dtstart=date.today(),
        generates_tasks=True, reminder_days=[7],
    )
    db.add(event)
    db.flush()
    db.add(Occurrence(event_id=event.id, occurrence_date=date.today()))
    db.add(Task(title="pay rent", due_date=date.today(), status=TaskStatus.todo))
    db.commit()

    assert generate_pending_tasks(db) == 0
    assert db.query(Task).count() == 1


# ── reopening a completed recurring task ──────────────────────────────────────

def _recurring(client: TestClient) -> int:
    return _post(client, recurrence="daily").json()["id"]


def _titles_open(client: TestClient) -> list[dict]:
    return client.get("/api/tasks").json()


def test_reopening_done_recurring_task_removes_untouched_successor(client: TestClient):
    tid = _recurring(client)
    assert client.patch(f"/api/tasks/{tid}", json={"status": "done"}).status_code == 200
    assert len(_titles_open(client)) == 1  # the spawned successor
    assert client.patch(f"/api/tasks/{tid}", json={"status": "todo"}).status_code == 200
    open_tasks = _titles_open(client)
    assert [t["id"] for t in open_tasks] == [tid]


def test_reopening_keeps_successor_that_was_started(client: TestClient):
    tid = _recurring(client)
    client.patch(f"/api/tasks/{tid}", json={"status": "done"})
    succ = _titles_open(client)[0]["id"]
    client.patch(f"/api/tasks/{succ}", json={"status": "in_progress"})
    client.patch(f"/api/tasks/{tid}", json={"status": "todo"})
    assert {t["id"] for t in _titles_open(client)} == {tid, succ}
