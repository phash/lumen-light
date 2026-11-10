"""Marketplace-Moderation: Auto-Hide-Schwelle und Publish-Sperre.

Eigenes Modul (statt in routers/marketplace.py), damit Janitor, Admin- und
Preset-Router die Konstanten/Helfer ohne Router-Zirkularimporte nutzen.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import Preset, User


REPORT_AUTOHIDE_THRESHOLD = 3


def is_publish_blocked(user: User, *, now: datetime | None = None) -> bool:
    """True, solange users.publish_blocked_until in der Zukunft liegt."""
    until = user.publish_blocked_until
    return until is not None and until > (now or datetime.now(timezone.utc))


async def block_publishing(
    db: AsyncSession, user_id: UUID, *, now: datetime | None = None
) -> None:
    """Publish-Sperre nach Auto-Hide setzen (L3). Haengt am User, nicht am
    Preset: Loeschen/Umbenennen des versteckten Presets hebt sie nicht auf.
    Eine laengere bestehende Sperre wird nicht verkuerzt."""
    until = (now or datetime.now(timezone.utc)) + timedelta(
        days=settings.publish_block_days
    )
    await db.execute(
        update(User)
        .where(User.id == user_id)
        .values(
            publish_blocked_until=func.greatest(
                func.coalesce(User.publish_blocked_until, until), until
            )
        )
        .execution_options(synchronize_session=False)
    )


async def release_publish_block(db: AsyncSession, user_id: UUID) -> None:
    """Sperre aufheben (Admin hat Meldungen verworfen) — aber nur, wenn
    kein weiteres eigenes Preset mehr auto-versteckt ist."""
    still_hidden = (
        await db.execute(
            select(Preset.id)
            .where(
                Preset.user_id == user_id,
                Preset.visibility != "public",
                Preset.report_count >= REPORT_AUTOHIDE_THRESHOLD,
            )
            .limit(1)
        )
    ).scalar_one_or_none()
    if still_hidden is not None:
        return
    await db.execute(
        update(User)
        .where(User.id == user_id)
        .values(publish_blocked_until=None)
        .execution_options(synchronize_session=False)
    )
