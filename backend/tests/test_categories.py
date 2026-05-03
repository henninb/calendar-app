from __future__ import annotations

from fastapi.testclient import TestClient


# ── Helpers ───────────────────────────────────────────────────────────────────

def _create_category(
    client: TestClient,
    name: str = "Holidays",
    color: str = "#3b82f6",
    icon: str = "🎉",
) -> dict:
    resp = client.post("/api/categories", json={"name": name, "color": color, "icon": icon})
    assert resp.status_code == 201, resp.text
    return resp.json()


# ── Tests ─────────────────────────────────────────────────────────────────────

def test_create_category_returns_201(client: TestClient) -> None:
    cat = _create_category(client)
    assert cat["name"] == "Holidays"
    assert cat["color"] == "#3b82f6"
    assert cat["icon"] == "🎉"
    assert cat["id"] > 0


def test_create_category_duplicate_name_returns_409(client: TestClient) -> None:
    _create_category(client, name="Birthdays")
    resp = client.post("/api/categories", json={"name": "Birthdays", "color": "#000000", "icon": "🎂"})
    assert resp.status_code == 409


def test_list_categories_empty(client: TestClient) -> None:
    resp = client.get("/api/categories")
    assert resp.status_code == 200
    assert resp.json() == []


def test_list_categories_returns_all(client: TestClient) -> None:
    _create_category(client, name="Appointments")
    _create_category(client, name="Reminders")
    resp = client.get("/api/categories")
    assert resp.status_code == 200
    names = [c["name"] for c in resp.json()]
    assert "Appointments" in names
    assert "Reminders" in names


def test_list_categories_ordered_by_name(client: TestClient) -> None:
    _create_category(client, name="Zebra")
    _create_category(client, name="Apple")
    _create_category(client, name="Mango")
    resp = client.get("/api/categories")
    names = [c["name"] for c in resp.json()]
    assert names == sorted(names)


def test_get_category_returns_correct_fields(client: TestClient) -> None:
    cat = _create_category(client, name="Work", color="#ff0000", icon="💼")
    resp = client.get(f"/api/categories/{cat['id']}")
    assert resp.status_code == 200
    data = resp.json()
    assert data["name"] == "Work"
    assert data["color"] == "#ff0000"
    assert data["icon"] == "💼"


def test_get_category_returns_404_for_missing(client: TestClient) -> None:
    resp = client.get("/api/categories/99999")
    assert resp.status_code == 404


def test_update_category_name(client: TestClient) -> None:
    cat = _create_category(client, name="Old Name")
    resp = client.put(f"/api/categories/{cat['id']}", json={"name": "New Name"})
    assert resp.status_code == 200
    assert resp.json()["name"] == "New Name"


def test_update_category_color(client: TestClient) -> None:
    cat = _create_category(client)
    resp = client.put(f"/api/categories/{cat['id']}", json={"color": "#aabbcc"})
    assert resp.status_code == 200
    assert resp.json()["color"] == "#aabbcc"


def test_update_category_description(client: TestClient) -> None:
    cat = _create_category(client)
    resp = client.put(f"/api/categories/{cat['id']}", json={"description": "A note"})
    assert resp.status_code == 200
    assert resp.json()["description"] == "A note"


def test_update_category_missing_returns_404(client: TestClient) -> None:
    resp = client.put("/api/categories/99999", json={"name": "Ghost"})
    assert resp.status_code == 404


def test_delete_category(client: TestClient) -> None:
    cat = _create_category(client)
    resp = client.delete(f"/api/categories/{cat['id']}")
    assert resp.status_code == 204
    assert client.get(f"/api/categories/{cat['id']}").status_code == 404


def test_delete_category_missing_returns_404(client: TestClient) -> None:
    resp = client.delete("/api/categories/99999")
    assert resp.status_code == 404
