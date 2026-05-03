from __future__ import annotations

from fastapi.testclient import TestClient


# ── Helpers ───────────────────────────────────────────────────────────────────

def _create_category(client: TestClient, name: str = "General") -> dict:
    resp = client.post("/api/categories", json={"name": name, "color": "#3b82f6", "icon": "📅"})
    assert resp.status_code == 201, resp.text
    return resp.json()


def _create_event(
    client: TestClient,
    category_id: int,
    title: str = "Weekly Meeting",
    dtstart: str = "2026-06-01",
    rrule: str | None = "FREQ=WEEKLY;COUNT=3",
) -> dict:
    body: dict = {
        "title": title,
        "category_id": category_id,
        "dtstart": dtstart,
    }
    if rrule is not None:
        body["rrule"] = rrule
    resp = client.post("/api/events", json=body)
    assert resp.status_code == 201, resp.text
    return resp.json()


def _first_occurrence_id(client: TestClient, event_id: int) -> int:
    resp = client.get(f"/api/events/{event_id}")
    assert resp.status_code == 200
    occs = resp.json()["occurrences"]
    assert occs, "Event has no occurrences"
    return occs[0]["id"]


# ── Tests ─────────────────────────────────────────────────────────────────────

def test_list_occurrences_empty(client: TestClient) -> None:
    resp = client.get("/api/occurrences")
    assert resp.status_code == 200
    assert resp.json() == []


def test_event_creation_generates_occurrences(client: TestClient) -> None:
    cat = _create_category(client)
    _create_event(client, cat["id"], rrule="FREQ=WEEKLY;COUNT=3")
    resp = client.get("/api/occurrences")
    assert resp.status_code == 200
    assert len(resp.json()) == 3


def test_list_occurrences_includes_event(client: TestClient) -> None:
    cat = _create_category(client)
    event = _create_event(client, cat["id"], title="Standup", rrule="FREQ=DAILY;COUNT=1")
    resp = client.get("/api/occurrences")
    assert resp.status_code == 200
    occs = resp.json()
    assert len(occs) >= 1
    assert occs[0]["event"]["id"] == event["id"]
    assert occs[0]["event"]["title"] == "Standup"


def test_list_occurrences_filter_by_event_id(client: TestClient) -> None:
    cat = _create_category(client)
    ev1 = _create_event(client, cat["id"], title="Event 1", rrule="FREQ=WEEKLY;COUNT=2")
    ev2 = _create_event(client, cat["id"], title="Event 2", rrule="FREQ=WEEKLY;COUNT=4")
    resp = client.get(f"/api/occurrences?event_id={ev1['id']}")
    assert resp.status_code == 200
    assert len(resp.json()) == 2
    assert all(o["event_id"] == ev1["id"] for o in resp.json())


def test_list_occurrences_filter_by_category(client: TestClient) -> None:
    cat1 = _create_category(client, name="Work")
    cat2 = _create_category(client, name="Personal")
    _create_event(client, cat1["id"], title="Work Event", rrule="FREQ=WEEKLY;COUNT=2")
    _create_event(client, cat2["id"], title="Personal Event", rrule="FREQ=WEEKLY;COUNT=3")
    resp = client.get(f"/api/occurrences?category_id={cat1['id']}")
    assert resp.status_code == 200
    assert len(resp.json()) == 2
    assert all(o["event"]["category"]["id"] == cat1["id"] for o in resp.json())


def test_list_occurrences_filter_by_date_range(client: TestClient) -> None:
    cat = _create_category(client)
    _create_event(client, cat["id"], dtstart="2026-06-01", rrule="FREQ=WEEKLY;COUNT=4")
    # Only the first two: June 1 and June 8
    resp = client.get("/api/occurrences?start_date=2026-06-01&end_date=2026-06-08")
    assert resp.status_code == 200
    assert len(resp.json()) == 2


def test_list_occurrences_filter_by_status(client: TestClient) -> None:
    cat = _create_category(client)
    event = _create_event(client, cat["id"], rrule="FREQ=WEEKLY;COUNT=2")
    occ_id = _first_occurrence_id(client, event["id"])
    client.patch(f"/api/occurrences/{occ_id}", json={"status": "completed"})
    resp = client.get("/api/occurrences?status=completed")
    assert resp.status_code == 200
    assert all(o["status"] == "completed" for o in resp.json())


def test_list_occurrences_pagination(client: TestClient) -> None:
    cat = _create_category(client)
    _create_event(client, cat["id"], rrule="FREQ=DAILY;COUNT=5")
    resp = client.get("/api/occurrences?limit=2&offset=0")
    assert resp.status_code == 200
    assert len(resp.json()) == 2


def test_get_occurrence_by_id(client: TestClient) -> None:
    cat = _create_category(client)
    event = _create_event(client, cat["id"], rrule="FREQ=WEEKLY;COUNT=1")
    occ_id = _first_occurrence_id(client, event["id"])
    resp = client.get(f"/api/occurrences/{occ_id}")
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == occ_id
    assert data["event_id"] == event["id"]


def test_get_occurrence_returns_404_for_missing(client: TestClient) -> None:
    resp = client.get("/api/occurrences/99999")
    assert resp.status_code == 404


def test_update_occurrence_status_to_completed(client: TestClient) -> None:
    cat = _create_category(client)
    event = _create_event(client, cat["id"], rrule="FREQ=WEEKLY;COUNT=1")
    occ_id = _first_occurrence_id(client, event["id"])
    resp = client.patch(f"/api/occurrences/{occ_id}", json={"status": "completed"})
    assert resp.status_code == 200
    assert resp.json()["status"] == "completed"


def test_update_occurrence_status_to_skipped(client: TestClient) -> None:
    cat = _create_category(client)
    event = _create_event(client, cat["id"], rrule="FREQ=WEEKLY;COUNT=1")
    occ_id = _first_occurrence_id(client, event["id"])
    resp = client.patch(f"/api/occurrences/{occ_id}", json={"status": "skipped"})
    assert resp.status_code == 200
    assert resp.json()["status"] == "skipped"


def test_update_occurrence_notes(client: TestClient) -> None:
    cat = _create_category(client)
    event = _create_event(client, cat["id"], rrule="FREQ=WEEKLY;COUNT=1")
    occ_id = _first_occurrence_id(client, event["id"])
    resp = client.patch(f"/api/occurrences/{occ_id}", json={"notes": "Rescheduled to Zoom"})
    assert resp.status_code == 200
    assert resp.json()["notes"] == "Rescheduled to Zoom"


def test_update_occurrence_missing_returns_404(client: TestClient) -> None:
    resp = client.patch("/api/occurrences/99999", json={"status": "completed"})
    assert resp.status_code == 404


def test_delete_occurrence(client: TestClient) -> None:
    cat = _create_category(client)
    event = _create_event(client, cat["id"], rrule="FREQ=WEEKLY;COUNT=1")
    occ_id = _first_occurrence_id(client, event["id"])
    resp = client.delete(f"/api/occurrences/{occ_id}")
    assert resp.status_code == 204
    assert client.get(f"/api/occurrences/{occ_id}").status_code == 404


def test_delete_occurrence_missing_returns_404(client: TestClient) -> None:
    resp = client.delete("/api/occurrences/99999")
    assert resp.status_code == 404


def test_delete_event_cascades_occurrences(client: TestClient) -> None:
    cat = _create_category(client)
    event = _create_event(client, cat["id"], rrule="FREQ=WEEKLY;COUNT=3")
    occ_id = _first_occurrence_id(client, event["id"])
    client.delete(f"/api/events/{event['id']}")
    assert client.get(f"/api/occurrences/{occ_id}").status_code == 404


def test_create_task_from_occurrence(client: TestClient) -> None:
    cat = _create_category(client)
    event = _create_event(client, cat["id"], title="Sprint Review", rrule="FREQ=WEEKLY;COUNT=1")
    occ_id = _first_occurrence_id(client, event["id"])
    resp = client.post(f"/api/occurrences/{occ_id}/task")
    assert resp.status_code == 201
    data = resp.json()
    assert data["title"] == "Sprint Review"
    assert data["occurrence_id"] == occ_id


def test_create_task_from_occurrence_is_idempotent(client: TestClient) -> None:
    cat = _create_category(client)
    event = _create_event(client, cat["id"], rrule="FREQ=WEEKLY;COUNT=1")
    occ_id = _first_occurrence_id(client, event["id"])
    resp1 = client.post(f"/api/occurrences/{occ_id}/task")
    resp2 = client.post(f"/api/occurrences/{occ_id}/task")
    assert resp1.status_code == 201
    assert resp2.status_code == 201
    assert resp1.json()["id"] == resp2.json()["id"]


def test_create_task_from_occurrence_missing_returns_404(client: TestClient) -> None:
    resp = client.post("/api/occurrences/99999/task")
    assert resp.status_code == 404


def test_skip_occurrence_cancels_linked_task(client: TestClient) -> None:
    cat = _create_category(client)
    event = _create_event(client, cat["id"], rrule="FREQ=WEEKLY;COUNT=1")
    occ_id = _first_occurrence_id(client, event["id"])
    task_resp = client.post(f"/api/occurrences/{occ_id}/task")
    task_id = task_resp.json()["id"]
    client.patch(f"/api/occurrences/{occ_id}", json={"status": "skipped"})
    task = client.get(f"/api/tasks/{task_id}").json()
    assert task["status"] == "cancelled"
