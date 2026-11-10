"""Janitor: failed-Rows, Retention (L6), Schritt-Isolation (L16)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import uuid4

from sqlalchemy import select

from app.janitor import prune_pending_uploads, prune_retention
from app.models import Feedback, Image, Preset, PresetReport, User
from app.storage import get_storage


async def _user(db_session, client, headers) -> User:
    me = await client.get("/api/v1/auth/me", headers=headers)
    return (
        await db_session.execute(select(User).where(User.id == me.json()["id"]))
    ).scalar_one()


async def test_janitor_entfernt_alte_failed_rows(db_session, client, user_a):
    user = await _user(db_session, client, user_a["headers"])
    storage = get_storage()
    img = Image(
        user_id=user.id,
        bucket_key=storage.make_key(user.id, uuid4()),
        original_filename="failed.jpg",
        content_type="image/jpeg",
        size_bytes=64,
        upload_state="failed",
    )
    db_session.add(img)
    await db_session.flush()
    img.created_at = datetime.now(timezone.utc) - timedelta(hours=2)
    await db_session.flush()
    storage._client.put_object(Bucket=storage.bucket, Key=img.bucket_key, Body=b"x")

    result = await prune_pending_uploads(db_session, storage)

    assert result.db_deleted == 1
    assert (
        await db_session.execute(select(Image).where(Image.id == img.id))
    ).scalar_one_or_none() is None
    assert storage.list_objects(img.bucket_key) == []


async def test_retention_loescht_altes_erledigtes_feedback_und_alte_meldungen(
    db_session, client, user_a
):
    user = await _user(db_session, client, user_a["headers"])
    old = datetime.now(timezone.utc) - timedelta(days=400)
    fresh = datetime.now(timezone.utc) - timedelta(days=10)
    fb_old_closed = Feedback(user_id=user.id, kind="bug", message="Alt und erledigt.", status="closed")
    fb_old_new = Feedback(user_id=user.id, kind="bug", message="Alt aber offen!!", status="new")
    fb_fresh_closed = Feedback(user_id=user.id, kind="bug", message="Frisch erledigt.", status="closed")
    db_session.add_all([fb_old_closed, fb_old_new, fb_fresh_closed])
    preset = Preset(user_id=user.id, name="Gemeldet", adjustments={})
    db_session.add(preset)
    await db_session.flush()
    rep_old = PresetReport(preset_id=preset.id, reporter_user_id=None, reason="alt")
    rep_fresh = PresetReport(preset_id=preset.id, reporter_user_id=user.id, reason="frisch")
    db_session.add_all([rep_old, rep_fresh])
    await db_session.flush()
    fb_old_closed.updated_at = old
    fb_old_new.updated_at = old
    fb_fresh_closed.updated_at = fresh
    rep_old.created_at = old
    rep_fresh.created_at = fresh
    await db_session.flush()

    result = await prune_retention(db_session)

    assert result.feedback_deleted >= 1
    assert result.reports_deleted >= 1
    remaining_fb = {
        f.id for f in (await db_session.execute(select(Feedback))).scalars().all()
    }
    assert fb_old_closed.id not in remaining_fb
    assert fb_old_new.id in remaining_fb
    assert fb_fresh_closed.id in remaining_fb
    remaining_rep = {
        r.id for r in (await db_session.execute(select(PresetReport))).scalars().all()
    }
    assert rep_old.id not in remaining_rep
    assert rep_fresh.id in remaining_rep


async def test_janitor_skript_isoliert_fehlerhafte_schritte(monkeypatch, capsys):
    """L16: ein crashender Schritt bricht den Lauf nicht ab — die uebrigen
    Schritte laufen, der Fehler steht in der JSON-Statistik."""
    import json

    from scripts import janitor as janitor_script

    called: list[str] = []

    async def _boom(*_a, **_kw):
        raise RuntimeError("kaputt")

    def _ok(name: str):
        async def _step(*_a, **_kw):
            called.append(name)
            return None

        return _step

    steps = [
        ("pending", _boom),
        ("staging", _ok("staging")),
        ("purges", _ok("purges")),
        ("retention", _ok("retention")),
    ]
    monkeypatch.setattr(janitor_script, "_steps", lambda _ttl: steps)

    class _Session:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_a):
            return None

        async def rollback(self):
            return None

    monkeypatch.setattr(janitor_script, "AsyncSessionLocal", lambda: _Session())
    rc = await janitor_script._run(30)
    out = json.loads(capsys.readouterr().out.strip().splitlines()[-1])
    assert rc == 1
    assert called == ["staging", "purges", "retention"]
    assert "kaputt" in out["errors"]["pending"]
