"""Review 2026-11 r2: Janitor-Datenhaltung — abgeleitete Vorschauen beim
Wegraeumen fehlgeschlagener Bilder, preset_applies-Retention (L2), Feedback-
Hoechstalter (L14), Report-Retention ohne Re-Count-Luecke, Export."""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from uuid import UUID, uuid4

from sqlalchemy import select

from app.config import settings
from app.janitor import REPORT_AUTOHIDE_THRESHOLD, prune_pending_uploads, prune_retention
from app.models import Feedback, Image, Preset, PresetApply, PresetReport, User
from app.storage import ObjectNotFound, get_storage
from tests.images import upload_image
from tests.test_review_preview import _preset_body, _preset_row

import pytest


async def _user(db_session, user_info) -> User:
    return (
        await db_session.execute(select(User).where(User.id == UUID(user_info["user"]["id"])))
    ).scalar_one()


# ---------- abgeleitete Vorschauen ----------


async def test_janitor_raeumt_vorschau_fehlgeschlagener_bilder_mit_ab(
    client, user_a, db_session
):
    image_id = await upload_image(client, user_a["headers"])
    r = await client.post(
        "/api/v1/presets", headers=user_a["headers"], json=_preset_body("JanVorschau", image_id)
    )
    preset_id = r.json()["id"]
    key = (await _preset_row(db_session, preset_id)).preview_key
    assert key is not None
    img = (
        await db_session.execute(select(Image).where(Image.id == UUID(image_id)))
    ).scalar_one()
    img.upload_state = "failed"
    img.created_at = datetime.now(timezone.utc) - timedelta(days=1)
    await db_session.commit()

    result = await prune_pending_uploads(db_session, get_storage())
    assert result.db_deleted >= 1
    preset = await _preset_row(db_session, preset_id)
    assert preset.preview_key is None
    assert preset.preview_image_id is None
    with pytest.raises(ObjectNotFound):
        get_storage().head(key)


async def test_bild_loeschen_mit_s3_fehler_entfernt_vorschau_trotzdem(
    client, user_a, db_session, monkeypatch
):
    image_id = await upload_image(client, user_a["headers"])
    r = await client.post(
        "/api/v1/presets", headers=user_a["headers"], json=_preset_body("S3Weg", image_id)
    )
    preset_id = r.json()["id"]
    key = (await _preset_row(db_session, preset_id)).preview_key
    assert key is not None
    storage = get_storage()
    real_delete = storage.delete

    def _fail_originals(k: str) -> None:
        if "/originals/" in k:
            raise RuntimeError("S3 kaputt")
        real_delete(k)

    monkeypatch.setattr(storage, "delete", _fail_originals)
    d = await client.delete(f"/api/v1/images/{image_id}", headers=user_a["headers"])
    assert d.status_code == 502
    assert (await _preset_row(db_session, preset_id)).preview_key is None
    with pytest.raises(ObjectNotFound):
        storage.head(key)


# ---------- preset_applies ----------


async def test_retention_entfernt_apply_eintraege_vor_heute(client, user_a, db_session):
    user = await _user(db_session, user_a)
    preset = Preset(user_id=user.id, name="ApplyRet", adjustments={})
    db_session.add(preset)
    await db_session.flush()
    today = datetime.now(timezone.utc).date()
    db_session.add_all(
        [
            PresetApply(user_id=user.id, preset_id=preset.id, day=today - timedelta(days=1)),
            PresetApply(user_id=user.id, preset_id=preset.id, day=today),
        ]
    )
    await db_session.commit()

    result = await prune_retention(db_session)
    assert result.applies_deleted >= 1
    days = {
        a.day
        for a in (
            await db_session.execute(
                select(PresetApply).where(PresetApply.preset_id == preset.id)
            )
        ).scalars()
    }
    assert days == {today}


async def test_export_enthaelt_marketplace_applies(client, user_a, db_session):
    user = await _user(db_session, user_a)
    preset = Preset(user_id=user.id, name="ApplyExport", adjustments={})
    db_session.add(preset)
    await db_session.flush()
    db_session.add(PresetApply(user_id=user.id, preset_id=preset.id, day=date(2026, 11, 10)))
    await db_session.commit()
    r = await client.get("/api/v1/auth/me/export", headers=user_a["headers"])
    assert r.status_code == 200, r.text
    applies = r.json()["marketplaceApplies"]
    assert {"presetId": str(preset.id), "day": "2026-11-10"} in applies


# ---------- Feedback ----------


async def test_feedback_jeden_status_nach_hoechstalter_loeschen(client, user_a, db_session):
    user = await _user(db_session, user_a)
    very_old = datetime.now(timezone.utc) - timedelta(days=settings.feedback_max_age_days + 5)
    fb_old_open = Feedback(user_id=user.id, kind="bug", message="Uralt und offen.", status="new")
    fb_old_triaged = Feedback(user_id=user.id, kind="idea", message="Uralt triagiert.", status="triaged")
    fb_young_open = Feedback(user_id=user.id, kind="bug", message="Jung und offen.", status="new")
    db_session.add_all([fb_old_open, fb_old_triaged, fb_young_open])
    await db_session.flush()
    fb_old_open.created_at = very_old
    fb_old_triaged.created_at = very_old
    await db_session.commit()

    result = await prune_retention(db_session)
    assert result.feedback_deleted >= 2
    ids = {f.id for f in (await db_session.execute(select(Feedback))).scalars()}
    assert fb_old_open.id not in ids
    assert fb_old_triaged.id not in ids
    assert fb_young_open.id in ids


async def test_anonymisiertes_feedback_nach_retention_loeschen(client, user_a, db_session):
    user = await _user(db_session, user_a)
    old = datetime.now(timezone.utc) - timedelta(days=settings.feedback_retention_days + 5)
    fb_anon_old = Feedback(user_id=None, kind="bug", message="Anonym und alt.", status="new")
    fb_anon_fresh = Feedback(user_id=None, kind="bug", message="Anonym und frisch.", status="new")
    fb_user_old = Feedback(user_id=user.id, kind="bug", message="Mit User und alt.", status="new")
    db_session.add_all([fb_anon_old, fb_anon_fresh, fb_user_old])
    await db_session.flush()
    fb_anon_old.created_at = old
    fb_user_old.created_at = old
    await db_session.commit()

    await prune_retention(db_session)
    ids = {f.id for f in (await db_session.execute(select(Feedback))).scalars()}
    assert fb_anon_old.id not in ids
    assert fb_anon_fresh.id in ids
    # Offenes Feedback eines bestehenden Users bleibt bis zum Hoechstalter.
    assert fb_user_old.id in ids


# ---------- Reports ----------


async def _report(db_session, preset: Preset, *, age_days: int) -> PresetReport:
    rep = PresetReport(preset_id=preset.id, reporter_user_id=None, reason=f"r-{uuid4().hex[:6]}")
    db_session.add(rep)
    await db_session.flush()
    rep.created_at = datetime.now(timezone.utc) - timedelta(days=age_days)
    return rep


async def test_report_retention_nur_fuer_nicht_oeffentliche_unmoderierte_presets(
    client, user_a, db_session
):
    """Meldungen oeffentlicher Presets bleiben (sonst koennte derselbe User
    nach dem Prune erneut melden, der Zaehler stiege), ebenso Meldungen
    auto-versteckter Presets (Moderationsgrundlage)."""
    user = await _user(db_session, user_a)
    age = settings.report_retention_days + 5
    public = Preset(user_id=user.id, name="RepPub", adjustments={}, visibility="public",
                    genre="portrait", report_count=1)
    hidden = Preset(user_id=user.id, name="RepHidden", adjustments={},
                    report_count=REPORT_AUTOHIDE_THRESHOLD)
    private = Preset(user_id=user.id, name="RepPriv", adjustments={}, report_count=1)
    db_session.add_all([public, hidden, private])
    await db_session.flush()
    rep_public = await _report(db_session, public, age_days=age)
    rep_hidden = await _report(db_session, hidden, age_days=age)
    rep_private = await _report(db_session, private, age_days=age)
    await db_session.commit()

    await prune_retention(db_session)
    ids = {r.id for r in (await db_session.execute(select(PresetReport))).scalars()}
    assert rep_public.id in ids
    assert rep_hidden.id in ids
    assert rep_private.id not in ids
