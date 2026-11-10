"""Admin: 403 fuer Nicht-Admins auf JEDER Admin-Route (Zustand unveraendert)
und Schutz gegen Selbst-Sperre."""
from __future__ import annotations

from uuid import UUID

from sqlalchemy import select

from app.models import Feedback, Preset, User


async def test_nicht_admin_bekommt_403_auf_allen_admin_routen(
    client, user_a, user_b, db_session
):
    fb = Feedback(user_id=UUID(user_b["user"]["id"]), kind="bug", message="Ein Feedback-Text.")
    preset = Preset(
        user_id=UUID(user_b["user"]["id"]), name="Gemeldet-403", adjustments={}, report_count=3
    )
    db_session.add_all([fb, preset])
    await db_session.commit()
    fb_id, preset_id = fb.id, preset.id

    h = user_a["headers"]
    calls = [
        ("GET", "/api/v1/admin/users", None),
        ("PATCH", f"/api/v1/admin/users/{user_b['user']['id']}", {"isDisabled": True}),
        ("GET", "/api/v1/admin/stats", None),
        ("GET", "/api/v1/admin/feedback", None),
        ("PATCH", f"/api/v1/admin/feedback/{fb_id}", {"status": "closed", "adminNotes": "x"}),
        ("GET", "/api/v1/admin/presets/reported", None),
        ("POST", f"/api/v1/admin/presets/{preset_id}/clear-reports", None),
    ]
    for method, url, body in calls:
        r = await client.request(method, url, headers=h, json=body)
        assert r.status_code == 403, f"{method} {url}: {r.status_code}"

    db_session.expire_all()
    b = (await db_session.execute(select(User).where(User.id == UUID(user_b["user"]["id"])))).scalar_one()
    assert b.is_disabled is False
    fb_row = (await db_session.execute(select(Feedback).where(Feedback.id == fb_id))).scalar_one()
    assert fb_row.status == "new" and fb_row.admin_notes is None
    p_row = (await db_session.execute(select(Preset).where(Preset.id == preset_id))).scalar_one()
    assert p_row.report_count == 3


async def test_admin_kann_sich_nicht_selbst_sperren(client, admin_user, db_session):
    r = await client.patch(
        f"/api/v1/admin/users/{admin_user['user']['id']}",
        headers=admin_user["headers"],
        json={"isDisabled": True},
    )
    assert r.status_code == 400, r.text
    assert r.json()["detail"] == "Du kannst dich nicht selbst sperren."
    db_session.expire_all()
    me = (
        await db_session.execute(select(User).where(User.id == UUID(admin_user["user"]["id"])))
    ).scalar_one()
    assert me.is_disabled is False
