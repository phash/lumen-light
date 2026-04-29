"""Schmaler Keycloak-Admin-Client fuer DSGVO Art. 17.

Produktiv-Setup: ein Service-Account-Client im lumen-Realm mit
`manage-users`-Role. Auth via client_credentials grant (kein
User-Token noetig) → Admin-API-Call DELETE /admin/realms/<realm>/users/<sub>.

Best-effort: Fehler werden geloggt, fuehren aber NICHT zu einem 500
beim DELETE /me. Andernfalls bliebe der App-Datensatz fuer immer
stehen, nur weil KC gerade unerreichbar ist. Vor Public-Launch
sollte aber ein Alerting auf den Logger hier sitzen, damit Reste
nicht stillschweigend angesammelt werden.
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


def _is_configured() -> bool:
    return bool(
        settings.keycloak_admin_client_id
        and settings.keycloak_admin_client_secret
    )


def _admin_base() -> str:
    """Server-Root-URL, abgeleitet aus dem Issuer.

    `keycloak_issuer` zeigt auf `<server>/realms/<realm>`. Fuer Admin-Calls
    brauchen wir den Server-Root, deswegen schneiden wir das `/realms/...`
    ab.
    """
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
    data = r.json()
    token = data.get("access_token")
    if not token:
        raise KeycloakAdminError("Token-Response ohne access_token.")
    return token


def delete_user(keycloak_sub: str) -> bool:
    """Loescht den User in Keycloak. Gibt True bei Erfolg zurueck.

    Bei nicht-konfiguriertem Service-Account (Dev) wird False zurueck-
    gegeben und ein DEBUG-Log gemacht — DELETE /me funktioniert weiter,
    der KC-Account bleibt nur stehen. Fehler beim Admin-Call landen als
    WARNING im Log und liefern False; der Caller darf den /me-DELETE
    trotzdem als Erfolg behandeln (best effort).
    """
    if not _is_configured():
        logger.debug(
            "keycloak_admin: not configured (KEYCLOAK_ADMIN_CLIENT_ID/SECRET fehlen)"
        )
        return False
    try:
        token = _fetch_admin_token()
        base = _admin_base()
        realm = _realm_name()
        url = urljoin(base + "/", f"admin/realms/{realm}/users/{keycloak_sub}")
        with httpx.Client(timeout=_DELETE_TIMEOUT) as c:
            r = c.delete(url, headers={"Authorization": f"Bearer {token}"})
        # 204 = geloescht, 404 = schon weg → in beiden Faellen Erfolg.
        if r.status_code in (204, 404):
            return True
        logger.warning(
            "keycloak_admin.delete_user(%s): %s %s",
            keycloak_sub,
            r.status_code,
            r.text[:200],
        )
        return False
    except (httpx.HTTPError, KeycloakAdminError) as exc:
        logger.warning("keycloak_admin.delete_user(%s) Fehler: %s", keycloak_sub, exc)
        return False
