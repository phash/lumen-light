# Spec · Backend test-tauglich machen

**Datum:** 2026-04-27
**Status:** Entwurf, bereit für Plan
**Iteration:** 1 (von vielen)
**Vorgänger:** Iteration 0 (Grundordnung) — abgeschlossen

## Motivation

Das Backend-Skeleton in `backend/` enthält drei Tests in `tests/test_api.py` (Health, Register/Login-Flow, Preset-CRUD). Diese Tests:

1. **laufen nicht reproduzierbar** — sie verwenden die in `app/config.py` konfigurierte `DATABASE_URL`, die in einem ungesetzten Environment auf Localhost-Postgres zeigt. Es gibt weder eine Test-DB-Fixture noch ein Pytest-Setup.
2. **decken den Happy Path ab**, aber keine Fehlerfälle, keine **Tenant-Isolation** (zentrale Conventions-Anforderung) und keine **Refresh-Token-Rotation** (zentrale Sicherheits-Annahme aus ADR-004).
3. `pytest-asyncio` und `httpx` fehlen in `requirements.txt` → die Tests sind nicht installierbar.

Bevor irgendein neuer Code entsteht, wird das Test-Fundament tragfähig gemacht. Alle weiteren Iterationen können dann mit echtem TDD arbeiten.

## Ziel

- Alle bestehenden Tests laufen grün gegen eine echte, isolierte Postgres-Instanz, die der Test-Run automatisch hochfährt und beim Ende wieder beendet.
- Neue Tests decken Tenant-Isolation, Refresh-Rotation und alle bisher fehlenden 4xx-Fehlerpfade ab.
- Konkrete Akzeptanzkriterien: `pytest -q` läuft auf einem frischen Checkout (mit installiertem Docker) ohne weitere manuelle Schritte und gibt 0 Fails aus.

## Nicht-Ziel

- Keine API-Änderung. Keine Endpoint-Ergänzungen. Keine Schema-Änderungen.
- Kein produktives Deployment. Kein Frontend-Code in dieser Iteration.
- Keine Code-Coverage-Tools in CI (kommt später, eigene Iteration).

## Datenbank-Strategie

**Entscheidung:** `testcontainers-python` startet pro Pytest-Session genau einen `postgres:16-alpine`-Container.

**Begründung:**
- Conventions (`MRD Cluster`) verlangen explizit *"keine Mocks für Datenbank — echte Test-DB"*.
- testcontainers ist Industrie-Standard, gut gepflegt, läuft auf allen relevanten Plattformen (Linux/macOS/Windows mit Docker Desktop).
- Alternative wäre ein dauerhaft laufender Postgres-Container in `docker-compose.test.yml`, den der Entwickler selbst hochfahren muss. Verschiebt Friction zum Entwickler.
- Lokaler Postgres mit fixem Port (5434) wäre fragiler — Konflikte, vergessenes Reset, kein deterministisches Schema.

**Lebenszyklus:**

| Scope | Schritt |
|---|---|
| `session` | Container hochfahren, `alembic upgrade head` ausführen, Engine an die Test-DB binden |
| `function` | Pro Test eine `SAVEPOINT`-basierte Transaktion, die am Ende zurückgerollt wird (sehr schnell, deterministisch) |
| `session` (teardown) | Container stoppen |

Transaktions-Rollback statt Drop-Recreate spart pro Test ~200 ms. Funktioniert für alle Endpunkte; einziger Stolperstein: nested commits (z. B. `register` ruft mehrere `commit` auf). Lösung: alle Endpunkte committen *innerhalb* eines äußeren SAVEPOINTs, den die Fixture aufspannt — siehe SQLAlchemy-Pattern "join external transaction".

## Dependency-Änderungen

`backend/requirements.txt` bleibt schlank für das Production-Image. Test-/Dev-Deps in `backend/requirements-dev.txt`:

```text
-r requirements.txt
pytest==8.3.3
pytest-asyncio==0.24.0
httpx==0.27.2
testcontainers[postgres]==4.8.2
```

`backend/Dockerfile` zieht weiterhin nur `requirements.txt` — kein Bloat im Production-Image.

## Pytest-Konfiguration

Neue Datei `backend/pyproject.toml` (kompatibel mit bestehendem `alembic.ini`):

```toml
[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]
filterwarnings = ["ignore::DeprecationWarning"]
```

`asyncio_mode = "auto"` ersetzt das `@pytest.mark.asyncio`-Boilerplate in jedem Test.

## Conftest-Architektur

`backend/tests/conftest.py`:

```
- pg_container          (session)  → testcontainers PostgresContainer
- engine_url            (session)  → DATABASE_URL aus Container, mit asyncpg-Treiber
- migrate_db            (session)  → alembic upgrade head, einmal
- engine                (session)  → SQLAlchemy AsyncEngine an Test-DB
- db_session            (function) → AsyncSession in äußerer Transaktion + SAVEPOINT
- client                (function) → httpx.AsyncClient mit dependency_overrides für get_db
- registered_user       (function) → erstellt User via /auth/register, gibt User+Tokens zurück
- second_user           (function) → wie registered_user, mit anderer E-Mail (für Tenant-Tests)
```

Die `dependency_overrides`-Magic ersetzt `app.database.get_db` durch eine Funktion, die die Test-Session aus der Fixture liefert. Damit teilen Test-Code und Endpoint-Code dieselbe Transaktion.

## Test-Suite (Soll-Zustand nach Iteration 1)

### Health
- `test_health_returns_ok`

### Auth · Register
- `test_register_creates_user_and_default_presets` — User existiert, 4 Presets mit den korrekten Namen vorhanden
- `test_register_with_existing_email_returns_400`
- `test_register_with_short_password_returns_422`
- `test_register_lowercases_email` — `Test@Example.COM` → gespeichert als `test@example.com`

### Auth · Login
- `test_login_with_valid_credentials_returns_token_pair`
- `test_login_with_wrong_password_returns_401`
- `test_login_with_unknown_user_returns_401`
- `test_login_is_case_insensitive_on_email`

### Auth · /me
- `test_me_without_token_returns_401`
- `test_me_with_invalid_token_returns_401`
- `test_me_with_valid_token_returns_user`

### Auth · Refresh
- `test_refresh_with_valid_token_returns_new_pair`
- `test_refresh_invalidates_old_refresh_token` — alter Token nochmal nutzen → 401 (Rotation-Schutz)
- `test_refresh_with_unknown_token_returns_401`
- `test_refresh_with_revoked_token_returns_401`

### Auth · Logout
- `test_logout_revokes_refresh_token`
- `test_logout_with_unknown_token_succeeds` — bewusst still-success, kein Token-Existenz-Leak

### Presets · CRUD
- `test_list_presets_for_new_user_returns_defaults` — die vier Default-Presets, sortiert
- `test_create_preset_returns_201_and_persisted`
- `test_create_preset_with_duplicate_name_returns_409`
- `test_create_preset_with_invalid_adjustment_value_returns_422` — `exposure: 99` außerhalb `[-5, 5]`
- `test_create_preset_with_extra_field_returns_422` — `extra="forbid"` greift
- `test_update_preset_changes_name_and_adjustments`
- `test_update_unknown_preset_returns_404`
- `test_delete_preset_removes_it`
- `test_delete_unknown_preset_returns_404`
- `test_list_presets_supports_search_query` — `?q=Punc` findet "Punchy"
- `test_list_presets_supports_sort_minus_name` — Sortierung absteigend

### Tenant-Isolation (Conventions-Pflicht)
- `test_user_b_cannot_list_user_a_presets` — User B sieht nur eigene Defaults
- `test_user_b_cannot_get_user_a_preset_by_id` → 404
- `test_user_b_cannot_update_user_a_preset` → 404
- `test_user_b_cannot_delete_user_a_preset` → 404 (User-A-Preset bleibt persistent)

### Schema
- `test_adjustments_schema_matches_pydantic` — `backend/schemas/adjustments.schema.json` und `app.schemas.Adjustments` haben identische Felder, Bereiche, Defaults

## Aufdeckbare Bugs (sehr wahrscheinlich)

Die Tests werden *vermutlich* einen oder mehrere dieser Punkte aufdecken:

1. `register` macht `db.flush()` und dann ohne `try` weitere `db.add(Preset(...))` — wenn der erste Insert mit IntegrityError fliegt, wird `rollback()` korrekt aufgerufen, aber bei einem Adjustments-Validierungsfehler des Default-Presets könnte der User existieren und keine Presets bekommen. → wird durch Test sichtbar.
2. `refresh` rotiert den Token, aber das Issuen geschieht *vor* dem Commit der Invalidierung. Race-bedingt sicher, weil eine Transaktion. Test stellt das sicher.
3. `User.email` hat keinen unique CITEXT-Index — die Spec verlangt das. Aktuell wird im Code `email.lower()` gemacht; das ist eine implementatorische Lösung. Test `test_register_lowercases_email` macht das explizit.

Falls Bugs auftauchen: Im Plan separate Tasks "Bug X fixen", in eigenen Commits nach den Tests, mit Test als Reproducer-Vorlage.

## Akzeptanzkriterien (Definition of Done)

1. `cd backend && pip install -r requirements-dev.txt && pytest -q` läuft nach `git clone` ohne weitere manuelle Schritte und gibt **0 Failures** aus.
2. Test-Suite enthält ≥ 30 Tests, Tenant-Isolation und Refresh-Rotation sind explizit getestet.
3. `requirements.txt` (Production) enthält **keine** Test-Dependencies.
4. `tests/conftest.py` ist dokumentiert (kurzer Modul-Docstring + eine Zeile pro Fixture).
5. `pyproject.toml` mit asyncio-Mode-Auto.
6. Jeder Tests-Commit folgt dem TDD-Zyklus: Test rot → Code grün → Refactor (wo nötig) → Commit.

## Offene Fragen

- **Test-DB-Init-Performance:** `alembic upgrade head` einmal pro Session ist OK. Wenn das später lästig wird, Schema einmal als SQL-Dump cachen und in `pg_container` injecten.
- **Container-Name-Konflikte:** testcontainers vergibt zufällige Namen, kein Problem.
- **CI-Tauglichkeit:** GitHub Actions hat Docker-in-Docker-Limits, aber `services: postgres` als Alternative vorhanden — wenn CI später kommt, evaluieren wir das in eigener Iteration.
