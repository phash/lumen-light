"""Re-Export des Limiters aus main, damit Router-Module den Decorator
nutzen koennen, ohne in eine Zirkularimport-Falle zu laufen.

Limit-Strategie:
- Default 600/minute auf alle Endpoints (in main.py konfiguriert).
- Write-Endpoints (POST/PUT/DELETE) bekommen 60/minute zusaetzlich
  per Decorator — schuetzt vor Bulk-Erzeugung von Presets/Images.
- Tests setzen LUMEN_RATELIMIT_DISABLED=1, damit die Suite kein
  429 sieht.

Stable-Hash: Python's `hash()` wird per PYTHONHASHSEED randomisiert;
bei Multi-Worker-Setup haette jeder Worker eine eigene Hash-Reihenfolge
und das Limit waere effektiv mit der Worker-Anzahl multipliziert. Wir
nutzen einen SHA-256-Hash, sodass dieselbe User-ID auf jedem Worker
denselben Bucket trifft.

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


def _key_func(request) -> str:
    auth_header = request.headers.get("authorization", "")
    if auth_header.startswith("Bearer "):
        token = auth_header[7:]
        digest = hashlib.sha256(token.encode("utf-8")).hexdigest()[:16]
        return f"u:{digest}"
    return f"ip:{get_remote_address(request)}"


_storage_uri = os.environ.get("LUMEN_RATELIMIT_STORAGE", "memory://")

limiter = Limiter(
    key_func=_key_func,
    enabled=os.environ.get("LUMEN_RATELIMIT_DISABLED") != "1",
    storage_uri=_storage_uri,
    # Bei Redis-Outage Fallback auf in-memory statt Hard-Fail. Single-
    # User koennten dann zwar das Limit knacken, aber die App bleibt up.
    in_memory_fallback_enabled=True,
)
