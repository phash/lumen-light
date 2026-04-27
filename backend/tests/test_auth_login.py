"""Tests fuer POST /api/v1/auth/login."""

VALID_PW = "supersicheresPasswort1"


async def _register(client, email: str, password: str = VALID_PW):
    return await client.post(
        "/api/v1/auth/register", json={"email": email, "password": password}
    )


async def test_login_with_valid_credentials_returns_token_pair(client):
    await _register(client, "login@example.com")
    r = await client.post(
        "/api/v1/auth/login",
        json={"email": "login@example.com", "password": VALID_PW},
    )
    assert r.status_code == 200
    body = r.json()
    assert "access_token" in body
    assert "refresh_token" in body
    assert body["token_type"] == "bearer"
    assert body["expires_in"] > 0


async def test_login_with_wrong_password_returns_401(client):
    await _register(client, "wrongpw@example.com")
    r = await client.post(
        "/api/v1/auth/login",
        json={"email": "wrongpw@example.com", "password": "falsch12345678"},
    )
    assert r.status_code == 401


async def test_login_with_unknown_user_returns_401(client):
    r = await client.post(
        "/api/v1/auth/login",
        json={"email": "ghost@example.com", "password": VALID_PW},
    )
    assert r.status_code == 401


async def test_login_is_case_insensitive_on_email(client):
    await _register(client, "case@example.com")
    r = await client.post(
        "/api/v1/auth/login",
        json={"email": "CASE@example.com", "password": VALID_PW},
    )
    assert r.status_code == 200
