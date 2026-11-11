"""H2a: Vorschaubilder pro Bild — Upload, Re-Encode, Ersetzen, Loeschen,
Listen-URLs, Rate-Limit, Backfill."""
from __future__ import annotations

import io
import re
import threading
import time
from uuid import UUID, uuid4

import pytest
from PIL import Image as PILImage
from sqlalchemy import select

from app import previews
from app.models import Image
from app.storage import ObjectNotFound, get_storage
from tests.images import make_jpeg, upload_image
from tests.test_review_preview import _get_object


KEY_RE = re.compile(
    r"^(?P<uid>[0-9a-f-]{36})/thumbs/(?P<iid>[0-9a-f-]{36})-(?P<v>[0-9a-f]{12})-(?P<edge>400|1600)\.jpg$"
)


def _png(width: int, height: int, mode: str = "RGBA") -> bytes:
    buf = io.BytesIO()
    PILImage.new(mode, (width, height), (10, 20, 30, 0) if mode == "RGBA" else (10, 20, 30)).save(
        buf, "PNG"
    )
    return buf.getvalue()


def _tiff(width: int, height: int) -> bytes:
    buf = io.BytesIO()
    PILImage.new("RGB", (width, height), (90, 90, 200)).save(buf, "TIFF")
    return buf.getvalue()


def _open(data: bytes) -> PILImage.Image:
    img = PILImage.open(io.BytesIO(data))
    img.load()
    return img


async def _put_thumb(client, headers, image_id: str, data: bytes, ctype: str = "image/jpeg"):
    return await client.put(
        f"/api/v1/images/{image_id}/thumbnail",
        headers=headers,
        files={"file": ("thumb.jpg", data, ctype)},
    )


async def _row(db_session, image_id: str) -> Image:
    db_session.expire_all()
    return (
        await db_session.execute(select(Image).where(Image.id == UUID(image_id)))
    ).scalar_one()


def _exists(key: str) -> bool:
    try:
        get_storage().head(key)
        return True
    except ObjectNotFound:
        return False


# ---------- render_thumbnails (Unit) ----------


def test_render_thumbnails_liefert_zwei_groessen_mit_seitenverhaeltnis():
    small, large = previews.render_thumbnails(
        make_jpeg(3200, 1600), max_pixels=previews.MAX_SOURCE_PIXELS
    )
    assert _open(small).size == (400, 200)
    assert _open(large).size == (1600, 800)


def test_render_thumbnails_skaliert_kleine_quelle_nicht_hoch():
    small, large = previews.render_thumbnails(make_jpeg(300, 200))
    assert _open(small).size == (300, 200)
    assert _open(large).size == (300, 200)


def test_render_thumbnails_entfernt_metadaten():
    small, large = previews.render_thumbnails(make_jpeg(800, 600, with_metadata=True))
    for data in (small, large):
        img = _open(data)
        assert img.format == "JPEG"
        assert len(img.getexif()) == 0
        assert "icc_profile" not in img.info
        assert b"GeheimeKamera" not in data


def test_render_thumbnails_png_mit_transparenz_wird_rgb():
    small, _ = previews.render_thumbnails(
        _png(50, 40), formats=previews.THUMB_BACKFILL_FORMATS
    )
    img = _open(small)
    assert img.mode == "RGB"
    # Transparenz auf Weiss gelegt, nicht schwarz.
    px = img.getpixel((5, 5))
    assert isinstance(px, tuple) and min(px) > 200


def test_render_thumbnails_tiff_nur_wenn_erlaubt():
    with pytest.raises(previews.PreviewError):
        previews.render_thumbnails(_tiff(40, 30))
    small, _ = previews.render_thumbnails(_tiff(40, 30), previews.THUMB_BACKFILL_FORMATS)
    assert _open(small).size == (40, 30)


def test_build_thumbnails_teilt_den_build_semaphore(monkeypatch):
    sem = threading.BoundedSemaphore(1)
    sem.acquire()
    monkeypatch.setattr(previews, "_BUILD_SEMAPHORE", sem)
    monkeypatch.setattr(previews, "BUILD_SLOT_TIMEOUT_SECONDS", 0.05)
    with pytest.raises(previews.PreviewBusy):
        previews.build_thumbnails(make_jpeg(20, 20))


def test_presign_von_1000_urls_ist_lokal_und_schnell():
    """GET /images signiert bis zu 2 x 500 URLs pro Seite — reine HMAC-
    Rechnung ohne Netzwerk (lokal ~15 ms fuer 1000). Grosszuegige Grenze
    gegen Ausreisser in CI, faengt aber einen Rueckfall auf boto3 (~0.2 s)
    auf schnellen Maschinen nicht zwingend — der Byte-Vergleich in
    test_s3_presign.py sichert die Semantik."""
    storage = get_storage()
    uid = uuid4()
    start = time.perf_counter()
    for _ in range(1000):
        storage.presign_get(f"{uid}/thumbs/{uuid4()}-abcdefabcdef-400.jpg")
    assert time.perf_counter() - start < 1.0


# ---------- PUT /images/{id}/thumbnail ----------


async def test_upload_speichert_zwei_reencodierte_groessen(client, user_a, db_session):
    image_id = await upload_image(client, user_a["headers"])
    r = await _put_thumb(
        client, user_a["headers"], image_id, make_jpeg(2000, 1000, with_metadata=True)
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["id"] == image_id
    assert body["thumbUrl"] and body["previewUrl"]

    row = await _row(db_session, image_id)
    assert row.thumb_key and row.preview_key
    m_small = KEY_RE.match(row.thumb_key)
    m_large = KEY_RE.match(row.preview_key)
    assert m_small and m_large
    assert m_small["uid"] == user_a["user"]["id"]
    assert m_small["iid"] == image_id
    assert m_small["edge"] == "400" and m_large["edge"] == "1600"
    assert m_small["v"] == m_large["v"]

    small = _open(_get_object(row.thumb_key))
    large = _open(_get_object(row.preview_key))
    assert small.size == (400, 200)
    assert large.size == (1600, 800)
    assert len(large.getexif()) == 0
    assert "icc_profile" not in large.info


async def test_upload_lehnt_png_ab(client, user_a):
    """PNG kann trotz 1 MB zu riesigen Pixelmengen aufblaehen -> nur JPEG."""
    image_id = await upload_image(client, user_a["headers"])
    r = await _put_thumb(client, user_a["headers"], image_id, _png(120, 80), "image/png")
    assert r.status_code == 415, r.text


async def test_upload_mit_zu_vielen_pixeln_gibt_422(client, user_a):
    """Pixel-Grenze greift vor dem Dekodieren (Decompression-Bomb)."""
    image_id = await upload_image(client, user_a["headers"])
    big = make_jpeg(4000, 1200)
    assert len(big) < previews.THUMB_UPLOAD_MAX_BYTES
    r = await _put_thumb(client, user_a["headers"], image_id, big, "image/jpeg")
    assert r.status_code == 422, r.text


def test_render_thumbnails_upload_grenze_vor_dekodieren():
    with pytest.raises(previews.PreviewError):
        previews.render_thumbnails(make_jpeg(2100, 2100))


async def test_upload_kein_bild_gibt_415(client, user_a, db_session):
    image_id = await upload_image(client, user_a["headers"])
    r = await _put_thumb(
        client, user_a["headers"], image_id, b"<html><script>alert(1)</script></html>", "image/jpeg"
    )
    assert r.status_code == 415
    assert (await _row(db_session, image_id)).thumb_key is None


async def test_upload_kaputtes_jpeg_gibt_422(client, user_a):
    image_id = await upload_image(client, user_a["headers"])
    r = await _put_thumb(client, user_a["headers"], image_id, b"\xff\xd8\xff\xe0" + b"x" * 500)
    assert r.status_code == 422


async def test_upload_tiff_wird_abgelehnt(client, user_a):
    image_id = await upload_image(client, user_a["headers"])
    r = await _put_thumb(client, user_a["headers"], image_id, _tiff(40, 30), "image/tiff")
    assert r.status_code == 415


async def test_upload_ueber_1_mb_gibt_413(client, user_a):
    image_id = await upload_image(client, user_a["headers"])
    big = b"\xff\xd8\xff\xe0" + b"\x00" * previews.THUMB_UPLOAD_MAX_BYTES
    r = await _put_thumb(client, user_a["headers"], image_id, big)
    assert r.status_code == 413


async def test_upload_ohne_datei_gibt_422(client, user_a):
    image_id = await upload_image(client, user_a["headers"])
    r = await client.put(
        f"/api/v1/images/{image_id}/thumbnail",
        headers=user_a["headers"],
        files={"other": ("x.jpg", make_jpeg(), "image/jpeg")},
    )
    assert r.status_code == 422


async def test_upload_auf_fremdes_bild_gibt_404(client, user_a, user_b, db_session):
    image_id = await upload_image(client, user_a["headers"])
    r = await _put_thumb(client, user_b["headers"], image_id, make_jpeg())
    assert r.status_code == 404
    assert (await _row(db_session, image_id)).thumb_key is None


async def test_upload_auf_unbekanntes_bild_gibt_404(client, user_a):
    r = await _put_thumb(client, user_a["headers"], str(uuid4()), make_jpeg())
    assert r.status_code == 404


async def test_upload_auf_unbestaetigtes_bild_gibt_409(client, user_a):
    image_id = await upload_image(client, user_a["headers"], confirm=False)
    r = await _put_thumb(client, user_a["headers"], image_id, make_jpeg())
    assert r.status_code == 409


async def test_ersetzen_loescht_alten_satz(client, user_a, db_session):
    image_id = await upload_image(client, user_a["headers"])
    assert (await _put_thumb(client, user_a["headers"], image_id, make_jpeg(800, 600))).status_code == 200
    first = await _row(db_session, image_id)
    old = (first.thumb_key, first.preview_key)
    assert all(old) and all(_exists(k) for k in old)  # type: ignore[arg-type]

    assert (await _put_thumb(client, user_a["headers"], image_id, make_jpeg(600, 800))).status_code == 200
    second = await _row(db_session, image_id)
    assert (second.thumb_key, second.preview_key) != old
    assert _exists(second.thumb_key or "") and _exists(second.preview_key or "")
    assert not any(_exists(k) for k in old)  # type: ignore[arg-type]


async def test_thumbnail_upload_rate_limit_30_pro_minute(client, user_a, monkeypatch):
    from app.rate_limit import limiter

    image_id = await upload_image(client, user_a["headers"])
    monkeypatch.setattr(limiter, "enabled", True)
    limiter.reset()
    try:
        codes = []
        # Billig: kein Bild -> 415, zaehlt trotzdem gegen das Limit.
        for _ in range(31):
            r = await _put_thumb(client, user_a["headers"], image_id, b"nope")
            codes.append(r.status_code)
        assert codes[:30] == [415] * 30
        assert codes[30] == 429
    finally:
        limiter.reset()


# ---------- ImageOut / Liste ----------


@pytest.mark.parametrize("threshold", [100, 1], ids=["event-loop", "threadpool"])
async def test_liste_liefert_thumb_urls_oder_null(client, user_a, monkeypatch, threshold):
    # threshold=1 erzwingt das Signieren im Threadpool (sonst erst ab 100 Bildern).
    from app.routers import images as images_router

    monkeypatch.setattr(images_router, "_SIGN_OFFLOAD_THRESHOLD", threshold)
    with_thumb = await upload_image(client, user_a["headers"])
    without = await upload_image(client, user_a["headers"])
    assert (await _put_thumb(client, user_a["headers"], with_thumb, make_jpeg(500, 500))).status_code == 200

    r = await client.get("/api/v1/images", headers=user_a["headers"])
    assert r.status_code == 200
    by_id = {i["id"]: i for i in r.json()}
    assert by_id[with_thumb]["thumbUrl"].startswith("http")
    assert by_id[with_thumb]["previewUrl"].startswith("http")
    assert "/thumbs/" in by_id[with_thumb]["thumbUrl"]
    assert by_id[without]["thumbUrl"] is None
    assert by_id[without]["previewUrl"] is None
    # Signierte URL liefert das 400er-JPEG aus (kein Attachment noetig).
    import httpx

    got = httpx.get(by_id[with_thumb]["thumbUrl"], timeout=10)
    assert got.status_code == 200
    assert _open(got.content).size == (400, 400)


# ---------- Loeschen ----------


async def test_bild_loeschen_entfernt_beide_vorschauen(client, user_a, db_session):
    image_id = await upload_image(client, user_a["headers"])
    assert (await _put_thumb(client, user_a["headers"], image_id, make_jpeg())).status_code == 200
    row = await _row(db_session, image_id)
    keys = [row.thumb_key, row.preview_key]
    assert all(keys)

    r = await client.delete(f"/api/v1/images/{image_id}", headers=user_a["headers"])
    assert r.status_code == 204
    assert not any(_exists(k) for k in keys)  # type: ignore[arg-type]


async def test_delete_me_prefix_purge_erfasst_thumbs(client, user_a, db_session):
    """DELETE /me purgt <uid>/ — damit auch <uid>/thumbs/ (kein eigener
    Loeschpfad noetig)."""
    image_id = await upload_image(client, user_a["headers"])
    assert (await _put_thumb(client, user_a["headers"], image_id, make_jpeg())).status_code == 200
    row = await _row(db_session, image_id)
    uid = user_a["user"]["id"]
    assert row.thumb_key and row.thumb_key.startswith(f"{uid}/thumbs/")
    assert get_storage().list_objects(f"{uid}/thumbs/")

    r = await client.delete("/api/v1/auth/me", headers=user_a["headers"])
    assert r.status_code == 204
    assert get_storage().list_objects(f"{uid}/thumbs/") == []


# ---------- Backfill ----------


async def test_backfill_erzeugt_vorschauen_idempotent(client, user_a, db_session):
    from scripts.backfill_thumbnails import backfill_thumbnails

    jpg = await upload_image(client, user_a["headers"], data=make_jpeg(2400, 1200))
    png = await upload_image(
        client, user_a["headers"], data=_png(300, 200, "RGB"),
        content_type="image/png", filename="a.png",
    )
    tif = await upload_image(
        client, user_a["headers"], data=_tiff(500, 250),
        content_type="image/tiff", filename="a.tif",
    )
    # Fake-DNG (TIFF-Header): RAW ist kein Kandidat.
    dng = await upload_image(
        client, user_a["headers"], data=b"II*\x00\x08\x00\x00\x00" + b"\x00" * 64,
        content_type="image/x-adobe-dng", filename="a.dng",
    )
    # Kaputtes JPEG: wird gezaehlt und uebersprungen.
    broken = await upload_image(
        client, user_a["headers"], data=b"\xff\xd8\xff\xe0" + b"y" * 300, filename="b.jpg"
    )
    # Bereits versorgt: bleibt unangetastet.
    done = await upload_image(client, user_a["headers"])
    assert (await _put_thumb(client, user_a["headers"], done, make_jpeg())).status_code == 200
    done_keys = ((await _row(db_session, done)).thumb_key, (await _row(db_session, done)).preview_key)

    storage = get_storage()
    result = await backfill_thumbnails(db_session, storage)
    assert result.generated == 3
    assert result.skipped == 1
    assert result.candidates == 4

    for iid, size in ((jpg, (400, 200)), (png, (300, 200)), (tif, (400, 200))):
        row = await _row(db_session, iid)
        assert row.thumb_key and KEY_RE.match(row.thumb_key)
        assert _open(_get_object(row.thumb_key)).size == size
    assert (await _row(db_session, dng)).thumb_key is None
    assert (await _row(db_session, broken)).thumb_key is None
    row_done = await _row(db_session, done)
    assert (row_done.thumb_key, row_done.preview_key) == done_keys

    again = await backfill_thumbnails(db_session, storage)
    assert again.generated == 0
    assert again.candidates == 1  # nur das kaputte JPEG
