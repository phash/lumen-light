"""Batch-Apply: Profil auf mehrere Bilder anwenden (POST /presets/{id}/apply)."""
import io
from PIL import Image as PILImage

ZERO_ADJ = {
    "exposure": 0.0, "contrast": 0.0, "highlights": 0.0, "shadows": 0.0,
    "whites": 0.0, "blacks": 0.0, "temperature": 0.0, "tint": 0.0,
    "vibrance": 0.0, "saturation": 0.0,
}


async def _make_ready_image(client, headers) -> str:
    """Legt ein Bild an, laedt JPEG-Bytes per Pre-Signed PUT hoch, confirmt."""
    buf = io.BytesIO()
    PILImage.new("RGB", (8, 8), (120, 120, 120)).save(buf, format="JPEG")
    data = buf.getvalue()
    init = await client.post(
        "/api/v1/images",
        headers=headers,
        json={"filename": "x.jpg", "contentType": "image/jpeg", "sizeBytes": len(data)},
    )
    assert init.status_code == 201, init.text
    image_id = init.json()["id"]
    upload_url = init.json()["uploadUrl"]
    import httpx
    async with httpx.AsyncClient() as raw:
        put = await raw.put(upload_url, content=data, headers={"Content-Type": "image/jpeg"})
        assert put.status_code in (200, 204), put.text
    conf = await client.post(f"/api/v1/images/{image_id}/confirm", headers=headers)
    assert conf.status_code == 200, conf.text
    return image_id


async def _create_preset(client, headers, name, **over) -> str:
    body = {"name": name, "adjustments": {**ZERO_ADJ, **over.pop("adjustments", {})}}
    body.update(over)
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
