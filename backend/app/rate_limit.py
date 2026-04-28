"""Re-Export des Limiters aus main, damit Router-Module den Decorator
nutzen koennen, ohne in eine Zirkularimport-Falle zu laufen.

Limit-Strategie:
- Default 600/minute auf alle Endpoints (in main.py konfiguriert).
- Write-Endpoints (POST/PUT/DELETE) bekommen 60/minute zusaetzlich
  per Decorator — schuetzt vor Bulk-Erzeugung von Presets/Images.
- Tests setzen LUMEN_RATELIMIT_DISABLED=1, damit die Suite kein
  429 sieht.

Sicherheits-Hinweis (Security-Review): Python's `hash()` wird per
PYTHONHASHSEED randomisiert; bei Multi-Worker-Setup haette jeder
Worker eine eigene Hash-Reihenfolge und das Limit waere effektiv
mit der Worker-Anzahl multipliziert. Wir nutzen daher einen stabilen
SHA-256-Hash. Fuer echte Multi-Worker-Skalierung muss `storage_uri`
gesetzt werden (Redis-Backend), sonst sind die Counter pro Worker
isoliert.
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


limiter = Limiter(
    key_func=_key_func,
    enabled=os.environ.get("LUMEN_RATELIMIT_DISABLED") != "1",
)
