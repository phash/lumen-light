"""Tests fuer den Rate-Limit-Key (rate_limit._key_func).

Reine Unit-Tests ohne Container — pruefen, dass der Bucket pro User
stabil ist (JWT-`sub`) und NICHT pro Token-Instanz. Sonst setzt jede
Token-Rotation (alle <=15 min via Refresh) die Counter zurueck und das
Limit ist effektiv umgehbar.
"""
from __future__ import annotations

from types import SimpleNamespace

import jwt

from app.rate_limit import _key_func


def _req(auth: str | None = None, host: str = "10.0.0.1") -> SimpleNamespace:
    headers = {"authorization": auth} if auth is not None else {}
    return SimpleNamespace(headers=headers, client=SimpleNamespace(host=host))


def test_key_func_same_sub_different_tokens_yields_same_bucket() -> None:
    # Zwei verschiedene Tokens (anderes jti), gleicher User -> gleicher Bucket.
    t1 = jwt.encode({"sub": "user-1", "jti": "a"}, "secret", algorithm="HS256")
    t2 = jwt.encode({"sub": "user-1", "jti": "b"}, "secret", algorithm="HS256")
    assert _key_func(_req(f"Bearer {t1}")) == _key_func(_req(f"Bearer {t2}"))


def test_key_func_different_sub_yields_different_bucket() -> None:
    t1 = jwt.encode({"sub": "user-1"}, "secret", algorithm="HS256")
    t2 = jwt.encode({"sub": "user-2"}, "secret", algorithm="HS256")
    assert _key_func(_req(f"Bearer {t1}")) != _key_func(_req(f"Bearer {t2}"))


def test_key_func_without_token_falls_back_to_ip() -> None:
    assert _key_func(_req(None, host="203.0.113.9")) == "ip:203.0.113.9"


def test_key_func_unparseable_token_falls_back_to_ip() -> None:
    # Kaputtes Token darf keinen Crash ausloesen, sondern IP-Fallback.
    assert _key_func(_req("Bearer not-a-jwt", host="203.0.113.7")) == "ip:203.0.113.7"
