"""Janitor — periodische Cleanup-Tasks fuer haengengebliebene Uploads.

Pre-Signed-URLs haben keine Content-Length-Range-Constraint, also kann
ein Browser einen `init_upload` aufrufen und den `confirm` nie senden.
Die DB-Row und ein potentiell schon hochgeladenes S3-Object bleiben
dann zurueck (Bucket-Bloat). Dieser Janitor raeumt sie ab einem
Schwellenalter (Default: 15 min) weg.

Geraeumt werden zwei Zustaende:
- `pending`: nie bestaetigte Uploads (Browser hat confirm nie geschickt).
- `failed`: DELETE-Versuche, bei denen das S3-Delete fehlschlug und die
  Row als `failed` markiert wurde (Object evtl. noch da). Sonst bliebe ein
  verwaistes Object ohne DB-Referenz dauerhaft liegen.

Das Modul stellt eine reine async-Funktion `prune_pending_uploads()`
bereit; aufgerufen wird sie von `backend/scripts/janitor.py` (Cron).
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Image
from app.storage import StorageService


PENDING_TTL = timedelta(minutes=15)


@dataclass
class PruneResult:
    candidates: int          # gefundene pending/failed-Rows aelter als TTL
    storage_deleted: int     # erfolgreich aus S3 entfernt
    storage_errors: int      # S3-Fehler (best effort, DB-Row bleibt drin)
    db_deleted: int          # tatsaechlich aus DB entfernt


async def prune_pending_uploads(
    db: AsyncSession,
    storage: StorageService,
    *,
    ttl: timedelta = PENDING_TTL,
    now: datetime | None = None,
) -> PruneResult:
    """Loescht haengengebliebene Uploads (pending + failed) aelter als ttl
    aus S3 und DB.

    Reihenfolge: erst S3-Object weg, dann DB-Row. Wenn S3 wirft, bleibt
    die DB-Row stehen (naechster Lauf versucht's wieder). Das ist
    bewusst — sonst kann ein S3-Glitch zu einem Object fuehren, das in
    der DB schon weg ist und somit nie wieder gefunden wird.
    """
    threshold = (now or datetime.now(timezone.utc)) - ttl
    result = await db.execute(
        select(Image).where(
            Image.upload_state.in_(("pending", "failed")),
            Image.created_at < threshold,
        )
    )
    candidates = list(result.scalars().all())

    storage_deleted = 0
    storage_errors = 0
    db_deleted = 0

    for image in candidates:
        try:
            storage.delete(image.bucket_key)
            storage_deleted += 1
        except Exception:  # noqa: BLE001 — best effort, kein Crash
            storage_errors += 1
            # DB-Row bleibt — naechster Janitor-Lauf versucht's nochmal.
            continue
        await db.delete(image)
        db_deleted += 1

    if db_deleted:
        await db.commit()

    return PruneResult(
        candidates=len(candidates),
        storage_deleted=storage_deleted,
        storage_errors=storage_errors,
        db_deleted=db_deleted,
    )
