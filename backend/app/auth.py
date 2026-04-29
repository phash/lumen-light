"""JWT-Verifikation gegen den Keycloak-Realm + JIT-User-Provisioning.

Lumen-Backend ist ein OIDC Resource Server: Tokens werden ausschliesslich
von Keycloak ausgestellt, hier nur verifiziert. Siehe ADR-010.
"""
from __future__ import annotations

import time
from typing import Any

import httpx
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt.algorithms import RSAAlgorithm
from jwt.exceptions import InvalidTokenError, PyJWTError
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
    # --- Erweiterte Genre-Presets (Phase G+ / Onboarding-Wave) ---
    {
        # Insekten/Bluete: Klarheit fuer Mikro-Texturen, leichter Saettigungsboost
        # auf Bluetenfarben, Schaerfen im Detail-Bereich.
        "name": "Macro",
        "adjustments": {
            "exposure": 0, "contrast": 0.15, "highlights": -0.15, "shadows": 0.10,
            "whites": 0, "blacks": -0.05, "temperature": 0, "tint": 0,
            "vibrance": 0.20, "saturation": 0,
            "sharpness": 0.30, "noiseReduction": 0.10,
            "highlightRecovery": 0, "localContrast": 0.30,
        },
    },
    {
        # Sterne/Milchstrasse: Schatten oeffnen ohne Rauschen, leicht kuehl,
        # Highlights eindaempfen. Erwartet langes Belichten — wir setzen
        # Belichtung neutral, der Fotograf justiert nach.
        "name": "Astro",
        "adjustments": {
            "exposure": 0, "contrast": 0.30, "highlights": -0.40, "shadows": 0.50,
            "whites": -0.10, "blacks": -0.15, "temperature": -0.15, "tint": -0.05,
            "vibrance": 0.25, "saturation": 0,
            "sharpness": 0, "noiseReduction": 0.40,
            "highlightRecovery": 0, "localContrast": 0.20,
        },
    },
    {
        # Speisen: warm + appetitlich, Saettigung nur leicht (sonst Plastik-
        # Look), Klarheit gibt Textur (Brot, Soße).
        "name": "Food",
        "adjustments": {
            "exposure": 0.10, "contrast": 0.15, "highlights": -0.20, "shadows": 0.20,
            "whites": 0.05, "blacks": -0.05, "temperature": 0.10, "tint": 0,
            "vibrance": 0.30, "saturation": 0.05,
            "sharpness": 0.10, "noiseReduction": 0,
            "highlightRecovery": 0.20, "localContrast": 0.20,
        },
    },
    {
        # Hochzeit: weiches Hautlicht, romantisch, Lichter retten fuer
        # Brautkleid, Schatten oeffnen fuer Anzug.
        "name": "Hochzeit",
        "adjustments": {
            "exposure": 0.05, "contrast": 0, "highlights": -0.30, "shadows": 0.25,
            "whites": -0.10, "blacks": 0.05, "temperature": 0.05, "tint": 0,
            "vibrance": 0.15, "saturation": 0,
            "sharpness": 0, "noiseReduction": 0.10,
            "highlightRecovery": 0.40, "localContrast": -0.10,
        },
    },
    {
        # Innen/Indoor: typisch Mischlicht. Etwas waermer, Schatten auf,
        # leichte Rauschunterdrueckung als Default-Sicherheitsnetz.
        "name": "Innen",
        "adjustments": {
            "exposure": 0.20, "contrast": 0.10, "highlights": -0.10, "shadows": 0.30,
            "whites": 0, "blacks": -0.05, "temperature": 0.05, "tint": 0.05,
            "vibrance": 0.10, "saturation": 0,
            "sharpness": 0, "noiseReduction": 0.20,
            "highlightRecovery": 0, "localContrast": 0,
        },
    },
    {
        # Konzert/Buehne: harte Mischlicht-Farben, kraeftiger Look, tiefes
        # Schwarz fuer Bandhintergrund.
        "name": "Konzert",
        "adjustments": {
            "exposure": 0, "contrast": 0.40, "highlights": -0.30, "shadows": 0.05,
            "whites": 0.10, "blacks": -0.30, "temperature": -0.05, "tint": 0,
            "vibrance": 0.40, "saturation": 0.10,
            "sharpness": 0.10, "noiseReduction": 0.20,
            "highlightRecovery": 0.30, "localContrast": 0.20,
        },
    },
    {
        # Strand/Sommer: Sonne haerter, Hauttoene schuetzen, Wasser/Himmel pop.
        "name": "Strand",
        "adjustments": {
            "exposure": 0, "contrast": 0.15, "highlights": -0.30, "shadows": 0.10,
            "whites": -0.10, "blacks": -0.05, "temperature": -0.05, "tint": 0,
            "vibrance": 0.30, "saturation": 0,
            "sharpness": 0.10, "noiseReduction": 0,
            "highlightRecovery": 0.30, "localContrast": 0.10,
        },
    },
    {
        # Schnee/Winter: Weiss eindaempfen damit's nicht clipped, leicht kuehl
        # fuer Authentizitaet, Schatten oeffnen damit Details bleiben.
        "name": "Schnee",
        "adjustments": {
            "exposure": -0.15, "contrast": 0.10, "highlights": -0.20, "shadows": 0.20,
            "whites": -0.25, "blacks": 0, "temperature": -0.10, "tint": -0.05,
            "vibrance": 0.10, "saturation": 0,
            "sharpness": 0.05, "noiseReduction": 0.10,
            "highlightRecovery": 0.40, "localContrast": 0.10,
        },
    },
    {
        # Herbstfarben: Warme Saettigung, Mid-Kontrast, Klarheit fuer Laub.
        "name": "Herbst",
        "adjustments": {
            "exposure": 0, "contrast": 0.20, "highlights": -0.20, "shadows": 0.20,
            "whites": 0, "blacks": -0.05, "temperature": 0.10, "tint": 0.05,
            "vibrance": 0.40, "saturation": 0.10,
            "sharpness": 0.10, "noiseReduction": 0,
            "highlightRecovery": 0, "localContrast": 0.20,
        },
    },
    {
        # Architektur-Detail: Klarheit auf Texturen, leicht kuehl, harte Linien.
        "name": "Architektur-Detail",
        "adjustments": {
            "exposure": 0, "contrast": 0.25, "highlights": -0.15, "shadows": 0.15,
            "whites": 0.05, "blacks": -0.10, "temperature": -0.05, "tint": 0,
            "vibrance": 0, "saturation": -0.05,
            "sharpness": 0.20, "noiseReduction": 0,
            "highlightRecovery": 0, "localContrast": 0.40,
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
    except PyJWTError as exc:
        raise HTTPException(status_code=401, detail="Token-Header unlesbar.") from exc

    kid = header.get("kid")
    if not kid:
        raise HTTPException(status_code=401, detail="Token ohne kid-Header.")

    jwk = _jwk_cache.get(kid)
    # JWK-Dict in einen RSA-Public-Key fuer pyjwt umwandeln. RSAAlgorithm.
    # from_jwk akzeptiert dict oder JSON-String — wir nutzen den dict-Pfad.
    try:
        public_key = RSAAlgorithm.from_jwk(jwk)
    except (PyJWTError, ValueError) as exc:
        raise HTTPException(status_code=401, detail="JWK ungueltig.") from exc

    # Whitelist statt Header-Wert: verhindert "alg confusion" (Token mit
    # alg=HS256, das die Bibliothek mit dem RSA-Public-Key als HMAC-Secret
    # verifizieren wuerde). Keycloak signiert ausschliesslich RS256.
    try:
        return jwt.decode(
            token,
            public_key,
            algorithms=["RS256"],
            audience=settings.keycloak_audience,
            issuer=settings.keycloak_issuer,
        )
    except InvalidTokenError as exc:
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

ADMIN_ROLE = "admin"


def _has_admin_role(payload: dict[str, Any]) -> bool:
    """Keycloak-Realm-Roles liegen unter realm_access.roles. Wir akzeptieren
    auch resource_access.<audience>.roles als Fallback fuer Client-spezifische
    Rollen — beides ist im Realm-Setup ueblich."""
    realm_roles = (payload.get("realm_access") or {}).get("roles") or []
    if ADMIN_ROLE in realm_roles:
        return True
    resource_access = payload.get("resource_access") or {}
    for client in resource_access.values():
        if ADMIN_ROLE in (client.get("roles") or []):
            return True
    return False


async def _resolve_user(
    creds: HTTPAuthorizationCredentials | None,
    db: AsyncSession,
) -> tuple[User, dict[str, Any]]:
    """Token verifizieren, User JIT-provisionieren und sowohl User als auch
    den Token-Payload zurueckgeben (Letzteres fuer Role-Checks)."""
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
    user = await _get_or_create_user(db, sub=sub, email=email)
    return user, payload


async def current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    user, _ = await _resolve_user(creds, db)
    if user.is_disabled:
        # 403 statt 401: Token ist gueltig, der Account aber gesperrt.
        # Frontend soll einen klaren "Account deaktiviert"-Banner zeigen,
        # nicht zum Login schicken.
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account deaktiviert.",
        )
    return user


async def current_admin(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Nutzer-Resolve + Admin-Role-Check. Auch fuer Admins gilt der
    is_disabled-Block — ein gesperrter Admin soll nichts mehr aendern."""
    user, payload = await _resolve_user(creds, db)
    if user.is_disabled:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account deaktiviert.",
        )
    if not _has_admin_role(payload):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin-Rolle erforderlich.",
        )
    return user
