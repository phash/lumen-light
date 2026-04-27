"""Tests fuer /api/v1/presets CRUD."""

ZERO_ADJ = {
    "exposure": 0.0, "contrast": 0.0, "highlights": 0.0, "shadows": 0.0,
    "whites": 0.0, "blacks": 0.0, "temperature": 0.0, "tint": 0.0,
    "vibrance": 0.0, "saturation": 0.0,
}


async def test_list_presets_for_new_user_returns_defaults(client, user_a):
    r = await client.get("/api/v1/presets", headers=user_a["headers"])
    assert r.status_code == 200
    names = [p["name"] for p in r.json()]
    assert names == sorted(names)
    assert {"Neutral", "Punchy", "Soft Mood", "Schwarzweiss-Vorbereitung"} <= set(names)


async def test_create_preset(client, user_a):
    adj = {**ZERO_ADJ, "contrast": 0.4}
    r = await client.post(
        "/api/v1/presets",
        headers=user_a["headers"],
        json={"name": "Mein Look", "adjustments": adj},
    )
    assert r.status_code == 201
    body = r.json()
    assert body["name"] == "Mein Look"
    assert body["adjustments"]["contrast"] == 0.4
    assert "id" in body


async def test_create_duplicate_name_returns_409(client, user_a):
    r = await client.post(
        "/api/v1/presets",
        headers=user_a["headers"],
        json={"name": "Punchy", "adjustments": ZERO_ADJ},
    )
    assert r.status_code == 409


async def test_create_with_out_of_range_value_returns_422(client, user_a):
    bad = {**ZERO_ADJ, "exposure": 99.0}
    r = await client.post(
        "/api/v1/presets",
        headers=user_a["headers"],
        json={"name": "Bad", "adjustments": bad},
    )
    assert r.status_code == 422


async def test_create_with_extra_field_returns_422(client, user_a):
    bad = {**ZERO_ADJ, "clarity": 0.3}
    r = await client.post(
        "/api/v1/presets",
        headers=user_a["headers"],
        json={"name": "Extra", "adjustments": bad},
    )
    assert r.status_code == 422


async def test_update_preset(client, user_a):
    create = await client.post(
        "/api/v1/presets",
        headers=user_a["headers"],
        json={"name": "ToUpdate", "adjustments": ZERO_ADJ},
    )
    pid = create.json()["id"]

    new_adj = {**ZERO_ADJ, "saturation": -0.5}
    r = await client.put(
        f"/api/v1/presets/{pid}",
        headers=user_a["headers"],
        json={"name": "Updated", "adjustments": new_adj},
    )
    assert r.status_code == 200
    assert r.json()["name"] == "Updated"
    assert r.json()["adjustments"]["saturation"] == -0.5


async def test_update_unknown_preset_returns_404(client, user_a):
    fake = "00000000-0000-0000-0000-000000000000"
    r = await client.put(
        f"/api/v1/presets/{fake}",
        headers=user_a["headers"],
        json={"name": "X", "adjustments": ZERO_ADJ},
    )
    assert r.status_code == 404


async def test_delete_preset(client, user_a):
    create = await client.post(
        "/api/v1/presets",
        headers=user_a["headers"],
        json={"name": "ToDelete", "adjustments": ZERO_ADJ},
    )
    pid = create.json()["id"]

    r = await client.delete(f"/api/v1/presets/{pid}", headers=user_a["headers"])
    assert r.status_code == 204

    listing = await client.get("/api/v1/presets", headers=user_a["headers"])
    assert "ToDelete" not in [p["name"] for p in listing.json()]


async def test_delete_unknown_preset_returns_404(client, user_a):
    fake = "00000000-0000-0000-0000-000000000000"
    r = await client.delete(f"/api/v1/presets/{fake}", headers=user_a["headers"])
    assert r.status_code == 404


async def test_list_supports_search(client, user_a):
    r = await client.get(
        "/api/v1/presets?q=Punc", headers=user_a["headers"]
    )
    assert r.status_code == 200
    names = [p["name"] for p in r.json()]
    assert names == ["Punchy"]


async def test_list_supports_sort_minus_name(client, user_a):
    r = await client.get(
        "/api/v1/presets?sort=-name", headers=user_a["headers"]
    )
    assert r.status_code == 200
    names = [p["name"] for p in r.json()]
    assert names == sorted(names, reverse=True)
