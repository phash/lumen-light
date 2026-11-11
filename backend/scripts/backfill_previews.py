"""Einmal-Backfill: Marketplace-Vorschauen fuer Bestandspresets (Migration 011).

Vor Migration 011 lieferte der Marketplace das Original als Vorschau aus;
jetzt nur noch serverseitig erzeugte JPEGs (presets.preview_key). Oeffentliche
Presets, die vor dem Update veroeffentlicht wurden, haben preview_key NULL
(previewUrl null), bis dieses Skript gelaufen ist:

    docker exec lumen-api python -m scripts.backfill_previews

Idempotent; Presets mit unverarbeitbarer Quelle werden gezaehlt und
uebersprungen. Ihr preview_image_id wird dabei geleert (die Quelle kann nie
eine Vorschau liefern, previewUrl bleibt ohnehin null) — sonst waeren sie bei
jedem Lauf erneut Kandidat. Stdout = einzeilige JSON-Statistik.
"""
from __future__ import annotations

import asyncio
import json
import sys
from dataclasses import dataclass

import logging

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Preset
from app.previews import sync_preset_preview
from app.storage import StorageService, get_storage


logger = logging.getLogger(__name__)


@dataclass
class BackfillResult:
    candidates: int
    generated: int
    skipped: int


async def backfill_previews(db: AsyncSession, storage: StorageService) -> BackfillResult:
    presets = (
        await db.execute(
            select(Preset).where(
                Preset.visibility == "public",
                Preset.preview_image_id.is_not(None),
                Preset.preview_key.is_(None),
            )
        )
    ).scalars().all()
    generated = 0
    skipped = 0
    for preset in presets:
        try:
            # Kein Build-Rate-Limit: einmaliger Admin-Lauf, sequenziell.
            await sync_preset_preview(
                db, storage, preset, force=True, rate_limited=False
            )
        except HTTPException as exc:
            if exc.status_code != 400:
                # 503 (kein Build-Slot) o.ae.: naechster Lauf probiert erneut.
                skipped += 1
                continue
            logger.info("Backfill: Preset %s ohne verwertbare Quelle", preset.id)
            preset.preview_image_id = None
        if preset.preview_key:
            generated += 1
        else:
            # z.B. Quelle noch pending: bleibt Kandidat fuer den naechsten Lauf.
            skipped += 1
        await db.commit()
    return BackfillResult(candidates=len(presets), generated=generated, skipped=skipped)


async def _main() -> int:
    from app.database import AsyncSessionLocal, engine

    try:
        async with AsyncSessionLocal() as db:
            r = await backfill_previews(db, get_storage())
        print(json.dumps({"candidates": r.candidates, "generated": r.generated, "skipped": r.skipped}))
        return 0
    finally:
        await engine.dispose()


if __name__ == "__main__":
    sys.exit(asyncio.run(_main()))
