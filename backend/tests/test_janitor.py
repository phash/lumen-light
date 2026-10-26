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

    # Echtes S3-Object am Staging-Key hochladen (dorthin zeigt der Pre-Signed
    # PUT), damit die Cleanup-Pfade einen realistischen State sehen.
    storage._client.put_object(  # noqa: SLF001 — Test-Helper
        Bucket=storage.bucket,
        Key=storage.staging_key_for(img.bucket_key),
        Body=b"x" * 64,
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
        storage.head(storage.staging_key_for(old_pending.bucket_key))

    # Frischer pending bleibt
    assert (
        await db_session.execute(select(Image).where(Image.id == fresh_pending.id))
    ).scalar_one_or_none() is not None
    assert storage.head(storage.staging_key_for(fresh_pending.bucket_key)) > 0

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
        staging_key_for = staticmethod(storage.staging_key_for)

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


# ---------- Staging-Sweep + Purge-Retry (Security-Review 2026-10) ----------


@pytest.mark.asyncio
async def test_sweep_loescht_alte_staging_reste_bestaetigter_bilder(
    db_session, client, user_a
):
    from app.janitor import sweep_stale_staging

    user = await _user_record(db_session, client, user_a["headers"])
    storage = get_storage()
    ready_id = _uuid()
    ready = Image(
        user_id=user.id,
        bucket_key=storage.make_key(user.id, ready_id),
        original_filename="ready.jpg",
        content_type="image/jpeg",
        size_bytes=64,
        upload_state="ready",
    )
    db_session.add(ready)
    await db_session.flush()
    leftover = storage.make_staging_key(user.id, ready_id)
    storage._client.put_object(Bucket=storage.bucket, Key=leftover, Body=b"x")
    pending = await _make_pending(db_session, user, age=timedelta(minutes=1))
    pending_staging = storage.staging_key_for(pending.bucket_key)

    # "now" in der Zukunft -> beide Objekte gelten als alt.
    later = datetime.now(timezone.utc) + timedelta(hours=2)
    result = await sweep_stale_staging(db_session, storage, now=later)

    assert result.deleted == 1
    with pytest.raises(ObjectNotFound):
        storage.head(leftover)
    # Staging eines noch offenen Uploads bleibt (prune_pending_uploads zustaendig).
    assert storage.head(pending_staging) > 0


@pytest.mark.asyncio
async def test_sweep_laesst_frische_staging_objekte_stehen(
    db_session, client, user_a
):
    from app.janitor import sweep_stale_staging

    user = await _user_record(db_session, client, user_a["headers"])
    storage = get_storage()
    key = storage.make_staging_key(user.id, _uuid())
    storage._client.put_object(Bucket=storage.bucket, Key=key, Body=b"x")

    result = await sweep_stale_staging(db_session, storage)

    assert result.deleted == 0
    assert storage.head(key) > 0


@pytest.mark.asyncio
async def test_purge_retry_loescht_prefix_und_row(db_session):
    from app.janitor import retry_storage_purges
    from app.models import StoragePurge

    storage = get_storage()
    prefix = f"{_uuid()}/"
    for k in ("originals/a", "staging/b", "originals/c"):
        storage._client.put_object(Bucket=storage.bucket, Key=prefix + k, Body=b"x")
    db_session.add(StoragePurge(prefix=prefix))
    await db_session.flush()

    result = await retry_storage_purges(db_session, storage)

    assert result.purged == 1
    assert storage.list_objects(prefix) == []
    assert (
        await db_session.execute(
            select(StoragePurge).where(StoragePurge.prefix == prefix)
        )
    ).scalar_one_or_none() is None


@pytest.mark.asyncio
async def test_purge_retry_fehler_behaelt_row_und_zaehlt_versuche(db_session):
    from app.janitor import retry_storage_purges
    from app.models import StoragePurge

    prefix = f"{_uuid()}/"
    db_session.add(StoragePurge(prefix=prefix))
    await db_session.flush()

    class BoomStorage:
        def delete_prefix(self, _prefix: str) -> int:
            raise RuntimeError("S3 down")

    result = await retry_storage_purges(db_session, BoomStorage())  # type: ignore[arg-type]

    assert result.errors == 1
    row = (
        await db_session.execute(
            select(StoragePurge).where(StoragePurge.prefix == prefix)
        )
    ).scalar_one()
    assert row.attempts == 1
    assert "S3 down" in (row.last_error or "")
