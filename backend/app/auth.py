"""JWT-Verifikation gegen den Keycloak-Realm + JIT-User-Provisioning.

Lumen-Backend ist ein OIDC Resource Server: Tokens werden ausschliesslich
von Keycloak ausgestellt, hier nur verifiziert. Siehe ADR-010.
"""
from __future__ import annotations

import time
from typing import Any

import httpx
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models import Preset, User


# Default-Presets, die bei JIT-Provisioning eines neuen Users angelegt werden.
# Spec: docs/03-datenmodell.md. Die genre-spezifischen Presets stammen
# aus typischen Lightroom-Empfehlungen fuer Anfaenger und sind bewusst
# moderat — sie sollen den Bild-Charakter unterstreichen, nicht
# uebertreiben.
_DEFAULT_PRESETS: list[dict] = [
    {
        "name": "Neutral",
        "adjustments": {k: 0 for k in (
            "exposure", "contrast", "highlights", "shadows", "whites",
            "blacks", "temperature", "tint", "vibrance", "saturation",
        )},
    },
    {
        "name": "Punchy",
        "adjustments": {
            "exposure": 0, "contrast": 0.30, "highlights": 0, "shadows": 0.15,
            "whites": 0, "blacks": -0.10, "temperature": 0, "tint": 0,
            "vibrance": 0.40, "saturation": 0,
        },
    },
    {
        "name": "Soft Mood",
        "adjustments": {
            "exposure": 0, "contrast": -0.15, "highlights": -0.30, "shadows": 0.20,
            "whites": -0.10, "blacks": 0.10, "temperature": 0.05, "tint": 0,
            "vibrance": -0.10, "saturation": 0,
        },
    },
    {
        "name": "Schwarzweiss-Vorbereitung",
        "adjustments": {
            "exposure": 0, "contrast": 0.20, "highlights": 0, "shadows": 0,
            "whites": 0, "blacks": 0, "temperature": 0, "tint": 0,
            "vibrance": 0, "saturation": -1.0,
        },
    },
    # --- Genre-Presets (Phase 5+) ---
    {
        # Hauttoene weich, Lichter zaehmen, Schatten oeffnen, leicht warm.
        "name": "Portrait",
        "adjustments": {
            "exposure": 0, "contrast": 0.10, "highlights": -0.20, "shadows": 0.20,
            "whites": -0.05, "blacks": 0.05, "temperature": 0.05, "tint": 0,
            "vibrance": 0.20, "saturation": 0,
        },
    },
    {
        # Drama im Himmel, Vordergrund auf, Gruen/Blau pop ueber Vibrance.
        "name": "Landschaft",
        "adjustments": {
            "exposure": 0, "contrast": 0.25, "highlights": -0.35, "shadows": 0.30,
            "whites": 0.15, "blacks": -0.10, "temperature": -0.05, "tint": 0,
            "vibrance": 0.40, "saturation": 0.10,
        },
    },
    {
        # Architektur: Kontrast, Linien betonen, leicht kuehl, gedaempfte Saettigung.
        "name": "Stadt",
        "adjustments": {
            "exposure": 0, "contrast": 0.30, "highlights": -0.20, "shadows": 0.15,
            "whites": 0.10, "blacks": -0.15, "temperature": -0.10, "tint": 0,
            "vibrance": 0.10, "saturation": -0.05,
        },
    },
    {
        # Wald/Wiese: lebendige Gruentoene, neutrale Farbtemperatur, weiche Schatten.
        "name": "Natur",
        "adjustments": {
            "exposure": 0, "contrast": 0.20, "highlights": -0.25, "shadows": 0.25,
            "whites": 0.05, "blacks": -0.05, "temperature": 0, "tint": 0,
            "vibrance": 0.45, "saturation": 0.05,
        },
    },
    {
        # Fell/Augen: Mid-Kontrast, leicht warm, moderate Vibrance.
        "name": "Tiere",
        "adjustments": {
            "exposure": 0, "contrast": 0.20, "highlights": -0.20, "shadows": 0.20,
            "whites": 0.05, "blacks": -0.10, "temperature": 0.05, "tint": 0,
            "vibrance": 0.25, "saturation": 0,
        },
    },
    {
        # Dynamik: Punch, tiefe Schwarz, Lichter unter Kontrolle.
        "name": "Sport",
        "adjustments": {
            "exposure": 0, "contrast": 0.35, "highlights": -0.25, "shadows": 0.10,
            "whites": 0.10, "blacks": -0.20, "temperature": 0, "tint": 0,
            "vibrance": 0.30, "saturation": 0.05,
        },
    },
]


bearer_scheme = HTTPBearer(auto_error=False)


# ----- JWK-Set Cache -----

class _JwkCache:
    """In-memory Cache fuer das JWK-Set des Keycloak-Realms.

    TTL aus settings.jwk_cache_seconds. Bei Cache-Miss oder Expiry wird das
    Set frisch geholt. Bei kid-Miss (Token verweist auf einen Schluessel,
    den wir noch nicht kennen) wird einmalig neu geladen — das deckt den
    Key-Rotation-Fall ab.
    """

    def __init__(self) -> None:
        self._keys_by_kid: dict[str, dict[str, Any]] = {}
        self._fetched_at: float = 0.0

    def _is_expired(self) -> bool:
        return (time.monotonic() - self._fetched_at) > settings.jwk_cache_seconds

    def _fetch(self) -> None:
        url = settings.keycloak_issuer.rstrip("/") + "/protocol/openid-connect/certs"
        with httpx.Client(timeout=5.0) as c:
            r = c.get(url)
            r.raise_for_status()
            data = r.json()
        self._keys_by_kid = {k["kid"]: k for k in data.get("keys", []) if "kid" in k}
        self._fetched_at = time.monotonic()

    def get(self, kid: str) -> dict[str, Any]:
        if self._is_expired() or kid not in self._keys_by_kid:
            self._fetch()
        if kid not in self._keys_by_kid:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token-Signatur konnte nicht verifiziert werden (kid unbekannt).",
            )
        return self._keys_by_kid[kid]

    def reset(self) -> None:
        """Fuer Tests: Cache nach Container-Restart invalidieren."""
        self._keys_by_kid = {}
        self._fetched_at = 0.0


_jwk_cache = _JwkCache()


def _decode_token(token: str) -> dict[str, Any]:
    try:
        header = jwt.get_unverified_header(token)
    except JWTError as exc:
        raise HTTPException(status_code=401, detail="Token-Header unlesbar.") from exc

    kid = header.get("kid")
    if not kid:
        raise HTTPException(status_code=401, detail="Token ohne kid-Header.")

    key = _jwk_cache.get(kid)
    # Whitelist statt Header-Wert: verhindert "alg confusion" (Token mit
    # alg=HS256, das die Bibliothek mit dem RSA-Public-Key als HMAC-Secret
    # verifizieren wuerde). Keycloak signiert ausschliesslich RS256.
    try:
        return jwt.decode(
            token,
            key,
            algorithms=["RS256"],
            audience=settings.keycloak_audience,
            issuer=settings.keycloak_issuer,
        )
    except JWTError as exc:
        raise HTTPException(status_code=401, detail=f"Token ungueltig: {exc}") from exc


# ----- JIT-User-Provisioning -----

async def _get_or_create_user(db: AsyncSession, sub: str, email: str) -> User:
    result = await db.execute(select(User).where(User.keycloak_sub == sub))
    user = result.scalar_one_or_none()
    if user is None:
        user = User(keycloak_sub=sub, email=email)
        db.add(user)
        await db.flush()  # User-ID erzeugen, ohne zu committen
        for p in _DEFAULT_PRESETS:
            db.add(Preset(user_id=user.id, name=p["name"], adjustments=p["adjustments"]))
        await db.commit()
        await db.refresh(user)
        return user

    # Email-Spiegel aktualisieren, falls in Keycloak geaendert
    if user.email != email:
        user.email = email
        await db.commit()
        await db.refresh(user)
    return user


# ----- FastAPI-Dependency -----

async def current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    if creds is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentifizierung erforderlich.",
        )
    payload = _decode_token(creds.credentials)

    sub = payload.get("sub")
    email = payload.get("email") or payload.get("preferred_username")
    if not sub or not email:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token ohne sub- oder email-Claim.",
        )
    return await _get_or_create_user(db, sub=sub, email=email)
