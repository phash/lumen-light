"""CLI-Entry fuer den Janitor (Upload-Cleanup, Purges, Retention).

Aufruf via Cron im Production-Stack:

    docker compose -f docker-compose.prod.yml exec -T api \
        python -m scripts.janitor [TTL_MINUTES]

Liest dieselben DB- und S3-Settings wie die FastAPI-App. Jeder Schritt
laeuft isoliert in eigener Session: ein Crash in einem Schritt (z.B.
DB-Konflikt) bricht die uebrigen nicht ab, landet aber unter "errors" in
der JSON-Statistik und fuehrt zu Exit-Code 1 (Cron-Alerting). Reine
S3-Fehler innerhalb eines Schritts sind best effort (Zaehler, Exit 0) —
der naechste Lauf versucht es wieder. TTL_MINUTES wird auf mindestens
Policy-Gueltigkeit + Puffer angehoben.
"""
from __future__ import annotations

import asyncio
import json
import sys
from collections.abc import Awaitable, Callable
from datetime import timedelta
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.database import AsyncSessionLocal, engine
from app.janitor import (
    pending_ttl,
    prune_pending_uploads,
    prune_retention,
    retry_storage_purges,
    sweep_stale_staging,
)
from app.storage import StorageService, get_storage


Step = Callable[[AsyncSession, StorageService], Awaitable[dict[str, Any] | None]]


def _steps(ttl_minutes: int) -> list[tuple[str, Step]]:
    async def pending(db: AsyncSession, storage: StorageService) -> dict[str, Any]:
        r = await prune_pending_uploads(db, storage, ttl=timedelta(minutes=ttl_minutes))
        return {
            "candidates": r.candidates,
            "storageDeleted": r.storage_deleted,
            "storageErrors": r.storage_errors,
            "dbDeleted": r.db_deleted,
        }

    async def staging(db: AsyncSession, storage: StorageService) -> dict[str, Any]:
        r = await sweep_stale_staging(db, storage)
        return {"stagingDeleted": r.deleted, "stagingErrors": r.errors}

    async def purges(db: AsyncSession, storage: StorageService) -> dict[str, Any]:
        r = await retry_storage_purges(db, storage)
        return {
            "purgeCandidates": r.candidates,
            "purged": r.purged,
            "purgeErrors": r.errors,
        }

    async def retention(db: AsyncSession, _storage: StorageService) -> dict[str, Any]:
        r = await prune_retention(db)
        return {"feedbackDeleted": r.feedback_deleted, "reportsDeleted": r.reports_deleted}

    return [
        ("pending", pending),
        ("staging", staging),
        ("purges", purges),
        ("retention", retention),
    ]


async def _run(ttl_minutes: int) -> int:
    storage = get_storage()
    stats: dict[str, Any] = {"ttlMinutes": ttl_minutes}
    errors: dict[str, str] = {}
    for name, step in _steps(ttl_minutes):
        async with AsyncSessionLocal() as db:
            try:
                result = await step(db, storage)
            except Exception as exc:  # noqa: BLE001 — Schritt isolieren
                errors[name] = f"{type(exc).__name__}: {exc}"[:500]
                try:
                    await db.rollback()
                except Exception:  # noqa: BLE001
                    pass
                continue
        if result:
            stats.update(result)
    stats["errors"] = errors
    print(json.dumps(stats))
    return 1 if errors else 0


async def _main(ttl_minutes: int) -> int:
    try:
        return await _run(ttl_minutes)
    finally:
        await engine.dispose()


def main() -> int:
    min_minutes = int(pending_ttl().total_seconds() // 60)
    ttl_minutes = min_minutes
    if len(sys.argv) > 1:
        ttl_minutes = max(min_minutes, int(sys.argv[1]))
    return asyncio.run(_main(ttl_minutes))


if __name__ == "__main__":
    sys.exit(main())
