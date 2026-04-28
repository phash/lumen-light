"""Tests fuer Preset-Marketplace (F1)."""
import urllib.request


ZERO_ADJ = {
    "exposure": 0.0, "contrast": 0.0, "highlights": 0.0, "shadows": 0.0,
    "whites": 0.0, "blacks": 0.0, "temperature": 0.0, "tint": 0.0,
    "vibrance": 0.0, "saturation": 0.0,
}


def _put_to_url(url: str, data: bytes, content_type: str) -> None:
    req = urllib.request.Request(
        url, data=data, method="PUT",
        headers={"Content-Type": content_type},
    )
    with urllib.request.urlopen(req, timeout=5) as resp:
        assert 200 <= resp.status < 300


async def _upload_image(client, headers, filename="cover.jpg") -> str:
    payload = b"fake-image"
    r = await client.post(
        "/api/v1/images",
        headers=headers,
        json={
            "filename": filename,
            "content_type": "image/jpeg",
            "size_bytes": len(payload),
        },
    )
    assert r.status_code == 201, r.text
    body = r.json()
    _put_to_url(body["upload_url"], payload, "image/jpeg")
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
            "preview_image_id": image_id,
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
    assert "preview_image_id" in body


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
            "preview_image_id": foreign_image,
        },
    )
    assert r.status_code == 400


async def test_public_preset_creation_sets_published_at(client, user_a):
    body = await _create_public_preset(client, user_a["headers"], name="warm")
    assert body["visibility"] == "public"
    assert body["published_at"] is not None


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
    assert detail.json()["apply_count"] == 1


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
    assert fork["preview_image_id"] is None


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

async def test_marketplace_report_increments_count(client, user_a, user_b):
    src = await _create_public_preset(client, user_a["headers"], name="report-me")
    r = await client.post(
        f"/api/v1/marketplace/presets/{src['id']}/report",
        headers=user_b["headers"],
        json={"reason": "Spam"},
    )
    assert r.status_code == 204


async def test_marketplace_auto_hides_after_three_reports(
    client, user_a, user_b, user_c, make_keycloak_user
):
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


async def test_marketplace_double_report_returns_409(client, user_a, user_b):
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
