"""Pytest-Fixtures fuer Backend-Tests.

Strategie:
- Pro Pytest-Session ein Postgres-16-Container (testcontainers).
- Alembic-Migration einmal pro Session, synchron (kein Loop-Konflikt).
- Pro Test eine eigene AsyncEngine, AsyncSession in aeusserer Transaktion mit
  SAVEPOINT-Rollback fuer schnelle, deterministische Isolation.

Function-scope fuer Engine vermeidet asyncio-Loop-Konflikte zwischen
session-scoped async-Fixtures und function-scoped async-Tests.
"""
from __future__ import annotations

from collections.abc import AsyncIterator, Iterator

import pytest
from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, create_async_engine
from testcontainers.postgres import PostgresContainer


@pytest.fixture(scope="session")
def pg_container() -> Iterator[PostgresContainer]:
    """Postgres 16 als Test-DB. Bleibt fuer die ganze Session laufen."""
    with PostgresContainer("postgres:16-alpine") as container:
        yield container


@pytest.fixture(scope="session")
def database_url(pg_container: PostgresContainer) -> str:
    """asyncpg-URL fuer die Test-DB (Treiber explizit ueberschreiben)."""
    raw = pg_container.get_connection_url()
    if "+psycopg2" in raw:
        return raw.replace("postgresql+psycopg2://", "postgresql+asyncpg://")
    if raw.startswith("postgresql://"):
        return raw.replace("postgresql://", "postgresql+asyncpg://", 1)
    return raw


@pytest.fixture(scope="session", autouse=True)
def _set_settings_url(database_url: str) -> Iterator[None]:
    """app.config.settings.database_url auf die Container-URL umlenken,
    bevor irgendetwas anderes app.* importiert."""
    from app import config

    original = config.settings.database_url
    config.settings.database_url = database_url
    yield
    config.settings.database_url = original


@pytest.fixture(scope="session")
def _migrated_db(database_url: str, _set_settings_url: None) -> None:
    """Alembic-Migration einmal pro Session ausfuehren (synchron)."""
    from alembic import command
    from alembic.config import Config

    cfg = Config("alembic.ini")
    cfg.set_main_option("sqlalchemy.url", database_url)
    command.upgrade(cfg, "head")


@pytest.fixture
async def engine(
    database_url: str, _migrated_db: None
) -> AsyncIterator[AsyncEngine]:
    """Eigene Engine pro Test — function-scope, damit Loop-Bindung passt."""
    eng = create_async_engine(database_url, future=True, pool_pre_ping=True)
    yield eng
    await eng.dispose()


@pytest.fixture
async def db_session(engine: AsyncEngine) -> AsyncIterator[AsyncSession]:
    """Pro Test eine aeussere Transaktion mit SAVEPOINT.

    Endpoint-Code darf intern committen — wir fangen das mit nested
    transactions ab und rollen am Testende alles zurueck. Pattern:
    SQLAlchemy 'join external transaction'.
    """
    async with engine.connect() as connection:
        outer = await connection.begin()
        session = AsyncSession(bind=connection, expire_on_commit=False)
        await connection.begin_nested()

        @event.listens_for(session.sync_session, "after_transaction_end")
        def _restart_savepoint(sess, trans):
            if trans.nested and not trans._parent.nested:
                connection.sync_connection.begin_nested()

        try:
            yield session
        finally:
            await session.close()
            await outer.rollback()


@pytest.fixture
async def client(db_session: AsyncSession):
    """httpx.AsyncClient gegen die FastAPI-App, mit get_db -> Test-Session."""
    from httpx import ASGITransport, AsyncClient
    from app.database import get_db
    from app.main import app

    async def _override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = _override_get_db
    try:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as c:
            yield c
    finally:
        app.dependency_overrides.pop(get_db, None)


VALID_PW = "supersicheresPasswort1"


async def _register_and_login(client, email: str, password: str = VALID_PW) -> dict:
    """User anlegen und einloggen, Tokens und Header zurueckgeben."""
    r = await client.post(
        "/api/v1/auth/register", json={"email": email, "password": password}
    )
    assert r.status_code == 201, r.text
    user = r.json()

    r = await client.post(
        "/api/v1/auth/login", json={"email": email, "password": password}
    )
    assert r.status_code == 200, r.text
    tokens = r.json()
    return {
        "user": user,
        "tokens": tokens,
        "headers": {"Authorization": f"Bearer {tokens['access_token']}"},
    }


@pytest.fixture
async def user_a(client) -> dict:
    return await _register_and_login(client, "alice@example.com")


@pytest.fixture
async def user_b(client) -> dict:
    return await _register_and_login(client, "bob@example.com")
