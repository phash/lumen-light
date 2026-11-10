"""Review 2026-11: Batch-Apply-Grenzen, Preview-Validierung bei PUT,
Rate-Limit, RAW-Magic-Bytes, Content-Disposition, Isolation, Sperre."""
from __future__ import annotations

import urllib.request
from uuid import UUID

import pytest
from sqlalchemy import update

from app.models import User
from tests.images import make_jpeg, upload_image


ZERO_ADJ = {
    "exposure": 0.0, "contrast": 0.0, "highlights": 0.0, "shadows": 0.0,
    "whites": 0.0, "blacks": 0.0, "temperature": 0.0, "tint": 0.0,
    "vibrance": 0.0, "saturation": 0.0,
}


async def _preset(client, headers, name: str, **extra) -> str:
    body = {"name": name, "adjustments": ZERO_ADJ, **extra}
    r = await client.post("/api/v1/presets", headers=headers, json=body)
    assert r.status_code == 201, r.text
    return r.json()["id"]


# ---------- Batch-Apply ----------


async def test_batch_apply_mit_fremdem_preset_gibt_404_ohne_mutation(client, user_a, user_b):
    b_img = await upload_image(client, user_b["headers"])
    state = {"adjustments": {**ZERO_ADJ, "exposure": 0.3}}
    put = await client.put(f"/api/v1/images/{b_img}/edit", headers=user_b["headers"], json=state)
    assert put.status_code == 204
    a_preset = await _preset(client, user_a["headers"], "Fremd", adjustments={**ZERO_ADJ, "contrast": 0.9})

    r = await client.post(
        f"/api/v1/presets/{a_preset}/apply",
        headers=user_b["headers"],
        json={"imageIds": [b_img], "groups": ["tone"]},
    )
    assert r.status_code == 404
    got = await client.get(f"/api/v1/images/{b_img}/edit", headers=user_b["headers"])
    assert got.json()["adjustments"]["exposure"] == pytest.approx(0.3)
    assert got.json()["adjustments"]["contrast"] == pytest.approx(0.0)


async def test_batch_apply_mit_pending_bild_gibt_400(client, user_a):
    pending = await upload_image(client, user_a["headers"], confirm=False)
    preset = await _preset(client, user_a["headers"], "PendingZiel")
    r = await client.post(
        f"/api/v1/presets/{preset}/apply",
        headers=user_a["headers"],
        json={"imageIds": [pending], "groups": ["tone"]},
    )
    assert r.status_code == 400


# ---------- PUT /presets: Vorschaubild-Validierung ----------


@pytest.mark.parametrize("visibility", ["private", "public"])
async def test_put_mit_fremdem_vorschaubild_gibt_400(client, user_a, user_b, visibility):
    foreign = await upload_image(client, user_b["headers"])
    pid = await _preset(client, user_a["headers"], f"Put-{visibility}")
    body: dict = {"name": f"Put-{visibility}", "adjustments": ZERO_ADJ,
                  "visibility": visibility, "previewImageId": foreign}
    if visibility == "public":
        body |= {"genre": "portrait", "description": "Fremdes Cover per PUT."}
    r = await client.put(f"/api/v1/presets/{pid}", headers=user_a["headers"], json=body)
    assert r.status_code == 400, r.text


async def test_put_public_mit_png_vorschau_gibt_400(client, user_a):
    png = await upload_image(
        client, user_a["headers"], data=b"\x89PNG\r\n\x1a\n" + b"\x00" * 16,
        content_type="image/png", filename="c.png",
    )
    pid = await _preset(client, user_a["headers"], "PngPut")
    r = await client.put(
        f"/api/v1/presets/{pid}", headers=user_a["headers"],
        json={"name": "PngPut", "adjustments": ZERO_ADJ, "visibility": "public",
              "genre": "portrait", "description": "PNG-Cover per PUT.",
              "previewImageId": png},
    )
    assert r.status_code == 400, r.text


# ---------- Rate-Limit greift wirklich ----------


async def test_rate_limit_feuert_beim_sechsten_feedback(client, user_a, monkeypatch):
    from app.rate_limit import limiter

    monkeypatch.setattr(limiter, "enabled", True)
    limiter.reset()
    try:
        # JWK-Cache waermen, damit alle Feedback-Calls im selben User-Bucket landen.
        assert (await client.get("/api/v1/auth/me", headers=user_a["headers"])).status_code == 200
        codes = []
        for i in range(6):
            r = await client.post(
                "/api/v1/feedback", headers=user_a["headers"],
                json={"kind": "idea", "message": f"Rate-Limit-Test Nummer {i}", "page": "/"},
            )
            codes.append(r.status_code)
        assert codes[:5] == [201] * 5
        assert codes[5] == 429
    finally:
        limiter.reset()


# ---------- Magic-Bytes ----------


_TIFF_II = b"II*\x00\x08\x00\x00\x00" + b"\x00" * 24
_TIFF_MM = b"MM\x00*\x00\x00\x00\x08" + b"\x00" * 24
_HTML = b"<html><script>alert(1)</script></html>"


@pytest.mark.parametrize(
    ("content_type", "data", "ok"),
    [
        ("image/png", b"\x89PNG\r\n\x1a\n" + b"\x00" * 16, True),
        ("image/png", _HTML, False),
        ("image/tiff", _TIFF_II, True),
        ("image/tiff", _TIFF_MM, True),
        ("image/tiff", _HTML, False),
        ("image/x-canon-cr2", _TIFF_II, True),
        ("image/x-nikon-nef", _TIFF_MM, True),
        ("image/x-sony-arw", _TIFF_II, True),
        ("image/x-adobe-dng", _TIFF_II, True),
        ("image/x-canon-cr3", b"\x00\x00\x00\x18ftypcrx \x00\x00\x00\x01" + b"\x00" * 16, True),
        ("image/x-fuji-raf", b"FUJIFILMCCD-RAW 0201" + b"\x00" * 16, True),
        ("image/x-canon-cr2", _HTML, False),
        ("image/x-canon-cr3", _HTML, False),
        ("image/x-fuji-raf", _HTML, False),
        ("image/x-adobe-dng", _HTML, False),
    ],
)
async def test_magic_bytes_pruefung(client, user_a, content_type, data, ok):
    image_id = await upload_image(
        client, user_a["headers"], data=data, content_type=content_type,
        filename="m.bin", confirm=False,
    )
    r = await client.post(f"/api/v1/images/{image_id}/confirm", headers=user_a["headers"])
    assert r.status_code == (200 if ok else 415), r.text


async def test_original_download_url_erzwingt_attachment(client, user_a):
    image_id = await upload_image(client, user_a["headers"])
    r = await client.get(f"/api/v1/images/{image_id}/url", headers=user_a["headers"])
    with urllib.request.urlopen(r.json()["url"]) as resp:  # noqa: S310 — lokale S3
        assert resp.headers.get("Content-Disposition", "").startswith("attachment")


# ---------- Isolation + Sperre ----------


async def test_images_liste_enthaelt_keine_fremden_bilder(client, user_a, user_b):
    a_ids = {await upload_image(client, user_a["headers"]) for _ in range(2)}
    b_id = await upload_image(client, user_b["headers"])
    b_list = await client.get("/api/v1/images?state=all", headers=user_b["headers"])
    ids = {i["id"] for i in b_list.json()}
    assert b_id in ids
    assert ids.isdisjoint(a_ids)


async def test_gesperrter_user_kann_nicht_schreiben(client, user_a, user_b, db_session):
    a_img = await upload_image(client, user_a["headers"])
    pub = await client.post(
        "/api/v1/presets", headers=user_a["headers"],
        json={"name": "PubSperre", "adjustments": ZERO_ADJ, "visibility": "public",
              "genre": "portrait", "description": "Fuer den Sperr-Test.",
              "previewImageId": a_img},
    )
    assert pub.status_code == 201, pub.text
    b_img = await upload_image(client, user_b["headers"])
    await db_session.execute(
        update(User).where(User.id == UUID(user_b["user"]["id"])).values(is_disabled=True)
    )
    await db_session.commit()

    h = user_b["headers"]
    r1 = await client.post("/api/v1/presets", headers=h, json={"name": "X", "adjustments": ZERO_ADJ})
    r2 = await client.put(f"/api/v1/images/{b_img}/edit", headers=h, json={"adjustments": ZERO_ADJ})
    r3 = await client.post(
        "/api/v1/images", headers=h,
        json={"filename": "x.jpg", "contentType": "image/jpeg", "sizeBytes": 10},
    )
    r4 = await client.post(f"/api/v1/marketplace/presets/{pub.json()['id']}/apply", headers=h)
    assert [r1.status_code, r2.status_code, r3.status_code, r4.status_code] == [403] * 4


async def test_put_image_edit_upsert_ist_idempotent(client, user_a):
    """L1: Upsert per INSERT ... ON CONFLICT — zweimal hintereinander ohne
    Fehler, der zweite Stand gewinnt."""
    image_id = await upload_image(client, user_a["headers"], data=make_jpeg())
    for exp in (0.1, 0.7):
        r = await client.put(
            f"/api/v1/images/{image_id}/edit", headers=user_a["headers"],
            json={"adjustments": {**ZERO_ADJ, "exposure": exp}},
        )
        assert r.status_code == 204
    got = await client.get(f"/api/v1/images/{image_id}/edit", headers=user_a["headers"])
    assert got.json()["adjustments"]["exposure"] == pytest.approx(0.7)
