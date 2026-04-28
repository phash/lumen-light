"""Re-Export des Limiters aus main, damit Router-Module den Decorator
nutzen koennen, ohne in eine Zirkularimport-Falle zu laufen.

Limit-Strategie:
- Default 600/minute auf alle Endpoints (in main.py konfiguriert).
- Write-Endpoints (POST/PUT/DELETE) bekommen 60/minute zusaetzlich
  per Decorator — schuetzt vor Bulk-Erzeugung von Presets/Images.
- Tests setzen LUMEN_RATELIMIT_DISABLED=1, damit die Suite kein
  429 sieht.
"""
from __future__ import annotations

import os

from slowapi import Limiter
from slowapi.util import get_remote_address


def _key_func(request) -> str:
    auth_header = request.headers.get("authorization", "")
    if auth_header.startswith("Bearer "):
        token = auth_header[7:]
        return f"u:{hash(token) & 0xffffffff:08x}"
    return f"ip:{get_remote_address(request)}"


limiter = Limiter(
    key_func=_key_func,
    enabled=os.environ.get("LUMEN_RATELIMIT_DISABLED") != "1",
)
