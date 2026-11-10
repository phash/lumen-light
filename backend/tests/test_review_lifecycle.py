"""DELETE /me: vollstaendige DB-Bereinigung, Anonymisierung, Purge-
Vormerkung (L5) und Reihenfolge DB-Commit vor S3-Purge."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import UUID

import pytest
from sqlalchemy import select

from app.models import Feedback, Image, ImageEdit, Preset, PresetReport, StoragePurge
from app.storage import get_storage
from tests.images import upload_image


ZERO_ADJ = {
    "exposure": 0.0, "contrast": 0.0, "highlights": 0.0, "shadows": 0.0,
    "whites": 0.0, "blacks": 0.0, "temperature": 0.0, "tint": 0.0,
    "vibrance": 0.0, "saturation": 0.0,
}


async def test_delete_me_entfernt_alle_rows_und_anonymisiert(
    client, user_a, user_b, db_session, monkeypatch
):
    from app.config import settings

    monkeypatch.setattr(settings, "report_min_account_age_hours", 0)
    uid = UUID(user_a["user"]["id"])

    image_id = await upload_image(client, user_a["headers"])
    edit = await client.put(
        f"/api/v1/images/{image_id}/edit",
        headers=user_a["headers"],
        json={"adjustments": ZERO_ADJ},
    )
    assert edit.status_code == 204, edit.text
    pub = await client.post(
        "/api/v1/presets", headers=user_a["headers"],
        json={
            "name": "Oeffentlich", "adjustments": ZERO_ADJ, "visibility": "public",
            "genre": "portrait", "description": "Wird mit dem Account geloescht.",
            "previewImageId": image_id,
        },
    )
    assert pub.status_code == 201, pub.text
    fb = await client.post(
        "/api/v1/feedback", headers=user_a["headers"],
        json={"kind": "idea", "message": "Feedback, das anonym bleiben soll.", "page": "/"},
    )
    assert fb.status_code in (201, 204), fb.text

    b_img = await upload_image(client, user_b["headers"])
    b_pub = await client.post(
        "/api/v1/presets", headers=user_b["headers"],
        json={
            "name": "Von B", "adjustments": ZERO_ADJ, "visibility": "public",
            "genre": "portrait", "description": "Wird von A gemeldet.",
            "previewImageId": b_img,
        },
    )
    rep = await client.post(
        f"/api/v1/marketplace/presets/{b_pub.json()['id']}/report",
        headers=user_a["headers"], json={"reason": "Testmeldung"},
    )
    assert rep.status_code == 204, rep.text

    r = await client.delete("/api/v1/auth/me", headers=user_a["headers"])
    assert r.status_code == 204, r.text
    db_session.expire_all()

    assert (await db_session.execute(select(Preset).where(Preset.user_id == uid))).first() is None
    assert (await db_session.execute(select(Image).where(Image.user_id == uid))).first() is None
    assert (
        await db_session.execute(select(ImageEdit).where(ImageEdit.image_id == UUID(image_id)))
    ).first() is None
    feedbacks = (
        await db_session.execute(
            select(Feedback).where(Feedback.message == "Feedback, das anonym bleiben soll.")
        )
    ).scalars().all()
    assert len(feedbacks) == 1 and feedbacks[0].user_id is None
    reports = (
        await db_session.execute(
            select(PresetReport).where(PresetReport.preset_id == UUID(b_pub.json()["id"]))
        )
    ).scalars().all()
    assert len(reports) == 1 and reports[0].reporter_user_id is None

    gone = await client.get(f"/api/v1/marketplace/presets/{pub.json()['id']}")
    assert gone.status_code == 404
    listing = await client.get("/api/v1/marketplace/presets")
    assert pub.json()["id"] not in [i["id"] for i in listing.json()["items"]]


async def test_delete_me_merkt_prefix_immer_verzoegert_vor(client, user_a, db_session):
    """Auch bei erfolgreichem Sofort-Purge bleibt eine Vormerkung, die erst
    nach Ablauf der Upload-Policy faellig wird (spaete Staging-Uploads)."""
    from app.config import settings

    before = datetime.now(timezone.utc)
    r = await client.delete("/api/v1/auth/me", headers=user_a["headers"])
    assert r.status_code == 204
    row = (
        await db_session.execute(
            select(StoragePurge).where(StoragePurge.prefix == f"{user_a['user']['id']}/")
        )
    ).scalar_one()
    assert row.not_before >= before + timedelta(seconds=settings.presigned_url_expires_in)


async def test_spaeter_staging_upload_wird_vom_janitor_entfernt(
    client, user_a, db_session
):
    from app.janitor import retry_storage_purges

    prefix = f"{user_a['user']['id']}/"
    r = await client.delete("/api/v1/auth/me", headers=user_a["headers"])
    assert r.status_code == 204
    storage = get_storage()
    # Upload mit noch gueltiger Policy NACH der Loeschung.
    storage._client.put_object(Bucket=storage.bucket, Key=prefix + "staging/spaet", Body=b"x")

    # Vor Ablauf der Wartezeit: nichts passiert, Row bleibt.
    early = await retry_storage_purges(db_session, storage)
    assert early.purged == 0
    assert storage.list_objects(prefix) != []

    later = datetime.now(timezone.utc) + timedelta(hours=1)
    result = await retry_storage_purges(db_session, storage, now=later)
    assert result.purged == 1
    assert storage.list_objects(prefix) == []
    assert (
        await db_session.execute(select(StoragePurge).where(StoragePurge.prefix == prefix))
    ).scalar_one_or_none() is None
    # Idempotent: zweiter Lauf hat nichts mehr zu tun.
    again = await retry_storage_purges(db_session, storage, now=later)
    assert again.candidates == 0


async def test_db_fehler_beim_loeschen_laesst_s3_objekte_unberuehrt(
    client, user_a, db_session, monkeypatch
):
    """Erst DB-Commit, dann S3-Purge: scheitert der Commit, sind die Bilder
    noch vollstaendig da (kein User ohne Objekte)."""
    image_id = await upload_image(client, user_a["headers"])
    key = f"{user_a['user']['id']}/originals/{image_id}"

    async def _boom() -> None:
        raise RuntimeError("DB down")

    monkeypatch.setattr(db_session, "commit", _boom)
    with pytest.raises(RuntimeError):
        await client.delete("/api/v1/auth/me", headers=user_a["headers"])
    assert get_storage().head(key) > 0
