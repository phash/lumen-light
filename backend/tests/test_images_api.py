"""HTTP-Tests fuer /api/v1/images — gegen MinIO + FastAPI."""
import urllib.request


def _put_to_url(url: str, data: bytes, content_type: str) -> None:
    req = urllib.request.Request(
        url, data=data, method="PUT",
        headers={"Content-Type": content_type},
    )
    with urllib.request.urlopen(req, timeout=5) as resp:
        assert 200 <= resp.status < 300


async def _init(client, headers, filename="test.jpg",
                content_type="image/jpeg", size=1024) -> dict:
    r = await client.post(
        "/api/v1/images",
        headers=headers,
        json={"filename": filename, "content_type": content_type, "size_bytes": size},
    )
    assert r.status_code == 201, r.text
    return r.json()


async def _full_upload(client, headers, payload=b"fake-image-bytes",
                       content_type="image/jpeg") -> str:
    init = await _init(
        client, headers, filename="up.jpg",
        content_type=content_type, size=len(payload),
    )
    _put_to_url(init["upload_url"], payload, content_type)
    confirm = await client.post(
        f"/api/v1/images/{init['id']}/confirm", headers=headers
    )
    assert confirm.status_code == 200, confirm.text
    return init["id"]


async def test_init_returns_url_and_id(client, user_a):
    body = await _init(client, user_a["headers"])
    assert "id" in body
    assert body["upload_url"].startswith("http")
    assert body["expires_in"] > 0


async def test_init_too_large_returns_413(client, user_a):
    r = await client.post(
        "/api/v1/images",
        headers=user_a["headers"],
        json={
            "filename": "huge.cr2",
            "content_type": "image/x-canon-cr2",
            "size_bytes": 300 * 1024 * 1024,
        },
    )
    assert r.status_code == 413


async def test_init_unsupported_type_returns_415(client, user_a):
    r = await client.post(
        "/api/v1/images",
        headers=user_a["headers"],
        json={
            "filename": "audio.mp3",
            "content_type": "audio/mpeg",
            "size_bytes": 1024,
        },
    )
    assert r.status_code == 415


async def test_confirm_marks_ready_after_upload(client, user_a):
    image_id = await _full_upload(client, user_a["headers"])
    listing = await client.get(
        "/api/v1/images?state=ready", headers=user_a["headers"]
    )
    assert listing.status_code == 200
    ids = [it["id"] for it in listing.json()]
    assert image_id in ids


async def test_confirm_409_if_not_uploaded(client, user_a):
    init = await _init(client, user_a["headers"])
    r = await client.post(
        f"/api/v1/images/{init['id']}/confirm", headers=user_a["headers"]
    )
    assert r.status_code == 409


async def test_confirm_413_if_actual_object_exceeds_limit(
    client, user_a, monkeypatch,
):
    """Pre-Signed PUT akzeptiert beliebige Body-Groesse. confirm() muss
    gegen settings.max_image_size_bytes pruefen, bei Verletzung das
    Object loeschen + DB-Eintrag wegraeumen + 413 zurueckgeben."""
    from app.config import settings as app_settings

    # Limit auf 100 Bytes runter, damit der Test nicht 200 MB Body braucht.
    monkeypatch.setattr(app_settings, "max_image_size_bytes", 100)

    init = await _init(
        client, user_a["headers"], filename="trick.jpg",
        content_type="image/jpeg", size=50,  # Browser-behauptet
    )
    # Echtes Object: 200 Bytes — ueber dem Limit.
    _put_to_url(init["upload_url"], b"x" * 200, "image/jpeg")

    confirm = await client.post(
        f"/api/v1/images/{init['id']}/confirm", headers=user_a["headers"]
    )
    assert confirm.status_code == 413, confirm.text

    # Image-Row muss weg sein (idempotenter Cleanup).
    listing = await client.get(
        "/api/v1/images?state=all", headers=user_a["headers"]
    )
    ids = [it["id"] for it in listing.json()]
    assert init["id"] not in ids


async def test_list_default_returns_only_ready(client, user_a):
    init_pending = await _init(
        client, user_a["headers"], filename="pending.jpg"
    )
    ready_id = await _full_upload(client, user_a["headers"])

    r = await client.get("/api/v1/images", headers=user_a["headers"])
    ids = [it["id"] for it in r.json()]
    assert ready_id in ids
    assert init_pending["id"] not in ids


async def test_list_state_pending(client, user_a):
    init_pending = await _init(
        client, user_a["headers"], filename="pending.jpg"
    )
    r = await client.get(
        "/api/v1/images?state=pending", headers=user_a["headers"]
    )
    ids = [it["id"] for it in r.json()]
    assert init_pending["id"] in ids


async def test_get_url_returns_signed(client, user_a):
    image_id = await _full_upload(client, user_a["headers"], payload=b"abc")
    r = await client.get(
        f"/api/v1/images/{image_id}/url", headers=user_a["headers"]
    )
    assert r.status_code == 200
    body = r.json()
    assert body["url"].startswith("http")
    assert body["expires_in"] > 0

    # URL liefert tatsaechlich den Inhalt
    with urllib.request.urlopen(body["url"], timeout=5) as resp:
        assert resp.read() == b"abc"


async def test_delete_removes_db_and_object(client, user_a):
    image_id = await _full_upload(client, user_a["headers"])
    r = await client.delete(
        f"/api/v1/images/{image_id}", headers=user_a["headers"]
    )
    assert r.status_code == 204

    listing = await client.get(
        "/api/v1/images?state=all", headers=user_a["headers"]
    )
    assert image_id not in [it["id"] for it in listing.json()]


async def test_user_b_cannot_get_user_a_image_url(client, user_a, user_b):
    image_id = await _full_upload(client, user_a["headers"])
    r = await client.get(
        f"/api/v1/images/{image_id}/url", headers=user_b["headers"]
    )
    assert r.status_code == 404


async def test_user_b_cannot_delete_user_a_image(client, user_a, user_b):
    image_id = await _full_upload(client, user_a["headers"])
    r = await client.delete(
        f"/api/v1/images/{image_id}", headers=user_b["headers"]
    )
    assert r.status_code == 404

    # User-A-Image existiert weiterhin
    listing = await client.get(
        "/api/v1/images", headers=user_a["headers"]
    )
    assert image_id in [it["id"] for it in listing.json()]


async def test_bucket_key_uses_user_prefix(client, user_a, db_session):
    """White-Box: pruefe direkt in der DB, dass der bucket_key mit user_id
    beginnt."""
    from sqlalchemy import select
    from app.models import Image

    init = await _init(client, user_a["headers"])

    db_session.expire_all()
    result = await db_session.execute(
        select(Image).where(Image.id == init["id"])
    )
    image = result.scalar_one()
    assert image.bucket_key.startswith(f"{user_a['user']['id']}/originals/")


async def test_unauthorized_init_returns_401(client):
    r = await client.post(
        "/api/v1/images",
        json={"filename": "x.jpg", "content_type": "image/jpeg", "size_bytes": 1},
    )
    assert r.status_code == 401
