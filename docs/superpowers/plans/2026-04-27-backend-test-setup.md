# Backend Test-Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Backend-Tests laufen reproduzierbar gegen eine echte Postgres-Test-DB (via testcontainers); die Suite umfasst Tenant-Isolation, Refresh-Rotation und alle 4xx-Pfade.

**Architecture:** `testcontainers-python` startet pro Pytest-Session genau einen Postgres-16-Container; Alembic migriert das Schema einmal; pro Test wird eine äußere Transaktion mit SAVEPOINT geöffnet und am Ende zurückgerollt — schnelle, deterministische Isolation. `httpx.AsyncClient` mit `dependency_overrides` bindet Endpoint-Code und Test-Session in dieselbe Transaktion.

**Tech Stack:** pytest 8 + pytest-asyncio (auto-mode) + httpx + testcontainers[postgres] + SQLAlchemy 2 async + Alembic.

---

## Files

**Create:**
- `backend/requirements-dev.txt` — Test-/Dev-Dependencies, separat vom Production-Image
- `backend/pyproject.toml` — Pytest-Konfiguration (asyncio_mode = "auto")
- `backend/tests/conftest.py` — alle Test-Fixtures
- `backend/tests/test_health.py` — Health-Endpoint-Test (bestehender wird umgezogen)
- `backend/tests/test_auth_register.py` — Register-Tests
- `backend/tests/test_auth_login.py` — Login-Tests
- `backend/tests/test_auth_me.py` — /me-Tests
- `backend/tests/test_auth_refresh.py` — Refresh-Tests inkl. Rotation
- `backend/tests/test_auth_logout.py` — Logout-Tests
- `backend/tests/test_presets_crud.py` — Presets-CRUD-Tests
- `backend/tests/test_tenant_isolation.py` — User-A-vs-User-B-Tests
- `backend/tests/test_schema_sync.py` — JSON-Schema ↔ Pydantic-Sync

**Delete (nach Migration):**
- `backend/tests/test_api.py` — Inhalt verteilt sich auf die neuen Dateien

**Modify:**
- möglicherweise `backend/app/routers/auth.py` (nur falls Tests Bugs aufdecken)
- `README.md` — kurzer Test-How-to

---

## Task 1: Test-Dependencies & Pytest-Konfiguration

**Files:**
- Create: `backend/requirements-dev.txt`
- Create: `backend/pyproject.toml`

- [ ] **Step 1: requirements-dev.txt anlegen**

```text
-r requirements.txt
pytest==8.3.3
pytest-asyncio==0.24.0
httpx==0.27.2
testcontainers[postgres]==4.8.2
```

- [ ] **Step 2: pyproject.toml mit Pytest-Config anlegen**

```toml
[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]
filterwarnings = ["ignore::DeprecationWarning"]
```

- [ ] **Step 3: venv erstellen, Dev-Deps installieren**

```bash
cd backend && python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
```

Expected: alle Pakete installieren ohne Resolver-Konflikte; letzte Zeile `Successfully installed ...`.

- [ ] **Step 4: Pytest-Lauf zur Verifikation, dass Pytest geladen wird**

```bash
cd backend && .venv/bin/pytest --collect-only -q 2>&1 | tail -20
```

Expected: Collect-Output zeigt die alten Tests aus `tests/test_api.py`. Noch keine Test-Lauf, kein Postgres nötig.

- [ ] **Step 5: Commit**

```bash
git add backend/requirements-dev.txt backend/pyproject.toml
git commit -m "test(backend): add pytest, pytest-asyncio, httpx, testcontainers dev-deps"
```

---

## Task 2: Postgres-Container-Fixture mit Alembic-Migration

**Files:**
- Create: `backend/tests/conftest.py`

- [ ] **Step 1: conftest.py mit Postgres-Container und Migration anlegen**

```python
"""Pytest-Fixtures fuer Backend-Tests.

Strategie: pro Pytest-Session ein Postgres-16-Container (testcontainers),
einmal Alembic-Migration, pro Test eine aeussere Transaktion mit
SAVEPOINT-Rollback fuer schnelle, deterministische Isolation.
"""
from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Iterator

import pytest
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, create_async_engine
from testcontainers.postgres import PostgresContainer


@pytest.fixture(scope="session")
def event_loop() -> Iterator[asyncio.AbstractEventLoop]:
    """Session-weit eine Event-Loop, damit session-scoped async Fixtures funktionieren."""
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest.fixture(scope="session")
def pg_container() -> Iterator[PostgresContainer]:
    """Postgres 16 als Test-DB. Bleibt fuer die ganze Session laufen."""
    with PostgresContainer("postgres:16-alpine", driver=None) as container:
        yield container


@pytest.fixture(scope="session")
def database_url(pg_container: PostgresContainer) -> str:
    """asyncpg-URL fuer die Test-DB (Treiber explizit ueberschreiben)."""
    raw = pg_container.get_connection_url()
    return raw.replace("postgresql+psycopg2://", "postgresql+asyncpg://").replace(
        "postgresql://", "postgresql+asyncpg://"
    )


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
    """Alembic-Migration einmal pro Session ausfuehren."""
    from alembic import command
    from alembic.config import Config

    cfg = Config("alembic.ini")
    cfg.set_main_option("sqlalchemy.url", database_url)
    command.upgrade(cfg, "head")
```

- [ ] **Step 2: Sanity-Check, dass Postgres anspringt und Migration laeuft**

```bash
cd backend && .venv/bin/python -c "
import asyncio
from testcontainers.postgres import PostgresContainer
from alembic import command
from alembic.config import Config

with PostgresContainer('postgres:16-alpine') as c:
    url = c.get_connection_url().replace('postgresql+psycopg2://', 'postgresql+asyncpg://')
    print('URL:', url)
    cfg = Config('alembic.ini')
    cfg.set_main_option('sqlalchemy.url', url)
    command.upgrade(cfg, 'head')
    print('Migration OK')
"
```

Expected: `URL: postgresql+asyncpg://...` und `Migration OK`. Erste Ausführung lädt Postgres-Image (~80 MB), kann 30s dauern.

- [ ] **Step 3: Commit (Fixture-Skelett, noch ohne db_session/client)**

```bash
git add backend/tests/conftest.py
git commit -m "test(backend): postgres testcontainer fixture with alembic migration"
```

---

## Task 3: Async-Engine + db_session-Fixture mit Transaktions-Rollback

**Files:**
- Modify: `backend/tests/conftest.py`

- [ ] **Step 1: Engine-Fixture und db_session-Fixture ergänzen**

Anhängen an `backend/tests/conftest.py`:

```python
@pytest.fixture(scope="session")
async def engine(database_url: str, _migrated_db: None) -> AsyncIterator[AsyncEngine]:
    eng = create_async_engine(database_url, future=True, pool_pre_ping=True)
    yield eng
    await eng.dispose()


@pytest.fixture
async def db_session(engine: AsyncEngine) -> AsyncIterator[AsyncSession]:
    """Pro Test eine aeussere Transaktion mit SAVEPOINT.

    Endpoint-Code darf intern committen — wir fangen das mit nested transactions
    ab und rollen am Testende alles zurueck. Pattern: SQLAlchemy "join external
    transaction".
    """
    async with engine.connect() as connection:
        outer = await connection.begin()
        session = AsyncSession(bind=connection, expire_on_commit=False)
        await connection.begin_nested()

        from sqlalchemy import event

        @event.listens_for(session.sync_session, "after_transaction_end")
        def _restart_savepoint(sess, trans):
            if trans.nested and not trans._parent.nested:
                connection.sync_connection.begin_nested()

        try:
            yield session
        finally:
            await session.close()
            await outer.rollback()
```

- [ ] **Step 2: Smoke-Test, dass die Fixture liefert**

`backend/tests/test_smoke.py` (temporär, wird in Task 5 entfernt):

```python
import pytest
from sqlalchemy import text


@pytest.mark.asyncio
async def test_db_session_works(db_session):
    result = await db_session.execute(text("select 1"))
    assert result.scalar() == 1
```

- [ ] **Step 3: Pytest laufen lassen**

```bash
cd backend && .venv/bin/pytest tests/test_smoke.py -v
```

Expected: `test_db_session_works PASSED`.

- [ ] **Step 4: Smoke-Test entfernen**

```bash
rm backend/tests/test_smoke.py
```

- [ ] **Step 5: Commit**

```bash
git add backend/tests/conftest.py
git commit -m "test(backend): add async engine + transactional db_session fixture"
```

---

## Task 4: HTTP-Client-Fixture mit dependency_override

**Files:**
- Modify: `backend/tests/conftest.py`

- [ ] **Step 1: client-Fixture und Helfer für Test-User-Erstellung anhängen**

```python
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
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            yield c
    finally:
        app.dependency_overrides.pop(get_db, None)


async def _register_and_login(client, email: str, password: str = "supersicheresPasswort1") -> dict:
    """Hilfsfunktion: User anlegen und einloggen, Tokens und Header zurueckgeben."""
    r = await client.post("/api/v1/auth/register", json={"email": email, "password": password})
    assert r.status_code == 201, r.text
    user = r.json()

    r = await client.post("/api/v1/auth/login", json={"email": email, "password": password})
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
```

- [ ] **Step 2: Smoke-Test mit /api/v1/health**

`backend/tests/test_smoke_client.py` (temporär):

```python
async def test_health_via_client(client):
    r = await client.get("/api/v1/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}
```

- [ ] **Step 3: Test laufen lassen**

```bash
cd backend && .venv/bin/pytest tests/test_smoke_client.py -v
```

Expected: PASS.

- [ ] **Step 4: Smoke-Test entfernen**

```bash
rm backend/tests/test_smoke_client.py
```

- [ ] **Step 5: Commit**

```bash
git add backend/tests/conftest.py
git commit -m "test(backend): add httpx client fixture with get_db override + user fixtures"
```

---

## Task 5: Health-Test umziehen, alten test_api.py entsorgen

**Files:**
- Create: `backend/tests/test_health.py`
- Delete: `backend/tests/test_api.py`

- [ ] **Step 1: test_health.py schreiben**

```python
"""Tests fuer /api/v1/health."""


async def test_health_returns_ok(client):
    r = await client.get("/api/v1/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}
```

- [ ] **Step 2: test_api.py löschen**

```bash
rm backend/tests/test_api.py
```

- [ ] **Step 3: Pytest-Lauf**

```bash
cd backend && .venv/bin/pytest tests/test_health.py -v
```

Expected: 1 passed.

- [ ] **Step 4: Commit**

```bash
git add backend/tests/test_health.py backend/tests/test_api.py
git commit -m "test(backend): split health test into own module, drop legacy test_api.py"
```

---

## Task 6: Register-Tests

**Files:**
- Create: `backend/tests/test_auth_register.py`

- [ ] **Step 1: Tests schreiben**

```python
"""Tests fuer POST /api/v1/auth/register."""

VALID_PW = "supersicheresPasswort1"


async def test_register_creates_user(client):
    r = await client.post(
        "/api/v1/auth/register",
        json={"email": "new@example.com", "password": VALID_PW},
    )
    assert r.status_code == 201
    body = r.json()
    assert body["email"] == "new@example.com"
    assert "id" in body
    assert "created_at" in body
    assert "password_hash" not in body


async def test_register_creates_default_presets(client):
    await client.post(
        "/api/v1/auth/register",
        json={"email": "presets@example.com", "password": VALID_PW},
    )
    login = await client.post(
        "/api/v1/auth/login",
        json={"email": "presets@example.com", "password": VALID_PW},
    )
    token = login.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    r = await client.get("/api/v1/presets", headers=headers)
    assert r.status_code == 200
    names = {p["name"] for p in r.json()}
    assert {"Neutral", "Punchy", "Soft Mood", "Schwarzweiss-Vorbereitung"} <= names


async def test_register_with_existing_email_returns_400(client):
    await client.post(
        "/api/v1/auth/register",
        json={"email": "dup@example.com", "password": VALID_PW},
    )
    r = await client.post(
        "/api/v1/auth/register",
        json={"email": "dup@example.com", "password": VALID_PW},
    )
    assert r.status_code == 400


async def test_register_with_short_password_returns_422(client):
    r = await client.post(
        "/api/v1/auth/register",
        json={"email": "short@example.com", "password": "kurz"},
    )
    assert r.status_code == 422


async def test_register_lowercases_email(client):
    r = await client.post(
        "/api/v1/auth/register",
        json={"email": "Mixed@Example.COM", "password": VALID_PW},
    )
    assert r.status_code == 201
    assert r.json()["email"] == "mixed@example.com"
```

- [ ] **Step 2: Tests laufen lassen, alle müssen PASS sein**

```bash
cd backend && .venv/bin/pytest tests/test_auth_register.py -v
```

Expected: 5 passed.
Falls FAIL: Bug im Endpoint sichtbar — separater Fix-Commit nach Task-Ende, mit fehlschlagendem Test als Reproducer.

- [ ] **Step 3: Commit**

```bash
git add backend/tests/test_auth_register.py
git commit -m "test(backend): cover /auth/register success, conflict, validation, lowercasing"
```

---

## Task 7: Login-Tests

**Files:**
- Create: `backend/tests/test_auth_login.py`

- [ ] **Step 1: Tests schreiben**

```python
"""Tests fuer POST /api/v1/auth/login."""

VALID_PW = "supersicheresPasswort1"


async def _register(client, email: str, password: str = VALID_PW):
    return await client.post(
        "/api/v1/auth/register", json={"email": email, "password": password}
    )


async def test_login_with_valid_credentials_returns_token_pair(client):
    await _register(client, "login@example.com")
    r = await client.post(
        "/api/v1/auth/login",
        json={"email": "login@example.com", "password": VALID_PW},
    )
    assert r.status_code == 200
    body = r.json()
    assert "access_token" in body
    assert "refresh_token" in body
    assert body["token_type"] == "bearer"
    assert body["expires_in"] > 0


async def test_login_with_wrong_password_returns_401(client):
    await _register(client, "wrongpw@example.com")
    r = await client.post(
        "/api/v1/auth/login",
        json={"email": "wrongpw@example.com", "password": "falsch1234567"},
    )
    assert r.status_code == 401


async def test_login_with_unknown_user_returns_401(client):
    r = await client.post(
        "/api/v1/auth/login",
        json={"email": "ghost@example.com", "password": VALID_PW},
    )
    assert r.status_code == 401


async def test_login_is_case_insensitive_on_email(client):
    await _register(client, "case@example.com")
    r = await client.post(
        "/api/v1/auth/login",
        json={"email": "CASE@example.com", "password": VALID_PW},
    )
    assert r.status_code == 200
```

- [ ] **Step 2: Tests laufen lassen**

```bash
cd backend && .venv/bin/pytest tests/test_auth_login.py -v
```

Expected: 4 passed.

- [ ] **Step 3: Commit**

```bash
git add backend/tests/test_auth_login.py
git commit -m "test(backend): cover /auth/login success, wrong-pw, unknown-user, case"
```

---

## Task 8: /me-Tests

**Files:**
- Create: `backend/tests/test_auth_me.py`

- [ ] **Step 1: Tests schreiben**

```python
"""Tests fuer GET /api/v1/auth/me."""


async def test_me_without_token_returns_401(client):
    r = await client.get("/api/v1/auth/me")
    assert r.status_code == 401


async def test_me_with_invalid_token_returns_401(client):
    r = await client.get(
        "/api/v1/auth/me", headers={"Authorization": "Bearer not-a-jwt"}
    )
    assert r.status_code == 401


async def test_me_with_valid_token_returns_user(client, user_a):
    r = await client.get("/api/v1/auth/me", headers=user_a["headers"])
    assert r.status_code == 200
    assert r.json()["email"] == "alice@example.com"
    assert r.json()["id"] == user_a["user"]["id"]
```

- [ ] **Step 2: Tests laufen lassen**

```bash
cd backend && .venv/bin/pytest tests/test_auth_me.py -v
```

Expected: 3 passed.

- [ ] **Step 3: Commit**

```bash
git add backend/tests/test_auth_me.py
git commit -m "test(backend): cover /auth/me without/invalid/valid token"
```

---

## Task 9: Refresh-Tests inkl. Rotation

**Files:**
- Create: `backend/tests/test_auth_refresh.py`

- [ ] **Step 1: Tests schreiben — *Rotation* ist die wichtigste Eigenschaft**

```python
"""Tests fuer POST /api/v1/auth/refresh inkl. Rotation-Schutz."""


async def test_refresh_with_valid_token_returns_new_pair(client, user_a):
    old_refresh = user_a["tokens"]["refresh_token"]
    r = await client.post(
        "/api/v1/auth/refresh", json={"refresh_token": old_refresh}
    )
    assert r.status_code == 200
    new_pair = r.json()
    assert new_pair["access_token"] != user_a["tokens"]["access_token"]
    assert new_pair["refresh_token"] != old_refresh


async def test_refresh_invalidates_old_refresh_token(client, user_a):
    """Replay-Schutz: alter Refresh-Token darf nach Rotation nicht mehr gehen."""
    old = user_a["tokens"]["refresh_token"]

    first = await client.post("/api/v1/auth/refresh", json={"refresh_token": old})
    assert first.status_code == 200

    second = await client.post("/api/v1/auth/refresh", json={"refresh_token": old})
    assert second.status_code == 401


async def test_refresh_with_unknown_token_returns_401(client):
    r = await client.post(
        "/api/v1/auth/refresh", json={"refresh_token": "ungueltig-blub"}
    )
    assert r.status_code == 401


async def test_refresh_chain_works(client, user_a):
    """Mehrfaches Refresh-Rotieren funktioniert mit jeweils neuem Token."""
    current = user_a["tokens"]["refresh_token"]
    for _ in range(3):
        r = await client.post(
            "/api/v1/auth/refresh", json={"refresh_token": current}
        )
        assert r.status_code == 200
        current = r.json()["refresh_token"]
```

- [ ] **Step 2: Tests laufen lassen**

```bash
cd backend && .venv/bin/pytest tests/test_auth_refresh.py -v
```

Expected: 4 passed. Falls Rotation-Test fehlschlägt: Bug in `app/routers/auth.py:refresh` (siehe Spec). Fix als separater Commit nach diesem Task.

- [ ] **Step 3: Commit**

```bash
git add backend/tests/test_auth_refresh.py
git commit -m "test(backend): cover /auth/refresh rotation, unknown-token, chain"
```

---

## Task 10: Logout-Tests

**Files:**
- Create: `backend/tests/test_auth_logout.py`

- [ ] **Step 1: Tests schreiben**

```python
"""Tests fuer POST /api/v1/auth/logout."""


async def test_logout_revokes_refresh_token(client, user_a):
    refresh = user_a["tokens"]["refresh_token"]

    r = await client.post(
        "/api/v1/auth/logout", json={"refresh_token": refresh}
    )
    assert r.status_code == 204

    r = await client.post(
        "/api/v1/auth/refresh", json={"refresh_token": refresh}
    )
    assert r.status_code == 401


async def test_logout_with_unknown_token_succeeds(client):
    """Bewusst still-success: kein Existenz-Leak via Statuscode."""
    r = await client.post(
        "/api/v1/auth/logout", json={"refresh_token": "fantasie-1234"}
    )
    assert r.status_code == 204
```

- [ ] **Step 2: Tests laufen lassen**

```bash
cd backend && .venv/bin/pytest tests/test_auth_logout.py -v
```

Expected: 2 passed.

- [ ] **Step 3: Commit**

```bash
git add backend/tests/test_auth_logout.py
git commit -m "test(backend): cover /auth/logout revoke + silent unknown-token"
```

---

## Task 11: Presets-CRUD-Tests

**Files:**
- Create: `backend/tests/test_presets_crud.py`

- [ ] **Step 1: Tests schreiben — alle Werte explizit für Reproduzierbarkeit**

```python
"""Tests fuer /api/v1/presets CRUD."""

ZERO_ADJ = {
    "exposure": 0.0, "contrast": 0.0, "highlights": 0.0, "shadows": 0.0,
    "whites": 0.0, "blacks": 0.0, "temperature": 0.0, "tint": 0.0,
    "vibrance": 0.0, "saturation": 0.0,
}


async def test_list_presets_for_new_user_returns_defaults(client, user_a):
    r = await client.get("/api/v1/presets", headers=user_a["headers"])
    assert r.status_code == 200
    names = [p["name"] for p in r.json()]
    assert names == sorted(names)  # Default-Sort: name asc
    assert {"Neutral", "Punchy", "Soft Mood", "Schwarzweiss-Vorbereitung"} <= set(names)


async def test_create_preset(client, user_a):
    adj = {**ZERO_ADJ, "contrast": 0.4}
    r = await client.post(
        "/api/v1/presets",
        headers=user_a["headers"],
        json={"name": "Mein Look", "adjustments": adj},
    )
    assert r.status_code == 201
    body = r.json()
    assert body["name"] == "Mein Look"
    assert body["adjustments"]["contrast"] == 0.4
    assert "id" in body


async def test_create_duplicate_name_returns_409(client, user_a):
    r = await client.post(
        "/api/v1/presets",
        headers=user_a["headers"],
        json={"name": "Punchy", "adjustments": ZERO_ADJ},
    )
    assert r.status_code == 409


async def test_create_with_out_of_range_value_returns_422(client, user_a):
    bad = {**ZERO_ADJ, "exposure": 99.0}
    r = await client.post(
        "/api/v1/presets",
        headers=user_a["headers"],
        json={"name": "Bad", "adjustments": bad},
    )
    assert r.status_code == 422


async def test_create_with_extra_field_returns_422(client, user_a):
    bad = {**ZERO_ADJ, "clarity": 0.3}
    r = await client.post(
        "/api/v1/presets",
        headers=user_a["headers"],
        json={"name": "Extra", "adjustments": bad},
    )
    assert r.status_code == 422


async def test_update_preset(client, user_a):
    create = await client.post(
        "/api/v1/presets",
        headers=user_a["headers"],
        json={"name": "ToUpdate", "adjustments": ZERO_ADJ},
    )
    pid = create.json()["id"]

    new_adj = {**ZERO_ADJ, "saturation": -0.5}
    r = await client.put(
        f"/api/v1/presets/{pid}",
        headers=user_a["headers"],
        json={"name": "Updated", "adjustments": new_adj},
    )
    assert r.status_code == 200
    assert r.json()["name"] == "Updated"
    assert r.json()["adjustments"]["saturation"] == -0.5


async def test_update_unknown_preset_returns_404(client, user_a):
    fake = "00000000-0000-0000-0000-000000000000"
    r = await client.put(
        f"/api/v1/presets/{fake}",
        headers=user_a["headers"],
        json={"name": "X", "adjustments": ZERO_ADJ},
    )
    assert r.status_code == 404


async def test_delete_preset(client, user_a):
    create = await client.post(
        "/api/v1/presets",
        headers=user_a["headers"],
        json={"name": "ToDelete", "adjustments": ZERO_ADJ},
    )
    pid = create.json()["id"]

    r = await client.delete(f"/api/v1/presets/{pid}", headers=user_a["headers"])
    assert r.status_code == 204

    listing = await client.get("/api/v1/presets", headers=user_a["headers"])
    assert "ToDelete" not in [p["name"] for p in listing.json()]


async def test_delete_unknown_preset_returns_404(client, user_a):
    fake = "00000000-0000-0000-0000-000000000000"
    r = await client.delete(f"/api/v1/presets/{fake}", headers=user_a["headers"])
    assert r.status_code == 404


async def test_list_supports_search(client, user_a):
    r = await client.get(
        "/api/v1/presets?q=Punc", headers=user_a["headers"]
    )
    assert r.status_code == 200
    names = [p["name"] for p in r.json()]
    assert names == ["Punchy"]


async def test_list_supports_sort_minus_name(client, user_a):
    r = await client.get(
        "/api/v1/presets?sort=-name", headers=user_a["headers"]
    )
    assert r.status_code == 200
    names = [p["name"] for p in r.json()]
    assert names == sorted(names, reverse=True)
```

- [ ] **Step 2: Tests laufen lassen**

```bash
cd backend && .venv/bin/pytest tests/test_presets_crud.py -v
```

Expected: 11 passed.

- [ ] **Step 3: Commit**

```bash
git add backend/tests/test_presets_crud.py
git commit -m "test(backend): cover presets CRUD, conflict, validation, search, sort"
```

---

## Task 12: Tenant-Isolation-Tests

**Files:**
- Create: `backend/tests/test_tenant_isolation.py`

- [ ] **Step 1: Tests schreiben**

```python
"""Tests fuer Tenant-Isolation: User B darf nichts von User A sehen oder aendern."""

ZERO_ADJ = {
    "exposure": 0.0, "contrast": 0.0, "highlights": 0.0, "shadows": 0.0,
    "whites": 0.0, "blacks": 0.0, "temperature": 0.0, "tint": 0.0,
    "vibrance": 0.0, "saturation": 0.0,
}


async def _create_preset(client, headers, name: str) -> str:
    r = await client.post(
        "/api/v1/presets",
        headers=headers,
        json={"name": name, "adjustments": ZERO_ADJ},
    )
    assert r.status_code == 201
    return r.json()["id"]


async def test_user_b_cannot_see_user_a_preset_in_list(client, user_a, user_b):
    await _create_preset(client, user_a["headers"], "AlicesPreset")

    r = await client.get("/api/v1/presets", headers=user_b["headers"])
    names = [p["name"] for p in r.json()]
    assert "AlicesPreset" not in names


async def test_user_b_cannot_update_user_a_preset(client, user_a, user_b):
    pid = await _create_preset(client, user_a["headers"], "Lock")

    r = await client.put(
        f"/api/v1/presets/{pid}",
        headers=user_b["headers"],
        json={"name": "Hijacked", "adjustments": ZERO_ADJ},
    )
    assert r.status_code == 404

    # Original unangetastet
    listing = await client.get("/api/v1/presets", headers=user_a["headers"])
    assert "Lock" in [p["name"] for p in listing.json()]


async def test_user_b_cannot_delete_user_a_preset(client, user_a, user_b):
    pid = await _create_preset(client, user_a["headers"], "DontDeleteMe")

    r = await client.delete(
        f"/api/v1/presets/{pid}", headers=user_b["headers"]
    )
    assert r.status_code == 404

    listing = await client.get("/api/v1/presets", headers=user_a["headers"])
    assert "DontDeleteMe" in [p["name"] for p in listing.json()]


async def test_search_query_does_not_leak_other_tenants(client, user_a, user_b):
    await _create_preset(client, user_a["headers"], "AliceSecret")

    r = await client.get(
        "/api/v1/presets?q=AliceSecret", headers=user_b["headers"]
    )
    assert r.json() == []
```

- [ ] **Step 2: Tests laufen lassen**

```bash
cd backend && .venv/bin/pytest tests/test_tenant_isolation.py -v
```

Expected: 4 passed.

- [ ] **Step 3: Commit**

```bash
git add backend/tests/test_tenant_isolation.py
git commit -m "test(backend): tenant isolation across list/update/delete/search"
```

---

## Task 13: Schema-Sync-Test (JSON-Schema ↔ Pydantic)

**Files:**
- Create: `backend/tests/test_schema_sync.py`

- [ ] **Step 1: Test schreiben**

```python
"""Sicherstellen, dass adjustments.schema.json und app.schemas.Adjustments
identisch sind — Single Source of Truth fuer Frontend, Backend, Shader."""
import json
from pathlib import Path

from app.schemas import Adjustments

SCHEMA_PATH = Path(__file__).resolve().parents[1] / "schemas" / "adjustments.schema.json"


def _bounds_from_pydantic(field):
    constraints = {"min": None, "max": None}
    for m in field.metadata:
        for attr, key in (("ge", "min"), ("le", "max")):
            v = getattr(m, attr, None)
            if v is not None:
                constraints[key] = v
    return constraints


def test_adjustments_schema_matches_pydantic():
    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    schema_props = schema["properties"]

    pydantic_fields = Adjustments.model_fields

    assert set(schema_props.keys()) == set(pydantic_fields.keys()), (
        f"Felder weichen ab. JSON-Schema: {set(schema_props)}, "
        f"Pydantic: {set(pydantic_fields)}"
    )

    for name, prop in schema_props.items():
        bounds = _bounds_from_pydantic(pydantic_fields[name])
        assert bounds["min"] == prop["minimum"], f"{name}: min mismatch"
        assert bounds["max"] == prop["maximum"], f"{name}: max mismatch"

    assert schema.get("additionalProperties") is False
```

- [ ] **Step 2: Test laufen lassen**

```bash
cd backend && .venv/bin/pytest tests/test_schema_sync.py -v
```

Expected: PASS. Falls FAIL: einer der beiden ist veraltet — beide synchronisieren in einem Folge-Commit.

- [ ] **Step 3: Commit**

```bash
git add backend/tests/test_schema_sync.py
git commit -m "test(backend): assert adjustments JSON-Schema and Pydantic stay in sync"
```

---

## Task 14: Vollständiger Suite-Run + README-Update

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Komplette Test-Suite laufen lassen**

```bash
cd backend && .venv/bin/pytest -q
```

Expected: alle Tests grün, mindestens **30** Tests gesammelt. Wenn nicht: Fehler analysieren, fix in eigenem Commit, dann erneut.

- [ ] **Step 2: README-Abschnitt zum Test-Setup ergänzen**

In `README.md` direkt unter dem bestehenden „Schnellstart"-Abschnitt einfügen:

````markdown
## Tests

Backend-Tests laufen gegen einen automatisch hochgefahrenen Postgres-Container (`testcontainers`). Voraussetzung: laufender Docker-Daemon.

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
pytest -q
```

Erste Ausführung lädt `postgres:16-alpine` (~80 MB). Folgende Läufe nutzen das gecachte Image. Pro Test: aktive Transaktion mit SAVEPOINT, am Ende Rollback — Tests sind voneinander vollständig isoliert.
````

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: how to run backend tests via testcontainers"
```

---

## Self-Review-Checkliste (vor Abschluss durchgehen)

1. **Spec-Coverage:** Jeder Test aus dem Spec-Abschnitt "Test-Suite (Soll-Zustand)" hat hier eine Task-Zeile. Geprüft: Register (5), Login (4), /me (3), Refresh (4), Logout (2), Presets-CRUD (11), Tenant-Isolation (4), Schema-Sync (1) → ~34 Tests gesamt, ≥ 30 erfüllt.
2. **Kein Placeholder:** Jede Test-Funktion enthält die finale Assertion. Keine "TODO" oder "ergänzen". Pytest-Commands sind exakt.
3. **Type-Konsistenz:** `client`, `user_a`, `user_b`, `db_session` heißen in allen Tasks gleich. `ZERO_ADJ` ist in jeder Datei lokal definiert (kein Cross-Modul-Import = einfacher und expliziter).
4. **TDD-Treue:** Bei aufgedeckten Bugs wird der Test zuerst geschrieben (rot), dann der Fix als separater Commit. Diese Bug-Fix-Tasks sind absichtlich nicht vorgeplant — sie hängen davon ab, was die Tests aufdecken, und werden erst dann konkret.

---

## Nach Abschluss dieser Iteration

Alle Endpoints sind durch Tests abgesichert. Damit ist die Grundlage gelegt, um in Iteration 2 das Frontend-Vite-Setup mit TDD anzugehen, ohne dass am Backend etwas Unbeobachtetes regressiert.
