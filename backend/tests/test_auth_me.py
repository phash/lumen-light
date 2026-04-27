"""Tests fuer GET /api/v1/auth/me."""


async def test_me_without_token_returns_401(client):
    r = await client.get("/api/v1/auth/me")
    assert r.status_code == 401


async def test_me_with_invalid_token_returns_401(client):
    r = await client.get(
        "/api/v1/auth/me", headers={"Authorization": "Bearer not-a-jwt"}
    )
    assert r.status_code == 401


async def test_me_with_valid_token_returns_user(client, user_a):
    r = await client.get("/api/v1/auth/me", headers=user_a["headers"])
    assert r.status_code == 200
    assert r.json()["email"] == "alice@example.com"
    assert r.json()["id"] == user_a["user"]["id"]
