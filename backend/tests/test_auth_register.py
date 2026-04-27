"""Tests fuer POST /api/v1/auth/register."""

VALID_PW = "supersicheresPasswort1"


async def test_register_creates_user(client):
    r = await client.post(
        "/api/v1/auth/register",
        json={"email": "new@example.com", "password": VALID_PW},
    )
    assert r.status_code == 201
    body = r.json()
    assert body["email"] == "new@example.com"
    assert "id" in body
    assert "created_at" in body
    assert "password_hash" not in body


async def test_register_creates_default_presets(client):
    await client.post(
        "/api/v1/auth/register",
        json={"email": "presets@example.com", "password": VALID_PW},
    )
    login = await client.post(
        "/api/v1/auth/login",
        json={"email": "presets@example.com", "password": VALID_PW},
    )
    token = login.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    r = await client.get("/api/v1/presets", headers=headers)
    assert r.status_code == 200
    names = {p["name"] for p in r.json()}
    assert {"Neutral", "Punchy", "Soft Mood", "Schwarzweiss-Vorbereitung"} <= names


async def test_register_with_existing_email_returns_400(client):
    await client.post(
        "/api/v1/auth/register",
        json={"email": "dup@example.com", "password": VALID_PW},
    )
    r = await client.post(
        "/api/v1/auth/register",
        json={"email": "dup@example.com", "password": VALID_PW},
    )
    assert r.status_code == 400


async def test_register_with_short_password_returns_422(client):
    r = await client.post(
        "/api/v1/auth/register",
        json={"email": "short@example.com", "password": "kurz"},
    )
    assert r.status_code == 422


async def test_register_lowercases_email(client):
    r = await client.post(
        "/api/v1/auth/register",
        json={"email": "Mixed@Example.COM", "password": VALID_PW},
    )
    assert r.status_code == 201
    assert r.json()["email"] == "mixed@example.com"
