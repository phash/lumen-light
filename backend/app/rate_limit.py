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

Key = JWT-`sub` (nicht der rohe Token), ABER nur fuer signatur-
verifizierte Tokens: Access-Tokens rotieren bei jedem Refresh (<=15 min);
haenge der Bucket am rohen Token, setzte jede Rotation die Counter zurueck.
Der `sub`-Claim ist pro User stabil. Frueher wurde `sub` ungeprueft
gelesen — dann bekam ein gefaelschter Token mit Zufalls-`sub` je Request
einen frischen Bucket (Limit-Bypass), oder ein Angreifer verbrannte mit dem
`sub` eines Opfers dessen Bucket. Jetzt: Verifikation gegen die bereits
gecachten JWKs (`auth.verified_claims_cached`, kein Netzwerk). Alles, was
nicht verifizierbar ist (gefaelscht, abgelaufen, unbekannter kid, kalter
Cache direkt nach Start), faellt auf den IP-Bucket zurueck.

IP = `request.client.host`. Hinter Caddy ist das nur dann die echte
Client-IP, wenn uvicorn `--proxy-headers --forwarded-allow-ips` fuer den
Proxy gesetzt hat (siehe backend/Dockerfile, env FORWARDED_ALLOW_IPS) —
sonst teilen sich alle anonymen Requests den Bucket der Caddy-Container-IP.

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

from slowapi import Limiter
from slowapi.util import get_remote_address


def _verified_sub(token: str) -> str | None:
    """`sub` eines signatur-verifizierten Tokens (nur gecachte JWKs, kein
    Netzwerk). None, wenn nicht verifizierbar -> Caller nimmt den IP-Bucket."""
    # Lazy-Import: app.auth zieht DB/Models nach; rate_limit wird von den
    # Router-Modulen frueh importiert (Zirkularimport vermeiden).
    from app.auth import verified_claims_cached

    payload = verified_claims_cached(token)
    if payload is None:
        return None
    sub = payload.get("sub")
    return sub if isinstance(sub, str) and sub else None


def _key_func(request) -> str:
    auth_header = request.headers.get("authorization", "")
    if auth_header.startswith("Bearer "):
        sub = _verified_sub(auth_header[7:])
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
