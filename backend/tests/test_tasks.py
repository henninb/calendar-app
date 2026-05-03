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


# ── CRUD: list / create / get / update / delete ───────────────────────────────

def test_list_tasks_empty(client: TestClient) -> None:
    resp = client.get("/api/tasks")
    assert resp.status_code == 200
    assert resp.json() == []


def test_create_task_minimal(client: TestClient, category: Category) -> None:
    resp = client.post("/api/tasks", json={"title": "Minimum task", "category_id": category.id})
    assert resp.status_code == 201
    data = resp.json()
    assert data["title"] == "Minimum task"
    assert data["status"] == "todo"
    assert data["id"] > 0


def test_create_task_with_due_date(client: TestClient, category: Category) -> None:
    resp = client.post(
        "/api/tasks",
        json={"title": "With due", "category_id": category.id, "due_date": "2026-06-01"},
    )
    assert resp.status_code == 201
    assert resp.json()["due_date"] == "2026-06-01"


def test_create_task_invalid_category_returns_404(client: TestClient) -> None:
    resp = client.post("/api/tasks", json={"title": "Bad cat", "category_id": 99999})
    assert resp.status_code == 404


def test_get_task_returns_task(client: TestClient, task: dict) -> None:
    resp = client.get(f"/api/tasks/{task['id']}")
    assert resp.status_code == 200
    assert resp.json()["id"] == task["id"]


def test_get_task_not_found(client: TestClient) -> None:
    resp = client.get("/api/tasks/99999")
    assert resp.status_code == 404


def test_update_task_title(client: TestClient, task: dict) -> None:
    resp = client.patch(f"/api/tasks/{task['id']}", json={"title": "Renamed task"})
    assert resp.status_code == 200
    assert resp.json()["title"] == "Renamed task"


def test_update_task_description(client: TestClient, task: dict) -> None:
    resp = client.patch(f"/api/tasks/{task['id']}", json={"description": "More detail"})
    assert resp.status_code == 200
    assert resp.json()["description"] == "More detail"


def test_update_task_not_found(client: TestClient) -> None:
    resp = client.patch("/api/tasks/99999", json={"title": "Ghost"})
    assert resp.status_code == 404


def test_delete_task(client: TestClient, task: dict) -> None:
    resp = client.delete(f"/api/tasks/{task['id']}")
    assert resp.status_code == 204
    assert client.get(f"/api/tasks/{task['id']}").status_code == 404


def test_delete_task_not_found(client: TestClient) -> None:
    resp = client.delete("/api/tasks/99999")
    assert resp.status_code == 404


# ── List filtering ────────────────────────────────────────────────────────────

def test_filter_tasks_by_status(client: TestClient, category: Category) -> None:
    client.post("/api/tasks", json={"title": "Todo task", "category_id": category.id})
    done_id = client.post(
        "/api/tasks", json={"title": "Done task", "category_id": category.id}
    ).json()["id"]
    client.patch(f"/api/tasks/{done_id}", json={"status": "done"})

    resp = client.get("/api/tasks?status=done")
    assert resp.status_code == 200
    titles = [t["title"] for t in resp.json()]
    assert "Done task" in titles
    assert "Todo task" not in titles


def test_filter_tasks_by_category_id(client: TestClient, db: Session) -> None:
    cat_a = Category(name="CatA", color="#aabbcc")
    cat_b = Category(name="CatB", color="#112233")
    db.add_all([cat_a, cat_b])
    db.commit()

    client.post("/api/tasks", json={"title": "A task", "category_id": cat_a.id})
    client.post("/api/tasks", json={"title": "B task", "category_id": cat_b.id})

    resp = client.get(f"/api/tasks?category_id={cat_a.id}")
    assert resp.status_code == 200
    titles = [t["title"] for t in resp.json()]
    assert "A task" in titles
    assert "B task" not in titles


def test_list_tasks_pagination(client: TestClient, category: Category) -> None:
    for i in range(5):
        client.post("/api/tasks", json={"title": f"Task {i}", "category_id": category.id})

    r1 = client.get("/api/tasks?limit=2&offset=0")
    r2 = client.get("/api/tasks?limit=2&offset=2")
    assert len(r1.json()) == 2
    assert len(r2.json()) == 2
    assert {t["id"] for t in r1.json()}.isdisjoint({t["id"] for t in r2.json()})


def test_list_tasks_includes_subtasks(client: TestClient, task: dict) -> None:
    client.post(f"/api/tasks/{task['id']}/subtasks", json={"title": "Sub X"})
    resp = client.get("/api/tasks")
    found = next(t for t in resp.json() if t["id"] == task["id"])
    assert len(found["subtasks"]) == 1


# ── completed_at transitions ──────────────────────────────────────────────────

def test_completed_at_set_when_status_done(client: TestClient, task: dict) -> None:
    resp = client.patch(f"/api/tasks/{task['id']}", json={"status": "done"})
    assert resp.status_code == 200
    assert resp.json()["completed_at"] is not None


def test_completed_at_cleared_when_back_to_todo(client: TestClient, task: dict) -> None:
    client.patch(f"/api/tasks/{task['id']}", json={"status": "done"})
    resp = client.patch(f"/api/tasks/{task['id']}", json={"status": "todo"})
    assert resp.status_code == 200
    assert resp.json()["completed_at"] is None


def test_completed_at_none_for_in_progress(client: TestClient, task: dict) -> None:
    resp = client.patch(f"/api/tasks/{task['id']}", json={"status": "in_progress"})
    assert resp.status_code == 200
    assert resp.json()["completed_at"] is None


def test_task_includes_category_in_response(client: TestClient, task: dict, category: Category) -> None:
    resp = client.get(f"/api/tasks/{task['id']}")
    assert resp.status_code == 200
    assert resp.json()["category"]["id"] == category.id


# ── Tasks with assignee ───────────────────────────────────────────────────────

def test_create_task_with_assignee(client: TestClient, category: Category, db: Session) -> None:
    from app.models import Person
    person = Person(name="Alice", email="alice@example.com")
    db.add(person)
    db.commit()

    resp = client.post("/api/tasks", json={
        "title": "Assigned task",
        "category_id": category.id,
        "assignee_id": person.id,
    })
    assert resp.status_code == 201
    assert resp.json()["assignee"]["id"] == person.id
    assert resp.json()["assignee"]["name"] == "Alice"


def test_filter_tasks_by_assignee_id(client: TestClient, category: Category, db: Session) -> None:
    from app.models import Person
    alice = Person(name="Alice", email="alice@example.com")
    bob = Person(name="Bob", email="bob@example.com")
    db.add_all([alice, bob])
    db.commit()

    client.post("/api/tasks", json={"title": "Alice task", "category_id": category.id, "assignee_id": alice.id})
    client.post("/api/tasks", json={"title": "Bob task", "category_id": category.id, "assignee_id": bob.id})

    resp = client.get(f"/api/tasks?assignee_id={alice.id}")
    assert resp.status_code == 200
    titles = [t["title"] for t in resp.json()]
    assert "Alice task" in titles
    assert "Bob task" not in titles


def test_update_task_assignee(client: TestClient, task: dict, db: Session) -> None:
    from app.models import Person
    person = Person(name="Charlie", email="charlie@example.com")
    db.add(person)
    db.commit()

    resp = client.patch(f"/api/tasks/{task['id']}", json={"assignee_id": person.id})
    assert resp.status_code == 200
    assert resp.json()["assignee"]["name"] == "Charlie"


def test_task_with_estimated_minutes(client: TestClient, category: Category) -> None:
    resp = client.post("/api/tasks", json={
        "title": "Timed task",
        "category_id": category.id,
        "estimated_minutes": 90,
    })
    assert resp.status_code == 201
    assert resp.json()["estimated_minutes"] == 90


def test_update_task_estimated_minutes(client: TestClient, task: dict) -> None:
    resp = client.patch(f"/api/tasks/{task['id']}", json={"estimated_minutes": 45})
    assert resp.status_code == 200
    assert resp.json()["estimated_minutes"] == 45


def test_task_priority_stored(client: TestClient, category: Category) -> None:
    resp = client.post("/api/tasks", json={
        "title": "High priority",
        "category_id": category.id,
        "priority": "high",
    })
    assert resp.status_code == 201
    assert resp.json()["priority"] == "high"


def test_update_task_priority(client: TestClient, task: dict) -> None:
    resp = client.patch(f"/api/tasks/{task['id']}", json={"priority": "low"})
    assert resp.status_code == 200
    assert resp.json()["priority"] == "low"


def test_filter_tasks_by_occurrence_id(client: TestClient, db: Session, category: Category) -> None:
    from app.models import Event, Occurrence, OccurrenceStatus, Priority
    from datetime import date

    event = Event(
        title="Linked Event",
        category_id=category.id,
        dtstart=date.today(),
        priority=Priority.medium,
        is_active=True,
    )
    db.add(event)
    db.flush()
    occ = Occurrence(
        event_id=event.id,
        occurrence_date=date.today(),
        status=OccurrenceStatus.upcoming,
    )
    db.add(occ)
    db.commit()

    client.post("/api/tasks", json={"title": "Linked task", "category_id": category.id, "occurrence_id": occ.id})
    client.post("/api/tasks", json={"title": "Unlinked task", "category_id": category.id})

    resp = client.get(f"/api/tasks?occurrence_id={occ.id}")
    assert resp.status_code == 200
    titles = [t["title"] for t in resp.json()]
    assert "Linked task" in titles
    assert "Unlinked task" not in titles
