"""Serverseitige Marketplace-Vorschau (Review 2026-11, M3).

Oeffentliche Presets zeigen im Marketplace ein Vorschaubild. Frueher wurde
dafuer das Original des Creators (volle Aufloesung, ggf. mit Metadaten, die
der Client-EXIF-Strip verpasst hat) per Pre-Signed GET ausgeliefert. Jetzt
erzeugt der Server beim Veroeffentlichen ein eigenes JPEG:

- Quelle: das bestaetigte (ready) JPEG des Users aus S3 (Threadpool).
- Pillow: Orientierung anwenden, auf max. PREVIEW_MAX_EDGE px verkleinern,
  als frisches RGB-Bild ohne EXIF/ICC/IPTC/XMP neu kodieren.
- Ablage unter <uid>/previews/<preset_id>-<version>.jpg (versioniert, Review
  2026-11 r2), Key in presets.preview_key.

Der Marketplace signiert ausschliesslich preview_key, nie Originale.
"""
from __future__ import annotations

import io
import logging
import threading
from uuid import UUID

from fastapi import HTTPException, status
from fastapi.concurrency import run_in_threadpool
from limits import parse as parse_limit
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
# Prozessweite Pillow-Grenze (L6): statt warnings.catch_warnings (nicht
# thread-sicher, der Build laeuft im Threadpool) einmal beim Import setzen.
# Pillow wirft ab 2x dieser Grenze DecompressionBombError; dazwischen greift
# die eigene Pruefung in render_preview.
PILImage.MAX_IMAGE_PIXELS = MAX_SOURCE_PIXELS
# Obergrenze der Quelldatei, die in den API-Speicher geladen wird (M1).
# Handy-/Kamera-JPEGs liegen deutlich darunter.
MAX_SOURCE_BYTES = 25 * 1024 * 1024
# Prozessweit hoechstens so viele gleichzeitige Builds (M1): jeder haelt
# Quelle (bis MAX_SOURCE_BYTES) plus dekodierte Pixel im Speicher.
MAX_CONCURRENT_BUILDS = 2
_BUILD_SEMAPHORE = threading.BoundedSemaphore(MAX_CONCURRENT_BUILDS)
# So lange wartet ein Build (im Threadpool) auf einen freien Slot -> 503.
BUILD_SLOT_TIMEOUT_SECONDS = 20.0
# Eigenes Limit fuer vorschau-erzeugende Requests pro User (zusaetzlich zu
# den 60/min der Preset-Endpoints): Publish/Unpublish-Toggeln erzeugt
# jedes Mal einen neuen Build.
PREVIEW_BUILDS_PER_MINUTE = 10
_BUILD_RATE = parse_limit(f"{PREVIEW_BUILDS_PER_MINUTE}/minute")
_ACCEPTED_FORMATS = ("JPEG", "MPO")

INVALID_PREVIEW_DETAIL = "Vorschaubild ungültig — bitte ein anderes JPEG wählen."
BUSY_PREVIEW_DETAIL = (
    "Vorschau-Erzeugung gerade ausgelastet — bitte gleich erneut versuchen."
)
RATE_PREVIEW_DETAIL = (
    "Zu viele Vorschau-Erzeugungen — bitte warte eine Minute."
)


class PreviewError(ValueError):
    """Quelle ist kein verarbeitbares JPEG (kaputt, zu gross, Bombe)."""


class PreviewBusy(RuntimeError):
    """Kein freier Build-Slot innerhalb von BUILD_SLOT_TIMEOUT_SECONDS."""


def check_preview_build_rate(user_id: UUID) -> None:
    """429, wenn der User sein Build-Kontingent pro Minute verbraucht hat.
    Nutzt den Storage des globalen slowapi-Limiters (Redis in Prod)."""
    from app.rate_limit import limiter

    if not limiter.enabled:
        return
    if not limiter.limiter.hit(_BUILD_RATE, "preview-build", str(user_id)):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=RATE_PREVIEW_DETAIL,
        )


def render_preview(data: bytes) -> bytes:
    """JPEG-Bytes -> verkleinertes, metadatenfreies JPEG. Wirft PreviewError."""
    try:
        # formats: nur der JPEG-Opener (L7) — kein Plugin-Zoo fuer
        # Angreifer-Bytes. Er liefert fuer Mehrbild-JPEGs (MPO, z.B. iPhone)
        # ein MpoImageFile; Frame 0 ist das Hauptbild und nach open() aktiv.
        with PILImage.open(io.BytesIO(data), formats=["JPEG"]) as src:
            if src.format not in _ACCEPTED_FORMATS:
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
        OSError,
        ValueError,
        SyntaxError,
    ) as exc:
        raise PreviewError(str(exc)) from exc
    out = io.BytesIO()
    clean.save(out, "JPEG", quality=PREVIEW_QUALITY, optimize=True)
    return out.getvalue()


def _build_preview(storage: StorageService, source_key: str, preview_key: str) -> None:
    """Blockierend (boto3 + Pillow) — nur im Threadpool aufrufen. Der
    Semaphore deckt Download UND Dekodieren ab (beides speicherintensiv)."""
    if not _BUILD_SEMAPHORE.acquire(timeout=BUILD_SLOT_TIMEOUT_SECONDS):
        raise PreviewBusy("Kein freier Vorschau-Slot.")
    try:
        try:
            data = storage.get_bytes(source_key, MAX_SOURCE_BYTES)
        except ValueError as exc:
            raise PreviewError(str(exc)) from exc
        rendered = render_preview(data)
        del data
        storage.put_bytes(preview_key, rendered, "image/jpeg")
    finally:
        _BUILD_SEMAPHORE.release()


async def delete_preview_object(storage: StorageService, key: str | None) -> None:
    """Best-effort: Vorschau-Objekt loeschen. Ein Rest unter <uid>/previews/
    wird spaetestens beim Prefix-Purge (DELETE /me) entfernt."""
    if not key:
        return
    try:
        await run_in_threadpool(storage.delete, key)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Vorschau %s konnte nicht geloescht werden: %s", key, exc)


def clear_preview(preset: Preset) -> str | None:
    """preview_key leeren; liefert den alten Key, den der Caller NACH dem
    Commit loeschen soll."""
    old = preset.preview_key
    preset.preview_key = None
    return old


async def sync_preset_preview(
    db: AsyncSession,
    storage: StorageService,
    preset: Preset,
    *,
    force: bool = False,
    rate_limited: bool = True,
) -> str | None:
    """Bringt preset.preview_key in Einklang mit visibility/preview_image_id.

    - public + bestaetigtes, eigenes JPEG als Vorschaubild -> Vorschau (neu)
      erzeugen, wenn force oder noch keine existiert. Jede Erzeugung schreibt
      einen NEUEN versionierten Key; der bisherige bleibt bis zum Commit
      unangetastet (Rollback laesst S3 konsistent).
    - sonst -> preview_key auf None.

    Liefert den abgeloesten Key, den der Caller NACH erfolgreichem Commit
    loeschen soll (delete_preview_object). Schlaegt der Commit fehl, muss
    der Caller stattdessen den neuen preset.preview_key loeschen.

    Wirft HTTPException(400) bei unverarbeitbarer Quelle, 429 bei
    ueberschrittenem Build-Limit, 503 ohne freien Build-Slot. Commit macht
    der Caller."""
    if preset.visibility != "public" or preset.preview_image_id is None:
        return clear_preview(preset)

    img = (
        await db.execute(
            select(Image).where(
                Image.id == preset.preview_image_id,
                # L8: nur Bilder des Preset-Owners (Defense in Depth zur
                # Pruefung im Router).
                Image.user_id == preset.user_id,
            )
        )
    ).scalar_one_or_none()
    # Nur bestaetigte Uploads: pending/failed koennen ungepruefte Bytes
    # enthalten. Ohne Quelle keine Vorschau (previewUrl null).
    if img is None or img.upload_state != "ready" or img.content_type != "image/jpeg":
        return clear_preview(preset)

    if preset.preview_key is not None and not force:
        return None

    if rate_limited:
        check_preview_build_rate(preset.user_id)
    key = storage.make_preview_key(preset.user_id, preset.id)
    try:
        await run_in_threadpool(_build_preview, storage, img.bucket_key, key)
    except (PreviewError, ObjectNotFound) as exc:
        logger.info("Vorschau fuer Preset %s abgelehnt: %s", preset.id, exc)
        raise HTTPException(status_code=400, detail=INVALID_PREVIEW_DETAIL) from exc
    except PreviewBusy as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=BUSY_PREVIEW_DETAIL
        ) from exc
    old = preset.preview_key
    preset.preview_key = key
    return old
