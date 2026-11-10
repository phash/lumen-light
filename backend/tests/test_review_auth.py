"""L1/L2/M4 + JWT-Haertung: kid-Typ, JWKS-Ausfall, interne KC-URL,
Startup-Warnung, Issuer- und alg-Confusion-Pruefung."""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import time
from typing import Any

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

from app import auth, keycloak_admin
from app.config import settings


KID = "review-key"


@pytest.fixture
def rsa_key():
    """Eigener RSA-Key, dessen JWK als bekannter kid im Cache liegt."""
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    jwk = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(key.public_key()))
    jwk["kid"] = KID
    auth._jwk_cache._keys_by_kid = {KID: jwk}  # noqa: SLF001
    auth._jwk_cache._fetched_at = time.monotonic()  # noqa: SLF001
    return key


def _claims(**over: Any) -> dict[str, Any]:
    now = int(time.time())
    base = {
        "sub": "00000000-0000-0000-0000-0000000000aa",
        "email": "review@example.com",
        "iss": settings.keycloak_issuer,
        "aud": settings.keycloak_audience,
        "iat": now,
        "exp": now + 600,
    }
    base.update(over)
    return base


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _raw_token(header: dict[str, Any], claims: dict[str, Any], secret: bytes) -> str:
    """HS256 von Hand signieren — PyJWT verweigert PEM-Keys als HMAC-Secret."""
    signing_input = (
        _b64(json.dumps(header).encode()) + "." + _b64(json.dumps(claims).encode())
    )
    sig = hmac.new(secret, signing_input.encode(), hashlib.sha256).digest()
    return signing_input + "." + _b64(sig)


async def test_richtiger_key_falscher_issuer_gibt_401(client, rsa_key):
    token = jwt.encode(
        _claims(iss="https://evil.example.com/realms/lumen"),
        rsa_key, algorithm="RS256", headers={"kid": KID},
    )
    r = await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 401


async def test_hs256_mit_rsa_public_pem_als_secret_gibt_401(client, rsa_key):
    pem = rsa_key.public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
    )
    token = _raw_token({"alg": "HS256", "typ": "JWT", "kid": KID}, _claims(), pem)
    r = await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 401


async def test_richtig_signierter_token_wird_akzeptiert(client, rsa_key):
    """Gegenprobe: derselbe Key mit gueltigen Claims -> 200."""
    token = jwt.encode(_claims(), rsa_key, algorithm="RS256", headers={"kid": KID})
    r = await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200, r.text


@pytest.mark.parametrize("kid", [123, ["a", "b"], {"x": 1}])
async def test_nicht_string_kid_gibt_401(client, kid):
    token = _raw_token({"alg": "RS256", "typ": "JWT", "kid": kid}, _claims(), b"x")
    r = await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 401, r.text


async def test_jwks_ausfall_gibt_503(client, monkeypatch, rsa_key):
    auth._jwk_cache.reset()

    class _Boom:
        def __init__(self, **_kw: Any) -> None:
            pass

        def __enter__(self) -> "_Boom":
            return self

        def __exit__(self, *_a: Any) -> None:
            return None

        def get(self, url: str) -> Any:
            raise httpx.ConnectError("keycloak down")

    monkeypatch.setattr(auth.httpx, "Client", _Boom)
    token = jwt.encode(_claims(), rsa_key, algorithm="RS256", headers={"kid": KID})
    r = await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 503, r.text


def test_jwks_url_nutzt_interne_keycloak_url(monkeypatch):
    monkeypatch.setattr(settings, "keycloak_issuer", "https://lumen.example.com/auth/realms/lumen")
    monkeypatch.setattr(settings, "keycloak_internal_url", "http://lumen-keycloak:8080/auth/")
    assert auth.jwks_url() == (
        "http://lumen-keycloak:8080/auth/realms/lumen/protocol/openid-connect/certs"
    )
    assert keycloak_admin._admin_base() == "http://lumen-keycloak:8080/auth"


def test_jwks_url_ohne_interne_url_nutzt_issuer(monkeypatch):
    monkeypatch.setattr(settings, "keycloak_issuer", "https://lumen.example.com/auth/realms/lumen")
    monkeypatch.setattr(settings, "keycloak_internal_url", "")
    assert auth.jwks_url() == (
        "https://lumen.example.com/auth/realms/lumen/protocol/openid-connect/certs"
    )
    assert keycloak_admin._admin_base() == "https://lumen.example.com/auth"


def test_admin_calls_nutzen_interne_url(monkeypatch):
    calls: list[str] = []

    class _Resp:
        def __init__(self, code: int, data: dict | None = None) -> None:
            self.status_code = code
            self._data = data or {}
            self.text = ""

        def json(self) -> dict:
            return self._data

    class _Client:
        def __init__(self, **_kw: Any) -> None:
            pass

        def __enter__(self) -> "_Client":
            return self

        def __exit__(self, *_a: Any) -> None:
            return None

        def post(self, url: str, **_kw: Any) -> _Resp:
            calls.append(url)
            return _Resp(200, {"access_token": "t"})

        def delete(self, url: str, **_kw: Any) -> _Resp:
            calls.append(url)
            return _Resp(204)

    monkeypatch.setattr(settings, "keycloak_issuer", "https://lumen.example.com/auth/realms/lumen")
    monkeypatch.setattr(settings, "keycloak_internal_url", "http://lumen-keycloak:8080/auth")
    monkeypatch.setattr(settings, "keycloak_admin_client_id", "svc")
    monkeypatch.setattr(settings, "keycloak_admin_client_secret", "geheim")
    monkeypatch.setattr(keycloak_admin.httpx, "Client", _Client)
    assert keycloak_admin.delete_user("sub-1") is True
    assert calls == [
        "http://lumen-keycloak:8080/auth/realms/lumen/protocol/openid-connect/token",
        "http://lumen-keycloak:8080/auth/admin/realms/lumen/users/sub-1",
    ]


def test_production_warnt_bei_fehlendem_service_account(monkeypatch, caplog):
    from app.main import warn_on_insecure_config

    monkeypatch.setattr(settings, "env", "production")
    monkeypatch.setattr(settings, "keycloak_admin_client_id", "")
    monkeypatch.setattr(settings, "keycloak_admin_client_secret", "")
    with caplog.at_level(logging.WARNING):
        warn_on_insecure_config()
    assert any("KEYCLOAK_ADMIN_CLIENT_ID" in rec.getMessage() for rec in caplog.records)


def test_development_warnt_nicht(monkeypatch, caplog):
    from app.main import warn_on_insecure_config

    monkeypatch.setattr(settings, "env", "development")
    monkeypatch.setattr(settings, "keycloak_admin_client_id", "")
    with caplog.at_level(logging.WARNING):
        warn_on_insecure_config()
    assert not any("KEYCLOAK_ADMIN_CLIENT_ID" in rec.getMessage() for rec in caplog.records)
