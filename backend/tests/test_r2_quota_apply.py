"""Review 2026-11 r2: Kontingent-Zaehlung race-frei per User-Row-Lock (L5),
Grenzwerte, Pagination hinter dem Ende, Apply-Dedupe ueber Tage."""
from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy import event, select

from app.config import settings
from app.models import PresetApply
from tests.images import upload_image
from tests.test_review_preview import _preset_body


ZERO_ADJ = {
    "exposure": 0.0, "contrast": 0.0, "highlights": 0.0, "shadows": 0.0,
    "whites": 0.0, "blacks": 0.0, "temperature": 0.0, "tint": 0.0,
    "vibrance": 0.0, "saturation": 0.0,
}


@contextmanager
def _capture_sql(engine):
    statements: list[str] = []

    def _listener(_conn, _cursor, statement, *_args):
        statements.append(" ".join(statement.split()))

    event.listen(engine.sync_engine, "before_cursor_execute", _listener)
    try:
        yield statements
    finally:
        event.remove(engine.sync_engine, "before_cursor_execute", _listener)


def _locks_user_row(statements: list[str]) -> bool:
    return any(
        "FROM users" in s and "FOR UPDATE" in s and "WHERE users.id" in s
        for s in statements
    )


async def _init(client, headers, size: int):
    return await client.post(
        "/api/v1/images",
        headers=headers,
        json={"filename": "q.jpg", "contentType": "image/jpeg", "sizeBytes": size},
    )


async def test_init_upload_sperrt_user_row(client, user_a, engine):
    with _capture_sql(engine) as sql:
        r = await _init(client, user_a["headers"], 1000)
    assert r.status_code == 201, r.text
    assert _locks_user_row(sql)


async def test_preset_anlegen_sperrt_user_row(client, user_a, engine):
    with _capture_sql(engine) as sql:
        r = await client.post(
            "/api/v1/presets", headers=user_a["headers"],
            json={"name": "Lock", "adjustments": ZERO_ADJ},
        )
    assert r.status_code == 201, r.text
    assert _locks_user_row(sql)


async def test_fork_sperrt_user_row(client, user_a, user_b, engine):
    image_id = await upload_image(client, user_a["headers"])
    pub = await client.post(
        "/api/v1/presets", headers=user_a["headers"], json=_preset_body("ForkLock", image_id)
    )
    assert pub.status_code == 201, pub.text
    with _capture_sql(engine) as sql:
        r = await client.post(
            f"/api/v1/marketplace/presets/{pub.json()['id']}/fork", headers=user_b["headers"]
        )
    assert r.status_code == 201, r.text
    assert _locks_user_row(sql)


async def test_speicherkontingent_grenzwert(client, user_a, monkeypatch):
    monkeypatch.setattr(settings, "max_user_storage_bytes", 3000)
    first = await _init(client, user_a["headers"], 1000)
    assert first.status_code == 201, first.text
    # used + size == max -> erlaubt
    exact = await _init(client, user_a["headers"], 2000)
    assert exact.status_code == 201, exact.text
    # ein Byte darueber -> 413
    over = await _init(client, user_a["headers"], 1)
    assert over.status_code == 413, over.text


async def test_images_offset_hinter_dem_ende(client, user_a):
    await upload_image(client, user_a["headers"])
    r = await client.get("/api/v1/images?offset=1000", headers=user_a["headers"])
    assert r.status_code == 200, r.text
    assert r.json() == []
    assert r.headers["x-total-count"] == "1"


async def test_presets_offset_hinter_dem_ende(client, user_a):
    r = await client.get("/api/v1/presets?offset=100000", headers=user_a["headers"])
    assert r.status_code == 200, r.text
    assert r.json() == []
    assert int(r.headers["x-total-count"]) >= 1  # Default-Presets


async def test_apply_dedupe_ueber_tage(client, user_a, user_b, db_session):
    image_id = await upload_image(client, user_a["headers"])
    pub = await client.post(
        "/api/v1/presets", headers=user_a["headers"], json=_preset_body("ApplyTage", image_id)
    )
    preset_id = pub.json()["id"]
    url = f"/api/v1/marketplace/presets/{preset_id}/apply"
    # Eintrag von gestern: zaehlt heute nicht als Duplikat.
    yesterday = (datetime.now(timezone.utc) - timedelta(days=1)).date()
    db_session.add(
        PresetApply(
            user_id=UUID(user_b["user"]["id"]), preset_id=UUID(preset_id), day=yesterday
        )
    )
    await db_session.commit()

    async def _count() -> int:
        d = await client.get(f"/api/v1/marketplace/presets/{preset_id}")
        return int(d.json()["applyCount"])

    before = await _count()
    assert (await client.post(url, headers=user_b["headers"])).status_code == 200
    assert await _count() == before + 1
    assert (await client.post(url, headers=user_b["headers"])).status_code == 200
    assert await _count() == before + 1
    rows = (
        await db_session.execute(
            select(PresetApply).where(PresetApply.preset_id == UUID(preset_id))
        )
    ).scalars().all()
    assert len(rows) == 2
