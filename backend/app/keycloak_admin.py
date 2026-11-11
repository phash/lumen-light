"""Schmaler Keycloak-Admin-Client fuer DSGVO Art. 17.

Produktiv-Setup: ein Service-Account-Client im lumen-Realm mit
`manage-users`-Role. Auth via client_credentials grant (kein
User-Token noetig) → Admin-API-Call DELETE /admin/realms/<realm>/users/<sub>.

Fehler fuehren NICHT zu einem 500 beim DELETE /me (der App-Datensatz ist
dann bereits committet). Statt fire-and-forget merkt DELETE /me die
Loeschung in keycloak_deletions vor (Migration 012); der Janitor
wiederholt fehlgeschlagene Versuche mit Backoff (app/janitor.py).
"""
from __future__ import annotations

import logging
from typing import Final
from urllib.parse import urljoin

import httpx

from app.config import settings


logger = logging.getLogger(__name__)


_TOKEN_TIMEOUT: Final = 5.0
_DELETE_TIMEOUT: Final = 10.0


class KeycloakAdminError(RuntimeError):
    """Wird vom Caller in einen 5xx-Hinweis oder ins Log gewandelt."""


def is_configured() -> bool:
    return bool(
        settings.keycloak_admin_client_id
        and settings.keycloak_admin_client_secret
    )


def _admin_base() -> str:
    """Server-Root-URL fuer Backend->Keycloak-Calls.

    Mit KEYCLOAK_INTERNAL_URL (z.B. http://lumen-keycloak:8080/auth) laufen
    Token-, Admin- und JWKS-Calls intern im Container-Netz — der oeffentliche
    /auth/admin-Pfad kann dann am Proxy gesperrt werden. Sonst wird der Root
    aus dem Issuer (`<server>/realms/<realm>`) abgeleitet.
    """
    internal = settings.keycloak_internal_url.strip().rstrip("/")
    if internal:
        return internal
    issuer = settings.keycloak_issuer.rstrip("/")
    marker = "/realms/"
    idx = issuer.rfind(marker)
    if idx == -1:
        # Defensive — Issuer-Pfad ist konventionell, aber nicht erzwungen.
        return issuer
    return issuer[:idx]


def _realm_name() -> str:
    issuer = settings.keycloak_issuer.rstrip("/")
    marker = "/realms/"
    idx = issuer.rfind(marker)
    if idx == -1:
        return ""
    return issuer[idx + len(marker):]


def realm_base_url() -> str:
    """<server-root>/realms/<realm> — intern, falls KEYCLOAK_INTERNAL_URL
    gesetzt ist, sonst identisch mit dem Issuer."""
    if not settings.keycloak_internal_url.strip():
        return settings.keycloak_issuer.rstrip("/")
    return f"{_admin_base()}/realms/{_realm_name()}"


def _fetch_admin_token() -> str:
    base = _admin_base()
    realm = _realm_name()
    token_url = urljoin(
        base + "/", f"realms/{realm}/protocol/openid-connect/token"
    )
    with httpx.Client(timeout=_TOKEN_TIMEOUT) as c:
        r = c.post(
            token_url,
            data={
                "grant_type": "client_credentials",
                "client_id": settings.keycloak_admin_client_id,
                "client_secret": settings.keycloak_admin_client_secret,
            },
        )
    if r.status_code != 200:
        raise KeycloakAdminError(
            f"Service-Account-Token fehlgeschlagen: {r.status_code} {r.text[:200]}"
        )
    try:
        data = r.json()
    except ValueError as exc:
        raise KeycloakAdminError("Token-Response ist kein JSON.") from exc
    token = data.get("access_token") if isinstance(data, dict) else None
    if not isinstance(token, str) or not token:
        raise KeycloakAdminError("Token-Response ohne access_token.")
    return token


def attempt_delete_user(keycloak_sub: str) -> str | None:
    """Ein Loeschversuch. None bei Erfolg (204 oder 404 = schon weg), sonst
    ein kurzer Fehlertext (fuer keycloak_deletions.last_error). Wirft nie —
    der Caller hat seinen DB-Commit dann schon hinter sich. Vorbedingung:
    is_configured()."""
    try:
        token = _fetch_admin_token()
        base = _admin_base()
        realm = _realm_name()
        url = urljoin(base + "/", f"admin/realms/{realm}/users/{keycloak_sub}")
        with httpx.Client(timeout=_DELETE_TIMEOUT) as c:
            r = c.delete(url, headers={"Authorization": f"Bearer {token}"})
        if r.status_code in (204, 404):
            return None
        logger.warning(
            "keycloak_admin.delete_user(%s): %s %s",
            keycloak_sub,
            r.status_code,
            r.text[:200],
        )
        return f"HTTP {r.status_code}: {r.text[:200]}"
    except (httpx.HTTPError, KeycloakAdminError, ValueError, TypeError) as exc:
        logger.warning("keycloak_admin.delete_user(%s) Fehler: %s", keycloak_sub, exc)
        return f"{type(exc).__name__}: {exc}"[:500]


def delete_user(keycloak_sub: str) -> bool:
    """Loescht den User in Keycloak. Gibt True bei Erfolg zurueck.

    Bei nicht-konfiguriertem Service-Account (Dev) wird False zurueck-
    gegeben und ein DEBUG-Log gemacht. Fehler beim Admin-Call landen als
    WARNING im Log und liefern False (siehe attempt_delete_user).
    """
    if not is_configured():
        logger.debug(
            "keycloak_admin: not configured (KEYCLOAK_ADMIN_CLIENT_ID/SECRET fehlen)"
        )
        return False
    return attempt_delete_user(keycloak_sub) is None
