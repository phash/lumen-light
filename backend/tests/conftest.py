"""Pytest-Fixtures fuer Backend-Tests.

Strategie:
- Pro Pytest-Session ein Postgres-16-Container (testcontainers).
- Pro Pytest-Session ein Keycloak-26-Container mit Realm-Import (siehe ADR-010).
- Alembic-Migration einmal pro Session.
- Pro Test eine eigene AsyncEngine und AsyncSession in aeusserer Transaktion
  mit SAVEPOINT-Rollback.
- User werden pro Test in Keycloak angelegt, Token via Direct-Grant geholt,
  am Test-Ende geloescht.

Function-scope fuer Engine vermeidet asyncio-Loop-Konflikte zwischen
session-scoped async-Fixtures und function-scoped async-Tests.
"""
from __future__ import annotations

import os
import secrets
import time
from collections.abc import AsyncIterator, Iterator
from pathlib import Path
from urllib.error import URLError
from urllib.request import urlopen

# Rate-Limiter abschalten BEVOR app-Module geladen werden — limiter.enabled
# wird zur Import-Zeit aus der Env gelesen (siehe app/rate_limit.py).
os.environ.setdefault("LUMEN_RATELIMIT_DISABLED", "1")

import pytest
from keycloak import KeycloakAdmin, KeycloakOpenID
from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, create_async_engine
from testcontainers.core.waiting_utils import wait_for_logs
from testcontainers.keycloak import KeycloakContainer
from testcontainers.minio import MinioContainer
from testcontainers.postgres import PostgresContainer


class LumenKeycloakContainer(KeycloakContainer):
    """KeycloakContainer mit Readiness-Probe, die fuer Keycloak 26 funktioniert.

    Der Default-Probe in testcontainers 4.8 wartet auf den Log-Eintrag
    'Added user .* to realm .*', der in Keycloak 26 nicht mehr ausgegeben
    wird (siehe KC-SERVICES0077 — 'Created temporary admin user with
    username .*'). Wir warten stattdessen auf einen 200 vom /health/ready-
    Management-Endpoint plus den Realm-Import-Log.
    """

    def _readiness_probe(self) -> None:  # type: ignore[override]
        deadline = time.monotonic() + 90.0
        while time.monotonic() < deadline:
            try:
                with urlopen(
                    f"{self.get_management_url()}/health/ready", timeout=2
                ) as r:
                    if r.status == 200:
                        break
            except (URLError, ConnectionError, OSError):
                time.sleep(1)
        else:
            raise RuntimeError("Keycloak never reached /health/ready")
        if self.has_realm_imports:
            wait_for_logs(self, "Realm '.*' imported", timeout=30)

REALM_FILE = (
    Path(__file__).resolve().parents[2] / "infra" / "keycloak" / "lumen-realm.json"
)
REALM_NAME = "lumen"
FRONTEND_CLIENT_ID = "lumen-frontend"
KEYCLOAK_ADMIN_USER = "admin"
KEYCLOAK_ADMIN_PASS = "admin"  # Test-only, KeycloakContainer-Default


# --- Postgres ----------------------------------------------------------------

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


# --- Keycloak ----------------------------------------------------------------

@pytest.fixture(scope="session")
def keycloak_container() -> Iterator[LumenKeycloakContainer]:
    """Keycloak 26 mit Realm-Import. Admin-Credentials explizit setzen,
    sonst legt Keycloak 26 in dev-mode einen Random-Admin an und unsere
    Admin-Client-Verbindung schlaegt fehl."""
    container = (
        LumenKeycloakContainer(
            "quay.io/keycloak/keycloak:26.0",
            username=KEYCLOAK_ADMIN_USER,
            password=KEYCLOAK_ADMIN_PASS,
        )
        .with_env("KC_BOOTSTRAP_ADMIN_USERNAME", KEYCLOAK_ADMIN_USER)
        .with_env("KC_BOOTSTRAP_ADMIN_PASSWORD", KEYCLOAK_ADMIN_PASS)
        .with_realm_import_file(str(REALM_FILE))
    )
    with container as c:
        yield c


@pytest.fixture(scope="session")
def keycloak_url(keycloak_container: LumenKeycloakContainer) -> str:
    """Externe URL des Keycloak-Containers."""
    return keycloak_container.get_url().rstrip("/")


@pytest.fixture(scope="session")
def keycloak_issuer(keycloak_url: str) -> str:
    return f"{keycloak_url}/realms/{REALM_NAME}"


@pytest.fixture(scope="session")
def keycloak_admin(keycloak_url: str) -> KeycloakAdmin:
    """Admin-Client gegen den lumen-Realm (auth ueber master-Realm)."""
    admin = KeycloakAdmin(
        server_url=keycloak_url,
        username=KEYCLOAK_ADMIN_USER,
        password=KEYCLOAK_ADMIN_PASS,
        realm_name=REALM_NAME,
        user_realm_name="master",
        verify=True,
    )
    return admin


@pytest.fixture(scope="session")
def keycloak_oid(keycloak_url: str) -> KeycloakOpenID:
    """OIDC-Client fuer Token-Issuance (Direct-Grant in Tests)."""
    return KeycloakOpenID(
        server_url=keycloak_url,
        realm_name=REALM_NAME,
        client_id=FRONTEND_CLIENT_ID,
        verify=True,
    )


# --- Settings-Override -------------------------------------------------------

@pytest.fixture(scope="session")
def minio_container() -> Iterator[MinioContainer]:
    """MinIO als S3-API-kompatible Test-Storage. Production wird Garage,
    aber das S3-Protokoll ist standardisiert."""
    container = MinioContainer()
    with container as c:
        yield c


@pytest.fixture(scope="session")
def minio_endpoint(minio_container: MinioContainer) -> str:
    host_ip = minio_container.get_container_host_ip()
    port = minio_container.get_exposed_port(9000)
    return f"http://{host_ip}:{port}"


@pytest.fixture(scope="session", autouse=True)
def _set_settings(
    database_url: str,
    keycloak_issuer: str,
    minio_container: MinioContainer,
    minio_endpoint: str,
) -> Iterator[None]:
    """app.config.settings auf Test-Container umlenken, bevor app.* importiert wird."""
    from app import config
    from app import storage as storage_module

    original = (
        config.settings.database_url,
        config.settings.keycloak_issuer,
        config.settings.garage_s3_endpoint,
        config.settings.garage_s3_access_key_id,
        config.settings.garage_s3_secret_access_key,
        config.settings.garage_s3_bucket,
    )
    config.settings.database_url = database_url
    config.settings.keycloak_issuer = keycloak_issuer
    config.settings.garage_s3_endpoint = minio_endpoint
    config.settings.garage_s3_access_key_id = minio_container.access_key
    config.settings.garage_s3_secret_access_key = minio_container.secret_key
    config.settings.garage_s3_bucket = "lumen-test-images"
    storage_module.reset_storage_singleton()
    # Bucket einmal anlegen
    storage_module.get_storage().ensure_bucket()

    yield

    (
        config.settings.database_url,
        config.settings.keycloak_issuer,
        config.settings.garage_s3_endpoint,
        config.settings.garage_s3_access_key_id,
        config.settings.garage_s3_secret_access_key,
        config.settings.garage_s3_bucket,
    ) = original
    storage_module.reset_storage_singleton()


@pytest.fixture(autouse=True)
def _reset_jwk_cache() -> None:
    """JWK-Cache zwischen Tests resetten — schuetzt vor Cross-Test-Cache-Leaks
    in Watch-Mode oder bei nachtraeglicher Settings-Aenderung."""
    from app import auth

    auth._jwk_cache.reset()


# --- Migration ---------------------------------------------------------------

@pytest.fixture(scope="session")
def _migrated_db(database_url: str, _set_settings: None) -> None:
    """Alembic-Migration einmal pro Session ausfuehren (synchron)."""
    from alembic import command
    from alembic.config import Config

    cfg = Config("alembic.ini")
    cfg.set_main_option("sqlalchemy.url", database_url)
    command.upgrade(cfg, "head")


# --- DB-Session --------------------------------------------------------------

@pytest.fixture
async def engine(
    database_url: str, _migrated_db: None
) -> AsyncIterator[AsyncEngine]:
    eng = create_async_engine(database_url, future=True, pool_pre_ping=True)
    yield eng
    await eng.dispose()


@pytest.fixture
async def db_session(engine: AsyncEngine) -> AsyncIterator[AsyncSession]:
    """Pro Test eine aeussere Transaktion mit SAVEPOINT-Rollback."""
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


# --- HTTP-Client + Test-User -------------------------------------------------

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


@pytest.fixture
def make_keycloak_user(keycloak_admin: KeycloakAdmin, keycloak_oid: KeycloakOpenID):
    """Fabrik: legt einen User im lumen-Realm an, holt einen Token via
    Direct-Grant und liefert ein Test-User-Dict im selben Shape wie zuvor.
    Cleanup nach dem Test."""
    created_ids: list[str] = []

    def _factory(email: str, password: str = VALID_PW) -> dict:
        user_id = keycloak_admin.create_user(
            {
                "username": email,
                "email": email,
                "enabled": True,
                "emailVerified": True,
                "firstName": "Test",
                "lastName": "User",
                "requiredActions": [],
                "credentials": [
                    {"type": "password", "value": password, "temporary": False}
                ],
            },
            exist_ok=False,
        )
        created_ids.append(user_id)
        token_response = keycloak_oid.token(username=email, password=password)
        access = token_response["access_token"]
        refresh = token_response["refresh_token"]
        return {
            "keycloak_sub": user_id,
            "email": email,
            "tokens": {"access_token": access, "refresh_token": refresh},
            "headers": {"Authorization": f"Bearer {access}"},
        }

    yield _factory

    for user_id in created_ids:
        try:
            keycloak_admin.delete_user(user_id)
        except Exception:
            # Bestes Bemuehen — Container ist nach Session sowieso weg.
            pass


@pytest.fixture
async def user_a(make_keycloak_user, client) -> dict:
    """Erster Test-User. Backend-User wird beim ersten /auth/me-Call JIT
    angelegt — wir machen das hier proaktiv, damit Tests den User-Row als
    gegeben annehmen koennen."""
    info = make_keycloak_user(f"alice-{secrets.token_hex(4)}@example.com")
    r = await client.get("/api/v1/auth/me", headers=info["headers"])
    assert r.status_code == 200, r.text
    info["user"] = r.json()
    return info


@pytest.fixture
async def user_b(make_keycloak_user, client) -> dict:
    info = make_keycloak_user(f"bob-{secrets.token_hex(4)}@example.com")
    r = await client.get("/api/v1/auth/me", headers=info["headers"])
    assert r.status_code == 200, r.text
    info["user"] = r.json()
    return info


@pytest.fixture
async def user_c(make_keycloak_user, client) -> dict:
    """Dritter Test-User — nuetzlich fuer Marketplace-Auto-Hide-Test (3 Reports)."""
    info = make_keycloak_user(f"clara-{secrets.token_hex(4)}@example.com")
    r = await client.get("/api/v1/auth/me", headers=info["headers"])
    assert r.status_code == 200, r.text
    info["user"] = r.json()
    return info


# --- Admin-User (mit Realm-Role 'admin' im JWT) ------------------------------


@pytest.fixture
def assign_admin_role(
    keycloak_admin: KeycloakAdmin, keycloak_oid: KeycloakOpenID
):
    """Hilfs-Funktion: assigned dem User die `admin`-Realm-Role und gibt
    einen frischen Token zurueck. Wir holen einen NEUEN Token nach der
    Role-Assignment, weil bestehende Tokens die alte Rolle-Liste behalten."""

    def _assign(info: dict, password: str = VALID_PW) -> dict:
        sub = info["keycloak_sub"]
        admin_role = keycloak_admin.get_realm_role("admin")
        keycloak_admin.assign_realm_roles(user_id=sub, roles=[admin_role])
        # Frischer Token mit Roles-Claim
        token_response = keycloak_oid.token(
            username=info["email"], password=password
        )
        info["tokens"] = {
            "access_token": token_response["access_token"],
            "refresh_token": token_response["refresh_token"],
        }
        info["headers"] = {
            "Authorization": f"Bearer {token_response['access_token']}"
        }
        return info

    return _assign


@pytest.fixture
async def admin_user(make_keycloak_user, assign_admin_role, client) -> dict:
    """User mit `admin`-Realm-Role. Wird in den Admin-Tests gebraucht."""
    info = make_keycloak_user(f"admin-{secrets.token_hex(4)}@example.com")
    info = assign_admin_role(info)
    r = await client.get("/api/v1/auth/me", headers=info["headers"])
    assert r.status_code == 200, r.text
    info["user"] = r.json()
    return info
