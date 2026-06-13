"""Tests fuer die JWT-Verifikation gegen Keycloak (siehe ADR-010)."""
import time

import jwt


async def test_endpoint_without_token_returns_401(client):
    r = await client.get("/api/v1/auth/me")
    assert r.status_code == 401


async def test_endpoint_with_invalid_signature_returns_401(client):
    # Beliebiger Garbage-Token — nicht mal valides JWT-Format
    r = await client.get(
        "/api/v1/auth/me", headers={"Authorization": "Bearer not-a-jwt"}
    )
    assert r.status_code == 401


async def test_endpoint_with_token_signed_by_wrong_key_returns_401(client, user_a):
    """Token mit valider JWT-Struktur, aber selbst signiert (also wrong kid)."""
    payload = {
        "sub": user_a["keycloak_sub"],
        "email": user_a["email"],
        "iss": "https://attacker.example.com/realms/lumen",
        "aud": "lumen-api",
        "exp": int(time.time()) + 600,
    }
    forged = jwt.encode(payload, "geheim", algorithm="HS256")
    r = await client.get(
        "/api/v1/auth/me", headers={"Authorization": f"Bearer {forged}"}
    )
    assert r.status_code == 401


async def test_truly_expired_token_returns_401(client, monkeypatch):
    """Echter exp-Pfad ohne langsames Warten: wir signieren ein Token mit
    einem eigenen RSA-Key und injizieren dessen JWK in den Cache (Signatur
    verifiziert also korrekt). aud/iss sind gueltig — nur `exp` liegt jenseits
    der 30s-leeway in der Vergangenheit. Damit feuert genau der
    jwt.decode-Expired-Branch -> 401 (statt eines unspezifischen Verify-Fails
    wie beim wrong-key/wrong-aud-Test)."""
    import json

    from cryptography.hazmat.primitives.asymmetric import rsa

    from app import auth
    from app.config import settings

    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    jwk = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(private_key.public_key()))
    jwk["kid"] = "test-expired-key"
    # Cache-Lookup so umbiegen, dass unser JWK fuer jede kid geliefert wird.
    monkeypatch.setattr(auth._jwk_cache, "get", lambda _kid: jwk)

    now = int(time.time())
    token = jwt.encode(
        {
            "sub": "00000000-0000-0000-0000-000000000000",
            "email": "expired@example.com",
            "iss": settings.keycloak_issuer,
            "aud": settings.keycloak_audience,
            "iat": now - 3600,
            "exp": now - 120,  # 2 min in der Vergangenheit, > leeway(30s)
        },
        private_key,
        algorithm="RS256",
        headers={"kid": "test-expired-key"},
    )
    r = await client.get(
        "/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"}
    )
    assert r.status_code == 401, r.text


async def test_token_without_kid_returns_401(client):
    """Ein JWT ohne kid-Header kann keinem JWK zugeordnet werden -> 401
    (Token ohne kid-Header)."""
    token = jwt.encode(
        {"sub": "x", "email": "x@example.com"}, "secret", algorithm="HS256"
    )
    r = await client.get(
        "/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"}
    )
    assert r.status_code == 401


async def test_endpoint_with_wrong_audience_returns_401(client, user_a):
    """Token mit gueltiger Signatur und Issuer, aber falscher Audience.

    Wir nehmen den User-A-Token und decodieren ihn; den 'aud'-Claim koennen
    wir aber nicht ueberschreiben, ohne neu zu signieren. Daher: indirekter
    Check — wir setzen die Backend-Setting 'keycloak_audience' temporaer
    auf einen Wert, der NICHT im Token steht, und erwarten 401."""
    from app import config

    original = config.settings.keycloak_audience
    config.settings.keycloak_audience = "ein-anderer-client"
    try:
        r = await client.get("/api/v1/auth/me", headers=user_a["headers"])
        assert r.status_code == 401
    finally:
        config.settings.keycloak_audience = original


async def test_endpoint_with_valid_token_returns_data(client, user_a):
    r = await client.get("/api/v1/auth/me", headers=user_a["headers"])
    assert r.status_code == 200
    body = r.json()
    assert body["email"] == user_a["email"]
