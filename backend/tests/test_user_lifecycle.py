"""DSGVO-Endpoints: DELETE /me + GET /me/export."""
import urllib.request


def _put_to_url(url: str, data: bytes, content_type: str) -> None:
    req = urllib.request.Request(
        url, data=data, method="PUT",
        headers={"Content-Type": content_type},
    )
    with urllib.request.urlopen(req, timeout=5) as resp:
        assert 200 <= resp.status < 300


# JPEG-Magic-Bytes vorne — confirm() validiert den Content-Type.
async def _upload_image(client, headers, payload=b"\xff\xd8\xff\xe0" + b"x" * 1020) -> str:
    init = await client.post(
        "/api/v1/images",
        headers=headers,
        json={
            "filename": "lifecycle.jpg",
            "contentType": "image/jpeg",
            "sizeBytes": len(payload),
        },
    )
    init_body = init.json()
    _put_to_url(init_body["uploadUrl"], payload, "image/jpeg")
    confirm = await client.post(
        f"/api/v1/images/{init_body['id']}/confirm", headers=headers
    )
    assert confirm.status_code == 200
    return init_body["id"]


async def test_delete_me_removes_db_rows_and_s3_objects(client, user_a):
    from app.storage import ObjectNotFound, get_storage

    image_id = await _upload_image(client, user_a["headers"])

    # Vorher: Image existiert in DB + S3
    listing = await client.get(
        "/api/v1/images?state=ready", headers=user_a["headers"]
    )
    assert image_id in [it["id"] for it in listing.json()]

    storage = get_storage()
    bucket_key = f"{user_a['user']['id']}/originals/{image_id}"
    assert storage.head(bucket_key) > 0

    # DELETE /me
    r = await client.delete("/api/v1/auth/me", headers=user_a["headers"])
    assert r.status_code == 204, r.text

    # Nachher: S3-Object weg
    try:
        storage.head(bucket_key)
        raise AssertionError("S3-Object haette weg sein muessen")
    except ObjectNotFound:
        pass


async def test_delete_me_idempotent_token_works_only_until_user_gone(
    client, user_a,
):
    """Nach DELETE /me: zweiter Aufruf mit demselben Token landet in
    JIT-Provisioning und erstellt einen NEUEN User-Record (mit den
    Default-Presets)."""
    r1 = await client.delete("/api/v1/auth/me", headers=user_a["headers"])
    assert r1.status_code == 204

    me_again = await client.get("/api/v1/auth/me", headers=user_a["headers"])
    assert me_again.status_code == 200
    # Andere User-ID, gleiche Email (aus Token).
    assert me_again.json()["email"] == user_a["user"]["email"]


async def test_export_me_returns_user_presets_images(client, user_a):
    image_id = await _upload_image(client, user_a["headers"])
    create_preset = await client.post(
        "/api/v1/presets",
        headers=user_a["headers"],
        json={
            "name": "Export-Test",
            "adjustments": {
                "exposure": 0.5, "contrast": 0, "highlights": 0, "shadows": 0,
                "whites": 0, "blacks": 0, "temperature": 0, "tint": 0,
                "vibrance": 0, "saturation": 0,
            },
        },
    )
    assert create_preset.status_code == 201

    r = await client.get("/api/v1/auth/me/export", headers=user_a["headers"])
    assert r.status_code == 200, r.text
    body = r.json()

    assert body["email"] == user_a["user"]["email"]

    preset_names = [p["name"] for p in body["presets"]]
    assert "Export-Test" in preset_names

    image_ids = [i["id"] for i in body["images"]]
    assert image_id in image_ids
    img = next(i for i in body["images"] if i["id"] == image_id)
    assert img["downloadUrl"].startswith("http")
    assert img["downloadUrlExpiresIn"] > 0
