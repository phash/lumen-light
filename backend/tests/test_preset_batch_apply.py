"""Batch-Apply: Profil auf mehrere Bilder anwenden (POST /presets/{id}/apply)."""
import urllib.request

ZERO_ADJ = {
    "exposure": 0.0, "contrast": 0.0, "highlights": 0.0, "shadows": 0.0,
    "whites": 0.0, "blacks": 0.0, "temperature": 0.0, "tint": 0.0,
    "vibrance": 0.0, "saturation": 0.0,
}

# Gueltige JPEG-Magic-Bytes vorne dran — confirm() validiert die echten
# Anfangsbytes gegen image/jpeg. Kein echtes Bild noetig (der Pixel-Pfad ist
# client-seitig), daher Magic-Byte-Literal statt Pillow. Gleiches Muster wie
# test_images_api.py — haelt Pillow aus den Backend-Test-Deps.
_JPEG_BYTES = b"\xff\xd8\xff\xe0fake-image-bytes"


def _put_to_url(url: str, data: bytes, content_type: str) -> None:
    req = urllib.request.Request(
        url, data=data, method="PUT", headers={"Content-Type": content_type},
    )
    with urllib.request.urlopen(req, timeout=5) as resp:
        assert 200 <= resp.status < 300


async def _make_ready_image(client, headers) -> str:
    """Legt ein Bild an, laedt JPEG-Magic-Bytes per Pre-Signed PUT hoch, confirmt."""
    init = await client.post(
        "/api/v1/images",
        headers=headers,
        json={
            "filename": "x.jpg",
            "contentType": "image/jpeg",
            "sizeBytes": len(_JPEG_BYTES),
        },
    )
    assert init.status_code == 201, init.text
    image_id = init.json()["id"]
    _put_to_url(init.json()["uploadUrl"], _JPEG_BYTES, "image/jpeg")
    conf = await client.post(f"/api/v1/images/{image_id}/confirm", headers=headers)
    assert conf.status_code == 200, conf.text
    return image_id


async def _create_preset(client, headers, name, *, adjustments=None, **extra) -> str:
    body = {"name": name, "adjustments": {**ZERO_ADJ, **(adjustments or {})}}
    body.update(extra)
    r = await client.post("/api/v1/presets", headers=headers, json=body)
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def test_batch_apply_sets_enabled_group_on_targets(client, user_a):
    img1 = await _make_ready_image(client, user_a["headers"])
    img2 = await _make_ready_image(client, user_a["headers"])
    preset_id = await _create_preset(
        client, user_a["headers"], "Kontrast-Look",
        adjustments={"contrast": 0.6, "temperature": 0.5},
    )
    r = await client.post(
        f"/api/v1/presets/{preset_id}/apply",
        headers=user_a["headers"],
        json={"imageIds": [img1, img2], "groups": ["tone"]},  # contrast in tone
    )
    assert r.status_code == 200, r.text
    assert r.json() == {"applied": 2, "total": 2}
    # tone angehakt -> contrast uebernommen; color NICHT -> temperature bleibt 0
    e1 = await client.get(f"/api/v1/images/{img1}/edit", headers=user_a["headers"])
    assert e1.status_code == 200
    assert e1.json()["adjustments"]["contrast"] == 0.6
    assert e1.json()["adjustments"]["temperature"] == 0.0


async def test_batch_apply_merges_keeps_untoggled_existing(client, user_a):
    img = await _make_ready_image(client, user_a["headers"])
    # Bild hat schon einen Edit-State mit temperature=0.7
    pre = await client.put(
        f"/api/v1/images/{img}/edit",
        headers=user_a["headers"],
        json={"adjustments": {**ZERO_ADJ, "temperature": 0.7}, "masks": []},
    )
    assert pre.status_code == 204
    preset_id = await _create_preset(
        client, user_a["headers"], "Nur-Ton", adjustments={"contrast": 0.4, "temperature": -0.4},
    )
    r = await client.post(
        f"/api/v1/presets/{preset_id}/apply",
        headers=user_a["headers"],
        json={"imageIds": [img], "groups": ["tone"]},  # color NICHT angehakt
    )
    assert r.status_code == 200
    e = await client.get(f"/api/v1/images/{img}/edit", headers=user_a["headers"])
    assert e.json()["adjustments"]["contrast"] == 0.4    # tone uebernommen
    assert e.json()["adjustments"]["temperature"] == 0.7  # color-Wert bleibt


async def test_batch_apply_foreign_image_rejected_no_mutation(client, user_a, user_b):
    own = await _make_ready_image(client, user_a["headers"])
    foreign = await _make_ready_image(client, user_b["headers"])
    preset_id = await _create_preset(client, user_a["headers"], "X", adjustments={"contrast": 0.5})
    r = await client.post(
        f"/api/v1/presets/{preset_id}/apply",
        headers=user_a["headers"],
        json={"imageIds": [own, foreign], "groups": ["tone"]},
    )
    assert r.status_code == 400
    # Keine Mutation am eigenen Bild (kein gespeicherter Stand entstanden)
    e = await client.get(f"/api/v1/images/{own}/edit", headers=user_a["headers"])
    assert e.status_code == 404


async def test_batch_apply_unknown_group_returns_422(client, user_a):
    img = await _make_ready_image(client, user_a["headers"])
    preset_id = await _create_preset(client, user_a["headers"], "Y")
    r = await client.post(
        f"/api/v1/presets/{preset_id}/apply",
        headers=user_a["headers"],
        json={"imageIds": [img], "groups": ["voodoo"]},
    )
    assert r.status_code == 422


async def test_batch_apply_crop_group_no_geometry_clears_existing_crop(client, user_a):
    img = await _make_ready_image(client, user_a["headers"])
    # Bild bekommt vorher einen Crop-State
    await client.put(
        f"/api/v1/images/{img}/edit",
        headers=user_a["headers"],
        json={"adjustments": ZERO_ADJ, "masks": [],
              "crop": {"x0": 0.1, "y0": 0.1, "x1": 0.9, "y1": 0.9},
              "straightenAngle": 0.1},
    )
    # Preset ohne Geometrie, aber crop-Gruppe angehakt
    preset_id = await _create_preset(client, user_a["headers"], "Kein-Crop-Preset")
    r = await client.post(
        f"/api/v1/presets/{preset_id}/apply",
        headers=user_a["headers"],
        json={"imageIds": [img], "groups": ["crop"]},
    )
    assert r.status_code == 200
    e = await client.get(f"/api/v1/images/{img}/edit", headers=user_a["headers"])
    assert e.json()["crop"] is None            # gecleared (Preset hat keine Geometrie)
    assert e.json()["straightenAngle"] == 0.0  # zurueckgesetzt


async def test_batch_apply_default_preset_with_missing_keys_succeeds(client, user_a):
    """Regression (CRITICAL): die 10 Look/Genre-Default-Presets (vor Phase E/G)
    haben kein highlightRecovery/localContrast/sharpness/noiseReduction in der
    gespeicherten JSONB. Batch-Apply mit den Default-Gruppen (tone+detail an)
    darf NICHT 400 werfen — die rohe Preset-JSONB wird vor dem Merge ueber das
    Adjustments-Modell normalisiert (fehlende Felder -> Default 0)."""
    presets = (
        await client.get("/api/v1/presets", headers=user_a["headers"])
    ).json()
    punchy = next(p for p in presets if p["name"] == "Punchy")
    img = await _make_ready_image(client, user_a["headers"])
    r = await client.post(
        f"/api/v1/presets/{punchy['id']}/apply",
        headers=user_a["headers"],
        json={"imageIds": [img], "groups": ["tone", "detail"]},
    )
    assert r.status_code == 200, r.text
    assert r.json() == {"applied": 1, "total": 1}
    e = (
        await client.get(f"/api/v1/images/{img}/edit", headers=user_a["headers"])
    ).json()
    # Fehlende Felder mit Default 0 gefuellt (kein None -> keine 400):
    assert e["adjustments"]["highlightRecovery"] == 0
    assert e["adjustments"]["localContrast"] == 0
    # tone-Gruppe hat Punchys Kontrast uebernommen:
    assert e["adjustments"]["contrast"] == punchy["adjustments"]["contrast"]


async def test_batch_apply_empty_groups_returns_422(client, user_a):
    """Leeres groups ist kein erlaubter No-op mehr (min_length=1)."""
    img = await _make_ready_image(client, user_a["headers"])
    preset_id = await _create_preset(client, user_a["headers"], "Empty-Groups")
    r = await client.post(
        f"/api/v1/presets/{preset_id}/apply",
        headers=user_a["headers"],
        json={"imageIds": [img], "groups": []},
    )
    assert r.status_code == 422
