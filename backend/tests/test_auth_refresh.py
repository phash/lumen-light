"""Tests fuer POST /api/v1/auth/refresh inkl. Rotation-Schutz."""


async def test_refresh_with_valid_token_returns_new_pair(client, user_a):
    old_refresh = user_a["tokens"]["refresh_token"]
    r = await client.post(
        "/api/v1/auth/refresh", json={"refresh_token": old_refresh}
    )
    assert r.status_code == 200
    new_pair = r.json()
    assert "access_token" in new_pair
    # Wichtige Garantie: Refresh-Token rotiert. Der Access-Token kann
    # binaer identisch sein, wenn beide in derselben Sekunde erzeugt
    # werden (gleiche sub/exp/type-Claims) — das ist korrektes JWT-Verhalten.
    assert new_pair["refresh_token"] != old_refresh
    assert new_pair["token_type"] == "bearer"
    assert new_pair["expires_in"] > 0


async def test_refresh_invalidates_old_refresh_token(client, user_a):
    """Replay-Schutz: alter Refresh-Token darf nach Rotation nicht mehr gehen."""
    old = user_a["tokens"]["refresh_token"]

    first = await client.post("/api/v1/auth/refresh", json={"refresh_token": old})
    assert first.status_code == 200

    second = await client.post("/api/v1/auth/refresh", json={"refresh_token": old})
    assert second.status_code == 401


async def test_refresh_with_unknown_token_returns_401(client):
    r = await client.post(
        "/api/v1/auth/refresh", json={"refresh_token": "ungueltig-blub"}
    )
    assert r.status_code == 401


async def test_refresh_chain_works(client, user_a):
    """Mehrfaches Refresh-Rotieren funktioniert mit jeweils neuem Token."""
    current = user_a["tokens"]["refresh_token"]
    for _ in range(3):
        r = await client.post(
            "/api/v1/auth/refresh", json={"refresh_token": current}
        )
        assert r.status_code == 200
        current = r.json()["refresh_token"]
