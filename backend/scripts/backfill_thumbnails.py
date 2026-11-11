"""Backfill: Vorschaubilder fuer Bestandsbilder (H2a, Migration 013).

Bilder, die vor H2a hochgeladen wurden, haben weder thumb_key noch
preview_key (thumbUrl/previewUrl null). Fuer JPEG/PNG/TIFF erzeugt dieses
Skript die Vorschauen serverseitig aus dem Original (OHNE Bearbeitung — die
kennt nur der Browser; der Editor ersetzt sie beim naechsten Speichern):

    docker exec lumen-api python -m scripts.backfill_thumbnails

RAW-Bestand bekommt seine Vorschau beim naechsten Oeffnen im Editor (der
Server kann RAW nicht dekodieren).

- Idempotent: nur Bilder mit thumb_key NULL sind Kandidaten; ein Bild, das
  zwischendurch eine Vorschau vom Browser bekommen hat, wird nicht
  ueberschrieben (Re-Check unter Zeilensperre).
- Speicher begrenzt: Kandidaten werden seitenweise (Keyset ueber id)
  geladen, Builds laufen sequenziell unter dem geteilten Build-Semaphore,
  Quellen ueber MAX_SOURCE_BYTES werden gar nicht erst gelesen.
- Unverarbeitbare Quellen (kaputt, zu gross, Format passt nicht) werden
  gezaehlt und uebersprungen; sie bleiben Kandidat (kein Markierungsfeld),
  kosten im naechsten Lauf aber nur einen HEAD-artigen GET-Abbruch bzw.
  einen erneuten Dekodierversuch.

Stdout = einzeilige JSON-Statistik.
"""
from __future__ import annotations

import asyncio
import json
import logging
import sys
from dataclasses import dataclass
from uuid import UUID

from fastapi.concurrency import run_in_threadpool
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Image
from app.previews import (
    PreviewBusy,
    PreviewError,
    build_thumbnails_from_storage,
    delete_preview_object,
)
from app.storage import ObjectNotFound, StorageService, get_storage


logger = logging.getLogger(__name__)

BACKFILL_CONTENT_TYPES = ("image/jpeg", "image/png", "image/tiff")
BATCH_SIZE = 100


@dataclass
class ThumbBackfillResult:
    candidates: int
    generated: int
    skipped: int


async def _candidate_page(
    db: AsyncSession, after: UUID | None
) -> list[tuple[UUID, UUID, str]]:
    stmt = (
        select(Image.id, Image.user_id, Image.bucket_key)
        .where(
            Image.upload_state == "ready",
            Image.thumb_key.is_(None),
            Image.content_type.in_(BACKFILL_CONTENT_TYPES),
        )
        .order_by(Image.id)
        .limit(BATCH_SIZE)
    )
    if after is not None:
        stmt = stmt.where(Image.id > after)
    return [(r[0], r[1], r[2]) for r in (await db.execute(stmt)).all()]


async def backfill_thumbnails(
    db: AsyncSession, storage: StorageService
) -> ThumbBackfillResult:
    candidates = generated = skipped = 0
    after: UUID | None = None
    while True:
        page = await _candidate_page(db, after)
        if not page:
            break
        for image_id, user_id, bucket_key in page:
            after = image_id
            candidates += 1
            try:
                small, large = await run_in_threadpool(
                    build_thumbnails_from_storage, storage, bucket_key
                )
            except (PreviewError, ObjectNotFound, PreviewBusy) as exc:
                logger.info("Backfill: Bild %s ohne Vorschau (%s)", image_id, exc)
                skipped += 1
                continue
            thumb_key, preview_key = storage.make_thumb_keys(user_id, image_id)

            def _put(tk: str = thumb_key, pk: str = preview_key,
                     s: bytes = small, lg: bytes = large) -> None:
                storage.put_bytes(tk, s, "image/jpeg")
                storage.put_bytes(pk, lg, "image/jpeg")

            await run_in_threadpool(_put)
            del small, large
            row = (
                await db.execute(
                    select(Image)
                    .where(Image.id == image_id)
                    .with_for_update()
                    .execution_options(populate_existing=True)
                )
            ).scalar_one_or_none()
            if row is None or row.thumb_key is not None:
                # Geloescht oder inzwischen vom Browser versorgt -> eigenen
                # Satz verwerfen, fremden nicht anfassen.
                await db.rollback()
                await delete_preview_object(storage, thumb_key)
                await delete_preview_object(storage, preview_key)
                skipped += 1
                continue
            row.thumb_key = thumb_key
            row.preview_key = preview_key
            await db.commit()
            generated += 1
        # Identity-Map nicht ueber alle Seiten wachsen lassen.
        db.expunge_all()
    return ThumbBackfillResult(candidates=candidates, generated=generated, skipped=skipped)


async def _main() -> int:
    from app.database import AsyncSessionLocal, engine

    try:
        async with AsyncSessionLocal() as db:
            r = await backfill_thumbnails(db, get_storage())
        print(json.dumps({
            "candidates": r.candidates, "generated": r.generated, "skipped": r.skipped,
        }))
        return 0
    finally:
        await engine.dispose()


if __name__ == "__main__":
    sys.exit(asyncio.run(_main()))
