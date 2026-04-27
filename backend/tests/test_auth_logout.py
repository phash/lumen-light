"""Tests fuer POST /api/v1/auth/logout."""


async def test_logout_revokes_refresh_token(client, user_a):
    refresh = user_a["tokens"]["refresh_token"]

    r = await client.post(
        "/api/v1/auth/logout", json={"refresh_token": refresh}
    )
    assert r.status_code == 204

    r = await client.post(
        "/api/v1/auth/refresh", json={"refresh_token": refresh}
    )
    assert r.status_code == 401


async def test_logout_with_unknown_token_succeeds(client):
    """Bewusst still-success: kein Existenz-Leak via Statuscode."""
    r = await client.post(
        "/api/v1/auth/logout", json={"refresh_token": "fantasie-1234"}
    )
    assert r.status_code == 204
