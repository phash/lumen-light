"""CLI-Entry fuer den Janitor (Pre-Signed-Upload-Cleanup).

Aufruf via Cron im Production-Stack:

    docker compose -f docker-compose.prod.yml exec -T api \
        python -m scripts.janitor

Liest dieselben DB- und S3-Settings wie die FastAPI-App. Exit-Code 0
auch bei Storage-Fehlern (best effort) — naechster Lauf versucht es
wieder. Stdout-Output ist eine einzeilige JSON-Statistik fuer
einfaches Cron-Logging.
"""
from __future__ import annotations

import asyncio
import json
import sys
from datetime import timedelta

from app.database import AsyncSessionLocal, engine
from app.janitor import PENDING_TTL, prune_pending_uploads
from app.storage import get_storage


async def _run(ttl_minutes: int) -> int:
    storage = get_storage()
    async with AsyncSessionLocal() as db:
        result = await prune_pending_uploads(
            db, storage, ttl=timedelta(minutes=ttl_minutes)
        )
    print(
        json.dumps(
            {
                "candidates": result.candidates,
                "storageDeleted": result.storage_deleted,
                "storageErrors": result.storage_errors,
                "dbDeleted": result.db_deleted,
                "ttlMinutes": ttl_minutes,
            }
        )
    )
    return 0


async def _main(ttl_minutes: int) -> int:
    try:
        return await _run(ttl_minutes)
    finally:
        await engine.dispose()


def main() -> int:
    ttl_minutes = int(PENDING_TTL.total_seconds() / 60)
    if len(sys.argv) > 1:
        ttl_minutes = max(1, int(sys.argv[1]))
    return asyncio.run(_main(ttl_minutes))


if __name__ == "__main__":
    sys.exit(main())
