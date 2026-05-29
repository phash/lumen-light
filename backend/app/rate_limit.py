"""Re-Export des Limiters aus main, damit Router-Module den Decorator
nutzen koennen, ohne in eine Zirkularimport-Falle zu laufen.

Limit-Strategie:
- Default 600/minute auf ALLE Endpoints. Greift via SlowAPIMiddleware
  (in main.py registriert) — ohne die Middleware wuerden `default_limits`
  ignoriert und nur dekorierte Routen waeren limitiert (GET-Endpoints
  blieben offen).
- Write-Endpoints (POST/PUT/DELETE) bekommen 60/minute (bzw. 30/5/h)
  zusaetzlich per Decorator — schuetzt vor Bulk-Erzeugung.
- Tests setzen LUMEN_RATELIMIT_DISABLED=1, damit die Suite kein
  429 sieht.

Key = JWT-`sub` (nicht der rohe Token): Access-Tokens rotieren bei jedem
Refresh (<=15 min). Wuerde der Bucket am rohen Token haengen, setzte jede
Rotation die Counter zurueck und das Limit waere trivial umgehbar. Der
`sub`-Claim ist pro User stabil. Wir dekodieren OHNE Signaturpruefung —
die echte Verifikation macht die Auth-Dependency; gefaelschte Tokens
laufen ohnehin in 401 und richten keinen Schaden an.

Stable-Hash: SHA-256 statt Python's per-PYTHONHASHSEED randomisiertem
`hash()`, sodass derselbe `sub` auf jedem Worker denselben Bucket trifft.

Storage-Backend:
- `LUMEN_RATELIMIT_STORAGE` env (default `memory://`) — in-memory haelt
  Counter pro Worker isoliert, was bei `--workers > 1` heisst, dass das
  effektive Limit mit der Worker-Anzahl multipliziert wird.
- `redis://host:port/db` — gemeinsam ueber alle Worker, wird in der
  Production-Compose vom mitgelieferten lumen-redis-Service gefuettert.
- Tests laufen single-process, in-memory ist OK.
"""
from __future__ import annotations

import hashlib
import os

import jwt
from slowapi import Limiter
from slowapi.util import get_remote_address


def _unverified_sub(token: str) -> str | None:
    """`sub`-Claim ohne Signaturpruefung lesen — nur fuer das Rate-Limit-
    Bucketing. None bei kaputtem/sub-losem Token (Caller faellt auf IP zurueck)."""
    try:
        payload = jwt.decode(
            token, options={"verify_signature": False, "verify_aud": False}
        )
    except Exception:
        return None
    sub = payload.get("sub")
    return sub if isinstance(sub, str) and sub else None


def _key_func(request) -> str:
    auth_header = request.headers.get("authorization", "")
    if auth_header.startswith("Bearer "):
        sub = _unverified_sub(auth_header[7:])
        if sub:
            digest = hashlib.sha256(sub.encode("utf-8")).hexdigest()[:16]
            return f"u:{digest}"
    return f"ip:{get_remote_address(request)}"


_storage_uri = os.environ.get("LUMEN_RATELIMIT_STORAGE", "memory://")

limiter = Limiter(
    key_func=_key_func,
    default_limits=["600/minute"],
    enabled=os.environ.get("LUMEN_RATELIMIT_DISABLED") != "1",
    storage_uri=_storage_uri,
    # Bei Redis-Outage Fallback auf in-memory statt Hard-Fail. Single-
    # User koennten dann zwar das Limit knacken, aber die App bleibt up.
    in_memory_fallback_enabled=True,
)
