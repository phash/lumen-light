"""Janitor — periodische Cleanup-Tasks fuer haengengebliebene Uploads.

Pre-Signed-URLs haben keine Content-Length-Range-Constraint, also kann
ein Browser einen `init_upload` aufrufen und den `confirm` nie senden.
Die DB-Row und ein potentiell schon hochgeladenes S3-Object bleiben
dann zurueck (Bucket-Bloat). Dieser Janitor raeumt sie ab einem
Schwellenalter weg: Policy-Gueltigkeit (presigned_url_expires_in) plus
Puffer (janitor_grace_seconds), Default 30 min. Kleinere TTLs werden
angehoben — sonst verschwaende ein Upload, dessen Policy noch gilt.

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
- `retry_storage_purges()`: Prefix-Purges aus DELETE /me (Tabelle
  storage_purges). Jede Loeschung merkt ihren Prefix vor; faellig erst ab
  not_before (nach Ablauf der Upload-Policy), damit spaete Staging-Uploads
  mit erfasst werden.
- `prune_retention()` (Review 2026-11): erledigtes Feedback und alte
  Marketplace-Meldungen nach Ablauf der Retention-Frist loeschen.

Robustheit: Kandidaten werden per FOR UPDATE SKIP LOCKED gesperrt (kein
Wettlauf mit confirm/DELETE oder einem parallelen Janitor-Lauf), geloescht
wird per DELETE ... WHERE (kein StaleDataError bei parallel verschwundenen
Rows).

Alle Funktionen sind async und werden von `backend/scripts/janitor.py`
(Cron) aufgerufen.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import Feedback, Image, PresetReport, StoragePurge, User
from app.storage import StorageService


# Obergrenze pro Lauf — haelt Sperren und Laufzeit klein, Rest im naechsten Lauf.
BATCH_SIZE = 500
_STALE_STATES = ("pending", "failed")


def pending_ttl() -> timedelta:
    """Mindestalter haengender Uploads: Policy-Gueltigkeit + Puffer."""
    return timedelta(
        seconds=settings.presigned_url_expires_in + settings.janitor_grace_seconds
    )


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
    ttl: timedelta | None = None,
    now: datetime | None = None,
) -> PruneResult:
    """Loescht haengengebliebene Uploads (pending + failed) aelter als ttl
    (mindestens pending_ttl()) aus S3 und DB.

    Die Kandidaten werden FOR UPDATE SKIP LOCKED gesperrt: ein paralleles
    confirm (sperrt dieselbe Row) wartet, bis der Janitor fertig ist, und
    findet die Row dann nicht mehr (404) — es kann also kein frisch
    bestaetigtes Bild weggeraeumt werden. Reihenfolge: erst S3, dann DB.
    Wirft S3, bleibt die Row stehen (naechster Lauf)."""
    effective = max(ttl or pending_ttl(), pending_ttl())
    threshold = (now or datetime.now(timezone.utc)) - effective
    result = await db.execute(
        select(Image)
        .where(
            Image.upload_state.in_(_STALE_STATES),
            Image.created_at < threshold,
        )
        .order_by(Image.created_at)
        .limit(BATCH_SIZE)
        .with_for_update(skip_locked=True)
    )
    candidates = list(result.scalars().all())

    storage_deleted = 0
    storage_errors = 0
    done: list = []
    for image in candidates:
        try:
            # Staging-Objekt (Ziel des Pre-Signed POST) und finaler Key —
            # beide idempotent, je nach Abbruchpunkt existiert einer davon.
            storage.delete(storage.staging_key_for(image.bucket_key))
            storage.delete(image.bucket_key)
            storage_deleted += 1
        except Exception:  # noqa: BLE001 — best effort, kein Crash
            storage_errors += 1
            continue
        done.append(image.id)

    db_deleted = 0
    if done:
        # WHERE upload_state: nur loeschen, was (noch) haengt.
        res = await db.execute(
            delete(Image)
            .where(Image.id.in_(done), Image.upload_state.in_(_STALE_STATES))
            .execution_options(synchronize_session="fetch")
        )
        db_deleted = int(res.rowcount or 0)  # type: ignore[attr-defined]
    # Commit auch ohne Loeschung: gibt die Row-Sperren frei.
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
    """Loescht Staging-Objekte aelter als max_age (Default: pending_ttl()).
    Staging-Objekte noch offener (pending) Uploads bleiben unberuehrt — die
    raeumt prune_pending_uploads.

    Pro User ein list_objects_v2 auf <uid>/staging/ statt eines Scans ueber
    den ganzen Bucket (originals bleiben aussen vor)."""
    if max_age is None:
        max_age = pending_ttl()
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
    db: AsyncSession,
    storage: StorageService,
    *,
    now: datetime | None = None,
) -> PurgeRetryResult:
    """Fuehrt faellige Prefix-Purges aus DELETE /me aus (not_before <= now).
    Erfolg -> Row weg; Fehler -> attempts+1 und last_error, naechster Lauf
    probiert's erneut. Idempotent: ein leerer Prefix ist ein No-op."""
    current = now or datetime.now(timezone.utc)
    rows = list(
        (
            await db.execute(
                select(StoragePurge)
                .where(StoragePurge.not_before <= current)
                .order_by(StoragePurge.created_at)
                .limit(BATCH_SIZE)
                .with_for_update(skip_locked=True)
            )
        ).scalars().all()
    )
    purged = 0
    errors = 0
    for row in rows:
        prefix = row.prefix
        try:
            storage.delete_prefix(prefix)
        except Exception as exc:  # noqa: BLE001
            await db.execute(
                update(StoragePurge)
                .where(StoragePurge.prefix == prefix)
                .values(
                    attempts=StoragePurge.attempts + 1,
                    last_error=str(exc)[:500],
                )
                .execution_options(synchronize_session="fetch")
            )
            errors += 1
            continue
        await db.execute(
            delete(StoragePurge)
            .where(StoragePurge.prefix == prefix)
            .execution_options(synchronize_session="fetch")
        )
        purged += 1
    await db.commit()
    return PurgeRetryResult(candidates=len(rows), purged=purged, errors=errors)


@dataclass
class RetentionResult:
    feedback_deleted: int
    reports_deleted: int


async def prune_retention(
    db: AsyncSession, *, now: datetime | None = None
) -> RetentionResult:
    """DSGVO-Speicherbegrenzung: erledigtes (closed) Feedback, dessen letzte
    Aenderung aelter als feedback_retention_days ist, und Marketplace-
    Meldungen aelter als report_retention_days loeschen. Offenes Feedback
    bleibt, bis es bearbeitet wurde. presets.report_count bleibt als
    denormalisierter Moderationsstand unveraendert."""
    current = now or datetime.now(timezone.utc)
    fb = await db.execute(
        delete(Feedback).where(
            Feedback.status == "closed",
            Feedback.updated_at
            < current - timedelta(days=settings.feedback_retention_days),
        ).execution_options(synchronize_session="fetch")
    )
    rep = await db.execute(
        delete(PresetReport).where(
            PresetReport.created_at
            < current - timedelta(days=settings.report_retention_days),
        ).execution_options(synchronize_session="fetch")
    )
    await db.commit()
    return RetentionResult(
        feedback_deleted=int(fb.rowcount or 0),  # type: ignore[attr-defined]
        reports_deleted=int(rep.rowcount or 0),  # type: ignore[attr-defined]
    )
