"""Keycloak-Admin-Client: Service-Account-DELETE fuer DSGVO Art. 17."""
from __future__ import annotations

from typing import Any
from unittest.mock import patch

import pytest

from app import keycloak_admin
from app.config import settings


class _FakeResponse:
    def __init__(self, status_code: int, json_data: dict | None = None, text: str = ""):
        self.status_code = status_code
        self._json = json_data or {}
        self.text = text

    def json(self) -> dict:
        return self._json


class _FakeClient:
    """Minimaler httpx.Client-Stub, der vorbereitete Antworten zurueckgibt."""

    def __init__(self, *, post: _FakeResponse, delete: _FakeResponse | None = None):
        self._post = post
        self._delete = delete or _FakeResponse(204)
        self.calls: list[tuple[str, str, dict[str, Any]]] = []

    def __enter__(self) -> "_FakeClient":
        return self

    def __exit__(self, *_args: Any) -> None:
        return None

    def post(self, url: str, **kwargs: Any) -> _FakeResponse:
        self.calls.append(("POST", url, kwargs))
        return self._post

    def delete(self, url: str, **kwargs: Any) -> _FakeResponse:
        self.calls.append(("DELETE", url, kwargs))
        return self._delete


def _configured(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "keycloak_admin_client_id", "lumen-admin", raising=False)
    monkeypatch.setattr(
        settings, "keycloak_admin_client_secret", "secret-xyz", raising=False
    )


def test_delete_user_skips_when_not_configured(monkeypatch):
    monkeypatch.setattr(settings, "keycloak_admin_client_id", "", raising=False)
    monkeypatch.setattr(settings, "keycloak_admin_client_secret", "", raising=False)

    assert keycloak_admin.delete_user("any-sub") is False


def test_delete_user_204_returns_true(monkeypatch):
    _configured(monkeypatch)
    fake = _FakeClient(
        post=_FakeResponse(200, {"access_token": "tok"}),
        delete=_FakeResponse(204),
    )
    monkeypatch.setattr(keycloak_admin.httpx, "Client", lambda **_: fake)

    assert keycloak_admin.delete_user("sub-abc") is True
    methods = [m for m, _, _ in fake.calls]
    assert methods == ["POST", "DELETE"]
    delete_url = fake.calls[1][1]
    assert delete_url.endswith("/admin/realms/lumen/users/sub-abc")


def test_delete_user_404_is_idempotent_success(monkeypatch):
    """Bei 404 ist der Account schon weg — fuer DSGVO ist das Erfolg."""
    _configured(monkeypatch)
    fake = _FakeClient(
        post=_FakeResponse(200, {"access_token": "tok"}),
        delete=_FakeResponse(404),
    )
    monkeypatch.setattr(keycloak_admin.httpx, "Client", lambda **_: fake)

    assert keycloak_admin.delete_user("ghost") is True


def test_delete_user_token_failure_returns_false(monkeypatch):
    _configured(monkeypatch)
    fake = _FakeClient(
        post=_FakeResponse(401, text="invalid_client"),
    )
    monkeypatch.setattr(keycloak_admin.httpx, "Client", lambda **_: fake)

    assert keycloak_admin.delete_user("anything") is False


def test_delete_user_admin_call_failure_returns_false(monkeypatch):
    _configured(monkeypatch)
    fake = _FakeClient(
        post=_FakeResponse(200, {"access_token": "tok"}),
        delete=_FakeResponse(403, text="forbidden"),
    )
    monkeypatch.setattr(keycloak_admin.httpx, "Client", lambda **_: fake)

    assert keycloak_admin.delete_user("locked-user") is False


def test_delete_user_network_error_returns_false(monkeypatch):
    _configured(monkeypatch)

    def boom(**_: Any):
        raise keycloak_admin.httpx.ConnectError("network down")

    monkeypatch.setattr(keycloak_admin.httpx, "Client", boom)

    assert keycloak_admin.delete_user("offline") is False


# ----- Integration mit DELETE /me -----


@pytest.mark.asyncio
async def test_delete_me_calls_keycloak_admin(client, user_a):
    """DELETE /me ruft kc_delete_user mit dem keycloak_sub auf."""
    sub = user_a["keycloak_sub"]
    with patch("app.routers.auth.kc_delete_user", return_value=True) as mock_kc:
        r = await client.delete("/api/v1/auth/me", headers=user_a["headers"])
    assert r.status_code == 204, r.text
    mock_kc.assert_called_once_with(sub)


@pytest.mark.asyncio
async def test_delete_me_succeeds_even_if_keycloak_admin_fails(client, user_a):
    """KC-Ausfall darf das App-Cleanup NICHT verhindern."""
    with patch("app.routers.auth.kc_delete_user", return_value=False):
        r = await client.delete("/api/v1/auth/me", headers=user_a["headers"])
    assert r.status_code == 204, r.text
