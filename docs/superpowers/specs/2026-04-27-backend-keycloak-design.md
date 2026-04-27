# Spec · Backend auf Keycloak

**Datum:** 2026-04-27
**Iteration:** 4 (von vielen)
**Vorgänger:** Iteration 3 (Architektur-Update — ADR-010, ADR-011, ADR-012)

## Motivation

Iteration 1 hat ein eigenes JWT-Auth-System gebaut (`app/auth.py`, `app/routers/auth.py`, 18 Tests). ADR-010 macht das obsolet: Lumen-Backend ist nur noch **Resource Server**, der Tokens vom externen Keycloak-Realm `lumen` verifiziert. Iteration 4 baut diesen Refactor um, ohne Tenant-Isolation oder Presets-CRUD zu brechen.

## Ziel

- `app/auth.py` ersetzt: JWK-Verifikation gegen Keycloak, JIT-User-Provisioning.
- `app/routers/auth.py` reduziert auf `GET /me`.
- DB-Schema migriert: `users.password_hash` → `users.keycloak_sub`, `refresh_tokens`-Tabelle weg.
- Neuer Realm-Export `infra/keycloak/lumen-realm.json` als Source-of-Truth.
- Test-Suite läuft mit echtem Keycloak-Container (testcontainers).

## Nicht-Ziel

- Frontend bleibt bei der Skelett-Form aus Iteration 2 (Auth-Flow im Frontend ist Iteration 5).
- Garage / Image-Storage ist Iteration 6.
- Production-Deployment ist Iteration 7.

## Architektur (Soll)

### Token-Verifikation

Jeder API-Call (außer `GET /api/v1/health`) erwartet einen `Authorization: Bearer <jwt>`. Die Dependency `current_user` führt aus:

1. JWT-Header lesen → `kid` extrahieren.
2. JWK-Set vom Keycloak-Issuer holen (URL aus `KEYCLOAK_ISSUER`-Setting), Schlüssel zum `kid` finden. **Cache:** 10 min, in-memory.
3. JWT-Signatur mit `python-jose` verifizieren, Audience/Issuer-Claims prüfen.
4. `sub`-Claim → lokale `users`-Row finden oder JIT anlegen (`email`-Spiegel aus Token).
5. `User`-Objekt zurückgeben.

### Settings (`app/config.py`)

Neue Felder:
- `keycloak_issuer` — z. B. `https://auth.example.com/realms/lumen`. Lokal: `http://localhost:18080/realms/lumen`. In Tests: aus dem testcontainers-Container abgeleitet.
- `keycloak_audience` — der erwartete `aud`-Claim, z. B. `account` (Keycloak-Default für Public Clients) oder explizit `lumen-api`.
- `jwk_cache_seconds` — Default 600.

Wegfallen:
- `jwt_secret`, `jwt_algorithm`, `access_token_expire_minutes`, `refresh_token_expire_days`, `bcrypt_rounds` — alles obsolet.

### Models (`app/models.py`)

- `User`: `id`, `keycloak_sub` (unique), `email`, `created_at`. Relation `presets` bleibt. `password_hash` raus, `refresh_tokens`-Relation raus.
- `RefreshToken`: komplett raus.

### Schemas (`app/schemas.py`)

Raus: `UserCreate`, `LoginRequest`, `TokenPair`, `RefreshRequest`. Bleibt: `Adjustments`, `UserOut`, `PresetIn`, `PresetOut`, `ErrorResponse`.

### Router-Registrierung (`app/main.py`)

`auth.router` bleibt registriert (auf `/api/v1/auth`), enthält aber nur noch `GET /me`. `presets.router` unverändert.

### Realm-Export (`infra/keycloak/lumen-realm.json`)

Minimal-Realm mit:
- Realm-Name `lumen`, `enabled: true`, `accessTokenLifespan: 900`
- Public Client `lumen-frontend` mit `standardFlowEnabled` (PKCE) UND `directAccessGrantsEnabled` (für Tests). Redirects zunächst weit (`*`) — wird in Iteration 7 verschärft.
- Realm-Roles: `user` (default).
- **Kein** vorgelegter Test-User — Tests legen User dynamisch via Admin-API an.

### Test-Setup

`conftest.py` bekommt drei neue Fixtures:

```python
@pytest.fixture(scope="session")
def keycloak_container(): ...        # KeycloakContainer mit Realm-Import

@pytest.fixture(scope="session")
def keycloak_admin(keycloak_container) -> KeycloakAdmin: ...

@pytest.fixture
async def make_user(keycloak_admin, client):
    """Fabrik: erzeugt User in Keycloak + holt Direct-Grant-Token. Cleanup."""

@pytest.fixture
async def user_a(make_user) -> dict: yield await make_user("alice@example.com")

@pytest.fixture
async def user_b(make_user) -> dict: yield await make_user("bob@example.com")
```

Kompatibilität: `user_a`/`user_b` haben das selbe Shape wie bisher (`{"user": ..., "tokens": ..., "headers": ...}`), damit Tenant-Isolation- und Presets-Tests **unverändert** bleiben.

## Test-Plan (Soll-Zustand)

| Datei | Status | Tests |
|---|---|---|
| `test_health.py` | bleibt | 1 |
| `test_auth_register.py` | **gelöscht** | – |
| `test_auth_login.py` | **gelöscht** | – |
| `test_auth_refresh.py` | **gelöscht** | – |
| `test_auth_logout.py` | **gelöscht** | – |
| `test_auth_me.py` | umgeschrieben | 4 |
| `test_auth_jwt.py` | **neu** | 6 |
| `test_jit_provisioning.py` | **neu** | 3 |
| `test_presets_crud.py` | bleibt (Tokens kommen aus neuer Fixture) | 11 |
| `test_tenant_isolation.py` | bleibt (analog) | 4 |
| `test_schema_sync.py` | bleibt | 1 |
| **Summe** | | **30** |

(Vorher 35, jetzt 30 — die 18 register/login/refresh/logout-Tests werden durch 13 fokussiertere Tests rund um JWT und JIT ersetzt.)

### `test_auth_jwt.py` (neu)

- `test_endpoint_without_token_returns_401`
- `test_endpoint_with_invalid_signature_returns_401`
- `test_endpoint_with_expired_token_returns_401`
- `test_endpoint_with_wrong_issuer_returns_401`
- `test_endpoint_with_wrong_audience_returns_401`
- `test_endpoint_with_valid_token_returns_data`

### `test_jit_provisioning.py` (neu)

- `test_first_request_creates_local_user_row`
- `test_second_request_reuses_user_row`
- `test_email_change_in_token_updates_local_email`

### `test_auth_me.py` (umgeschrieben)

- `test_me_without_token_returns_401`
- `test_me_with_invalid_token_returns_401`
- `test_me_with_valid_token_returns_user`
- `test_me_returns_email_from_token_after_change`

## Migrations-Plan

`alembic/versions/002_keycloak.py` (`upgrade()`):

1. `ALTER TABLE users DROP COLUMN password_hash;`
2. `ALTER TABLE users ADD COLUMN keycloak_sub TEXT;`
3. `UPDATE users SET keycloak_sub = id::text;` *(no-op auf leerer Test-DB; Schutz für hypothetische Production-Daten)*
4. `ALTER TABLE users ALTER COLUMN keycloak_sub SET NOT NULL;`
5. `CREATE UNIQUE INDEX uq_users_keycloak_sub ON users(keycloak_sub);`
6. `DROP TABLE refresh_tokens;`

`downgrade()`: Reverse, mit Default-Werten für `password_hash`.

## Akzeptanzkriterien

1. **Tests grün:** `pytest -q` → 30/30 passed.
2. **Keine Mocks für IdP:** echter Keycloak-Container für jeden Test-Run.
3. **Schema sauber:** Migration 002 läuft `upgrade` und `downgrade` ohne Fehler auf einer frischen DB.
4. **Code clean:** keine Reste von bcrypt / Refresh-Token-Logik im Code (`grep -r "password_hash\|refresh_token\|bcrypt\|create_access_token" app/` → leer, außer in Tests die JWT-Utilities testen).
5. **Realm-Export checked-in:** `infra/keycloak/lumen-realm.json` versioniert, lädbar via `kc.sh import`.
6. **Settings dokumentiert:** `deployment/.env.example` zeigt `KEYCLOAK_ISSUER` und `KEYCLOAK_AUDIENCE`, alte JWT-Variablen entfernt.

## Risiken / Fragen

- **Keycloak-Boot-Zeit:** lokal initial ~15 s. Bei wiederholten Tests im selben Lauf: einmaliger Container, daher OK. CI-Auswirkung: separate Iteration.
- **`kc.sh start-dev` vs `start`:** testcontainers nutzt `start-dev` (in-memory DB, schnell). Production nutzt `start` mit externem Postgres — Realm-Export ist trotzdem kompatibel.
- **Audience-Claim:** Keycloak setzt für Public Clients standardmäßig `account` als `aud`. Wir fügen einen Audience-Mapper auf den Client `lumen-frontend` hinzu, der `aud=lumen-api` setzt. Falls das in Iteration 4 zu friemelig wird, fallback: `keycloak_audience=account` als Default, später verschärfen.
