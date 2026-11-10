"""M3: Marketplace-Vorschau wird serverseitig erzeugt (verkleinert, ohne
Metadaten) — das Original des Creators wird nie oeffentlich ausgeliefert."""
from __future__ import annotations

import io
import urllib.request
from uuid import UUID

import pytest
from PIL import Image as PILImage
from sqlalchemy import select

from app.models import Preset
from app.storage import ObjectNotFound, get_storage
from tests.images import make_jpeg, upload_image


ZERO_ADJ = {
    "exposure": 0.0, "contrast": 0.0, "highlights": 0.0, "shadows": 0.0,
    "whites": 0.0, "blacks": 0.0, "temperature": 0.0, "tint": 0.0,
    "vibrance": 0.0, "saturation": 0.0,
}


def _preset_body(name: str, image_id: str | None, visibility: str = "public") -> dict:
    body: dict = {
        "name": name,
        "adjustments": ZERO_ADJ,
        "visibility": visibility,
        "previewImageId": image_id,
    }
    if visibility == "public":
        body["genre"] = "portrait"
        body["description"] = "Vorschau-Test-Preset mit Beschreibung."
    return body


async def _preset_row(db_session, preset_id: str) -> Preset:
    db_session.expire_all()
    return (
        await db_session.execute(select(Preset).where(Preset.id == UUID(preset_id)))
    ).scalar_one()


def _get_object(key: str) -> bytes:
    storage = get_storage()
    return storage._client.get_object(Bucket=storage.bucket, Key=key)["Body"].read()


async def test_veroeffentlichen_erzeugt_verkleinerte_vorschau_ohne_metadaten(
    client, user_a, db_session
):
    image_id = await upload_image(
        client, user_a["headers"], data=make_jpeg(2000, 1000, with_metadata=True)
    )
    r = await client.post(
        "/api/v1/presets", headers=user_a["headers"], json=_preset_body("Vorschau", image_id)
    )
    assert r.status_code == 201, r.text
    preset = await _preset_row(db_session, r.json()["id"])
    assert preset.preview_key is not None
    assert preset.preview_key.startswith(f"{user_a['user']['id']}/previews/{preset.id}-")

    data = _get_object(preset.preview_key)
    img = PILImage.open(io.BytesIO(data))
    assert img.format == "JPEG"
    assert img.size == (1600, 800)
    assert "exif" not in img.info
    assert "icc_profile" not in img.info
    assert len(img.getexif()) == 0
    assert b"GeheimeKamera" not in data
    assert b"Mustermann" not in data


async def test_marketplace_liefert_nur_vorschau_nie_original(client, user_a, user_b):
    image_id = await upload_image(client, user_a["headers"])
    r = await client.post(
        "/api/v1/presets", headers=user_a["headers"], json=_preset_body("Nur-Vorschau", image_id)
    )
    assert r.status_code == 201, r.text
    preset_id = r.json()["id"]

    listing = await client.get("/api/v1/marketplace/presets", headers=user_b["headers"])
    item = next(i for i in listing.json()["items"] if i["id"] == preset_id)
    assert "/previews/" in item["previewUrl"]
    assert "/originals/" not in item["previewUrl"]

    detail = await client.get(f"/api/v1/marketplace/presets/{preset_id}")
    url = detail.json()["previewUrl"]
    assert "/previews/" in url and "/originals/" not in url
    with urllib.request.urlopen(url) as resp:  # noqa: S310 — Test gegen lokale S3
        assert resp.status == 200
        PILImage.open(io.BytesIO(resp.read())).verify()


async def test_privates_preset_bekommt_keine_vorschau(client, user_a, db_session):
    image_id = await upload_image(client, user_a["headers"])
    r = await client.post(
        "/api/v1/presets",
        headers=user_a["headers"],
        json=_preset_body("Privat-Vorschau", image_id, visibility="private"),
    )
    assert r.status_code == 201, r.text
    preset = await _preset_row(db_session, r.json()["id"])
    assert preset.preview_key is None


async def test_zurueckziehen_loescht_vorschau(client, user_a, db_session):
    image_id = await upload_image(client, user_a["headers"])
    r = await client.post(
        "/api/v1/presets", headers=user_a["headers"], json=_preset_body("Zurueck", image_id)
    )
    preset_id = r.json()["id"]
    key = (await _preset_row(db_session, preset_id)).preview_key
    assert key is not None

    r2 = await client.put(
        f"/api/v1/presets/{preset_id}",
        headers=user_a["headers"],
        json=_preset_body("Zurueck", image_id, visibility="private"),
    )
    assert r2.status_code == 200, r2.text
    assert (await _preset_row(db_session, preset_id)).preview_key is None
    with pytest.raises(ObjectNotFound):
        get_storage().head(key)


async def test_loeschen_des_presets_loescht_vorschau(client, user_a, db_session):
    image_id = await upload_image(client, user_a["headers"])
    r = await client.post(
        "/api/v1/presets", headers=user_a["headers"], json=_preset_body("Weg", image_id)
    )
    preset_id = r.json()["id"]
    key = (await _preset_row(db_session, preset_id)).preview_key
    assert key is not None

    d = await client.delete(f"/api/v1/presets/{preset_id}", headers=user_a["headers"])
    assert d.status_code == 204
    with pytest.raises(ObjectNotFound):
        get_storage().head(key)


async def test_vorschaubild_wechsel_erzeugt_neue_vorschau(client, user_a, db_session):
    red = await upload_image(client, user_a["headers"], data=make_jpeg(color=(255, 0, 0)))
    blue = await upload_image(client, user_a["headers"], data=make_jpeg(color=(0, 0, 255)))
    r = await client.post(
        "/api/v1/presets", headers=user_a["headers"], json=_preset_body("Wechsel", red)
    )
    preset_id = r.json()["id"]
    key = (await _preset_row(db_session, preset_id)).preview_key
    assert key is not None
    r2 = await client.put(
        f"/api/v1/presets/{preset_id}",
        headers=user_a["headers"],
        json=_preset_body("Wechsel", blue),
    )
    assert r2.status_code == 200, r2.text
    new_key = (await _preset_row(db_session, preset_id)).preview_key
    assert new_key is not None and new_key != key
    px = PILImage.open(io.BytesIO(_get_object(new_key))).convert("RGB").getpixel((5, 5))
    assert isinstance(px, tuple)
    assert px[2] > 200 and px[0] < 60


async def test_kaputtes_jpeg_als_vorschau_gibt_400(client, user_a):
    image_id = await upload_image(
        client, user_a["headers"], data=b"\xff\xd8\xff\xe0" + b"kein-echtes-jpeg" * 8
    )
    r = await client.post(
        "/api/v1/presets", headers=user_a["headers"], json=_preset_body("Kaputt", image_id)
    )
    assert r.status_code == 400, r.text
    assert "Vorschaubild ungültig" in r.json()["detail"]


async def test_dekompressionsbombe_wird_abgelehnt(client, user_a, monkeypatch):
    from app import previews

    monkeypatch.setattr(previews, "MAX_SOURCE_PIXELS", 100)
    image_id = await upload_image(client, user_a["headers"], data=make_jpeg(64, 48))
    r = await client.post(
        "/api/v1/presets", headers=user_a["headers"], json=_preset_body("Bombe", image_id)
    )
    assert r.status_code == 400, r.text
    assert "Vorschaubild ungültig" in r.json()["detail"]


async def test_pending_vorschaubild_gibt_preview_url_null(client, user_a):
    image_id = await upload_image(client, user_a["headers"], confirm=False)
    r = await client.post(
        "/api/v1/presets", headers=user_a["headers"], json=_preset_body("Pending", image_id)
    )
    assert r.status_code == 201, r.text
    detail = await client.get(f"/api/v1/marketplace/presets/{r.json()['id']}")
    assert detail.status_code == 200
    assert detail.json()["previewUrl"] is None


async def test_failed_vorschaubild_gibt_preview_url_null(client, user_a, db_session):
    from sqlalchemy import update

    from app.models import Image

    image_id = await upload_image(client, user_a["headers"], confirm=False)
    await db_session.execute(
        update(Image).where(Image.id == UUID(image_id)).values(upload_state="failed")
    )
    await db_session.commit()
    r = await client.post(
        "/api/v1/presets", headers=user_a["headers"], json=_preset_body("Failed", image_id)
    )
    assert r.status_code == 201, r.text
    listing = await client.get("/api/v1/marketplace/presets")
    item = next(i for i in listing.json()["items"] if i["id"] == r.json()["id"])
    assert item["previewUrl"] is None


async def test_bild_loeschen_entfernt_abgeleitete_vorschau(client, user_a, db_session):
    image_id = await upload_image(client, user_a["headers"])
    r = await client.post(
        "/api/v1/presets", headers=user_a["headers"], json=_preset_body("Bildweg", image_id)
    )
    preset_id = r.json()["id"]
    key = (await _preset_row(db_session, preset_id)).preview_key
    assert key is not None

    d = await client.delete(f"/api/v1/images/{image_id}", headers=user_a["headers"])
    assert d.status_code == 204
    with pytest.raises(ObjectNotFound):
        get_storage().head(key)
    detail = await client.get(f"/api/v1/marketplace/presets/{preset_id}")
    assert detail.json()["previewUrl"] is None


async def test_backfill_erzeugt_fehlende_vorschauen(client, user_a, db_session):
    """Bestandspresets (vor Migration 011) haben preview_key NULL — das
    Backfill-Skript erzeugt die Vorschau nachtraeglich."""
    from sqlalchemy import update

    from scripts.backfill_previews import backfill_previews

    image_id = await upload_image(client, user_a["headers"])
    r = await client.post(
        "/api/v1/presets", headers=user_a["headers"], json=_preset_body("Alt", image_id)
    )
    preset_id = r.json()["id"]
    await db_session.execute(
        update(Preset).where(Preset.id == UUID(preset_id)).values(preview_key=None)
    )
    await db_session.commit()

    result = await backfill_previews(db_session, get_storage())
    assert result.generated >= 1
    preset = await _preset_row(db_session, preset_id)
    assert preset.preview_key is not None
    assert get_storage().head(preset.preview_key) > 0
