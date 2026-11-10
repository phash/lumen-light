"""Review 2026-11 r2 (M2): Keycloak-Account-Loeschung aus DELETE /me ist
nicht mehr fire-and-forget — ausstehende Loeschungen liegen in
keycloak_deletions und werden vom Janitor mit Backoff wiederholt."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app import janitor, keycloak_admin
from app.config import settings
from app.models import KeycloakDeletion
from tests.test_keycloak_admin import _configured, _FakeClient, _FakeResponse


async def _row(db_session, sub: str) -> KeycloakDeletion | None:
    db_session.expire_all()
    return (
        await db_session.execute(
            select(KeycloakDeletion).where(KeycloakDeletion.keycloak_sub == sub)
        )
    ).scalar_one_or_none()


# ---------- keycloak_admin ----------


class _BadJsonResponse(_FakeResponse):
    def json(self) -> dict:
        raise ValueError("kein JSON")


def test_token_antwort_ohne_json_liefert_fehler_statt_exception(monkeypatch):
    _configured(monkeypatch)
    fake = _FakeClient(post=_BadJsonResponse(200, text="<html>"))
    monkeypatch.setattr(keycloak_admin.httpx, "Client", lambda **_: fake)
    assert keycloak_admin.delete_user("sub-x") is False
    err = keycloak_admin.attempt_delete_user("sub-x")
    assert err is not None and "JSON" in err


def test_token_antwort_als_liste_liefert_fehler(monkeypatch):
    _configured(monkeypatch)

    class _ListResponse(_FakeResponse):
        def json(self):  # type: ignore[override]
            return ["kein", "dict"]

    fake = _FakeClient(post=_ListResponse(200))
    monkeypatch.setattr(keycloak_admin.httpx, "Client", lambda **_: fake)
    assert keycloak_admin.delete_user("sub-y") is False


def test_attempt_delete_204_ist_erfolg(monkeypatch):
    _configured(monkeypatch)
    fake = _FakeClient(post=_FakeResponse(200, {"access_token": "t"}), delete=_FakeResponse(204))
    monkeypatch.setattr(keycloak_admin.httpx, "Client", lambda **_: fake)
    assert keycloak_admin.attempt_delete_user("sub-z") is None


# ---------- DELETE /me ----------


async def test_delete_me_merkt_kc_loeschung_vor_wenn_nicht_konfiguriert(
    client, user_a, db_session, monkeypatch
):
    monkeypatch.setattr(settings, "keycloak_admin_client_id", "")
    r = await client.delete("/api/v1/auth/me", headers=user_a["headers"])
    assert r.status_code == 204
    row = await _row(db_session, user_a["keycloak_sub"])
    assert row is not None
    assert row.attempts == 0


async def test_delete_me_erfolgreiche_kc_loeschung_entfernt_vormerkung(
    client, user_a, db_session, monkeypatch
):
    from app.routers import auth as auth_router

    calls: list[str] = []
    monkeypatch.setattr(keycloak_admin, "is_configured", lambda: True)
    monkeypatch.setattr(
        auth_router, "kc_attempt_delete", lambda sub: calls.append(sub) or None
    )
    r = await client.delete("/api/v1/auth/me", headers=user_a["headers"])
    assert r.status_code == 204
    assert calls == [user_a["keycloak_sub"]]
    assert await _row(db_session, user_a["keycloak_sub"]) is None


async def test_delete_me_kc_fehler_bleibt_vorgemerkt_und_liefert_204(
    client, user_a, db_session, monkeypatch
):
    from app.routers import auth as auth_router

    monkeypatch.setattr(keycloak_admin, "is_configured", lambda: True)
    monkeypatch.setattr(auth_router, "kc_attempt_delete", lambda _sub: "503 down")
    r = await client.delete("/api/v1/auth/me", headers=user_a["headers"])
    assert r.status_code == 204
    row = await _row(db_session, user_a["keycloak_sub"])
    assert row is not None
    assert row.attempts == 1
    assert row.last_error == "503 down"
    assert row.next_attempt_at > datetime.now(timezone.utc)


async def test_delete_me_kc_exception_liefert_trotzdem_204(
    client, user_a, db_session, monkeypatch
):
    from app.routers import auth as auth_router

    def _boom(_sub: str) -> str | None:
        raise ValueError("unerwartet")

    monkeypatch.setattr(keycloak_admin, "is_configured", lambda: True)
    monkeypatch.setattr(auth_router, "kc_attempt_delete", _boom)
    r = await client.delete("/api/v1/auth/me", headers=user_a["headers"])
    assert r.status_code == 204
    assert await _row(db_session, user_a["keycloak_sub"]) is not None


# ---------- Janitor ----------


async def _seed(db_session, sub: str, *, attempts: int = 0, due: bool = True) -> None:
    now = datetime.now(timezone.utc)
    db_session.add(
        KeycloakDeletion(
            keycloak_sub=sub,
            attempts=attempts,
            next_attempt_at=now - timedelta(minutes=1) if due else now + timedelta(hours=1),
        )
    )
    await db_session.commit()


async def test_janitor_loescht_vormerkung_bei_erfolg(db_session, monkeypatch):
    monkeypatch.setattr(keycloak_admin, "is_configured", lambda: True)
    await _seed(db_session, "kc-ok")
    calls: list[str] = []
    r = await janitor.retry_keycloak_deletions(
        db_session, attempt=lambda sub: calls.append(sub) or None
    )
    assert "kc-ok" in calls
    assert r.deleted >= 1
    assert await _row(db_session, "kc-ok") is None


async def test_janitor_fehler_erhoeht_attempts_mit_backoff(db_session, monkeypatch):
    monkeypatch.setattr(keycloak_admin, "is_configured", lambda: True)
    await _seed(db_session, "kc-fail", attempts=3)
    before = datetime.now(timezone.utc)
    r = await janitor.retry_keycloak_deletions(db_session, attempt=lambda _s: "timeout")
    assert r.errors >= 1
    row = await _row(db_session, "kc-fail")
    assert row is not None
    assert row.attempts == 4
    assert row.last_error == "timeout"
    # Exponentieller Backoff: 4. Fehlversuch -> 2^3 = 8 Minuten.
    assert row.next_attempt_at >= before + timedelta(minutes=8)
    assert row.next_attempt_at < before + timedelta(minutes=9)


async def test_janitor_ueberspringt_nicht_faellige_und_aufgegebene(db_session, monkeypatch):
    monkeypatch.setattr(keycloak_admin, "is_configured", lambda: True)
    await _seed(db_session, "kc-spaeter", due=False)
    await _seed(db_session, "kc-aufgegeben", attempts=janitor.KEYCLOAK_DELETE_MAX_ATTEMPTS)
    calls: list[str] = []
    r = await janitor.retry_keycloak_deletions(
        db_session, attempt=lambda sub: calls.append(sub) or None
    )
    assert "kc-spaeter" not in calls
    assert "kc-aufgegeben" not in calls
    assert r.given_up >= 1
    assert await _row(db_session, "kc-spaeter") is not None


async def test_janitor_ohne_konfiguration_laesst_vormerkungen_stehen(db_session, monkeypatch):
    monkeypatch.setattr(keycloak_admin, "is_configured", lambda: False)
    await _seed(db_session, "kc-unkonfiguriert")

    def _never(_sub: str) -> str | None:
        raise AssertionError("darf nicht aufgerufen werden")

    r = await janitor.retry_keycloak_deletions(db_session, attempt=_never)
    assert r.configured is False
    assert await _row(db_session, "kc-unkonfiguriert") is not None


def test_backoff_ist_gedeckelt():
    assert janitor.keycloak_retry_delay(1) == timedelta(minutes=1)
    assert janitor.keycloak_retry_delay(2) == timedelta(minutes=2)
    assert janitor.keycloak_retry_delay(40) == timedelta(hours=24)


@pytest.mark.parametrize("attempts", [0, 1])
def test_backoff_mindestens_eine_minute(attempts: int):
    assert janitor.keycloak_retry_delay(attempts) >= timedelta(minutes=1)
