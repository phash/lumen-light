"""Review 2026-11 r2: Marketplace-Vorschau — Speicher-DoS (M1), Formate (L6/L7),
Owner-Filter (L8), Namenspruefung vor dem Bauen (L9), versionierte Keys."""
from __future__ import annotations

import io
import re
import threading
from uuid import UUID

import pytest
from fastapi import HTTPException
from PIL import Image as PILImage
from sqlalchemy import select, update

from app import previews
from app.models import Image, Preset
from app.storage import ObjectNotFound, get_storage
from tests.images import FAKE_ICC, make_jpeg, upload_image
from tests.test_review_preview import _get_object, _preset_body, _preset_row


# ---------- render_preview (reine Unit-Tests) ----------


def _jpeg_with_orientation(width: int, height: int, orientation: int) -> bytes:
    img = PILImage.new("RGB", (width, height), (10, 200, 30))
    exif = PILImage.Exif()
    exif[0x0112] = orientation
    buf = io.BytesIO()
    img.save(buf, "JPEG", exif=exif.tobytes())
    return buf.getvalue()


def _open(data: bytes) -> PILImage.Image:
    img = PILImage.open(io.BytesIO(data))
    img.load()
    return img


def test_exif_orientierung_6_wird_angewendet():
    out = _open(previews.render_preview(_jpeg_with_orientation(2000, 1000, 6)))
    # Drehung um 90 Grad: 1000x2000, dann auf 1600 lange Kante verkleinert.
    assert out.size == (800, 1600)
    assert len(out.getexif()) == 0


def test_cmyk_jpeg_wird_rgb_ohne_icc():
    img = PILImage.new("CMYK", (120, 80), (0, 100, 200, 0))
    buf = io.BytesIO()
    img.save(buf, "JPEG", icc_profile=FAKE_ICC)
    out = _open(previews.render_preview(buf.getvalue()))
    assert out.mode == "RGB"
    assert "icc_profile" not in out.info


def test_png_wird_abgelehnt():
    buf = io.BytesIO()
    PILImage.new("RGB", (20, 20)).save(buf, "PNG")
    with pytest.raises(previews.PreviewError):
        previews.render_preview(buf.getvalue())


def test_kleines_bild_wird_nicht_hochskaliert():
    out = _open(previews.render_preview(make_jpeg(500, 300)))
    assert out.size == (500, 300)


def test_header_mit_riesigen_abmessungen_wird_ohne_monkeypatch_abgelehnt():
    data = bytearray(make_jpeg(16, 16))
    sof = data.find(b"\xff\xc0")
    assert sof != -1
    # SOF0: Marker(2) Laenge(2) Praezision(1) Hoehe(2) Breite(2)
    data[sof + 5:sof + 7] = (20000).to_bytes(2, "big")
    data[sof + 7:sof + 9] = (20000).to_bytes(2, "big")
    with pytest.raises(previews.PreviewError):
        previews.render_preview(bytes(data))


def test_mpo_wird_akzeptiert_und_nutzt_erstes_bild():
    first = PILImage.new("RGB", (300, 200), (255, 0, 0))
    second = PILImage.new("RGB", (300, 200), (0, 0, 255))
    buf = io.BytesIO()
    first.save(buf, "MPO", save_all=True, append_images=[second])
    assert _open(buf.getvalue()).format == "MPO"
    out = _open(previews.render_preview(buf.getvalue()))
    assert out.format == "JPEG"
    assert out.size == (300, 200)
    px = out.convert("RGB").getpixel((10, 10))
    assert isinstance(px, tuple)
    assert px[0] > 200 and px[2] < 60


def test_decompression_bomb_grenze_ist_global_gesetzt():
    assert PILImage.MAX_IMAGE_PIXELS == previews.MAX_SOURCE_PIXELS


def test_quellgroesse_hoechstens_25_mb():
    assert previews.MAX_SOURCE_BYTES <= 25 * 1024 * 1024


def test_build_rate_limit_pro_user(monkeypatch):
    from uuid import uuid4

    from app.rate_limit import limiter

    monkeypatch.setattr(limiter, "enabled", True)
    uid = uuid4()
    for _ in range(previews.PREVIEW_BUILDS_PER_MINUTE):
        previews.check_preview_build_rate(uid)
    with pytest.raises(HTTPException) as exc:
        previews.check_preview_build_rate(uid)
    assert exc.value.status_code == 429
    # Anderer User hat eigenes Kontingent.
    previews.check_preview_build_rate(uuid4())


def test_build_ist_prozessweit_begrenzt(monkeypatch):
    sem = threading.BoundedSemaphore(1)
    sem.acquire()
    monkeypatch.setattr(previews, "_BUILD_SEMAPHORE", sem)
    monkeypatch.setattr(previews, "BUILD_SLOT_TIMEOUT_SECONDS", 0.01)
    with pytest.raises(previews.PreviewBusy):
        previews._build_preview(get_storage(), "egal", "egal")
    sem.release()


# ---------- API-Pfade ----------


async def test_zu_grosse_quelle_gibt_400(client, user_a, monkeypatch):
    image_id = await upload_image(client, user_a["headers"], data=make_jpeg(400, 300))
    monkeypatch.setattr(previews, "MAX_SOURCE_BYTES", 100)
    r = await client.post(
        "/api/v1/presets", headers=user_a["headers"], json=_preset_body("Gross", image_id)
    )
    assert r.status_code == 400, r.text
    assert "Vorschaubild ungültig" in r.json()["detail"]


async def test_ausgelastete_vorschau_gibt_503(client, user_a, monkeypatch):
    image_id = await upload_image(client, user_a["headers"])
    sem = threading.BoundedSemaphore(1)
    sem.acquire()
    monkeypatch.setattr(previews, "_BUILD_SEMAPHORE", sem)
    monkeypatch.setattr(previews, "BUILD_SLOT_TIMEOUT_SECONDS", 0.01)
    r = await client.post(
        "/api/v1/presets", headers=user_a["headers"], json=_preset_body("Busy", image_id)
    )
    sem.release()
    assert r.status_code == 503, r.text


async def test_vorschau_loeschfehler_loggt_nur(client, user_a, db_session, monkeypatch):
    image_id = await upload_image(client, user_a["headers"])
    r = await client.post(
        "/api/v1/presets", headers=user_a["headers"], json=_preset_body("LoeschFehler", image_id)
    )
    preset_id = r.json()["id"]
    storage = get_storage()
    real_delete = storage.delete

    def _fail_previews(key: str) -> None:
        if "/previews/" in key:
            raise RuntimeError("S3 kaputt")
        real_delete(key)

    monkeypatch.setattr(storage, "delete", _fail_previews)
    # caplog greift nicht: alembic.fileConfig deaktiviert bestehende Logger.
    warnings: list[str] = []
    monkeypatch.setattr(
        previews.logger, "warning", lambda msg, *a: warnings.append(msg % a)
    )
    r2 = await client.put(
        f"/api/v1/presets/{preset_id}",
        headers=user_a["headers"],
        json=_preset_body("LoeschFehler", image_id, visibility="private"),
    )
    assert r2.status_code == 200, r2.text
    assert any("konnte nicht geloescht werden" in w for w in warnings)
    d = await client.delete(f"/api/v1/presets/{preset_id}", headers=user_a["headers"])
    assert d.status_code == 204


async def test_vorschau_key_ist_versioniert_und_alter_wird_nach_wechsel_geloescht(
    client, user_a, db_session
):
    red = await upload_image(client, user_a["headers"], data=make_jpeg(color=(255, 0, 0)))
    blue = await upload_image(client, user_a["headers"], data=make_jpeg(color=(0, 0, 255)))
    r = await client.post(
        "/api/v1/presets", headers=user_a["headers"], json=_preset_body("Version", red)
    )
    preset_id = r.json()["id"]
    old_key = (await _preset_row(db_session, preset_id)).preview_key
    assert old_key is not None
    assert re.fullmatch(
        rf"{user_a['user']['id']}/previews/{preset_id}-[0-9a-f]{{12}}\.jpg", old_key
    )
    r2 = await client.put(
        f"/api/v1/presets/{preset_id}",
        headers=user_a["headers"],
        json=_preset_body("Version", blue),
    )
    assert r2.status_code == 200, r2.text
    new_key = (await _preset_row(db_session, preset_id)).preview_key
    assert new_key is not None and new_key != old_key
    with pytest.raises(ObjectNotFound):
        get_storage().head(old_key)
    assert get_storage().head(new_key) > 0


async def test_namenskonflikt_wird_vor_dem_bauen_erkannt(client, user_a, monkeypatch):
    image_id = await upload_image(client, user_a["headers"])
    r = await client.post(
        "/api/v1/presets", headers=user_a["headers"], json=_preset_body("Doppelt", image_id)
    )
    assert r.status_code == 201, r.text
    calls = {"n": 0}
    real = previews._build_preview

    def _count(*args, **kwargs):
        calls["n"] += 1
        return real(*args, **kwargs)

    monkeypatch.setattr(previews, "_build_preview", _count)
    r2 = await client.post(
        "/api/v1/presets", headers=user_a["headers"], json=_preset_body("Doppelt", image_id)
    )
    assert r2.status_code == 409, r2.text
    assert calls["n"] == 0


async def test_namenskonflikt_beim_update_laesst_alte_vorschau_stehen(
    client, user_a, db_session, monkeypatch
):
    red = await upload_image(client, user_a["headers"], data=make_jpeg(color=(255, 0, 0)))
    blue = await upload_image(client, user_a["headers"], data=make_jpeg(color=(0, 0, 255)))
    await client.post(
        "/api/v1/presets", headers=user_a["headers"], json=_preset_body("Belegt", red)
    )
    r = await client.post(
        "/api/v1/presets", headers=user_a["headers"], json=_preset_body("Eigen", red)
    )
    preset_id = r.json()["id"]
    old_key = (await _preset_row(db_session, preset_id)).preview_key
    calls = {"n": 0}
    real = previews._build_preview

    def _count(*args, **kwargs):
        calls["n"] += 1
        return real(*args, **kwargs)

    monkeypatch.setattr(previews, "_build_preview", _count)
    r2 = await client.put(
        f"/api/v1/presets/{preset_id}",
        headers=user_a["headers"],
        json=_preset_body("Belegt", blue),
    )
    assert r2.status_code == 409, r2.text
    assert calls["n"] == 0
    assert (await _preset_row(db_session, preset_id)).preview_key == old_key
    assert get_storage().head(old_key) > 0


async def test_fremdes_bild_erzeugt_keine_vorschau(client, user_a, user_b, db_session):
    """L8: sync_preset_preview filtert auf den Preset-Owner."""
    from scripts.backfill_previews import backfill_previews

    own = await upload_image(client, user_a["headers"])
    foreign = await upload_image(client, user_b["headers"])
    r = await client.post(
        "/api/v1/presets", headers=user_a["headers"], json=_preset_body("Fremd", own)
    )
    preset_id = r.json()["id"]
    await db_session.execute(
        update(Preset)
        .where(Preset.id == UUID(preset_id))
        .values(preview_image_id=UUID(foreign), preview_key=None)
    )
    await db_session.commit()
    await backfill_previews(db_session, get_storage())
    assert (await _preset_row(db_session, preset_id)).preview_key is None


async def test_backfill_kaputt_und_gut(client, user_a, db_session):
    from scripts.backfill_previews import backfill_previews

    good = await upload_image(client, user_a["headers"])
    broken = await upload_image(
        client, user_a["headers"], data=b"\xff\xd8\xff\xe0" + b"kein-echtes-jpeg" * 8
    )
    r = await client.post(
        "/api/v1/presets", headers=user_a["headers"], json=_preset_body("BfGut", good)
    )
    good_id = r.json()["id"]
    r2 = await client.post(
        "/api/v1/presets",
        headers=user_a["headers"],
        json=_preset_body("BfKaputt", good),
    )
    broken_id = r2.json()["id"]
    # Bestandsstand vor Migration 011 simulieren: keine Vorschauen; das
    # kaputte Bild als Vorschaubild direkt in der DB setzen.
    await db_session.execute(
        update(Preset)
        .where(Preset.id.in_([UUID(good_id), UUID(broken_id)]))
        .values(preview_key=None)
    )
    await db_session.execute(
        update(Preset)
        .where(Preset.id == UUID(broken_id))
        .values(preview_image_id=UUID(broken))
    )
    await db_session.commit()
    # Nur die beiden eigenen Presets betrachten (andere Tests teilen die DB nicht,
    # SAVEPOINT-Rollback isoliert).
    first = await backfill_previews(db_session, get_storage())
    assert (first.candidates, first.generated, first.skipped) == (2, 1, 1)
    second = await backfill_previews(db_session, get_storage())
    assert second.candidates == 0
    assert (await _preset_row(db_session, good_id)).preview_key is not None
    img = (
        await db_session.execute(select(Image).where(Image.id == UUID(broken)))
    ).scalar_one()
    assert img is not None
