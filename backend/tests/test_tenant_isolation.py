"""Tests fuer Tenant-Isolation: User B darf nichts von User A sehen oder aendern."""

ZERO_ADJ = {
    "exposure": 0.0, "contrast": 0.0, "highlights": 0.0, "shadows": 0.0,
    "whites": 0.0, "blacks": 0.0, "temperature": 0.0, "tint": 0.0,
    "vibrance": 0.0, "saturation": 0.0,
}


async def _create_preset(client, headers, name: str) -> str:
    r = await client.post(
        "/api/v1/presets",
        headers=headers,
        json={"name": name, "adjustments": ZERO_ADJ},
    )
    assert r.status_code == 201
    return r.json()["id"]


async def test_user_b_cannot_see_user_a_preset_in_list(client, user_a, user_b):
    await _create_preset(client, user_a["headers"], "AlicesPreset")

    r = await client.get("/api/v1/presets", headers=user_b["headers"])
    names = [p["name"] for p in r.json()]
    assert "AlicesPreset" not in names


async def test_user_b_cannot_update_user_a_preset(client, user_a, user_b):
    pid = await _create_preset(client, user_a["headers"], "Lock")

    r = await client.put(
        f"/api/v1/presets/{pid}",
        headers=user_b["headers"],
        json={"name": "Hijacked", "adjustments": ZERO_ADJ},
    )
    assert r.status_code == 404

    listing = await client.get("/api/v1/presets", headers=user_a["headers"])
    assert "Lock" in [p["name"] for p in listing.json()]


async def test_user_b_cannot_delete_user_a_preset(client, user_a, user_b):
    pid = await _create_preset(client, user_a["headers"], "DontDeleteMe")

    r = await client.delete(
        f"/api/v1/presets/{pid}", headers=user_b["headers"]
    )
    assert r.status_code == 404

    listing = await client.get("/api/v1/presets", headers=user_a["headers"])
    assert "DontDeleteMe" in [p["name"] for p in listing.json()]


async def test_search_query_does_not_leak_other_tenants(client, user_a, user_b):
    await _create_preset(client, user_a["headers"], "AliceSecret")

    r = await client.get(
        "/api/v1/presets?q=AliceSecret", headers=user_b["headers"]
    )
    assert r.json() == []
