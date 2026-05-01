from __future__ import annotations

import pytest
from fastapi.testclient import TestClient


# ── Helpers ───────────────────────────────────────────────────────────────────

def _create_store(client: TestClient, name: str = "ALDI", location: str | None = "Coon Rapids, MN") -> dict:
    resp = client.post("/api/stores", json={"name": name, "location": location})
    assert resp.status_code == 201, resp.text
    return resp.json()


def _create_item(client: TestClient, name: str = "Bone Broth", unit: str = "each", store_id: int | None = None) -> dict:
    body: dict = {"name": name, "default_unit": unit}
    if store_id:
        body["default_store_id"] = store_id
    resp = client.post("/api/grocery/items", json=body)
    assert resp.status_code == 201, resp.text
    return resp.json()


def _create_list(client: TestClient, name: str = "Weekly Run", store_id: int | None = None) -> dict:
    body: dict = {"name": name}
    if store_id:
        body["store_id"] = store_id
    resp = client.post("/api/grocery/lists", json=body)
    assert resp.status_code == 201, resp.text
    return resp.json()


# ── Store tests ───────────────────────────────────────────────────────────────

def test_create_store_returns_201(client: TestClient) -> None:
    store = _create_store(client)
    assert store["name"] == "ALDI"
    assert store["location"] == "Coon Rapids, MN"
    assert store["is_active"] is True
    assert store["id"] > 0


def test_create_store_duplicate_name_returns_409(client: TestClient) -> None:
    _create_store(client, name="Target")
    resp = client.post("/api/stores", json={"name": "Target"})
    assert resp.status_code == 409


def test_list_stores_returns_all(client: TestClient) -> None:
    _create_store(client, name="ALDI")
    _create_store(client, name="Costco")
    resp = client.get("/api/stores")
    assert resp.status_code == 200
    names = [s["name"] for s in resp.json()]
    assert "ALDI" in names
    assert "Costco" in names


def test_get_store_returns_404_for_missing(client: TestClient) -> None:
    resp = client.get("/api/stores/99999")
    assert resp.status_code == 404


def test_update_store_name(client: TestClient) -> None:
    store = _create_store(client)
    resp = client.patch(f"/api/stores/{store['id']}", json={"name": "ALDI #86"})
    assert resp.status_code == 200
    assert resp.json()["name"] == "ALDI #86"


def test_delete_store(client: TestClient) -> None:
    store = _create_store(client)
    resp = client.delete(f"/api/stores/{store['id']}")
    assert resp.status_code == 204
    assert client.get(f"/api/stores/{store['id']}").status_code == 404


# ── GroceryItem tests ─────────────────────────────────────────────────────────

def test_create_grocery_item_returns_201(client: TestClient) -> None:
    item = _create_item(client, name="Ground Coffee", unit="each")
    assert item["name"] == "Ground Coffee"
    assert item["default_unit"] == "each"
    assert item["default_store"] is None


def test_create_grocery_item_with_store(client: TestClient) -> None:
    store = _create_store(client)
    item = _create_item(client, name="Red Grapes", unit="lb", store_id=store["id"])
    assert item["default_unit"] == "lb"
    assert item["default_store"]["id"] == store["id"]


def test_create_grocery_item_duplicate_name_returns_409(client: TestClient) -> None:
    _create_item(client, name="Dill Pickles")
    resp = client.post("/api/grocery/items", json={"name": "Dill Pickles"})
    assert resp.status_code == 409


def test_create_grocery_item_invalid_store_returns_404(client: TestClient) -> None:
    resp = client.post("/api/grocery/items", json={"name": "Kiwi", "default_store_id": 99999})
    assert resp.status_code == 404


def test_list_grocery_items_search(client: TestClient) -> None:
    _create_item(client, name="Green Grapes")
    _create_item(client, name="Red Grapes")
    _create_item(client, name="Mandarins")
    resp = client.get("/api/grocery/items?search=Grapes")
    assert resp.status_code == 200
    names = [i["name"] for i in resp.json()]
    assert "Green Grapes" in names
    assert "Red Grapes" in names
    assert "Mandarins" not in names


def test_delete_grocery_item(client: TestClient) -> None:
    item = _create_item(client)
    resp = client.delete(f"/api/grocery/items/{item['id']}")
    assert resp.status_code == 204
    assert client.get(f"/api/grocery/items/{item['id']}").status_code == 404


# ── OnHand tests ──────────────────────────────────────────────────────────────

def test_upsert_on_hand_creates_record(client: TestClient) -> None:
    item = _create_item(client, name="Frozen Strawberry")
    resp = client.put(f"/api/grocery/on-hand/{item['id']}", json={"quantity": "2", "unit": "each"})
    assert resp.status_code == 200
    data = resp.json()
    assert float(data["quantity"]) == 2.0
    assert data["unit"] == "each"


def test_upsert_on_hand_updates_existing(client: TestClient) -> None:
    item = _create_item(client, name="Bone Broth")
    client.put(f"/api/grocery/on-hand/{item['id']}", json={"quantity": "4", "unit": "each"})
    resp = client.put(f"/api/grocery/on-hand/{item['id']}", json={"quantity": "2", "unit": "each"})
    assert resp.status_code == 200
    assert float(resp.json()["quantity"]) == 2.0


def test_upsert_on_hand_with_weight(client: TestClient) -> None:
    item = _create_item(client, name="Red Grapes", unit="lb")
    resp = client.put(f"/api/grocery/on-hand/{item['id']}", json={"quantity": "2.49", "unit": "lb"})
    assert resp.status_code == 200
    assert float(resp.json()["quantity"]) == pytest.approx(2.49, abs=0.001)


def test_list_on_hand(client: TestClient) -> None:
    item1 = _create_item(client, name="Frozen Strawberry")
    item2 = _create_item(client, name="Ground Coffee")
    client.put(f"/api/grocery/on-hand/{item1['id']}", json={"quantity": "1", "unit": "each"})
    client.put(f"/api/grocery/on-hand/{item2['id']}", json={"quantity": "1", "unit": "each"})
    resp = client.get("/api/grocery/on-hand")
    assert resp.status_code == 200
    assert len(resp.json()) == 2


def test_delete_on_hand(client: TestClient) -> None:
    item = _create_item(client)
    client.put(f"/api/grocery/on-hand/{item['id']}", json={"quantity": "1", "unit": "each"})
    resp = client.delete(f"/api/grocery/on-hand/{item['id']}")
    assert resp.status_code == 204
    assert client.get("/api/grocery/on-hand").json() == []


def test_delete_on_hand_missing_returns_404(client: TestClient) -> None:
    item = _create_item(client)
    resp = client.delete(f"/api/grocery/on-hand/{item['id']}")
    assert resp.status_code == 404


# ── GroceryList tests ─────────────────────────────────────────────────────────

def test_create_grocery_list_defaults_to_draft(client: TestClient) -> None:
    lst = _create_list(client)
    assert lst["status"] == "draft"
    assert lst["items"] == []


def test_create_grocery_list_with_store(client: TestClient) -> None:
    store = _create_store(client)
    lst = _create_list(client, store_id=store["id"])
    assert lst["store"]["id"] == store["id"]


def test_create_grocery_list_invalid_store_returns_404(client: TestClient) -> None:
    resp = client.post("/api/grocery/lists", json={"name": "Bad List", "store_id": 99999})
    assert resp.status_code == 404


def test_advance_list_status_draft_to_active(client: TestClient) -> None:
    lst = _create_list(client)
    resp = client.patch(f"/api/grocery/lists/{lst['id']}", json={"status": "active"})
    assert resp.status_code == 200
    assert resp.json()["status"] == "active"


def test_advance_list_status_active_to_completed(client: TestClient) -> None:
    lst = _create_list(client)
    client.patch(f"/api/grocery/lists/{lst['id']}", json={"status": "active"})
    resp = client.patch(f"/api/grocery/lists/{lst['id']}", json={"status": "completed", "shopping_date": "2026-04-18"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "completed"
    assert data["shopping_date"] == "2026-04-18"


def test_list_grocery_lists_filter_by_status(client: TestClient) -> None:
    lst1 = _create_list(client, name="ALDI Run")
    _create_list(client, name="Costco Run")
    client.patch(f"/api/grocery/lists/{lst1['id']}", json={"status": "completed"})
    resp = client.get("/api/grocery/lists?status=completed")
    assert resp.status_code == 200
    assert all(l["status"] == "completed" for l in resp.json())


def test_delete_grocery_list(client: TestClient) -> None:
    lst = _create_list(client)
    resp = client.delete(f"/api/grocery/lists/{lst['id']}")
    assert resp.status_code == 204
    assert client.get(f"/api/grocery/lists/{lst['id']}").status_code == 404


# ── GroceryListItem tests ─────────────────────────────────────────────────────

def test_add_item_to_list(client: TestClient) -> None:
    lst = _create_list(client)
    item = _create_item(client)
    resp = client.post(
        f"/api/grocery/lists/{lst['id']}/items",
        json={"item_id": item["id"], "quantity": "4", "unit": "each", "price": "3.49"},
    )
    assert resp.status_code == 201
    data = resp.json()
    assert float(data["quantity"]) == 4.0
    assert float(data["price"]) == 3.49
    assert data["status"] == "needed"
    assert data["item"]["name"] == "Bone Broth"


def test_add_duplicate_item_to_list_returns_409(client: TestClient) -> None:
    lst = _create_list(client)
    item = _create_item(client)
    client.post(f"/api/grocery/lists/{lst['id']}/items", json={"item_id": item["id"], "quantity": "1", "unit": "each"})
    resp = client.post(f"/api/grocery/lists/{lst['id']}/items", json={"item_id": item["id"], "quantity": "2", "unit": "each"})
    assert resp.status_code == 409


def test_add_item_by_weight(client: TestClient) -> None:
    lst = _create_list(client)
    item = _create_item(client, name="Green Grapes", unit="lb")
    resp = client.post(
        f"/api/grocery/lists/{lst['id']}/items",
        json={"item_id": item["id"], "quantity": "2.64", "unit": "lb", "price": "5.78"},
    )
    assert resp.status_code == 201
    data = resp.json()
    assert float(data["quantity"]) == pytest.approx(2.64, abs=0.001)
    assert data["unit"] == "lb"


def test_mark_list_item_purchased(client: TestClient) -> None:
    lst = _create_list(client)
    item = _create_item(client)
    client.post(f"/api/grocery/lists/{lst['id']}/items", json={"item_id": item["id"], "quantity": "1", "unit": "each"})
    resp = client.patch(f"/api/grocery/lists/{lst['id']}/items/{item['id']}", json={"status": "purchased"})
    assert resp.status_code == 200
    assert resp.json()["status"] == "purchased"


def test_update_list_item_price(client: TestClient) -> None:
    lst = _create_list(client)
    item = _create_item(client)
    client.post(f"/api/grocery/lists/{lst['id']}/items", json={"item_id": item["id"], "quantity": "1", "unit": "each"})
    resp = client.patch(f"/api/grocery/lists/{lst['id']}/items/{item['id']}", json={"price": "6.19"})
    assert resp.status_code == 200
    assert float(resp.json()["price"]) == 6.19


def test_remove_item_from_list(client: TestClient) -> None:
    lst = _create_list(client)
    item = _create_item(client)
    client.post(f"/api/grocery/lists/{lst['id']}/items", json={"item_id": item["id"], "quantity": "1", "unit": "each"})
    resp = client.delete(f"/api/grocery/lists/{lst['id']}/items/{item['id']}")
    assert resp.status_code == 204
    detail = client.get(f"/api/grocery/lists/{lst['id']}").json()
    assert detail["items"] == []


def test_get_list_includes_all_items(client: TestClient) -> None:
    store = _create_store(client)
    lst = _create_list(client, store_id=store["id"])
    items = [
        _create_item(client, name="Frozen Strawberry"),
        _create_item(client, name="Ground Coffee"),
        _create_item(client, name="Chicken Noodle", unit="can"),
    ]
    for i, item in enumerate(items, 1):
        client.post(
            f"/api/grocery/lists/{lst['id']}/items",
            json={"item_id": item["id"], "quantity": str(i), "unit": item["default_unit"]},
        )
    detail = client.get(f"/api/grocery/lists/{lst['id']}").json()
    assert len(detail["items"]) == 3
    names = {li["item"]["name"] for li in detail["items"]}
    assert names == {"Frozen Strawberry", "Ground Coffee", "Chicken Noodle"}


def test_delete_list_cascades_items(client: TestClient) -> None:
    lst = _create_list(client)
    item = _create_item(client)
    client.post(f"/api/grocery/lists/{lst['id']}/items", json={"item_id": item["id"], "quantity": "1", "unit": "each"})
    client.delete(f"/api/grocery/lists/{lst['id']}")
    # Item catalog entry should still exist
    assert client.get(f"/api/grocery/items/{item['id']}").status_code == 200


def test_list_grocery_lists_invalid_status_returns_422(client: TestClient) -> None:
    resp = client.get("/api/grocery/lists?status=not_a_real_status")
    assert resp.status_code == 422


def test_update_list_item_not_found_returns_404(client: TestClient) -> None:
    lst = _create_list(client)
    resp = client.patch(f"/api/grocery/lists/{lst['id']}/items/99999", json={"quantity": "2"})
    assert resp.status_code == 404


def test_remove_list_item_not_found_returns_404(client: TestClient) -> None:
    lst = _create_list(client)
    resp = client.delete(f"/api/grocery/lists/{lst['id']}/items/99999")
    assert resp.status_code == 404
