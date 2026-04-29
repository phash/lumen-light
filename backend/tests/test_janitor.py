"""Janitor: pending Uploads aelter als TTL aus S3 + DB raeumen."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.janitor import prune_pending_uploads
from app.models import Image
from app.storage import ObjectNotFound, get_storage


async def _make_pending(db_session, user, *, age: timedelta) -> Image:
    """Pending Image-Row anlegen + S3-Object hochladen + created_at zurueckdatieren."""
    storage = get_storage()
    img = Image(
        user_id=user.id,
        bucket_key=storage.make_key(user.id, _uuid()),
        original_filename="pending.jpg",
        content_type="image/jpeg",
        size_bytes=None,
        upload_state="pending",
    )
    db_session.add(img)
    await db_session.flush()
    img.created_at = datetime.now(timezone.utc) - age
    await db_session.flush()

    # Echtes S3-Object hochladen, damit die Cleanup-Pfade einen realistischen
    # State sehen.
    storage._client.put_object(  # noqa: SLF001 — Test-Helper
        Bucket=storage.bucket, Key=img.bucket_key, Body=b"x" * 64
    )
    return img


def _uuid():
    from uuid import uuid4

    return uuid4()


async def _user_record(db_session, client, headers):
    """User-Row aus der Test-DB holen (JIT-provisioniert beim ersten /me-Call)."""
    from app.models import User

    me = await client.get("/api/v1/auth/me", headers=headers)
    assert me.status_code == 200
    user_id = me.json()["id"]
    user = (
        await db_session.execute(select(User).where(User.id == user_id))
    ).scalar_one()
    return user


@pytest.mark.asyncio
async def test_prune_removes_old_pending_rows(db_session, client, user_a):
    user = await _user_record(db_session, client, user_a["headers"])
    storage = get_storage()

    # 1 alter pending (>15min), 1 frischer pending, 1 alter ready
    old_pending = await _make_pending(db_session, user, age=timedelta(minutes=20))
    fresh_pending = await _make_pending(db_session, user, age=timedelta(minutes=5))

    ready = Image(
        user_id=user.id,
        bucket_key=storage.make_key(user.id, _uuid()),
        original_filename="ready.jpg",
        content_type="image/jpeg",
        size_bytes=64,
        upload_state="ready",
    )
    db_session.add(ready)
    await db_session.flush()
    ready.created_at = datetime.now(timezone.utc) - timedelta(minutes=20)
    await db_session.flush()
    storage._client.put_object(
        Bucket=storage.bucket, Key=ready.bucket_key, Body=b"x" * 64
    )

    result = await prune_pending_uploads(db_session, storage)

    assert result.candidates == 1
    assert result.storage_deleted == 1
    assert result.db_deleted == 1
    assert result.storage_errors == 0

    # Alter pending Row + S3-Object weg
    assert (
        await db_session.execute(select(Image).where(Image.id == old_pending.id))
    ).scalar_one_or_none() is None
    with pytest.raises(ObjectNotFound):
        storage.head(old_pending.bucket_key)

    # Frischer pending bleibt
    assert (
        await db_session.execute(select(Image).where(Image.id == fresh_pending.id))
    ).scalar_one_or_none() is not None
    assert storage.head(fresh_pending.bucket_key) > 0

    # Ready bleibt selbstverstaendlich auch
    assert (
        await db_session.execute(select(Image).where(Image.id == ready.id))
    ).scalar_one_or_none() is not None


@pytest.mark.asyncio
async def test_prune_is_idempotent(db_session, client, user_a):
    user = await _user_record(db_session, client, user_a["headers"])
    storage = get_storage()

    await _make_pending(db_session, user, age=timedelta(minutes=20))

    first = await prune_pending_uploads(db_session, storage)
    assert first.db_deleted == 1

    second = await prune_pending_uploads(db_session, storage)
    assert second.candidates == 0
    assert second.db_deleted == 0
    assert second.storage_errors == 0


@pytest.mark.asyncio
async def test_prune_storage_error_keeps_db_row(db_session, client, user_a):
    """Wenn S3 wirft, bleibt die DB-Row stehen, damit der naechste Lauf
    es wieder versuchen kann."""
    user = await _user_record(db_session, client, user_a["headers"])
    storage = get_storage()
    pending = await _make_pending(db_session, user, age=timedelta(minutes=20))

    class BoomStorage:
        bucket = storage.bucket

        def delete(self, key: str) -> None:
            raise RuntimeError("S3 down")

    result = await prune_pending_uploads(db_session, BoomStorage())  # type: ignore[arg-type]

    assert result.candidates == 1
    assert result.storage_errors == 1
    assert result.db_deleted == 0

    assert (
        await db_session.execute(select(Image).where(Image.id == pending.id))
    ).scalar_one_or_none() is not None


@pytest.mark.asyncio
async def test_prune_respects_custom_ttl(db_session, client, user_a):
    user = await _user_record(db_session, client, user_a["headers"])
    storage = get_storage()

    # Nur 8 Minuten alt — bei TTL=5min schon faellig
    img = await _make_pending(db_session, user, age=timedelta(minutes=8))

    result = await prune_pending_uploads(
        db_session, storage, ttl=timedelta(minutes=5)
    )

    assert result.db_deleted == 1
    assert (
        await db_session.execute(select(Image).where(Image.id == img.id))
    ).scalar_one_or_none() is None
