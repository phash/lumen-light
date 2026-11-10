"""M2: Speicher-/Anzahl-Kontingente pro User + Pagination von Listen."""
from __future__ import annotations

from tests.images import upload_image


ZERO_ADJ = {
    "exposure": 0.0, "contrast": 0.0, "highlights": 0.0, "shadows": 0.0,
    "whites": 0.0, "blacks": 0.0, "temperature": 0.0, "tint": 0.0,
    "vibrance": 0.0, "saturation": 0.0,
}


async def _init(client, headers, size: int = 1024):
    return await client.post(
        "/api/v1/images",
        headers=headers,
        json={"filename": "q.jpg", "contentType": "image/jpeg", "sizeBytes": size},
    )


async def test_speicherkontingent_blockt_init(client, user_a, monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "max_user_storage_bytes", 3000)
    await upload_image(client, user_a["headers"])  # echtes kleines JPEG
    ok = await _init(client, user_a["headers"], size=1000)
    assert ok.status_code == 201, ok.text
    # pending zaehlt mit der angekuendigten Groesse -> Summe ueber Limit
    r = await _init(client, user_a["headers"], size=2500)
    assert r.status_code == 413, r.text
    assert "Speicherkontingent erschöpft" in r.json()["detail"]


async def test_failed_bilder_zaehlen_nicht_zum_kontingent(
    client, user_a, db_session, monkeypatch
):
    from uuid import UUID

    from sqlalchemy import update

    from app.config import settings
    from app.models import Image

    monkeypatch.setattr(settings, "max_user_storage_bytes", 2000)
    first = await _init(client, user_a["headers"], size=1500)
    await db_session.execute(
        update(Image).where(Image.id == UUID(first.json()["id"])).values(upload_state="failed")
    )
    await db_session.commit()
    r = await _init(client, user_a["headers"], size=1500)
    assert r.status_code == 201, r.text


async def test_bildanzahl_kontingent_blockt_init(client, user_a, monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "max_user_images", 2)
    assert (await _init(client, user_a["headers"])).status_code == 201
    assert (await _init(client, user_a["headers"])).status_code == 201
    r = await _init(client, user_a["headers"])
    assert r.status_code == 413, r.text
    assert "Bilder" in r.json()["detail"]


async def test_preset_kontingent_blockt_anlegen(client, user_a, monkeypatch):
    from app.config import settings

    # Neuer User hat 20 Default-Presets.
    monkeypatch.setattr(settings, "max_user_presets", 21)
    r1 = await client.post(
        "/api/v1/presets", headers=user_a["headers"],
        json={"name": "Eins", "adjustments": ZERO_ADJ},
    )
    assert r1.status_code == 201, r1.text
    r2 = await client.post(
        "/api/v1/presets", headers=user_a["headers"],
        json={"name": "Zwei", "adjustments": ZERO_ADJ},
    )
    assert r2.status_code == 409, r2.text
    assert "Presets" in r2.json()["detail"]


async def test_preset_kontingent_blockt_fork(client, user_a, user_b, monkeypatch):
    from app.config import settings

    image_id = await upload_image(client, user_a["headers"])
    pub = await client.post(
        "/api/v1/presets", headers=user_a["headers"],
        json={
            "name": "Forkbar", "adjustments": ZERO_ADJ, "visibility": "public",
            "genre": "portrait", "description": "Ein Preset zum Forken.",
            "previewImageId": image_id,
        },
    )
    assert pub.status_code == 201, pub.text
    monkeypatch.setattr(settings, "max_user_presets", 20)
    r = await client.post(
        f"/api/v1/marketplace/presets/{pub.json()['id']}/fork", headers=user_b["headers"]
    )
    assert r.status_code == 409, r.text


async def test_images_liste_unterstuetzt_limit_und_offset(client, user_a):
    ids = [await upload_image(client, user_a["headers"]) for _ in range(3)]
    full = await client.get("/api/v1/images", headers=user_a["headers"])
    assert full.status_code == 200
    assert full.headers["x-total-count"] == "3"
    assert {i["id"] for i in full.json()} == set(ids)

    page1 = await client.get(
        "/api/v1/images?limit=2&offset=0", headers=user_a["headers"]
    )
    page2 = await client.get(
        "/api/v1/images?limit=2&offset=2", headers=user_a["headers"]
    )
    assert len(page1.json()) == 2
    assert len(page2.json()) == 1
    assert page1.headers["x-total-count"] == "3"
    got = [i["id"] for i in page1.json()] + [i["id"] for i in page2.json()]
    assert sorted(got) == sorted(ids)


async def test_images_liste_limit_obergrenze(client, user_a):
    r = await client.get("/api/v1/images?limit=501", headers=user_a["headers"])
    assert r.status_code == 422


async def test_presets_liste_unterstuetzt_limit_und_offset(client, user_a):
    full = await client.get("/api/v1/presets", headers=user_a["headers"])
    assert len(full.json()) == 20
    assert full.headers["x-total-count"] == "20"
    page = await client.get(
        "/api/v1/presets?limit=5&offset=18", headers=user_a["headers"]
    )
    assert page.status_code == 200
    assert len(page.json()) == 2
    bad = await client.get("/api/v1/presets?limit=0", headers=user_a["headers"])
    assert bad.status_code == 422
