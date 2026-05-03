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
    title: str = "Annual Review",
    dtstart: str = "2026-06-01",
    rrule: str | None = None,
    is_active: bool = True,
) -> dict:
    body: dict = {
        "title": title,
        "category_id": category_id,
        "dtstart": dtstart,
        "is_active": is_active,
    }
    if rrule is not None:
        body["rrule"] = rrule
    resp = client.post("/api/events", json=body)
    assert resp.status_code == 201, resp.text
    return resp.json()


# ── Tests ─────────────────────────────────────────────────────────────────────

def test_create_event_returns_201(client: TestClient) -> None:
    cat = _create_category(client)
    event = _create_event(client, cat["id"])
    assert event["title"] == "Annual Review"
    assert event["category"]["id"] == cat["id"]
    assert event["is_active"] is True
    assert event["id"] > 0


def test_create_event_invalid_category_returns_404(client: TestClient) -> None:
    resp = client.post("/api/events", json={
        "title": "Ghost Event",
        "category_id": 99999,
        "dtstart": "2026-06-01",
    })
    assert resp.status_code == 404


def test_get_event_returns_event(client: TestClient) -> None:
    cat = _create_category(client)
    event = _create_event(client, cat["id"], title="Dentist")
    resp = client.get(f"/api/events/{event['id']}")
    assert resp.status_code == 200
    assert resp.json()["title"] == "Dentist"


def test_get_event_returns_404_for_missing(client: TestClient) -> None:
    resp = client.get("/api/events/99999")
    assert resp.status_code == 404


def test_list_events_empty(client: TestClient) -> None:
    resp = client.get("/api/events")
    assert resp.status_code == 200
    assert resp.json() == []


def test_list_events_returns_all(client: TestClient) -> None:
    cat = _create_category(client)
    _create_event(client, cat["id"], title="Event A")
    _create_event(client, cat["id"], title="Event B")
    resp = client.get("/api/events")
    assert resp.status_code == 200
    titles = [e["title"] for e in resp.json()]
    assert "Event A" in titles
    assert "Event B" in titles


def test_list_events_ordered_by_title(client: TestClient) -> None:
    cat = _create_category(client)
    _create_event(client, cat["id"], title="Zebra")
    _create_event(client, cat["id"], title="Apple")
    resp = client.get("/api/events")
    titles = [e["title"] for e in resp.json()]
    assert titles == sorted(titles)


def test_list_events_filter_by_category(client: TestClient) -> None:
    cat1 = _create_category(client, name="Work")
    cat2 = _create_category(client, name="Personal")
    _create_event(client, cat1["id"], title="Work Meeting")
    _create_event(client, cat2["id"], title="Gym")
    resp = client.get(f"/api/events?category_id={cat1['id']}")
    assert resp.status_code == 200
    titles = [e["title"] for e in resp.json()]
    assert "Work Meeting" in titles
    assert "Gym" not in titles


def test_list_events_filter_by_is_active(client: TestClient) -> None:
    cat = _create_category(client)
    _create_event(client, cat["id"], title="Active Event", is_active=True)
    _create_event(client, cat["id"], title="Inactive Event", is_active=False)
    resp = client.get("/api/events?is_active=true")
    assert resp.status_code == 200
    titles = [e["title"] for e in resp.json()]
    assert "Active Event" in titles
    assert "Inactive Event" not in titles


def test_list_events_filter_by_inactive(client: TestClient) -> None:
    cat = _create_category(client)
    _create_event(client, cat["id"], title="Running Event", is_active=True)
    _create_event(client, cat["id"], title="Stopped Event", is_active=False)
    resp = client.get("/api/events?is_active=false")
    titles = [e["title"] for e in resp.json()]
    assert "Stopped Event" in titles
    assert "Running Event" not in titles


def test_list_events_search(client: TestClient) -> None:
    cat = _create_category(client)
    _create_event(client, cat["id"], title="Doctor Appointment")
    _create_event(client, cat["id"], title="Dentist Appointment")
    _create_event(client, cat["id"], title="Gym Session")
    resp = client.get("/api/events?search=Appointment")
    assert resp.status_code == 200
    titles = [e["title"] for e in resp.json()]
    assert "Doctor Appointment" in titles
    assert "Dentist Appointment" in titles
    assert "Gym Session" not in titles


def test_update_event_title(client: TestClient) -> None:
    cat = _create_category(client)
    event = _create_event(client, cat["id"], title="Old Title")
    resp = client.patch(f"/api/events/{event['id']}", json={"title": "New Title"})
    assert resp.status_code == 200
    assert resp.json()["title"] == "New Title"


def test_update_event_category(client: TestClient) -> None:
    cat1 = _create_category(client, name="CatA")
    cat2 = _create_category(client, name="CatB")
    event = _create_event(client, cat1["id"])
    resp = client.patch(f"/api/events/{event['id']}", json={"category_id": cat2["id"]})
    assert resp.status_code == 200
    assert resp.json()["category"]["id"] == cat2["id"]


def test_update_event_invalid_category_returns_404(client: TestClient) -> None:
    cat = _create_category(client)
    event = _create_event(client, cat["id"])
    resp = client.patch(f"/api/events/{event['id']}", json={"category_id": 99999})
    assert resp.status_code == 404


def test_update_event_missing_returns_404(client: TestClient) -> None:
    resp = client.patch("/api/events/99999", json={"title": "Ghost"})
    assert resp.status_code == 404


def test_update_event_deactivate(client: TestClient) -> None:
    cat = _create_category(client)
    event = _create_event(client, cat["id"])
    resp = client.patch(f"/api/events/{event['id']}", json={"is_active": False})
    assert resp.status_code == 200
    assert resp.json()["is_active"] is False


def test_delete_event(client: TestClient) -> None:
    cat = _create_category(client)
    event = _create_event(client, cat["id"])
    resp = client.delete(f"/api/events/{event['id']}")
    assert resp.status_code == 204
    assert client.get(f"/api/events/{event['id']}").status_code == 404


def test_delete_event_missing_returns_404(client: TestClient) -> None:
    resp = client.delete("/api/events/99999")
    assert resp.status_code == 404


def test_get_event_includes_occurrences(client: TestClient) -> None:
    cat = _create_category(client)
    # A weekly recurrence with 3 occurrences
    event = _create_event(
        client, cat["id"],
        title="Weekly Standup",
        dtstart="2026-06-01",
        rrule="FREQ=WEEKLY;COUNT=3",
    )
    resp = client.get(f"/api/events/{event['id']}")
    assert resp.status_code == 200
    data = resp.json()
    assert "occurrences" in data
    assert len(data["occurrences"]) == 3


def test_generate_event_occurrences_endpoint(client: TestClient) -> None:
    cat = _create_category(client)
    # Recurring event — initial generation happens on create, so generation
    # should return 0 new occurrences if they already exist.
    event = _create_event(
        client, cat["id"],
        title="Monthly Bill",
        dtstart="2026-06-01",
        rrule="FREQ=MONTHLY;COUNT=2",
    )
    resp = client.post(f"/api/events/{event['id']}/generate")
    assert resp.status_code == 200
    data = resp.json()
    assert data["events_processed"] == 1
    assert "occurrences_created" in data


def test_generate_event_occurrences_missing_returns_404(client: TestClient) -> None:
    resp = client.post("/api/events/99999/generate")
    assert resp.status_code == 404


def test_rrule_prefix_stripped(client: TestClient) -> None:
    """RRULE: prefix should be accepted and stripped before storage."""
    cat = _create_category(client)
    resp = client.post("/api/events", json={
        "title": "Prefixed Rule Event",
        "category_id": cat["id"],
        "dtstart": "2026-06-01",
        "rrule": "RRULE:FREQ=YEARLY;COUNT=1",
    })
    assert resp.status_code == 201
    assert "RRULE:" not in (resp.json()["rrule"] or "")


# ── dtend_rule: bounded occurrences ──────────────────────────────────────────

def test_event_dtend_rule_bounds_occurrences(client: TestClient) -> None:
    cat = _create_category(client, name="Bounded")
    # Monthly from Jan 1 through Mar 31 → exactly 3 occurrences
    resp = client.post("/api/events", json={
        "title": "Monthly Bounded",
        "category_id": cat["id"],
        "dtstart": "2026-01-01",
        "rrule": "FREQ=MONTHLY",
        "dtend_rule": "2026-03-31",
    })
    assert resp.status_code == 201
    event = resp.json()
    assert event["dtend_rule"] == "2026-03-31"

    # Generate and verify count via generate endpoint
    gen = client.post(f"/api/events/{event['id']}/generate?lookahead_days=365")
    assert gen.status_code == 200
    # Should have created occurrences only for Jan, Feb, Mar
    occs = client.get(f"/api/occurrences?event_id={event['id']}").json()
    dates = [o["occurrence_date"] for o in occs]
    assert "2026-01-01" in dates
    assert "2026-02-01" in dates
    assert "2026-03-01" in dates
    assert all(d <= "2026-03-31" for d in dates)


def test_event_dtend_rule_stored_and_returned(client: TestClient) -> None:
    cat = _create_category(client, name="Dtend")
    resp = client.post("/api/events", json={
        "title": "With End Rule",
        "category_id": cat["id"],
        "dtstart": "2026-06-01",
        "rrule": "FREQ=WEEKLY",
        "dtend_rule": "2026-08-31",
    })
    assert resp.status_code == 201
    assert resp.json()["dtend_rule"] == "2026-08-31"


def test_update_event_dtend_rule(client: TestClient) -> None:
    cat = _create_category(client, name="DtendUpd")
    event = _create_event(client, cat["id"], rrule="FREQ=WEEKLY")
    resp = client.patch(f"/api/events/{event['id']}", json={"dtend_rule": "2026-12-31"})
    assert resp.status_code == 200
    assert resp.json()["dtend_rule"] == "2026-12-31"


# ── generates_tasks / reminder_days ──────────────────────────────────────────

def test_event_generates_tasks_flag(client: TestClient) -> None:
    cat = _create_category(client, name="TaskGen")
    resp = client.post("/api/events", json={
        "title": "Task Generator",
        "category_id": cat["id"],
        "dtstart": "2026-06-01",
        "generates_tasks": True,
        "reminder_days": [14, 7, 1],
    })
    assert resp.status_code == 201
    data = resp.json()
    assert data["generates_tasks"] is True
    assert data["reminder_days"] == [14, 7, 1]


def test_event_generates_tasks_default_false(client: TestClient) -> None:
    cat = _create_category(client, name="NoTaskGen")
    event = _create_event(client, cat["id"])
    assert event["generates_tasks"] is False


def test_update_event_generates_tasks(client: TestClient) -> None:
    cat = _create_category(client, name="UpdTaskGen")
    event = _create_event(client, cat["id"])
    resp = client.patch(f"/api/events/{event['id']}", json={"generates_tasks": True})
    assert resp.status_code == 200
    assert resp.json()["generates_tasks"] is True


# ── priority / location / amount ──────────────────────────────────────────────

def test_event_priority_stored(client: TestClient) -> None:
    cat = _create_category(client, name="PriorityEvt")
    resp = client.post("/api/events", json={
        "title": "High Priority",
        "category_id": cat["id"],
        "dtstart": "2026-06-01",
        "priority": "high",
    })
    assert resp.status_code == 201
    assert resp.json()["priority"] == "high"


def test_event_location_stored(client: TestClient) -> None:
    cat = _create_category(client, name="LocationEvt")
    resp = client.post("/api/events", json={
        "title": "Offsite Meeting",
        "category_id": cat["id"],
        "dtstart": "2026-06-01",
        "location": "Room 101",
    })
    assert resp.status_code == 201
    assert resp.json()["location"] == "Room 101"


def test_event_description_stored(client: TestClient) -> None:
    cat = _create_category(client, name="DescEvt")
    event = _create_event(client, cat["id"])
    resp = client.patch(f"/api/events/{event['id']}", json={"description": "Full notes here"})
    assert resp.status_code == 200
    assert resp.json()["description"] == "Full notes here"
