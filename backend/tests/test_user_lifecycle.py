"""DSGVO-Endpoints: DELETE /me + GET /me/export."""
import urllib.request


def _put_to_url(url: str, data: bytes, content_type: str) -> None:
    req = urllib.request.Request(
        url, data=data, method="PUT",
        headers={"Content-Type": content_type},
    )
    with urllib.request.urlopen(req, timeout=5) as resp:
        assert 200 <= resp.status < 300


# JPEG-Magic-Bytes vorne — confirm() validiert den Content-Type.
async def _upload_image(client, headers, payload=b"\xff\xd8\xff\xe0" + b"x" * 1020) -> str:
    init = await client.post(
        "/api/v1/images",
        headers=headers,
        json={
            "filename": "lifecycle.jpg",
            "contentType": "image/jpeg",
            "sizeBytes": len(payload),
        },
    )
    init_body = init.json()
    _put_to_url(init_body["uploadUrl"], payload, "image/jpeg")
    confirm = await client.post(
        f"/api/v1/images/{init_body['id']}/confirm", headers=headers
    )
    assert confirm.status_code == 200
    return init_body["id"]


async def test_delete_me_removes_db_rows_and_s3_objects(client, user_a):
    from app.storage import ObjectNotFound, get_storage

    image_id = await _upload_image(client, user_a["headers"])

    # Vorher: Image existiert in DB + S3
    listing = await client.get(
        "/api/v1/images?state=ready", headers=user_a["headers"]
    )
    assert image_id in [it["id"] for it in listing.json()]

    storage = get_storage()
    bucket_key = f"{user_a['user']['id']}/originals/{image_id}"
    assert storage.head(bucket_key) > 0

    # DELETE /me
    r = await client.delete("/api/v1/auth/me", headers=user_a["headers"])
    assert r.status_code == 204, r.text

    # Nachher: S3-Object weg
    try:
        storage.head(bucket_key)
        raise AssertionError("S3-Object haette weg sein muessen")
    except ObjectNotFound:
        pass


async def test_alter_token_belebt_geloeschten_account_nicht_wieder(
    client, user_a,
):
    """Nach DELETE /me darf ein noch gueltiger (vor der Loeschung
    ausgestellter) Token den Account NICHT per JIT-Provisioning neu anlegen
    (Grabstein: iat <= deleted_at -> 401)."""
    r1 = await client.delete("/api/v1/auth/me", headers=user_a["headers"])
    assert r1.status_code == 204

    me_again = await client.get("/api/v1/auth/me", headers=user_a["headers"])
    assert me_again.status_code == 401, me_again.text


async def test_nach_loeschung_neu_ausgestellter_token_darf_provisionieren(
    client, user_a, db_session,
):
    """Ein NACH der Loeschung ausgestellter Token (erneuter Login, falls der
    KC-Account noch existiert) provisioniert einen frischen Account."""
    from datetime import timedelta

    from sqlalchemy import update

    from app.models import AccountTombstone

    r1 = await client.delete("/api/v1/auth/me", headers=user_a["headers"])
    assert r1.status_code == 204
    # Loeschung "in die Vergangenheit" verschieben statt auf einen neuen
    # Token (iat-Sekundenaufloesung) zu warten.
    await db_session.execute(
        update(AccountTombstone).values(
            deleted_at=AccountTombstone.deleted_at - timedelta(hours=1)
        )
    )
    await db_session.commit()

    me_again = await client.get("/api/v1/auth/me", headers=user_a["headers"])
    assert me_again.status_code == 200, me_again.text
    assert me_again.json()["id"] != user_a["user"]["id"]
    assert me_again.json()["email"] == user_a["user"]["email"]


async def test_delete_me_loescht_alle_objekte_unter_user_prefix(client, user_a):
    """Auch Objekte ohne DB-Row (Staging-Reste, Verwaiste) muessen weg."""
    from app.storage import get_storage

    await _upload_image(client, user_a["headers"])
    storage = get_storage()
    prefix = f"{user_a['user']['id']}/"
    for k in ("staging/orphan-1", "originals/orphan-2"):
        storage._client.put_object(Bucket=storage.bucket, Key=prefix + k, Body=b"x")

    r = await client.delete("/api/v1/auth/me", headers=user_a["headers"])
    assert r.status_code == 204
    assert storage.list_objects(prefix) == []


async def test_delete_me_s3_fehler_merkt_prefix_fuer_janitor_vor(
    client, user_a, db_session, monkeypatch,
):
    from sqlalchemy import select

    from app.models import StoragePurge, User
    from app.storage import get_storage

    storage = get_storage()

    def _boom(_prefix: str) -> int:
        raise RuntimeError("S3 down")

    monkeypatch.setattr(storage, "delete_prefix", _boom)
    r = await client.delete("/api/v1/auth/me", headers=user_a["headers"])
    assert r.status_code == 204, r.text

    prefix = f"{user_a['user']['id']}/"
    row = (
        await db_session.execute(
            select(StoragePurge).where(StoragePurge.prefix == prefix)
        )
    ).scalar_one()
    assert "S3 down" in (row.last_error or "")
    # DB-Daten sind trotzdem weg.
    assert (
        await db_session.execute(select(User).where(User.id == user_a["user"]["id"]))
    ).scalar_one_or_none() is None


async def _disable(db_session, user_id: str) -> None:
    from sqlalchemy import update

    from app.models import User

    await db_session.execute(
        update(User).where(User.id == user_id).values(is_disabled=True)
    )
    await db_session.commit()


async def test_gesperrter_user_darf_exportieren(client, user_a, db_session):
    await _disable(db_session, user_a["user"]["id"])
    assert (
        await client.get("/api/v1/auth/me", headers=user_a["headers"])
    ).status_code == 403
    r = await client.get("/api/v1/auth/me/export", headers=user_a["headers"])
    assert r.status_code == 200, r.text


async def test_gesperrter_user_darf_account_loeschen(client, user_a, db_session):
    await _disable(db_session, user_a["user"]["id"])
    r = await client.delete("/api/v1/auth/me", headers=user_a["headers"])
    assert r.status_code == 204, r.text


async def test_export_me_returns_user_presets_images(client, user_a):
    image_id = await _upload_image(client, user_a["headers"])
    create_preset = await client.post(
        "/api/v1/presets",
        headers=user_a["headers"],
        json={
            "name": "Export-Test",
            "adjustments": {
                "exposure": 0.5, "contrast": 0, "highlights": 0, "shadows": 0,
                "whites": 0, "blacks": 0, "temperature": 0, "tint": 0,
                "vibrance": 0, "saturation": 0,
            },
        },
    )
    assert create_preset.status_code == 201

    r = await client.get("/api/v1/auth/me/export", headers=user_a["headers"])
    assert r.status_code == 200, r.text
    body = r.json()

    assert body["email"] == user_a["user"]["email"]

    preset_names = [p["name"] for p in body["presets"]]
    assert "Export-Test" in preset_names

    image_ids = [i["id"] for i in body["images"]]
    assert image_id in image_ids
    img = next(i for i in body["images"] if i["id"] == image_id)
    assert img["downloadUrl"].startswith("http")
    assert img["downloadUrlExpiresIn"] > 0


async def test_export_me_includes_feedback_edit_state_and_geometry(client, user_a):
    """DSGVO Art. 15/20: der Export muss auch abgegebenes Feedback, den
    persistierten Editor-Bearbeitungsstand und die Preset-Geometrie enthalten
    — alles User-erzeugter Inhalt."""
    image_id = await _upload_image(client, user_a["headers"])

    # Editor-Bearbeitungsstand speichern.
    put = await client.put(
        f"/api/v1/images/{image_id}/edit",
        headers=user_a["headers"],
        json={"adjustments": {"exposure": 0.42}, "straightenAngle": 0.05},
    )
    assert put.status_code == 204, put.text

    # Preset MIT Geometrie anlegen.
    preset = await client.post(
        "/api/v1/presets",
        headers=user_a["headers"],
        json={
            "name": "Geo-Export",
            "adjustments": {
                "exposure": 0, "contrast": 0, "highlights": 0, "shadows": 0,
                "whites": 0, "blacks": 0, "temperature": 0, "tint": 0,
                "vibrance": 0, "saturation": 0,
            },
            "geometry": {"crop": {"x0": 0.0, "y0": 0.0, "x1": 0.8, "y1": 0.8}},
        },
    )
    assert preset.status_code == 201, preset.text

    # Feedback abgeben.
    fb = await client.post(
        "/api/v1/feedback",
        headers=user_a["headers"],
        json={"kind": "idea", "message": "Bitte Export um Edit-State erweitern."},
    )
    assert fb.status_code == 201, fb.text

    r = await client.get("/api/v1/auth/me/export", headers=user_a["headers"])
    assert r.status_code == 200, r.text
    body = r.json()

    # Edit-State am Bild
    img = next(i for i in body["images"] if i["id"] == image_id)
    assert img["editState"] is not None
    assert img["editState"]["adjustments"]["exposure"] == 0.42

    # Geometrie am Preset
    geo_preset = next(p for p in body["presets"] if p["name"] == "Geo-Export")
    assert geo_preset["geometry"] is not None
    assert geo_preset["geometry"]["crop"]["x1"] == 0.8

    # Feedback enthalten
    assert any(
        f["message"].startswith("Bitte Export") for f in body["feedbacks"]
    )
