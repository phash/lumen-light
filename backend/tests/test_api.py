"""Beispiel-Tests für die Auth- und Presets-Endpoints.

Ausführen mit:
    pip install pytest pytest-asyncio httpx
    pytest

Diese Tests setzen voraus, dass DATABASE_URL auf eine Test-DB zeigt.
In CI: separate Postgres-Instanz hochfahren oder testcontainers nutzen.
"""
import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app


@pytest.mark.asyncio
async def test_health() -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.get("/api/v1/health")
        assert r.status_code == 200
        assert r.json() == {"status": "ok"}


@pytest.mark.asyncio
async def test_register_login_flow() -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # Register
        r = await client.post(
            "/api/v1/auth/register",
            json={"email": "test@example.com", "password": "supersicheresPasswort1"},
        )
        assert r.status_code == 201
        user = r.json()
        assert user["email"] == "test@example.com"

        # Login
        r = await client.post(
            "/api/v1/auth/login",
            json={"email": "test@example.com", "password": "supersicheresPasswort1"},
        )
        assert r.status_code == 200
        tokens = r.json()
        access = tokens["access_token"]

        # /me mit Token
        r = await client.get(
            "/api/v1/auth/me",
            headers={"Authorization": f"Bearer {access}"},
        )
        assert r.status_code == 200
        assert r.json()["email"] == "test@example.com"

        # Default-Presets vorhanden?
        r = await client.get(
            "/api/v1/presets",
            headers={"Authorization": f"Bearer {access}"},
        )
        assert r.status_code == 200
        names = [p["name"] for p in r.json()]
        assert "Neutral" in names
        assert "Punchy" in names


@pytest.mark.asyncio
async def test_preset_crud() -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # User anlegen + einloggen (vereinfacht)
        await client.post(
            "/api/v1/auth/register",
            json={"email": "crud@example.com", "password": "supersicheresPasswort1"},
        )
        login = await client.post(
            "/api/v1/auth/login",
            json={"email": "crud@example.com", "password": "supersicheresPasswort1"},
        )
        token = login.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        # Erstellen
        adj = {k: 0.0 for k in [
            "exposure", "contrast", "highlights", "shadows", "whites",
            "blacks", "temperature", "tint", "vibrance", "saturation",
        ]}
        adj["contrast"] = 0.4
        r = await client.post(
            "/api/v1/presets",
            headers=headers,
            json={"name": "Mein Preset", "adjustments": adj},
        )
        assert r.status_code == 201
        preset_id = r.json()["id"]

        # Doppelter Name → 409
        r = await client.post(
            "/api/v1/presets",
            headers=headers,
            json={"name": "Mein Preset", "adjustments": adj},
        )
        assert r.status_code == 409

        # Update
        adj["contrast"] = 0.5
        r = await client.put(
            f"/api/v1/presets/{preset_id}",
            headers=headers,
            json={"name": "Mein Preset v2", "adjustments": adj},
        )
        assert r.status_code == 200
        assert r.json()["name"] == "Mein Preset v2"

        # Delete
        r = await client.delete(f"/api/v1/presets/{preset_id}", headers=headers)
        assert r.status_code == 204
