"""Tests fuer /api/v1/presets CRUD."""

ZERO_ADJ = {
    "exposure": 0.0, "contrast": 0.0, "highlights": 0.0, "shadows": 0.0,
    "whites": 0.0, "blacks": 0.0, "temperature": 0.0, "tint": 0.0,
    "vibrance": 0.0, "saturation": 0.0,
}

ZERO_LOCAL_ADJ = {
    "exposure": 0.0, "contrast": 0.0, "saturation": 0.0, "temperature": 0.0,
}


def _linear_mask(**overrides):
    base = {
        "type": "linear",
        "mask": {
            "p1": {"u": 0.5, "v": 0.0},
            "p2": {"u": 0.5, "v": 1.0},
            "feather": 0.4,
        },
        "localAdj": {**ZERO_LOCAL_ADJ},
    }
    base["localAdj"] = {**base["localAdj"], **overrides.pop("localAdj", {})}
    base.update(overrides)
    return base


def _radial_mask(**overrides):
    base = {
        "type": "radial",
        "mask": {
            "center": {"u": 0.5, "v": 0.5},
            "rx": 0.3,
            "ry": 0.2,
            "feather": 0.4,
        },
        "localAdj": {**ZERO_LOCAL_ADJ},
    }
    base["localAdj"] = {**base["localAdj"], **overrides.pop("localAdj", {})}
    base.update(overrides)
    return base


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


# ---- Masken-Persistenz (iteration 19b) ----

async def test_default_presets_have_empty_masks(client, user_a):
    r = await client.get("/api/v1/presets", headers=user_a["headers"])
    assert r.status_code == 200
    for p in r.json():
        assert p["masks"] == []


async def test_create_preset_with_masks_roundtrips(client, user_a):
    masks = [
        _linear_mask(localAdj={"exposure": 1.0, "contrast": 0.2}),
        _radial_mask(localAdj={"exposure": -0.5, "saturation": 0.3}),
    ]
    r = await client.post(
        "/api/v1/presets",
        headers=user_a["headers"],
        json={"name": "Mit Masken", "adjustments": ZERO_ADJ, "masks": masks},
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert len(body["masks"]) == 2
    assert body["masks"][0]["type"] == "linear"
    assert body["masks"][0]["localAdj"]["exposure"] == 1.0
    assert body["masks"][1]["type"] == "radial"
    assert body["masks"][1]["localAdj"]["saturation"] == 0.3
    assert body["masks"][1]["mask"]["rx"] == 0.3

    # GET liefert dieselben Masken zurueck (DB-Roundtrip)
    listing = await client.get("/api/v1/presets", headers=user_a["headers"])
    [persisted] = [p for p in listing.json() if p["name"] == "Mit Masken"]
    assert persisted["masks"] == body["masks"]


async def test_create_preset_default_masks_is_empty_list(client, user_a):
    r = await client.post(
        "/api/v1/presets",
        headers=user_a["headers"],
        json={"name": "Ohne Masken", "adjustments": ZERO_ADJ},
    )
    assert r.status_code == 201
    assert r.json()["masks"] == []


async def test_update_preset_overwrites_masks(client, user_a):
    create = await client.post(
        "/api/v1/presets",
        headers=user_a["headers"],
        json={
            "name": "MaskUpdate",
            "adjustments": ZERO_ADJ,
            "masks": [_linear_mask()],
        },
    )
    pid = create.json()["id"]

    upd = await client.put(
        f"/api/v1/presets/{pid}",
        headers=user_a["headers"],
        json={
            "name": "MaskUpdate",
            "adjustments": ZERO_ADJ,
            "masks": [_radial_mask(), _radial_mask()],
        },
    )
    assert upd.status_code == 200
    assert [m["type"] for m in upd.json()["masks"]] == ["radial", "radial"]


async def test_invalid_mask_type_returns_422(client, user_a):
    bad = {**_linear_mask(), "type": "bogus"}
    r = await client.post(
        "/api/v1/presets",
        headers=user_a["headers"],
        json={"name": "Bogus", "adjustments": ZERO_ADJ, "masks": [bad]},
    )
    assert r.status_code == 422


async def test_mask_uv_out_of_range_returns_422(client, user_a):
    bad = _linear_mask()
    bad["mask"]["p1"]["u"] = 1.5
    r = await client.post(
        "/api/v1/presets",
        headers=user_a["headers"],
        json={"name": "BadUv", "adjustments": ZERO_ADJ, "masks": [bad]},
    )
    assert r.status_code == 422


async def test_too_many_linear_masks_returns_422(client, user_a):
    masks = [_linear_mask() for _ in range(5)]
    r = await client.post(
        "/api/v1/presets",
        headers=user_a["headers"],
        json={"name": "TooMany", "adjustments": ZERO_ADJ, "masks": masks},
    )
    assert r.status_code == 422


async def test_max_caps_combination_accepted(client, user_a):
    # Genau 4 linear + 4 radial darf passieren (Cap-Grenze)
    masks = [_linear_mask() for _ in range(4)] + [_radial_mask() for _ in range(4)]
    r = await client.post(
        "/api/v1/presets",
        headers=user_a["headers"],
        json={"name": "FullCaps", "adjustments": ZERO_ADJ, "masks": masks},
    )
    assert r.status_code == 201
    assert len(r.json()["masks"]) == 8


async def test_mask_extra_field_returns_422(client, user_a):
    bad = {**_linear_mask(), "unexpected": "field"}
    r = await client.post(
        "/api/v1/presets",
        headers=user_a["headers"],
        json={"name": "ExtraField", "adjustments": ZERO_ADJ, "masks": [bad]},
    )
    assert r.status_code == 422
