from __future__ import annotations

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

import pytest
from app.models import Category, Task, TaskStatus


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
