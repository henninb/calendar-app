from __future__ import annotations

from fastapi.testclient import TestClient


# ── Helpers ───────────────────────────────────────────────────────────────────

def _create_category(client: TestClient, name: str = "Work") -> dict:
    resp = client.post("/api/categories", json={"name": name, "color": "#3b82f6", "icon": "📋"})
    assert resp.status_code == 201, resp.text
    return resp.json()


def _create_person(client: TestClient, name: str = "Alice") -> dict:
    resp = client.post("/api/persons", json={"name": name, "email": f"{name.lower()}@example.com"})
    assert resp.status_code == 201, resp.text
    return resp.json()


def _create_task(
    client: TestClient,
    title: str = "Write tests",
    due_date: str | None = "2026-06-01",
    status: str = "todo",
    priority: str = "medium",
    category_id: int | None = None,
    assignee_id: int | None = None,
    recurrence: str = "none",
) -> dict:
    body: dict = {
        "title": title,
        "status": status,
        "priority": priority,
        "recurrence": recurrence,
    }
    if due_date is not None:
        body["due_date"] = due_date
    if category_id is not None:
        body["category_id"] = category_id
    if assignee_id is not None:
        body["assignee_id"] = assignee_id
    resp = client.post("/api/tasks", json=body)
    assert resp.status_code == 201, resp.text
    return resp.json()


# ── Task CRUD ─────────────────────────────────────────────────────────────────

def test_create_task_returns_201(client: TestClient) -> None:
    task = _create_task(client)
    assert task["title"] == "Write tests"
    assert task["status"] == "todo"
    assert task["priority"] == "medium"
    assert task["id"] > 0
    assert task["subtasks"] == []


def test_create_task_with_category(client: TestClient) -> None:
    cat = _create_category(client)
    task = _create_task(client, category_id=cat["id"])
    assert task["category"]["id"] == cat["id"]


def test_create_task_with_assignee(client: TestClient) -> None:
    person = _create_person(client)
    task = _create_task(client, assignee_id=person["id"])
    assert task["assignee"]["id"] == person["id"]


def test_create_task_invalid_category_returns_404(client: TestClient) -> None:
    resp = client.post("/api/tasks", json={
        "title": "Ghost Task",
        "category_id": 99999,
    })
    assert resp.status_code == 404


def test_list_tasks_empty(client: TestClient) -> None:
    resp = client.get("/api/tasks")
    assert resp.status_code == 200
    assert resp.json() == []


def test_list_tasks_returns_created_task(client: TestClient) -> None:
    _create_task(client, title="My Task")
    resp = client.get("/api/tasks")
    assert resp.status_code == 200
    titles = [t["title"] for t in resp.json()]
    assert "My Task" in titles


def test_list_tasks_filter_by_status(client: TestClient) -> None:
    _create_task(client, title="Todo Task", status="todo")
    t = _create_task(client, title="In Progress Task", status="todo")
    client.patch(f"/api/tasks/{t['id']}", json={"status": "in_progress"})
    resp = client.get("/api/tasks?status=in_progress")
    assert resp.status_code == 200
    titles = [t["title"] for t in resp.json()]
    assert "In Progress Task" in titles
    assert "Todo Task" not in titles


def test_list_tasks_filter_by_category(client: TestClient) -> None:
    cat1 = _create_category(client, name="Work")
    cat2 = _create_category(client, name="Personal")
    _create_task(client, title="Work Task", category_id=cat1["id"])
    _create_task(client, title="Personal Task", category_id=cat2["id"])
    resp = client.get(f"/api/tasks?category_id={cat1['id']}")
    titles = [t["title"] for t in resp.json()]
    assert "Work Task" in titles
    assert "Personal Task" not in titles


def test_list_tasks_filter_by_assignee(client: TestClient) -> None:
    alice = _create_person(client, name="Alice")
    bob = _create_person(client, name="Bob")
    _create_task(client, title="Alice Task", assignee_id=alice["id"])
    _create_task(client, title="Bob Task", assignee_id=bob["id"])
    resp = client.get(f"/api/tasks?assignee_id={alice['id']}")
    titles = [t["title"] for t in resp.json()]
    assert "Alice Task" in titles
    assert "Bob Task" not in titles


def test_list_tasks_pagination(client: TestClient) -> None:
    for i in range(5):
        _create_task(client, title=f"Task {i}", due_date=f"2026-0{i+1}-01")
    resp = client.get("/api/tasks?limit=2&offset=0")
    assert resp.status_code == 200
    assert len(resp.json()) == 2


def test_get_task_by_id(client: TestClient) -> None:
    task = _create_task(client, title="Specific Task")
    resp = client.get(f"/api/tasks/{task['id']}")
    assert resp.status_code == 200
    assert resp.json()["title"] == "Specific Task"


def test_get_task_returns_404_for_missing(client: TestClient) -> None:
    resp = client.get("/api/tasks/99999")
    assert resp.status_code == 404


def test_update_task_title(client: TestClient) -> None:
    task = _create_task(client, title="Old Title")
    resp = client.patch(f"/api/tasks/{task['id']}", json={"title": "New Title"})
    assert resp.status_code == 200
    assert resp.json()["title"] == "New Title"


def test_update_task_priority(client: TestClient) -> None:
    task = _create_task(client)
    resp = client.patch(f"/api/tasks/{task['id']}", json={"priority": "high"})
    assert resp.status_code == 200
    assert resp.json()["priority"] == "high"


def test_update_task_due_date(client: TestClient) -> None:
    task = _create_task(client)
    resp = client.patch(f"/api/tasks/{task['id']}", json={"due_date": "2027-01-15"})
    assert resp.status_code == 200
    assert resp.json()["due_date"] == "2027-01-15"


def test_update_task_missing_returns_404(client: TestClient) -> None:
    resp = client.patch("/api/tasks/99999", json={"title": "Ghost"})
    assert resp.status_code == 404


def test_complete_task_sets_completed_at(client: TestClient) -> None:
    task = _create_task(client)
    resp = client.patch(f"/api/tasks/{task['id']}", json={"status": "done"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "done"
    assert data["completed_at"] is not None


def test_reopen_task_clears_completed_at(client: TestClient) -> None:
    task = _create_task(client)
    client.patch(f"/api/tasks/{task['id']}", json={"status": "done"})
    resp = client.patch(f"/api/tasks/{task['id']}", json={"status": "todo"})
    assert resp.status_code == 200
    assert resp.json()["completed_at"] is None


def test_cancel_task_sets_completed_at(client: TestClient) -> None:
    task = _create_task(client)
    resp = client.patch(f"/api/tasks/{task['id']}", json={"status": "cancelled"})
    assert resp.status_code == 200
    assert resp.json()["status"] == "cancelled"


def test_delete_task(client: TestClient) -> None:
    task = _create_task(client)
    resp = client.delete(f"/api/tasks/{task['id']}")
    assert resp.status_code == 204
    assert client.get(f"/api/tasks/{task['id']}").status_code == 404


def test_delete_task_missing_returns_404(client: TestClient) -> None:
    resp = client.delete("/api/tasks/99999")
    assert resp.status_code == 404


# ── Recurrence spawning ───────────────────────────────────────────────────────

def test_complete_weekly_task_spawns_next(client: TestClient) -> None:
    task = _create_task(client, title="Weekly Chore", due_date="2026-06-01", recurrence="weekly")
    client.patch(f"/api/tasks/{task['id']}", json={"status": "done"})
    resp = client.get("/api/tasks")
    all_tasks = resp.json()
    next_tasks = [t for t in all_tasks if t["title"] == "Weekly Chore" and t["status"] == "todo"]
    assert len(next_tasks) == 1
    assert next_tasks[0]["due_date"] == "2026-06-08"


def test_complete_monthly_task_spawns_next(client: TestClient) -> None:
    task = _create_task(client, title="Monthly Review", due_date="2026-06-15", recurrence="monthly")
    client.patch(f"/api/tasks/{task['id']}", json={"status": "done"})
    resp = client.get("/api/tasks")
    next_tasks = [t for t in resp.json() if t["title"] == "Monthly Review" and t["status"] == "todo"]
    assert len(next_tasks) == 1
    assert next_tasks[0]["due_date"] == "2026-07-15"


def test_cancel_recurring_task_also_spawns_next(client: TestClient) -> None:
    task = _create_task(client, title="Daily Standup", due_date="2026-06-01", recurrence="daily")
    client.patch(f"/api/tasks/{task['id']}", json={"status": "cancelled"})
    resp = client.get("/api/tasks")
    next_tasks = [t for t in resp.json() if t["title"] == "Daily Standup" and t["status"] == "todo"]
    assert len(next_tasks) == 1
    assert next_tasks[0]["due_date"] == "2026-06-02"


def test_complete_recurring_task_does_not_double_spawn(client: TestClient) -> None:
    task = _create_task(client, title="Weekly", due_date="2026-06-01", recurrence="weekly")
    client.patch(f"/api/tasks/{task['id']}", json={"status": "done"})
    # Completing again should not spawn a second child
    client.patch(f"/api/tasks/{task['id']}", json={"status": "done"})
    resp = client.get("/api/tasks")
    next_tasks = [t for t in resp.json() if t["title"] == "Weekly" and t["status"] == "todo"]
    assert len(next_tasks) == 1


def test_one_time_task_does_not_spawn_next(client: TestClient) -> None:
    task = _create_task(client, title="One-time", due_date="2026-06-01", recurrence="none")
    client.patch(f"/api/tasks/{task['id']}", json={"status": "done"})
    resp = client.get("/api/tasks")
    spawned = [t for t in resp.json() if t["title"] == "One-time" and t["status"] == "todo"]
    assert spawned == []


# ── Subtasks ──────────────────────────────────────────────────────────────────

def test_create_subtask_returns_201(client: TestClient) -> None:
    task = _create_task(client)
    resp = client.post(f"/api/tasks/{task['id']}/subtasks", json={"title": "Step 1"})
    assert resp.status_code == 201
    data = resp.json()
    assert data["title"] == "Step 1"
    assert data["task_id"] == task["id"]
    assert data["status"] == "todo"


def test_create_subtask_missing_task_returns_404(client: TestClient) -> None:
    resp = client.post("/api/tasks/99999/subtasks", json={"title": "Orphan"})
    assert resp.status_code == 404


def test_get_task_includes_subtasks(client: TestClient) -> None:
    task = _create_task(client)
    client.post(f"/api/tasks/{task['id']}/subtasks", json={"title": "Sub A"})
    client.post(f"/api/tasks/{task['id']}/subtasks", json={"title": "Sub B"})
    resp = client.get(f"/api/tasks/{task['id']}")
    subtasks = resp.json()["subtasks"]
    assert len(subtasks) == 2
    titles = {s["title"] for s in subtasks}
    assert titles == {"Sub A", "Sub B"}


def test_update_subtask_status(client: TestClient) -> None:
    task = _create_task(client)
    sub_resp = client.post(f"/api/tasks/{task['id']}/subtasks", json={"title": "Sub"})
    sub = sub_resp.json()
    resp = client.patch(f"/api/tasks/{task['id']}/subtasks/{sub['id']}", json={"status": "done"})
    assert resp.status_code == 200
    assert resp.json()["status"] == "done"


def test_complete_subtask_sets_completed_at(client: TestClient) -> None:
    task = _create_task(client)
    sub = client.post(f"/api/tasks/{task['id']}/subtasks", json={"title": "Do thing"}).json()
    resp = client.patch(f"/api/tasks/{task['id']}/subtasks/{sub['id']}", json={"status": "done"})
    assert resp.json()["completed_at"] is not None


def test_reopen_subtask_clears_completed_at(client: TestClient) -> None:
    task = _create_task(client)
    sub = client.post(f"/api/tasks/{task['id']}/subtasks", json={"title": "Sub"}).json()
    client.patch(f"/api/tasks/{task['id']}/subtasks/{sub['id']}", json={"status": "done"})
    resp = client.patch(f"/api/tasks/{task['id']}/subtasks/{sub['id']}", json={"status": "todo"})
    assert resp.json()["completed_at"] is None


def test_update_subtask_title(client: TestClient) -> None:
    task = _create_task(client)
    sub = client.post(f"/api/tasks/{task['id']}/subtasks", json={"title": "Old"}).json()
    resp = client.patch(f"/api/tasks/{task['id']}/subtasks/{sub['id']}", json={"title": "New"})
    assert resp.status_code == 200
    assert resp.json()["title"] == "New"


def test_update_subtask_missing_returns_404(client: TestClient) -> None:
    task = _create_task(client)
    resp = client.patch(f"/api/tasks/{task['id']}/subtasks/99999", json={"title": "Ghost"})
    assert resp.status_code == 404


def test_delete_subtask(client: TestClient) -> None:
    task = _create_task(client)
    sub = client.post(f"/api/tasks/{task['id']}/subtasks", json={"title": "Temp"}).json()
    resp = client.delete(f"/api/tasks/{task['id']}/subtasks/{sub['id']}")
    assert resp.status_code == 204
    remaining = client.get(f"/api/tasks/{task['id']}").json()["subtasks"]
    assert remaining == []


def test_delete_subtask_missing_returns_404(client: TestClient) -> None:
    task = _create_task(client)
    resp = client.delete(f"/api/tasks/{task['id']}/subtasks/99999")
    assert resp.status_code == 404


def test_recurring_task_spawns_subtasks_to_next(client: TestClient) -> None:
    task = _create_task(client, title="Quarterly Report", due_date="2026-06-01", recurrence="weekly")
    client.post(f"/api/tasks/{task['id']}/subtasks", json={"title": "Draft"})
    client.post(f"/api/tasks/{task['id']}/subtasks", json={"title": "Review"})
    client.patch(f"/api/tasks/{task['id']}", json={"status": "done"})
    all_tasks = client.get("/api/tasks").json()
    next_task = next(
        (t for t in all_tasks if t["title"] == "Quarterly Report" and t["status"] == "todo"),
        None,
    )
    assert next_task is not None
    assert len(next_task["subtasks"]) == 2
    subtask_titles = {s["title"] for s in next_task["subtasks"]}
    assert subtask_titles == {"Draft", "Review"}
    assert all(s["status"] == "todo" for s in next_task["subtasks"])
