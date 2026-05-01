from __future__ import annotations

from datetime import date

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

import pytest
from app.models import Category, Task, TaskRecurrence, TaskStatus


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture
def category(db: Session) -> Category:
    cat = Category(name="work", color="#3b82f6")
    db.add(cat)
    db.commit()
    return cat


@pytest.fixture
def task(client: TestClient, category: Category) -> dict:
    resp = client.post(
        "/api/tasks",
        json={"title": "Write report", "category_id": category.id},
    )
    assert resp.status_code == 201
    return resp.json()


@pytest.fixture
def subtask(client: TestClient, task: dict) -> dict:
    resp = client.post(
        f"/api/tasks/{task['id']}/subtasks",
        json={"title": "Draft outline"},
    )
    assert resp.status_code == 201
    return resp.json()


# ── Subtask 404 via _get_subtask_or_404 ───────────────────────────────────────

def test_update_subtask_wrong_task_id_returns_404(
    client: TestClient, task: dict, subtask: dict
) -> None:
    resp = client.patch(
        f"/api/tasks/99999/subtasks/{subtask['id']}",
        json={"title": "Updated"},
    )
    assert resp.status_code == 404


def test_update_subtask_wrong_subtask_id_returns_404(
    client: TestClient, task: dict
) -> None:
    resp = client.patch(
        f"/api/tasks/{task['id']}/subtasks/99999",
        json={"title": "Updated"},
    )
    assert resp.status_code == 404


def test_delete_subtask_wrong_task_id_returns_404(
    client: TestClient, task: dict, subtask: dict
) -> None:
    resp = client.delete(f"/api/tasks/99999/subtasks/{subtask['id']}")
    assert resp.status_code == 404


def test_delete_subtask_wrong_subtask_id_returns_404(
    client: TestClient, task: dict
) -> None:
    resp = client.delete(f"/api/tasks/{task['id']}/subtasks/99999")
    assert resp.status_code == 404


# ── Subtask happy path ────────────────────────────────────────────────────────

def test_create_and_update_subtask(client: TestClient, task: dict) -> None:
    sub = client.post(
        f"/api/tasks/{task['id']}/subtasks",
        json={"title": "Step one"},
    ).json()
    assert sub["title"] == "Step one"
    assert sub["status"] == "todo"

    resp = client.patch(
        f"/api/tasks/{task['id']}/subtasks/{sub['id']}",
        json={"status": "done"},
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "done"
    assert resp.json()["completed_at"] is not None


def test_delete_subtask(client: TestClient, task: dict, subtask: dict) -> None:
    resp = client.delete(f"/api/tasks/{task['id']}/subtasks/{subtask['id']}")
    assert resp.status_code == 204


def test_task_includes_subtasks_in_response(client: TestClient, task: dict) -> None:
    client.post(f"/api/tasks/{task['id']}/subtasks", json={"title": "Sub A"})
    client.post(f"/api/tasks/{task['id']}/subtasks", json={"title": "Sub B"})
    resp = client.get(f"/api/tasks/{task['id']}")
    assert resp.status_code == 200
    assert len(resp.json()["subtasks"]) == 2


# ── Recurring task: cancel advances the chain ─────────────────────────────────

@pytest.fixture
def recurring_task(client: TestClient, category: Category) -> dict:
    resp = client.post(
        "/api/tasks",
        json={
            "title": "Weekly chore",
            "category_id": category.id,
            "due_date": "2026-04-30",
            "recurrence": "weekly",
        },
    )
    assert resp.status_code == 201
    return resp.json()


def test_cancel_recurring_task_spawns_successor(
    client: TestClient, db: Session, recurring_task: dict
) -> None:
    resp = client.patch(
        f"/api/tasks/{recurring_task['id']}",
        json={"status": "cancelled"},
    )
    assert resp.status_code == 200

    successor = db.query(Task).filter(Task.parent_task_id == recurring_task["id"]).first()
    assert successor is not None
    assert successor.due_date == date(2026, 5, 7)
    assert successor.recurrence == TaskRecurrence.weekly
    assert successor.title == recurring_task["title"]
    assert successor.status == TaskStatus.todo
    assert successor.completed_at is None


def test_cancel_recurring_task_spawns_exactly_one_successor(
    client: TestClient, db: Session, recurring_task: dict
) -> None:
    client.patch(f"/api/tasks/{recurring_task['id']}", json={"status": "cancelled"})

    count = db.query(Task).filter(Task.parent_task_id == recurring_task["id"]).count()
    assert count == 1


def test_done_recurring_task_also_spawns_successor(
    client: TestClient, db: Session, recurring_task: dict
) -> None:
    resp = client.patch(
        f"/api/tasks/{recurring_task['id']}",
        json={"status": "done"},
    )
    assert resp.status_code == 200

    successor = db.query(Task).filter(Task.parent_task_id == recurring_task["id"]).first()
    assert successor is not None
    assert successor.due_date == date(2026, 5, 7)
    assert successor.status == TaskStatus.todo


def test_cancel_non_recurring_task_no_successor(
    client: TestClient, db: Session, category: Category
) -> None:
    resp = client.post(
        "/api/tasks",
        json={"title": "One-off task", "category_id": category.id, "due_date": "2026-04-30"},
    )
    task_id = resp.json()["id"]

    client.patch(f"/api/tasks/{task_id}", json={"status": "cancelled"})

    count = db.query(Task).filter(Task.parent_task_id == task_id).count()
    assert count == 0
