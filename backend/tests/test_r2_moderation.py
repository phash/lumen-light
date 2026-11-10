"""Review 2026-11 r2: Publish-Sperre als User-Flag (L3) und Entfernen der
Vorschau beim Auto-Hide / clear-reports (L4)."""
from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone
from uuid import UUID

import pytest
from sqlalchemy import select, update

from app.config import settings
from app.models import Preset, User
from app.storage import ObjectNotFound, get_storage
from tests.images import upload_image
from tests.test_review_preview import _preset_body, _preset_row


async def _user_row(db_session, info) -> User:
    db_session.expire_all()
    return (
        await db_session.execute(select(User).where(User.id == UUID(info["user"]["id"])))
    ).scalar_one()


async def _auto_hide(client, preset_id: str, reporters: list[dict]) -> None:
    for headers in reporters:
        r = await client.post(
            f"/api/v1/marketplace/presets/{preset_id}/report",
            headers=headers,
            json={"reason": "Spam"},
        )
        assert r.status_code == 204, r.text


@pytest.fixture
def reporters(user_b, user_c, make_keycloak_user, monkeypatch) -> list[dict]:
    monkeypatch.setattr(settings, "report_min_account_age_hours", 0)
    dora = make_keycloak_user(f"dora-{secrets.token_hex(4)}@example.com")
    return [user_b["headers"], user_c["headers"], dora["headers"]]


async def _publish(client, user, name: str) -> tuple[str, str]:
    image_id = await upload_image(client, user["headers"])
    r = await client.post(
        "/api/v1/presets", headers=user["headers"], json=_preset_body(name, image_id)
    )
    assert r.status_code == 201, r.text
    return r.json()["id"], image_id


async def test_auto_hide_setzt_sperre_und_entfernt_vorschau(
    client, user_a, reporters, db_session
):
    pid, _ = await _publish(client, user_a, "Hide-Sperre")
    key = (await _preset_row(db_session, pid)).preview_key
    assert key is not None
    before = datetime.now(timezone.utc)
    await _auto_hide(client, pid, reporters)

    preset = await _preset_row(db_session, pid)
    assert preset.visibility == "private"
    assert preset.preview_key is None
    with pytest.raises(ObjectNotFound):
        get_storage().head(key)
    owner = await _user_row(db_session, user_a)
    assert owner.publish_blocked_until is not None
    assert owner.publish_blocked_until > before + timedelta(days=settings.publish_block_days - 1)


async def test_loeschen_des_versteckten_presets_umgeht_sperre_nicht(
    client, user_a, reporters, db_session
):
    pid, image_id = await _publish(client, user_a, "Hide-Bypass")
    await _auto_hide(client, pid, reporters)
    d = await client.delete(f"/api/v1/presets/{pid}", headers=user_a["headers"])
    assert d.status_code == 204
    r = await client.post(
        "/api/v1/presets", headers=user_a["headers"], json=_preset_body("Neuversuch", image_id)
    )
    assert r.status_code == 403, r.text
    assert "zurückgezogen" in r.json()["detail"]


async def test_abgelaufene_sperre_erlaubt_veroeffentlichen(client, user_a, db_session):
    await db_session.execute(
        update(User)
        .where(User.id == UUID(user_a["user"]["id"]))
        .values(publish_blocked_until=datetime.now(timezone.utc) - timedelta(minutes=1))
    )
    await db_session.commit()
    image_id = await upload_image(client, user_a["headers"])
    r = await client.post(
        "/api/v1/presets", headers=user_a["headers"], json=_preset_body("Abgelaufen", image_id)
    )
    assert r.status_code == 201, r.text


async def test_clear_reports_hebt_sperre_auf(
    client, user_a, reporters, admin_user, db_session
):
    pid, image_id = await _publish(client, user_a, "Hide-Clear")
    await _auto_hide(client, pid, reporters)
    c = await client.post(
        f"/api/v1/admin/presets/{pid}/clear-reports", headers=admin_user["headers"]
    )
    assert c.status_code == 200, c.text
    assert (await _user_row(db_session, user_a)).publish_blocked_until is None
    r = await client.post(
        "/api/v1/presets", headers=user_a["headers"], json=_preset_body("NachClear", image_id)
    )
    assert r.status_code == 201, r.text


async def test_clear_reports_behaelt_sperre_bei_weiterem_versteckten_preset(
    client, user_a, admin_user, db_session
):
    uid = UUID(user_a["user"]["id"])
    first = Preset(user_id=uid, name="Versteckt-1", adjustments={}, report_count=3)
    second = Preset(user_id=uid, name="Versteckt-2", adjustments={}, report_count=3)
    db_session.add_all([first, second])
    await db_session.execute(
        update(User)
        .where(User.id == uid)
        .values(publish_blocked_until=datetime.now(timezone.utc) + timedelta(days=5))
    )
    await db_session.commit()
    c = await client.post(
        f"/api/v1/admin/presets/{first.id}/clear-reports", headers=admin_user["headers"]
    )
    assert c.status_code == 200, c.text
    assert (await _user_row(db_session, user_a)).publish_blocked_until is not None


async def test_clear_reports_entfernt_restliche_vorschau(
    client, user_a, admin_user, db_session
):
    """Altbestand: auto-verstecktes Preset, das noch einen preview_key hat."""
    pid, _ = await _publish(client, user_a, "Hide-Altbestand")
    key = (await _preset_row(db_session, pid)).preview_key
    assert key is not None
    await db_session.execute(
        update(Preset)
        .where(Preset.id == UUID(pid))
        .values(visibility="private", published_at=None, report_count=3)
    )
    await db_session.commit()
    c = await client.post(
        f"/api/v1/admin/presets/{pid}/clear-reports", headers=admin_user["headers"]
    )
    assert c.status_code == 200, c.text
    assert (await _preset_row(db_session, pid)).preview_key is None
    with pytest.raises(ObjectNotFound):
        get_storage().head(key)


async def test_abgelaufene_sperre_blockiert_solange_preset_versteckt_ist(
    client, user_a, reporters, db_session
):
    pid, _ = await _publish(client, user_a, "Noch-Versteckt")
    await _auto_hide(client, pid, reporters)
    # Timer abgelaufen, Moderation aber noch offen (Preset weiter versteckt).
    await db_session.execute(
        update(User)
        .where(User.id == UUID(user_a["user"]["id"]))
        .values(publish_blocked_until=datetime.now(timezone.utc) - timedelta(minutes=1))
    )
    await db_session.commit()
    image_id = await upload_image(client, user_a["headers"])
    r = await client.post(
        "/api/v1/presets",
        headers=user_a["headers"],
        json=_preset_body("Neuer-Versuch", image_id),
    )
    assert r.status_code == 403, r.text
