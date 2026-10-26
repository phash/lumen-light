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

Zusaetzlich (Security-Review 2026-10):
- `sweep_stale_staging()`: Staging-Objekte (<uid>/staging/<id>, Ziel der
  Pre-Signed PUTs) aelter als die URL-Gueltigkeit. Nach confirm wird Staging
  sofort geloescht; ein erneuter PUT mit der alten URL hinterlaesst aber
  einen Rest, den niemand mehr liest.
- `retry_storage_purges()`: Prefix-Purges aus DELETE /me, die beim ersten
  Versuch an S3 scheiterten (Tabelle storage_purges).

Alle Funktionen sind async und werden von `backend/scripts/janitor.py`
(Cron) aufgerufen.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Image, StoragePurge, User
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
            # Staging-Objekt (Ziel des Pre-Signed PUT) und finaler Key —
            # beide idempotent, je nach Abbruchpunkt existiert einer davon.
            storage.delete(storage.staging_key_for(image.bucket_key))
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


@dataclass
class StagingSweepResult:
    deleted: int
    errors: int


async def sweep_stale_staging(
    db: AsyncSession,
    storage: StorageService,
    *,
    max_age: timedelta | None = None,
    now: datetime | None = None,
) -> StagingSweepResult:
    """Loescht Staging-Objekte aelter als max_age (Default: Pre-Signed-URL-
    Gueltigkeit, mindestens PENDING_TTL). Staging-Objekte noch offener
    (pending) Uploads bleiben unberuehrt — die raeumt prune_pending_uploads.

    Pro User ein list_objects_v2 auf <uid>/staging/ statt eines Scans ueber
    den ganzen Bucket (originals bleiben aussen vor)."""
    from app.config import settings

    if max_age is None:
        max_age = max(
            PENDING_TTL, timedelta(seconds=settings.presigned_url_expires_in)
        )
    threshold = (now or datetime.now(timezone.utc)) - max_age

    user_ids = (await db.execute(select(User.id))).scalars().all()
    pending_keys = {
        storage.staging_key_for(k)
        for k in (
            await db.execute(
                select(Image.bucket_key).where(Image.upload_state == "pending")
            )
        ).scalars().all()
    }

    deleted = 0
    errors = 0
    for uid in user_ids:
        try:
            objects = storage.list_objects(f"{uid}/staging/")
            stale = [
                o.key
                for o in objects
                if o.last_modified < threshold and o.key not in pending_keys
            ]
            if stale:
                storage.delete_many(stale)
                deleted += len(stale)
        except Exception:  # noqa: BLE001 — best effort, naechster Lauf
            errors += 1
    return StagingSweepResult(deleted=deleted, errors=errors)


@dataclass
class PurgeRetryResult:
    candidates: int
    purged: int
    errors: int


async def retry_storage_purges(
    db: AsyncSession, storage: StorageService
) -> PurgeRetryResult:
    """Wiederholt fehlgeschlagene Prefix-Purges aus DELETE /me. Erfolg ->
    Row weg; Fehler -> attempts+1 und last_error, naechster Lauf probiert's
    erneut."""
    rows = list((await db.execute(select(StoragePurge))).scalars().all())
    purged = 0
    errors = 0
    for row in rows:
        try:
            storage.delete_prefix(row.prefix)
        except Exception as exc:  # noqa: BLE001
            row.attempts += 1
            row.last_error = str(exc)[:500]
            errors += 1
            continue
        await db.delete(row)
        purged += 1
    if rows:
        await db.commit()
    return PurgeRetryResult(candidates=len(rows), purged=purged, errors=errors)
