"""Admin-Bereich: Role-Gating, User-Liste, Disable-Toggle, Stats,
Feedback-Inbox + PATCH."""
from __future__ import annotations

import pytest


@pytest.mark.asyncio
async def test_non_admin_user_forbidden(client, user_a):
    r = await client.get("/api/v1/admin/users", headers=user_a["headers"])
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_admin_can_list_users(client, admin_user, user_a, user_b):
    r = await client.get("/api/v1/admin/users", headers=admin_user["headers"])
    assert r.status_code == 200, r.text
    body = r.json()
    emails = {u["email"] for u in body}
    assert user_a["user"]["email"] in emails
    assert user_b["user"]["email"] in emails

    me = next(u for u in body if u["id"] == user_a["user"]["id"])
    # Aggregat-Felder im camelCase
    for key in (
        "presetCount",
        "publishedPresetCount",
        "imageCount",
        "feedbackCount",
        "isDisabled",
    ):
        assert key in me, f"Feld {key} fehlt im AdminUserOut"
    assert me["isDisabled"] is False


@pytest.mark.asyncio
async def test_admin_disable_toggle_blocks_user(client, admin_user, user_a):
    target_id = user_a["user"]["id"]

    r = await client.patch(
        f"/api/v1/admin/users/{target_id}",
        headers=admin_user["headers"],
        json={"isDisabled": True},
    )
    assert r.status_code == 200, r.text
    assert r.json()["isDisabled"] is True

    # Zielbenutzer kommt jetzt mit 403 nicht mehr durch.
    me = await client.get("/api/v1/auth/me", headers=user_a["headers"])
    assert me.status_code == 403, me.text

    # Re-Enable funktioniert
    r2 = await client.patch(
        f"/api/v1/admin/users/{target_id}",
        headers=admin_user["headers"],
        json={"isDisabled": False},
    )
    assert r2.status_code == 200
    me2 = await client.get("/api/v1/auth/me", headers=user_a["headers"])
    assert me2.status_code == 200


@pytest.mark.asyncio
async def test_admin_stats(client, admin_user, user_a):
    r = await client.get("/api/v1/admin/stats", headers=admin_user["headers"])
    assert r.status_code == 200, r.text
    s = r.json()
    # Mindestens die zwei User existieren (admin + user_a)
    assert s["userCount"] >= 2
    for key in (
        "userDisabledCount",
        "presetCount",
        "presetPublishedCount",
        "imageCount",
        "feedbackOpenCount",
        "reportOpenCount",
    ):
        assert key in s


@pytest.mark.asyncio
async def test_admin_feedback_inbox(client, admin_user, user_a):
    # User submitted Feedback
    r = await client.post(
        "/api/v1/feedback",
        headers=user_a["headers"],
        json={
            "kind": "bug",
            "message": "Etwas ist kaputt — die Tonkurve laesst sich nicht resetten.",
            "page": "/editor",
        },
    )
    assert r.status_code == 201, r.text
    fb_id = r.json()["id"]
    assert fb_id is not None

    # Admin sieht es
    listing = await client.get(
        "/api/v1/admin/feedback", headers=admin_user["headers"]
    )
    assert listing.status_code == 200
    items = listing.json()
    assert any(i["id"] == fb_id for i in items)
    found = next(i for i in items if i["id"] == fb_id)
    assert found["kind"] == "bug"
    assert found["userEmail"] == user_a["user"]["email"]
    assert found["status"] == "new"

    # PATCH triagiert
    p = await client.patch(
        f"/api/v1/admin/feedback/{fb_id}",
        headers=admin_user["headers"],
        json={"status": "triaged", "adminNotes": "Geprueft, betrifft Edge-Case."},
    )
    assert p.status_code == 200
    assert p.json()["status"] == "triaged"
    assert p.json()["adminNotes"].startswith("Geprueft")

    # Filter status=closed liefert das nicht
    closed_only = await client.get(
        "/api/v1/admin/feedback?status_filter=closed",
        headers=admin_user["headers"],
    )
    assert closed_only.status_code == 200
    assert all(i["id"] != fb_id for i in closed_only.json())


@pytest.mark.asyncio
async def test_disabled_admin_cannot_use_admin_endpoints(
    client, admin_user, db_session
):
    """Lockout-Schutz: auch ein Admin mit gueltigem Token + admin-Rolle wird
    geblockt (403), sobald sein Account deaktiviert ist. Deckt den separaten
    is_disabled-Block in current_admin ab (nicht nur den in current_user)."""
    from sqlalchemy import select

    from app.models import User

    u = (
        await db_session.execute(
            select(User).where(User.id == admin_user["user"]["id"])
        )
    ).scalar_one()
    u.is_disabled = True
    await db_session.commit()

    r = await client.get("/api/v1/admin/users", headers=admin_user["headers"])
    assert r.status_code == 403, r.text


def test_has_admin_role_realm_access():
    from app.auth import _has_admin_role

    assert _has_admin_role({"realm_access": {"roles": ["admin", "user"]}}) is True


def test_has_admin_role_resource_access_fallback():
    """Admin-Rolle nur als Client-Role unter resource_access.<client>.roles —
    der Fallback-Pfad in _has_admin_role muss sie ebenfalls erkennen."""
    from app.auth import _has_admin_role

    assert (
        _has_admin_role({"resource_access": {"lumen-api": {"roles": ["admin"]}}})
        is True
    )


def test_has_admin_role_absent():
    from app.auth import _has_admin_role

    assert _has_admin_role({"realm_access": {"roles": ["user"]}}) is False
    assert _has_admin_role({}) is False


@pytest.mark.asyncio
async def test_admin_feedback_patch_invalid_id_404(client, admin_user):
    r = await client.patch(
        "/api/v1/admin/feedback/00000000-0000-0000-0000-000000000000",
        headers=admin_user["headers"],
        json={"status": "closed"},
    )
    assert r.status_code == 404


def test_has_admin_role_ignoriert_fremde_clients():
    """Eine admin-Rolle an einem beliebigen anderen Client macht niemanden
    zum Lumen-Admin — nur realm_access oder der eigene API-Client zaehlen."""
    from app.auth import _has_admin_role

    assert (
        _has_admin_role({"resource_access": {"other-app": {"roles": ["admin"]}}})
        is False
    )



@pytest.mark.asyncio
async def test_admin_kann_auto_verstecktes_preset_wiederherstellen(
    client, admin_user, user_a, db_session, monkeypatch
):
    """Moderation: Admin sieht gemeldete Presets und kann die Meldungen
    verwerfen; danach darf der Creator wieder veroeffentlichen."""
    from sqlalchemy import update

    from app.models import Preset

    r = await client.post(
        "/api/v1/presets",
        headers=user_a["headers"],
        json={"name": "zu-unrecht", "adjustments": {"exposure": 0}},
    )
    pid = r.json()["id"]
    await db_session.execute(
        update(Preset).where(Preset.id == pid).values(report_count=3)
    )
    await db_session.commit()

    from uuid import UUID

    from app.models import PresetReport

    db_session.add(PresetReport(preset_id=UUID(pid), reason="Spam-Name"))
    await db_session.commit()

    listed = await client.get(
        "/api/v1/admin/presets/reported", headers=admin_user["headers"]
    )
    assert listed.status_code == 200
    entry = next(p for p in listed.json() if p["id"] == pid)
    # Moderations-UI braucht Gruende + Creator (fuer "Nutzer sperren").
    assert entry["reportCount"] == 3
    assert entry["ownerEmail"] == user_a["user"]["email"]
    assert entry["ownerId"] == user_a["user"]["id"]
    assert [r["reason"] for r in entry["reports"]] == ["Spam-Name"]

    cleared = await client.post(
        f"/api/v1/admin/presets/{pid}/clear-reports", headers=admin_user["headers"]
    )
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["reportCount"] == 0

    forbidden = await client.get(
        "/api/v1/admin/presets/reported", headers=user_a["headers"]
    )
    assert forbidden.status_code == 403
