from __future__ import annotations

from fastapi.testclient import TestClient


# ── Helpers ───────────────────────────────────────────────────────────────────

def _create_person(
    client: TestClient,
    name: str = "Alice",
    email: str | None = "alice@example.com",
) -> dict:
    body: dict = {"name": name}
    if email is not None:
        body["email"] = email
    resp = client.post("/api/persons", json=body)
    assert resp.status_code == 201, resp.text
    return resp.json()


# ── Tests ─────────────────────────────────────────────────────────────────────

def test_create_person_returns_201(client: TestClient) -> None:
    person = _create_person(client)
    assert person["name"] == "Alice"
    assert person["email"] == "alice@example.com"
    assert person["id"] > 0


def test_create_person_without_email(client: TestClient) -> None:
    person = _create_person(client, name="Bob", email=None)
    assert person["name"] == "Bob"
    assert person["email"] is None


def test_list_persons_empty(client: TestClient) -> None:
    resp = client.get("/api/persons")
    assert resp.status_code == 200
    assert resp.json() == []


def test_list_persons_returns_all(client: TestClient) -> None:
    _create_person(client, name="Alice")
    _create_person(client, name="Bob", email="bob@example.com")
    resp = client.get("/api/persons")
    assert resp.status_code == 200
    names = [p["name"] for p in resp.json()]
    assert "Alice" in names
    assert "Bob" in names


def test_list_persons_ordered_by_name(client: TestClient) -> None:
    _create_person(client, name="Zara", email="z@example.com")
    _create_person(client, name="Adam", email="a@example.com")
    resp = client.get("/api/persons")
    names = [p["name"] for p in resp.json()]
    assert names == sorted(names)


def test_get_person_by_id(client: TestClient) -> None:
    person = _create_person(client, name="Carol", email="carol@example.com")
    resp = client.get(f"/api/persons/{person['id']}")
    assert resp.status_code == 200
    assert resp.json()["name"] == "Carol"


def test_get_person_returns_404_for_missing(client: TestClient) -> None:
    resp = client.get("/api/persons/99999")
    assert resp.status_code == 404


def test_update_person_name(client: TestClient) -> None:
    person = _create_person(client, name="Dave")
    resp = client.put(f"/api/persons/{person['id']}", json={"name": "David"})
    assert resp.status_code == 200
    assert resp.json()["name"] == "David"


def test_update_person_email(client: TestClient) -> None:
    person = _create_person(client, name="Eve")
    resp = client.put(f"/api/persons/{person['id']}", json={"email": "eve2@example.com"})
    assert resp.status_code == 200
    assert resp.json()["email"] == "eve2@example.com"


def test_update_person_missing_returns_404(client: TestClient) -> None:
    resp = client.put("/api/persons/99999", json={"name": "Ghost"})
    assert resp.status_code == 404


def test_delete_person(client: TestClient) -> None:
    person = _create_person(client)
    resp = client.delete(f"/api/persons/{person['id']}")
    assert resp.status_code == 204
    assert client.get(f"/api/persons/{person['id']}").status_code == 404


def test_delete_person_missing_returns_404(client: TestClient) -> None:
    resp = client.delete("/api/persons/99999")
    assert resp.status_code == 404
