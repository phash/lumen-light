"""Tests fuer den Rate-Limit-Key (rate_limit._key_func).

Reine Unit-Tests ohne HTTP — pruefen, dass der Bucket pro User stabil ist
(verifizierter JWT-`sub`) und NICHT pro Token-Instanz. Sonst setzt jede
Token-Rotation (alle <=15 min via Refresh) die Counter zurueck. Und: nicht
verifizierbare Tokens (gefaelscht/fremder Key) duerfen keinen eigenen
User-Bucket bekommen, sondern landen im IP-Bucket.
"""
from __future__ import annotations

import json
import time
from types import SimpleNamespace

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

from app.rate_limit import _key_func


KID = "rl-test-key"


def _req(auth: str | None = None, host: str = "10.0.0.1") -> SimpleNamespace:
    headers = {"authorization": auth} if auth is not None else {}
    return SimpleNamespace(headers=headers, client=SimpleNamespace(host=host))


@pytest.fixture
def signing_key():
    """Eigener RSA-Key, dessen JWK in den Auth-Cache injiziert wird —
    damit gelten damit signierte Tokens als verifiziert."""
    from app import auth

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    jwk = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(key.public_key()))
    jwk["kid"] = KID
    auth._jwk_cache._keys_by_kid = {KID: jwk}  # noqa: SLF001
    auth._jwk_cache._fetched_at = time.monotonic()  # noqa: SLF001
    return key


def _token(key, sub: str, **extra) -> str:
    from app.config import settings

    now = int(time.time())
    claims = {
        "sub": sub,
        "iss": settings.keycloak_issuer,
        "aud": settings.keycloak_audience,
        "iat": now,
        "exp": now + 600,
        **extra,
    }
    return jwt.encode(claims, key, algorithm="RS256", headers={"kid": KID})


def test_key_func_same_sub_different_tokens_yields_same_bucket(signing_key) -> None:
    # Zwei verschiedene Tokens (anderes jti), gleicher User -> gleicher Bucket.
    t1 = _token(signing_key, "user-1", jti="a")
    t2 = _token(signing_key, "user-1", jti="b")
    k1 = _key_func(_req(f"Bearer {t1}"))
    assert k1.startswith("u:")
    assert k1 == _key_func(_req(f"Bearer {t2}", host="10.9.9.9"))


def test_key_func_different_sub_yields_different_bucket(signing_key) -> None:
    t1 = _token(signing_key, "user-1")
    t2 = _token(signing_key, "user-2")
    assert _key_func(_req(f"Bearer {t1}")) != _key_func(_req(f"Bearer {t2}"))


def test_key_func_without_token_falls_back_to_ip() -> None:
    assert _key_func(_req(None, host="203.0.113.9")) == "ip:203.0.113.9"


def test_key_func_unparseable_token_falls_back_to_ip() -> None:
    # Kaputtes Token darf keinen Crash ausloesen, sondern IP-Fallback.
    assert _key_func(_req("Bearer not-a-jwt", host="203.0.113.7")) == "ip:203.0.113.7"


def test_gefaelschter_token_mit_zufalls_sub_landet_im_ip_bucket(signing_key) -> None:
    """Ohne gueltige Signatur kein eigener Bucket — sonst bekaeme jeder
    Request mit Zufalls-sub einen frischen Counter (Limit-Bypass)."""
    forged = jwt.encode(
        {"sub": "random-123"}, "secret", algorithm="HS256", headers={"kid": KID}
    )
    assert _key_func(_req(f"Bearer {forged}", host="198.51.100.4")) == "ip:198.51.100.4"


def test_gefaelschter_token_mit_opfer_sub_trifft_nicht_dessen_bucket(signing_key) -> None:
    victim = _key_func(_req(f"Bearer {_token(signing_key, 'victim')}"))
    other_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    forged = _token(other_key, "victim")
    assert _key_func(_req(f"Bearer {forged}", host="198.51.100.5")) != victim


def test_abgelaufener_token_landet_im_ip_bucket(signing_key) -> None:
    old = int(time.time()) - 3600
    expired = _token(signing_key, "user-1", iat=old, exp=old + 60)
    assert _key_func(_req(f"Bearer {expired}", host="198.51.100.6")) == "ip:198.51.100.6"


def test_unbekannter_kid_loest_keinen_jwks_fetch_aus(monkeypatch) -> None:
    """Das Keying darf nie Netzwerk machen (kalter Cache -> IP)."""
    from app import auth

    def _no_fetch() -> None:
        raise AssertionError("Rate-Limit-Keying darf kein JWKS laden")

    monkeypatch.setattr(auth._jwk_cache, "_fetch", _no_fetch)
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    token = _token(key, "user-1")
    assert _key_func(_req(f"Bearer {token}", host="198.51.100.7")) == "ip:198.51.100.7"
