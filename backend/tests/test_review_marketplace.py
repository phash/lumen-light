"""L9: Apply-Dedupe pro User/Tag, Publish-Sperre bei auto-verstecktem
Preset, Limit-Obergrenze."""
from __future__ import annotations

from uuid import UUID

from datetime import datetime, timedelta, timezone

from sqlalchemy import update

from app.models import Preset, User
from tests.images import upload_image


ZERO_ADJ = {
    "exposure": 0.0, "contrast": 0.0, "highlights": 0.0, "shadows": 0.0,
    "whites": 0.0, "blacks": 0.0, "temperature": 0.0, "tint": 0.0,
    "vibrance": 0.0, "saturation": 0.0,
}


async def _publish(client, headers, name: str) -> dict:
    image_id = await upload_image(client, headers)
    r = await client.post(
        "/api/v1/presets", headers=headers,
        json={
            "name": name, "adjustments": ZERO_ADJ, "visibility": "public",
            "genre": "portrait", "description": "Marketplace-Review-Test.",
            "previewImageId": image_id,
        },
    )
    assert r.status_code == 201, r.text
    return r.json()


async def test_apply_zaehlt_pro_user_und_tag_nur_einmal(client, user_a, user_b, user_c):
    preset = await _publish(client, user_a["headers"], "Dedupe")
    for _ in range(3):
        r = await client.post(
            f"/api/v1/marketplace/presets/{preset['id']}/apply", headers=user_b["headers"]
        )
        assert r.status_code == 200, r.text
    r = await client.post(
        f"/api/v1/marketplace/presets/{preset['id']}/apply", headers=user_c["headers"]
    )
    assert r.status_code == 200
    detail = await client.get(f"/api/v1/marketplace/presets/{preset['id']}")
    assert detail.json()["applyCount"] == 2


async def test_owner_mit_auto_verstecktem_preset_kann_nicht_veroeffentlichen(
    client, user_a, db_session
):
    hidden = await _publish(client, user_a["headers"], "Versteckt")
    await db_session.execute(
        update(Preset)
        .where(Preset.id == UUID(hidden["id"]))
        .values(visibility="private", published_at=None, report_count=3)
    )
    # Auto-Hide setzt die Sperre am User (Migration 012).
    await db_session.execute(
        update(User)
        .where(User.id == UUID(user_a["user"]["id"]))
        .values(publish_blocked_until=datetime.now(timezone.utc) + timedelta(days=30))
    )
    await db_session.commit()

    image_id = await upload_image(client, user_a["headers"])
    r = await client.post(
        "/api/v1/presets", headers=user_a["headers"],
        json={
            "name": "Neu", "adjustments": ZERO_ADJ, "visibility": "public",
            "genre": "portrait", "description": "Soll gesperrt sein.",
            "previewImageId": image_id,
        },
    )
    assert r.status_code == 403, r.text
    assert "zurückgezogen" in r.json()["detail"]

    # Privat anlegen geht weiterhin, Veroeffentlichen per PUT nicht.
    priv = await client.post(
        "/api/v1/presets", headers=user_a["headers"],
        json={"name": "Privat", "adjustments": ZERO_ADJ},
    )
    assert priv.status_code == 201
    put = await client.put(
        f"/api/v1/presets/{priv.json()['id']}", headers=user_a["headers"],
        json={
            "name": "Privat", "adjustments": ZERO_ADJ, "visibility": "public",
            "genre": "portrait", "description": "Soll gesperrt sein.",
            "previewImageId": image_id,
        },
    )
    assert put.status_code == 403, put.text


async def test_marketplace_limit_obergrenze(client):
    r = await client.get("/api/v1/marketplace/presets?limit=1000")
    assert r.status_code == 422
