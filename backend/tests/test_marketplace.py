"""Tests fuer Preset-Marketplace (F1)."""
from tests.s3_upload import upload_via_init


ZERO_ADJ = {
    "exposure": 0.0, "contrast": 0.0, "highlights": 0.0, "shadows": 0.0,
    "whites": 0.0, "blacks": 0.0, "temperature": 0.0, "tint": 0.0,
    "vibrance": 0.0, "saturation": 0.0,
}


async def _upload_image(client, headers, filename="cover.jpg") -> str:
    # JPEG-Magic-Bytes vorne — confirm() validiert den Content-Type.
    payload = b"\xff\xd8\xff\xe0fake-image"
    r = await client.post(
        "/api/v1/images",
        headers=headers,
        json={
            "filename": filename,
            "contentType": "image/jpeg",
            "sizeBytes": len(payload),
        },
    )
    assert r.status_code == 201, r.text
    body = r.json()
    upload_via_init(body, payload, "image/jpeg")
    confirm = await client.post(
        f"/api/v1/images/{body['id']}/confirm", headers=headers
    )
    assert confirm.status_code == 200
    return body["id"]


async def _create_public_preset(
    client,
    headers,
    name="Public-Look",
    genre="portrait",
    description="Ein Portrait-Preset mit warmen Hauttoenen.",
    image_id: str | None = None,
) -> dict:
    if image_id is None:
        image_id = await _upload_image(client, headers, filename=f"{name}.jpg")
    r = await client.post(
        "/api/v1/presets",
        headers=headers,
        json={
            "name": name,
            "adjustments": ZERO_ADJ,
            "visibility": "public",
            "genre": genre,
            "description": description,
            "previewImageId": image_id,
        },
    )
    assert r.status_code == 201, r.text
    return r.json()


# ---------- Visibility-Validierung ----------

async def test_public_preset_requires_genre_description_preview(client, user_a):
    r = await client.post(
        "/api/v1/presets",
        headers=user_a["headers"],
        json={
            "name": "incomplete",
            "adjustments": ZERO_ADJ,
            "visibility": "public",
        },
    )
    assert r.status_code == 422
    body = str(r.json())
    assert "genre" in body
    assert "description" in body
    assert "previewImageId" in body


async def test_public_preset_with_foreign_image_returns_400(client, user_a, user_b):
    foreign_image = await _upload_image(client, user_b["headers"], filename="foreign.jpg")
    r = await client.post(
        "/api/v1/presets",
        headers=user_a["headers"],
        json={
            "name": "stolen-cover",
            "adjustments": ZERO_ADJ,
            "visibility": "public",
            "genre": "portrait",
            "description": "geht nicht, fremdes Bild als Cover.",
            "previewImageId": foreign_image,
        },
    )
    assert r.status_code == 400


async def test_public_preset_with_non_jpeg_preview_returns_400(client, user_a):
    """Oeffentliche Vorschaubilder werden an ALLE eingeloggten User
    ausgeliefert. Nur JPEG wird beim Upload client-seitig von EXIF/GPS
    befreit (und ist im <img> darstellbar) -> Public-Preview muss JPEG sein,
    sonst koennten ueber ein PNG/RAW-Cover Metadaten oeffentlich werden."""
    init = await client.post(
        "/api/v1/images", headers=user_a["headers"],
        json={"filename": "cover.png", "contentType": "image/png", "sizeBytes": 8},
    )
    body = init.json()
    upload_via_init(body, b"\x89PNG\r\n\x1a\n", "image/png")
    confirm = await client.post(
        f"/api/v1/images/{body['id']}/confirm", headers=user_a["headers"]
    )
    assert confirm.status_code == 200, confirm.text

    r = await client.post(
        "/api/v1/presets", headers=user_a["headers"],
        json={
            "name": "png-cover",
            "adjustments": ZERO_ADJ,
            "visibility": "public",
            "genre": "portrait",
            "description": "PNG-Cover soll abgelehnt werden.",
            "previewImageId": body["id"],
        },
    )
    assert r.status_code == 400, r.text


async def test_public_preset_creation_sets_published_at(client, user_a):
    body = await _create_public_preset(client, user_a["headers"], name="warm")
    assert body["visibility"] == "public"
    assert body["publishedAt"] is not None


# ---------- Listing ----------

async def test_marketplace_list_only_public(client, user_a, user_b):
    await _create_public_preset(client, user_a["headers"], name="public-1")
    await _create_public_preset(client, user_b["headers"], name="public-2")
    # Privates Preset darf nicht erscheinen.
    private = await client.post(
        "/api/v1/presets",
        headers=user_a["headers"],
        json={"name": "geheim", "adjustments": ZERO_ADJ},
    )
    assert private.status_code == 201

    r = await client.get("/api/v1/marketplace/presets", headers=user_a["headers"])
    assert r.status_code == 200
    items = r.json()["items"]
    names = [i["name"] for i in items]
    assert "public-1" in names
    assert "public-2" in names
    assert "geheim" not in names


async def test_marketplace_list_filters_by_genre(client, user_a):
    await _create_public_preset(
        client, user_a["headers"], name="port", genre="portrait"
    )
    await _create_public_preset(
        client, user_a["headers"], name="land", genre="landscape"
    )
    r = await client.get(
        "/api/v1/marketplace/presets?genre=portrait", headers=user_a["headers"]
    )
    assert r.status_code == 200
    names = [i["name"] for i in r.json()["items"]]
    assert names == ["port"]


async def test_marketplace_list_filters_by_q(client, user_a):
    await _create_public_preset(client, user_a["headers"], name="warm-look")
    await _create_public_preset(client, user_a["headers"], name="cool-tone")
    r = await client.get(
        "/api/v1/marketplace/presets?q=warm", headers=user_a["headers"]
    )
    assert r.status_code == 200
    names = [i["name"] for i in r.json()["items"]]
    assert names == ["warm-look"]


# ---------- Apply ----------

async def test_marketplace_apply_returns_adjustments_and_increments_count(
    client, user_a, user_b
):
    created = await _create_public_preset(client, user_a["headers"], name="apply-me")
    pid = created["id"]
    r = await client.post(
        f"/api/v1/marketplace/presets/{pid}/apply", headers=user_b["headers"]
    )
    assert r.status_code == 200
    body = r.json()
    assert body["adjustments"]["exposure"] == 0
    assert body["masks"] == []
    detail = await client.get(
        f"/api/v1/marketplace/presets/{pid}", headers=user_b["headers"]
    )
    assert detail.json()["applyCount"] == 1


async def test_marketplace_apply_404_for_private_preset(client, user_a, user_b):
    r = await client.post(
        "/api/v1/presets",
        headers=user_a["headers"],
        json={"name": "geheim2", "adjustments": ZERO_ADJ},
    )
    private_id = r.json()["id"]
    r2 = await client.post(
        f"/api/v1/marketplace/presets/{private_id}/apply", headers=user_b["headers"]
    )
    assert r2.status_code == 404


# ---------- Fork ----------

async def test_marketplace_fork_creates_private_copy(client, user_a, user_b):
    src = await _create_public_preset(client, user_a["headers"], name="forkable")
    r = await client.post(
        f"/api/v1/marketplace/presets/{src['id']}/fork", headers=user_b["headers"]
    )
    assert r.status_code == 201
    fork = r.json()
    assert fork["visibility"] == "private"
    assert fork["name"] == "forkable (Kopie)"
    assert fork["previewImageId"] is None


async def test_marketplace_fork_404_for_private_preset(client, user_a, user_b):
    """Fork laeuft ueber _load_public_preset — ein privates/unbekanntes Preset
    darf nicht forkbar sein (sonst Inhalts-Leak: Adjustments/Masks)."""
    r = await client.post(
        "/api/v1/presets",
        headers=user_a["headers"],
        json={"name": "priv-fork", "adjustments": ZERO_ADJ},
    )
    private_id = r.json()["id"]
    r2 = await client.post(
        f"/api/v1/marketplace/presets/{private_id}/fork", headers=user_b["headers"]
    )
    assert r2.status_code == 404


async def test_marketplace_fork_copies_geometry(client, user_a, user_b):
    """Fork muss die Geometrie (Crop/Straighten/Lens) des Originals mitkopieren
    — sonst verliert der Fork stillschweigend Crop/Lens-Einstellungen."""
    image_id = await _upload_image(client, user_a["headers"], filename="geo.jpg")
    create = await client.post(
        "/api/v1/presets",
        headers=user_a["headers"],
        json={
            "name": "geo-look",
            "adjustments": ZERO_ADJ,
            "geometry": {
                "crop": {"x0": 0.1, "y0": 0.1, "x1": 0.9, "y1": 0.9},
                "straightenAngle": 0.05,
            },
            "visibility": "public",
            "genre": "portrait",
            "description": "Preset mit Crop-Geometrie zum Forken.",
            "previewImageId": image_id,
        },
    )
    assert create.status_code == 201, create.text
    pid = create.json()["id"]

    fork = await client.post(
        f"/api/v1/marketplace/presets/{pid}/fork", headers=user_b["headers"]
    )
    assert fork.status_code == 201, fork.text
    geo = fork.json()["geometry"]
    assert geo is not None
    assert geo["crop"] == {"x0": 0.1, "y0": 0.1, "x1": 0.9, "y1": 0.9}
    assert geo["straightenAngle"] == 0.05


async def test_marketplace_fork_handles_name_collision(client, user_a, user_b):
    src = await _create_public_preset(client, user_a["headers"], name="busy")
    # Erster Fork
    r1 = await client.post(
        f"/api/v1/marketplace/presets/{src['id']}/fork", headers=user_b["headers"]
    )
    assert r1.status_code == 201
    # Zweiter Fork muss " 2" anhaengen.
    r2 = await client.post(
        f"/api/v1/marketplace/presets/{src['id']}/fork", headers=user_b["headers"]
    )
    assert r2.status_code == 201
    assert r2.json()["name"].endswith("2")


# ---------- Report + Auto-Hide ----------


def _allow_fresh_reporters(monkeypatch) -> None:
    """Mindest-Account-Alter fuer Reports abschalten — die Test-User sind
    frisch angelegt. Der Alters-Gate selbst wird separat getestet."""
    from app.config import settings

    monkeypatch.setattr(settings, "report_min_account_age_hours", 0)


async def _age_account(db_session, user_id: str, hours: int = 48) -> None:
    from datetime import datetime, timedelta, timezone

    from sqlalchemy import update

    from app.models import User

    await db_session.execute(
        update(User)
        .where(User.id == user_id)
        .values(created_at=datetime.now(timezone.utc) - timedelta(hours=hours))
    )
    await db_session.commit()

async def test_marketplace_report_increments_count(client, user_a, user_b, db_session):
    await _age_account(db_session, user_b["user"]["id"])
    src = await _create_public_preset(client, user_a["headers"], name="report-me")
    r = await client.post(
        f"/api/v1/marketplace/presets/{src['id']}/report",
        headers=user_b["headers"],
        json={"reason": "Spam"},
    )
    assert r.status_code == 204


async def test_marketplace_auto_hides_after_three_reports(
    client, user_a, user_b, user_c, make_keycloak_user, monkeypatch
):
    _allow_fresh_reporters(monkeypatch)
    src = await _create_public_preset(client, user_a["headers"], name="hide-me")
    pid = src["id"]
    # Drei verschiedene Reporter — Schwellenwert fuer Auto-Hide.
    for headers in (
        user_b["headers"],
        user_c["headers"],
        make_keycloak_user("dora@example.com")["headers"],
    ):
        r = await client.post(
            f"/api/v1/marketplace/presets/{pid}/report",
            headers=headers,
            json={"reason": "Spam"},
        )
        assert r.status_code == 204
    # Preset sollte nicht mehr im Marketplace auftauchen.
    detail = await client.get(
        f"/api/v1/marketplace/presets/{pid}", headers=user_a["headers"]
    )
    assert detail.status_code == 404


async def test_marketplace_report_404_for_private_preset(client, user_a, user_b):
    """Report laeuft ebenfalls ueber _load_public_preset — auf ein privates
    Preset darf keine Meldung abgesetzt werden (sonst Report-Abuse / DB-Write
    auf fremde private Daten)."""
    r = await client.post(
        "/api/v1/presets",
        headers=user_a["headers"],
        json={"name": "priv-report", "adjustments": ZERO_ADJ},
    )
    private_id = r.json()["id"]
    r2 = await client.post(
        f"/api/v1/marketplace/presets/{private_id}/report",
        headers=user_b["headers"],
        json={"reason": "Spam"},
    )
    assert r2.status_code == 404


async def test_update_preset_cannot_republish_after_autohide(
    client, user_a, user_b, user_c, make_keycloak_user, monkeypatch
):
    """Ein nach >=3 Meldungen auto-verstecktes Preset darf vom Creator NICHT
    einfach per PUT wieder oeffentlich geschaltet werden (409) — sonst laesst
    sich die Moderation trivial umgehen."""
    _allow_fresh_reporters(monkeypatch)
    src = await _create_public_preset(client, user_a["headers"], name="moderate-me")
    pid = src["id"]
    for headers in (
        user_b["headers"],
        user_c["headers"],
        make_keycloak_user("erik@example.com")["headers"],
    ):
        rr = await client.post(
            f"/api/v1/marketplace/presets/{pid}/report",
            headers=headers,
            json={"reason": "Spam"},
        )
        assert rr.status_code == 204

    # Auto-hidden -> privat. Re-Publish-Versuch des Creators muss 409 sein.
    put = await client.put(
        f"/api/v1/presets/{pid}",
        headers=user_a["headers"],
        json={
            "name": "moderate-me",
            "adjustments": ZERO_ADJ,
            "visibility": "public",
            "genre": "portrait",
            "description": "Ein Portrait-Preset mit warmen Hauttoenen.",
            "previewImageId": src["previewImageId"],
        },
    )
    assert put.status_code == 409, put.text


async def test_marketplace_invalid_cursor_returns_422(client, user_a):
    # Garbage-base64
    r = await client.get(
        "/api/v1/marketplace/presets?cursor=not-a-cursor",
        headers=user_a["headers"],
    )
    assert r.status_code == 422


async def test_marketplace_negative_cursor_returns_422(client, user_a):
    import base64

    cursor = base64.urlsafe_b64encode(b"-1").decode()
    r = await client.get(
        f"/api/v1/marketplace/presets?cursor={cursor}",
        headers=user_a["headers"],
    )
    assert r.status_code == 422


async def test_marketplace_huge_cursor_returns_422(client, user_a):
    import base64

    cursor = base64.urlsafe_b64encode(b"99999999").decode()
    r = await client.get(
        f"/api/v1/marketplace/presets?cursor={cursor}",
        headers=user_a["headers"],
    )
    assert r.status_code == 422


async def test_marketplace_double_report_returns_409(client, user_a, user_b, db_session):
    await _age_account(db_session, user_b["user"]["id"])
    src = await _create_public_preset(client, user_a["headers"], name="dup-report")
    r1 = await client.post(
        f"/api/v1/marketplace/presets/{src['id']}/report",
        headers=user_b["headers"],
        json={"reason": "Spam"},
    )
    assert r1.status_code == 204
    r2 = await client.post(
        f"/api/v1/marketplace/presets/{src['id']}/report",
        headers=user_b["headers"],
        json={"reason": "Nochmal"},
    )
    assert r2.status_code == 409


# ---------- Profil + published-presets ----------

async def test_get_and_patch_profile(client, user_a):
    r0 = await client.get("/api/v1/auth/me/profile", headers=user_a["headers"])
    assert r0.status_code == 200
    assert r0.json()["handle"] is None

    r1 = await client.patch(
        "/api/v1/auth/me/profile",
        headers=user_a["headers"],
        json={"handle": "anna", "bio": "Photographer"},
    )
    assert r1.status_code == 200
    assert r1.json()["handle"] == "anna"
    assert r1.json()["bio"] == "Photographer"


async def test_patch_profile_handle_collision_returns_409(client, user_a, user_b):
    await client.patch(
        "/api/v1/auth/me/profile",
        headers=user_a["headers"],
        json={"handle": "shared"},
    )
    r = await client.patch(
        "/api/v1/auth/me/profile",
        headers=user_b["headers"],
        json={"handle": "shared"},
    )
    assert r.status_code == 409


async def test_patch_profile_invalid_handle_returns_422(client, user_a):
    r = await client.patch(
        "/api/v1/auth/me/profile",
        headers=user_a["headers"],
        json={"handle": "Anna Schmidt"},  # Leerzeichen + Grossbuchstaben
    )
    assert r.status_code == 422


async def test_published_presets_list(client, user_a):
    await _create_public_preset(client, user_a["headers"], name="pub-1")
    private = await client.post(
        "/api/v1/presets",
        headers=user_a["headers"],
        json={"name": "priv-1", "adjustments": ZERO_ADJ},
    )
    assert private.status_code == 201
    r = await client.get(
        "/api/v1/auth/me/published-presets", headers=user_a["headers"]
    )
    assert r.status_code == 200
    names = [p["name"] for p in r.json()]
    assert names == ["pub-1"]


# ---------- Public Browse ohne Login (F7) ----------

async def test_marketplace_list_public_without_auth(client, user_a):
    """Liste ist ohne Authorization-Header oeffentlich lesbar (SEO + Browse)."""
    await _create_public_preset(client, user_a["headers"], name="oeffentlich-1")
    r = await client.get("/api/v1/marketplace/presets")
    assert r.status_code == 200, r.text
    names = [it["name"] for it in r.json()["items"]]
    assert "oeffentlich-1" in names


async def test_marketplace_detail_public_without_auth(client, user_a):
    """Detail ist ohne Login oeffentlich lesbar."""
    body = await _create_public_preset(client, user_a["headers"], name="detail-pub")
    r = await client.get(f"/api/v1/marketplace/presets/{body['id']}")
    assert r.status_code == 200, r.text
    assert r.json()["name"] == "detail-pub"


async def test_marketplace_apply_still_requires_auth(client, user_a):
    """Anwenden bleibt gated — ohne Login 401."""
    body = await _create_public_preset(client, user_a["headers"], name="apply-gated")
    r = await client.post(f"/api/v1/marketplace/presets/{body['id']}/apply")
    assert r.status_code == 401, r.text


async def test_marketplace_fork_still_requires_auth(client, user_a):
    """Forken bleibt gated — ohne Login 401."""
    body = await _create_public_preset(client, user_a["headers"], name="fork-gated")
    r = await client.post(f"/api/v1/marketplace/presets/{body['id']}/fork")
    assert r.status_code == 401, r.text



# ---------- Security-Review 2026-10 ----------


async def test_report_von_zu_neuem_account_wird_abgelehnt(client, user_a, user_b):
    src = await _create_public_preset(client, user_a["headers"], name="neu-report")
    r = await client.post(
        f"/api/v1/marketplace/presets/{src['id']}/report",
        headers=user_b["headers"],
        json={"reason": "Spam"},
    )
    assert r.status_code == 403, r.text


async def test_report_auf_eigenes_preset_wird_ignoriert(client, user_a, db_session):
    await _age_account(db_session, user_a["user"]["id"])
    src = await _create_public_preset(client, user_a["headers"], name="selbst")
    r = await client.post(
        f"/api/v1/marketplace/presets/{src['id']}/report",
        headers=user_a["headers"],
        json={"reason": "Spam"},
    )
    assert r.status_code == 204
    own = await client.get("/api/v1/presets", headers=user_a["headers"])
    mine = next(p for p in own.json() if p["id"] == src["id"])
    assert mine["reportCount"] == 0


async def test_presets_gesperrter_user_verschwinden_aus_marketplace(
    client, user_a, user_b, db_session
):
    from sqlalchemy import update

    from app.models import User

    src = await _create_public_preset(client, user_a["headers"], name="gesperrt-pub")
    await db_session.execute(
        update(User).where(User.id == user_a["user"]["id"]).values(is_disabled=True)
    )
    await db_session.commit()

    listing = await client.get("/api/v1/marketplace/presets")
    assert src["id"] not in [i["id"] for i in listing.json()["items"]]
    detail = await client.get(f"/api/v1/marketplace/presets/{src['id']}")
    assert detail.status_code == 404
    fork = await client.post(
        f"/api/v1/marketplace/presets/{src['id']}/fork", headers=user_b["headers"]
    )
    assert fork.status_code == 404


async def test_fork_mit_maximal_langem_namen_kuerzt_statt_500(client, user_a, user_b):
    long_name = "L" * 80
    src = await _create_public_preset(client, user_a["headers"], name=long_name)
    r1 = await client.post(
        f"/api/v1/marketplace/presets/{src['id']}/fork", headers=user_b["headers"]
    )
    assert r1.status_code == 201, r1.text
    assert len(r1.json()["name"]) <= 80
    assert r1.json()["name"].endswith(" (Kopie)")
    r2 = await client.post(
        f"/api/v1/marketplace/presets/{src['id']}/fork", headers=user_b["headers"]
    )
    assert r2.status_code == 201, r2.text
    assert len(r2.json()["name"]) <= 80
    assert r2.json()["name"].endswith(" (Kopie) 2")


async def test_fork_name_kollision_mit_bestehendem_preset(client, user_a, user_b):
    """Kollidiert der Fork-Name mit einem schon vorhandenen Preset (z.B.
    aus einem parallelen Fork), wird der naechste Suffix genommen statt 500."""
    src = await _create_public_preset(client, user_a["headers"], name="race")
    pre = await client.post(
        "/api/v1/presets",
        headers=user_b["headers"],
        json={"name": "race (Kopie)", "adjustments": ZERO_ADJ},
    )
    assert pre.status_code == 201
    r = await client.post(
        f"/api/v1/marketplace/presets/{src['id']}/fork", headers=user_b["headers"]
    )
    assert r.status_code == 201, r.text
    assert r.json()["name"] == "race (Kopie) 2"


async def test_suche_escaped_like_wildcards(client, user_a):
    await _create_public_preset(client, user_a["headers"], name="Normaler Look")
    pct = await _create_public_preset(client, user_a["headers"], name="100% Kontrast")
    r = await client.get("/api/v1/marketplace/presets?q=%25")
    names = [i["name"] for i in r.json()["items"]]
    assert names == [pct["name"]]
    r2 = await client.get("/api/v1/marketplace/presets?q=_")
    assert r2.json()["items"] == []
