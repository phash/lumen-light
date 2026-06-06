"""Geometry-Round-Trip im Preset-CRUD."""

ZERO_ADJ = {
    "exposure": 0.0, "contrast": 0.0, "highlights": 0.0, "shadows": 0.0,
    "whites": 0.0, "blacks": 0.0, "temperature": 0.0, "tint": 0.0,
    "vibrance": 0.0, "saturation": 0.0,
}

GEOMETRY = {
    "crop": {"x0": 0.1, "y0": 0.1, "x1": 0.9, "y1": 0.8},
    "straightenAngle": 0.05,
    "lensCorrection": {"distortion": 0.2, "vignette": 0.0, "tcaR": 0.0, "tcaB": 0.0},
    "lensProfileId": "canon-rf-24-105",
    "manualLensOverride": True,
}


async def test_create_preset_with_geometry_roundtrips(client, user_a):
    r = await client.post(
        "/api/v1/presets",
        headers=user_a["headers"],
        json={"name": "Mit Geometrie", "adjustments": ZERO_ADJ, "geometry": GEOMETRY},
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["geometry"]["crop"] == GEOMETRY["crop"]
    assert body["geometry"]["lensProfileId"] == "canon-rf-24-105"
    assert body["geometry"]["manualLensOverride"] is True


async def test_create_preset_without_geometry_is_null(client, user_a):
    r = await client.post(
        "/api/v1/presets",
        headers=user_a["headers"],
        json={"name": "Ohne Geometrie", "adjustments": ZERO_ADJ},
    )
    assert r.status_code == 201
    assert r.json()["geometry"] is None
