"""Tests fuer den persistierten Bearbeitungsstand (C1, Multi-Device).

PUT/GET /api/v1/images/{id}/edit. Ownership wird ueber das Bild gefahren
(images.user_id). Ein State pro Bild (Upsert)."""
import urllib.request


def _put_to_url(url: str, data: bytes, content_type: str) -> None:
    req = urllib.request.Request(
        url, data=data, method="PUT", headers={"Content-Type": content_type}
    )
    with urllib.request.urlopen(req, timeout=5) as resp:
        assert 200 <= resp.status < 300


async def _upload(client, headers) -> str:
    payload = b"\xff\xd8\xff\xe0edit-fixture"
    init = await client.post(
        "/api/v1/images",
        headers=headers,
        json={"filename": "e.jpg", "contentType": "image/jpeg", "sizeBytes": len(payload)},
    )
    body = init.json()
    _put_to_url(body["uploadUrl"], payload, "image/jpeg")
    confirm = await client.post(
        f"/api/v1/images/{body['id']}/confirm", headers=headers
    )
    assert confirm.status_code == 200, confirm.text
    return body["id"]


async def test_put_then_get_round_trips_edit_state(client, user_a):
    image_id = await _upload(client, user_a["headers"])
    state = {
        "adjustments": {"exposure": 0.5, "contrast": 0.2},
        "masks": [],
        "crop": {"x": 0.1, "y": 0.1, "w": 0.8, "h": 0.8},
        "straightenAngle": 0.05,
        "lensProfileId": "canon-ef-50",
        "manualLensOverride": True,
    }
    put = await client.put(
        f"/api/v1/images/{image_id}/edit", headers=user_a["headers"], json=state
    )
    assert put.status_code == 204, put.text

    got = await client.get(
        f"/api/v1/images/{image_id}/edit", headers=user_a["headers"]
    )
    assert got.status_code == 200, got.text
    body = got.json()
    assert body["adjustments"]["exposure"] == 0.5
    assert body["adjustments"]["contrast"] == 0.2
    # Default-Felder werden aufgefuellt
    assert body["adjustments"]["highlightRecovery"] == 0
    assert body["crop"] == {"x": 0.1, "y": 0.1, "w": 0.8, "h": 0.8}
    assert body["straightenAngle"] == 0.05
    assert body["lensProfileId"] == "canon-ef-50"
    assert body["manualLensOverride"] is True


async def test_put_is_upsert(client, user_a):
    image_id = await _upload(client, user_a["headers"])
    await client.put(
        f"/api/v1/images/{image_id}/edit",
        headers=user_a["headers"],
        json={"adjustments": {"exposure": 0.1}},
    )
    await client.put(
        f"/api/v1/images/{image_id}/edit",
        headers=user_a["headers"],
        json={"adjustments": {"exposure": 0.9}},
    )
    got = await client.get(
        f"/api/v1/images/{image_id}/edit", headers=user_a["headers"]
    )
    assert got.json()["adjustments"]["exposure"] == 0.9


async def test_get_without_saved_edit_returns_404(client, user_a):
    image_id = await _upload(client, user_a["headers"])
    got = await client.get(
        f"/api/v1/images/{image_id}/edit", headers=user_a["headers"]
    )
    assert got.status_code == 404


async def test_user_b_cannot_read_or_write_user_a_edit(client, user_a, user_b):
    image_id = await _upload(client, user_a["headers"])
    await client.put(
        f"/api/v1/images/{image_id}/edit",
        headers=user_a["headers"],
        json={"adjustments": {"exposure": 0.3}},
    )
    # Fremder Lesezugriff -> 404 (Ownership ueber das Bild)
    get_b = await client.get(
        f"/api/v1/images/{image_id}/edit", headers=user_b["headers"]
    )
    assert get_b.status_code == 404
    # Fremder Schreibzugriff -> 404
    put_b = await client.put(
        f"/api/v1/images/{image_id}/edit",
        headers=user_b["headers"],
        json={"adjustments": {"exposure": 0.9}},
    )
    assert put_b.status_code == 404


async def test_get_edit_unknown_image_returns_404(client, user_a):
    got = await client.get(
        "/api/v1/images/00000000-0000-0000-0000-000000000000/edit",
        headers=user_a["headers"],
    )
    assert got.status_code == 404


async def test_put_rejects_too_many_masks(client, user_a):
    image_id = await _upload(client, user_a["headers"])
    too_many_linear = [
        {
            "type": "linear",
            "mask": {
                "p1": {"u": 0, "v": 0},
                "p2": {"u": 1, "v": 1},
                "feather": 0.5,
            },
            "localAdj": {"exposure": 0, "contrast": 0, "saturation": 0, "temperature": 0},
        }
        for _ in range(5)  # MAX_LINEAR_MASKS = 4
    ]
    put = await client.put(
        f"/api/v1/images/{image_id}/edit",
        headers=user_a["headers"],
        json={"adjustments": {}, "masks": too_many_linear},
    )
    assert put.status_code == 422
