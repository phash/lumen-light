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
- `prune_retention()` (Review 2026-11): Feedback, Marketplace-Meldungen und
  Apply-Dedupe-Eintraege nach Ablauf der Retention-Fristen loeschen.
- `retry_keycloak_deletions()` (Review 2026-11 r2): ausstehende KC-Account-
  Loeschungen aus DELETE /me mit exponentiellem Backoff wiederholen.

Robustheit: Kandidaten werden per FOR UPDATE SKIP LOCKED gesperrt (kein
Wettlauf mit confirm/DELETE oder einem parallelen Janitor-Lauf), geloescht
wird per DELETE ... WHERE (kein StaleDataError bei parallel verschwundenen
Rows).

Alle Funktionen sind async und werden von `backend/scripts/janitor.py`
(Cron) aufgerufen.
"""
from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app import keycloak_admin
from app.config import settings
from app.moderation import REPORT_AUTOHIDE_THRESHOLD
from app.models import (
    Feedback,
    Image,
    KeycloakDeletion,
    Preset,
    PresetApply,
    PresetReport,
    StoragePurge,
    User,
)
from app.storage import StorageService


logger = logging.getLogger(__name__)

__all__ = [
    "REPORT_AUTOHIDE_THRESHOLD",
    "KEYCLOAK_DELETE_MAX_ATTEMPTS",
    "keycloak_retry_delay",
    "pending_ttl",
    "prune_pending_uploads",
    "prune_retention",
    "retry_keycloak_deletions",
    "retry_storage_purges",
    "sweep_stale_staging",
]


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
    stale_previews: list[str] = []
    if done:
        # Vom Bild abgeleitete Marketplace-Vorschauen mit wegraeumen:
        # preview_image_id leert die FK (SET NULL), preview_key nicht —
        # sonst zeigte der Marketplace weiter ein Motiv eines geloeschten
        # Bildes.
        rows = (
            await db.execute(
                select(Preset.id, Preset.preview_key).where(
                    Preset.preview_image_id.in_(done),
                    Preset.preview_key.is_not(None),
                ).with_for_update()
            )
        ).all()
        stale_previews = [key for _pid, key in rows if key]
        if rows:
            await db.execute(
                update(Preset)
                .where(Preset.id.in_([pid for pid, _ in rows]))
                .values(preview_key=None)
                .execution_options(synchronize_session="fetch")
            )
        # WHERE upload_state: nur loeschen, was (noch) haengt.
        res = await db.execute(
            delete(Image)
            .where(Image.id.in_(done), Image.upload_state.in_(_STALE_STATES))
            .execution_options(synchronize_session="fetch")
        )
        db_deleted = int(res.rowcount or 0)  # type: ignore[attr-defined]
    # Commit auch ohne Loeschung: gibt die Row-Sperren frei.
    await db.commit()
    # Erst nach dem Commit: Vorschau-Objekte best effort loeschen (ein Rest
    # unter <uid>/previews/ ist unreferenziert, faellt spaetestens beim
    # Prefix-Purge weg).
    for key in stale_previews:
        try:
            storage.delete(key)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Janitor: Vorschau %s nicht geloescht: %s", key, exc)

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
    applies_deleted: int = 0


async def prune_retention(
    db: AsyncSession, *, now: datetime | None = None
) -> RetentionResult:
    """DSGVO-Speicherbegrenzung.

    Feedback:
    - erledigt (closed), letzte Aenderung aelter als feedback_retention_days;
    - anonymisiert (user_id NULL, Account geloescht), angelegt vor mehr als
      feedback_retention_days — niemand kann mehr antworten;
    - JEDER Status, angelegt vor mehr als feedback_max_age_days (L14) —
      liegengebliebenes offenes Feedback waechst sonst unbegrenzt.

    Marketplace-Meldungen (aelter als report_retention_days) nur bei
    NICHT-oeffentlichen Presets unterhalb der Auto-Hide-Schwelle. Begruendung:
    - Die Meldung dient als Dedupe (eine pro Reporter+Preset). Wuerde sie bei
      einem oeffentlichen Preset geloescht, koennte derselbe User erneut
      melden und report_count stiege durch denselben Reporter.
    - Ein privates Preset kann nicht gemeldet werden; erst nach erneutem
      Veroeffentlichen sind neue Meldungen moeglich (neue Veroeffentlichung).
    - Auto-versteckte Presets (report_count >= Schwelle) behalten ihre
      Meldungen als Moderationsgrundlage, bis der Admin sie verwirft
      (clear-reports loescht sie) oder das Preset geloescht wird (Cascade).
    presets.report_count bleibt als denormalisierter Moderationsstand
    unveraendert.

    preset_applies (L2): nur der aktuelle Tag wird fuer das Apply-Dedupe
    gebraucht — aeltere Eintraege (personenbezogenes Nutzungsprotokoll)
    werden geloescht."""
    current = now or datetime.now(timezone.utc)
    fb_cutoff = current - timedelta(days=settings.feedback_retention_days)
    fb_max_cutoff = current - timedelta(days=settings.feedback_max_age_days)
    fb = await db.execute(
        delete(Feedback).where(
            or_(
                (Feedback.status == "closed") & (Feedback.updated_at < fb_cutoff),
                Feedback.user_id.is_(None) & (Feedback.created_at < fb_cutoff),
                Feedback.created_at < fb_max_cutoff,
            )
        ).execution_options(synchronize_session="fetch")
    )
    prunable_presets = select(Preset.id).where(
        Preset.visibility != "public",
        Preset.report_count < REPORT_AUTOHIDE_THRESHOLD,
    )
    rep = await db.execute(
        delete(PresetReport).where(
            PresetReport.created_at
            < current - timedelta(days=settings.report_retention_days),
            PresetReport.preset_id.in_(prunable_presets),
        ).execution_options(synchronize_session="fetch")
    )
    # Gleiche Tagesdefinition wie beim INSERT (DB-current_date), ausser der
    # Caller gibt einen Zeitpunkt vor.
    today = current.date() if now is not None else func.current_date()
    app_res = await db.execute(
        delete(PresetApply)
        .where(PresetApply.day < today)
        .execution_options(synchronize_session=False)
    )
    await db.commit()
    return RetentionResult(
        feedback_deleted=int(fb.rowcount or 0),  # type: ignore[attr-defined]
        reports_deleted=int(rep.rowcount or 0),  # type: ignore[attr-defined]
        applies_deleted=int(app_res.rowcount or 0),  # type: ignore[attr-defined]
    )


# ----- Keycloak-Loeschungen (M2) -----

# Danach gibt der Janitor auf (Row bleibt fuer manuelle Nacharbeit stehen
# und wird in der Statistik als givenUp gezaehlt -> Alerting).
KEYCLOAK_DELETE_MAX_ATTEMPTS = 50
_KC_BACKOFF_BASE = timedelta(minutes=1)
_KC_BACKOFF_MAX = timedelta(hours=24)


def keycloak_retry_delay(attempts: int) -> timedelta:
    """Exponentieller Backoff nach `attempts` Fehlversuchen: 1, 2, 4, ...
    Minuten, gedeckelt auf 24 h."""
    exponent = max(attempts - 1, 0)
    if exponent >= 20:
        return _KC_BACKOFF_MAX
    return min(_KC_BACKOFF_BASE * (2**exponent), _KC_BACKOFF_MAX)


@dataclass
class KeycloakRetryResult:
    configured: bool
    candidates: int
    deleted: int
    errors: int
    given_up: int


async def retry_keycloak_deletions(
    db: AsyncSession,
    *,
    now: datetime | None = None,
    attempt: Callable[[str], str | None] | None = None,
) -> KeycloakRetryResult:
    """Faellige Vormerkungen (next_attempt_at <= now, attempts < Maximum)
    erneut gegen die KC-Admin-API loeschen. Erfolg (204/404) -> Row weg;
    Fehler -> attempts+1, last_error, next_attempt_at per Backoff. Ohne
    konfigurierten Service-Account bleibt alles stehen."""
    current = now or datetime.now(timezone.utc)
    given_up = int(
        (
            await db.execute(
                select(func.count())
                .select_from(KeycloakDeletion)
                .where(KeycloakDeletion.attempts >= KEYCLOAK_DELETE_MAX_ATTEMPTS)
            )
        ).scalar_one()
    )
    if not keycloak_admin.is_configured():
        return KeycloakRetryResult(False, 0, 0, 0, given_up)
    run = attempt or keycloak_admin.attempt_delete_user
    rows = list(
        (
            await db.execute(
                select(KeycloakDeletion)
                .where(
                    KeycloakDeletion.next_attempt_at <= current,
                    KeycloakDeletion.attempts < KEYCLOAK_DELETE_MAX_ATTEMPTS,
                )
                .order_by(KeycloakDeletion.next_attempt_at)
                .limit(BATCH_SIZE)
                .with_for_update(skip_locked=True)
            )
        ).scalars().all()
    )
    deleted = 0
    errors = 0
    for row in rows:
        sub = row.keycloak_sub
        try:
            # Blockierendes httpx -> Thread, damit der Loop frei bleibt.
            error = await asyncio.to_thread(run, sub)
        except Exception as exc:  # noqa: BLE001 — naechster Lauf
            error = f"{type(exc).__name__}: {exc}"
        cond = KeycloakDeletion.keycloak_sub == sub
        if error is None:
            await db.execute(
                delete(KeycloakDeletion)
                .where(cond)
                .execution_options(synchronize_session="fetch")
            )
            deleted += 1
            continue
        attempts = row.attempts + 1
        await db.execute(
            update(KeycloakDeletion)
            .where(cond)
            .values(
                attempts=attempts,
                last_error=error[:500],
                next_attempt_at=current + keycloak_retry_delay(attempts),
            )
            .execution_options(synchronize_session="fetch")
        )
        errors += 1
        if attempts >= KEYCLOAK_DELETE_MAX_ATTEMPTS:
            given_up += 1
            logger.error("KC-Loeschung nach %d Versuchen aufgegeben", attempts)
    await db.commit()
    return KeycloakRetryResult(True, len(rows), deleted, errors, given_up)
