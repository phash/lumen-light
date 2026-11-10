"""Serverseitige Marketplace-Vorschau (Review 2026-11, M3).

Oeffentliche Presets zeigen im Marketplace ein Vorschaubild. Frueher wurde
dafuer das Original des Creators (volle Aufloesung, ggf. mit Metadaten, die
der Client-EXIF-Strip verpasst hat) per Pre-Signed GET ausgeliefert. Jetzt
erzeugt der Server beim Veroeffentlichen ein eigenes JPEG:

- Quelle: das bestaetigte (ready) JPEG des Users aus S3 (Threadpool).
- Pillow: Orientierung anwenden, auf max. PREVIEW_MAX_EDGE px verkleinern,
  als frisches RGB-Bild ohne EXIF/ICC/IPTC/XMP neu kodieren.
- Ablage unter <uid>/previews/<preset_id>.jpg, Key in presets.preview_key.

Der Marketplace signiert ausschliesslich preview_key, nie Originale.
"""
from __future__ import annotations

import io
import logging
import warnings

from fastapi import HTTPException
from fastapi.concurrency import run_in_threadpool
from PIL import Image as PILImage, ImageOps, UnidentifiedImageError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Image, Preset
from app.storage import ObjectNotFound, StorageService


logger = logging.getLogger(__name__)

PREVIEW_MAX_EDGE = 1600
PREVIEW_QUALITY = 85
# Dekompressionsbomben-Schutz: Pixelzahl wird VOR dem Dekodieren aus dem
# Header gelesen. 100 MP deckt aktuelle Vollformat-/Mittelformat-JPEGs ab.
MAX_SOURCE_PIXELS = 100_000_000
# Obergrenze der Quelldatei, die in den API-Speicher geladen wird.
MAX_SOURCE_BYTES = 60 * 1024 * 1024

INVALID_PREVIEW_DETAIL = "Vorschaubild ungültig — bitte ein anderes JPEG wählen."


class PreviewError(ValueError):
    """Quelle ist kein verarbeitbares JPEG (kaputt, zu gross, Bombe)."""


def render_preview(data: bytes) -> bytes:
    """JPEG-Bytes -> verkleinertes, metadatenfreies JPEG. Wirft PreviewError."""
    try:
        with warnings.catch_warnings():
            # DecompressionBombWarning als Fehler behandeln.
            warnings.simplefilter("error", PILImage.DecompressionBombWarning)
            with PILImage.open(io.BytesIO(data)) as src:
                if src.format != "JPEG":
                    raise PreviewError("Quelle ist kein JPEG.")
                width, height = src.size
                if width <= 0 or height <= 0 or width * height > MAX_SOURCE_PIXELS:
                    raise PreviewError("Quelle hat unzulaessige Abmessungen.")
                # draft(): JPEG direkt in reduzierter Aufloesung dekodieren
                # (DCT-Skalierung) — spart Speicher bei grossen Quellen.
                src.draft("RGB", (PREVIEW_MAX_EDGE, PREVIEW_MAX_EDGE))
                img = ImageOps.exif_transpose(src)
                img = img.convert("RGB")
                img.thumbnail((PREVIEW_MAX_EDGE, PREVIEW_MAX_EDGE), PILImage.Resampling.LANCZOS)
                # Frisches Bild aus den reinen Pixeln: kein info-Dict (EXIF,
                # ICC, XMP, Kommentare) wandert in die Ausgabe.
                clean = PILImage.frombytes("RGB", img.size, img.tobytes())
    except PreviewError:
        raise
    except (
        UnidentifiedImageError,
        PILImage.DecompressionBombError,
        PILImage.DecompressionBombWarning,
        OSError,
        ValueError,
        SyntaxError,
    ) as exc:
        raise PreviewError(str(exc)) from exc
    out = io.BytesIO()
    clean.save(out, "JPEG", quality=PREVIEW_QUALITY, optimize=True)
    return out.getvalue()


def _build_preview(storage: StorageService, source_key: str, preview_key: str) -> None:
    """Blockierend (boto3 + Pillow) — nur im Threadpool aufrufen."""
    try:
        data = storage.get_bytes(source_key, MAX_SOURCE_BYTES)
    except ValueError as exc:
        raise PreviewError(str(exc)) from exc
    storage.put_bytes(preview_key, render_preview(data), "image/jpeg")


async def delete_preview_object(storage: StorageService, key: str | None) -> None:
    """Best-effort: Vorschau-Objekt loeschen. Ein Rest unter <uid>/previews/
    wird spaetestens beim Prefix-Purge (DELETE /me) entfernt."""
    if not key:
        return
    try:
        await run_in_threadpool(storage.delete, key)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Vorschau %s konnte nicht geloescht werden: %s", key, exc)


async def sync_preset_preview(
    db: AsyncSession, storage: StorageService, preset: Preset, *, force: bool = False
) -> str | None:
    """Bringt preset.preview_key in Einklang mit visibility/preview_image_id.

    - public + bestaetigtes JPEG als Vorschaubild -> Vorschau (neu) erzeugen,
      wenn force oder noch keine existiert.
    - sonst -> preview_key auf None; liefert den alten Key zurueck, den der
      Caller NACH dem Commit loeschen soll.

    Wirft HTTPException(400) bei unverarbeitbarer Quelle. Commit macht der
    Caller."""
    if preset.visibility != "public" or preset.preview_image_id is None:
        old = preset.preview_key
        preset.preview_key = None
        return old

    img = (
        await db.execute(select(Image).where(Image.id == preset.preview_image_id))
    ).scalar_one_or_none()
    # Nur bestaetigte Uploads: pending/failed koennen ungepruefte Bytes
    # enthalten. Ohne Quelle keine Vorschau (previewUrl null).
    if img is None or img.upload_state != "ready" or img.content_type != "image/jpeg":
        old = preset.preview_key
        preset.preview_key = None
        return old

    if preset.preview_key is not None and not force:
        return None

    key = storage.make_preview_key(preset.user_id, preset.id)
    try:
        await run_in_threadpool(_build_preview, storage, img.bucket_key, key)
    except (PreviewError, ObjectNotFound) as exc:
        logger.info("Vorschau fuer Preset %s abgelehnt: %s", preset.id, exc)
        raise HTTPException(status_code=400, detail=INVALID_PREVIEW_DETAIL) from exc
    preset.preview_key = key
    return None
