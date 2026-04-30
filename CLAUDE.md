# Lumen · light

Browser-RAW-Editor (Lightroom-Alternative). Selfhost auf IONOS-VPS,
privat. FastAPI + React 19/WebGL2, Keycloak, Postgres, Garage S3.

## Stack hochfahren

```bash
# 1. Postgres + Keycloak + MinIO (statt Garage in dev)
docker compose -f deployment/docker-compose.dev.yml up -d
# Wartet bis Keycloak ready
until curl -fs http://localhost:19000/health/ready >/dev/null; do sleep 2; done

# 2. Migrations
cd backend && DATABASE_URL="postgresql+asyncpg://lumen:lumen@localhost:5433/lumen" \
  .venv/bin/alembic upgrade head

# 3. Backend
DATABASE_URL="postgresql+asyncpg://lumen:lumen@localhost:5433/lumen" \
KEYCLOAK_ISSUER="http://localhost:18080/realms/lumen" \
KEYCLOAK_AUDIENCE="lumen-api" \
GARAGE_S3_ENDPOINT="http://localhost:9000" GARAGE_S3_REGION="us-east-1" \
GARAGE_S3_BUCKET="lumen-images" \
GARAGE_S3_ACCESS_KEY_ID="minioadmin" GARAGE_S3_SECRET_ACCESS_KEY="minioadmin" \
CORS_ORIGIN="http://localhost:5173" \
.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000

# 4. Frontend (anderes Terminal)
cd frontend && pnpm dev   # http://localhost:5173
```

`frontend/.env.example` → `.env.local` kopieren (KC + API_BASE).

## Test-User in Keycloak

```bash
TOKEN=$(curl -s -X POST http://localhost:18080/realms/master/protocol/openid-connect/token \
  -d "username=admin&password=admin&grant_type=password&client_id=admin-cli" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")
curl -X POST http://localhost:18080/admin/realms/lumen/users \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"username":"manuel","email":"manuel@local.test","enabled":true,
       "emailVerified":true,"requiredActions":[],
       "credentials":[{"type":"password","value":"lumen","temporary":false}]}'
```

Login mit `manuel@local.test` / `lumen` — der Realm hat
`registrationEmailAsUsername=true`, also wird die Email zum Username.

## Tests

```bash
# Backend (testcontainers für PG + MinIO + Keycloak — Docker muss laufen)
cd backend && .venv/bin/pytest -q

# Frontend Unit/Component
cd frontend && pnpm test

# Frontend E2E (Stack muss komplett laufen)
cd frontend && pnpm exec playwright test

# Lint + Build
cd frontend && pnpm lint && pnpm build
cd frontend && pnpm exec tsc -b --noEmit
```

`LUMEN_RATELIMIT_DISABLED=1` ist im backend `conftest.py` automatisch
gesetzt — pytest läuft sonst gegen 429er.

## Architektur

- **backend/** — FastAPI, async SQLAlchemy 2 + asyncpg, Alembic. Auth
  via Keycloak-JWT (Whitelist `RS256`). S3 via boto3. Pre-Signed PUTs
  für Bild-Uploads (Pixel laufen NICHT durch FastAPI). Rate-Limit via
  slowapi (`@limiter.limit`).
- **frontend/** — React 19 + Vite 8 + TypeScript strict +
  noUncheckedIndexedAccess. WebGL2-Pipeline in einem Fragment-Shader
  mit Uniform-Arrays für Multi-Mask. Zustand 5 für State.
  react-oidc-context für OIDC.
- **deployment/** — `docker-compose.dev.yml` (PG + KC + MinIO),
  `docker-compose.prod.yml` (db + api + web hinter Caddy-Proxy auf VPS).
- **docs/** — `01-konzept.md` bis `08-risiken-offene-fragen.md`,
  `06-roadmap.md` zeigt Iterationsstand.
- **docs/superpowers/specs/** — pro Iteration eine Spec.
- **docs/superpowers/plans/** — Implementierungs-Pläne.

## Schlüssel-Dateien

| Pfad | Inhalt |
|------|--------|
| `backend/app/auth.py` | JWT-Verify (PyJWT, RS256-Whitelist), JIT-User-Provisioning + 10 Default-Presets (Neutral/Punchy/Soft/SW + 6 Genre-Presets) |
| `backend/app/schemas.py` | Adjustments, Mask-Discriminated-Union, `MAX_LINEAR_MASKS=4`, `MAX_RADIAL_MASKS=4`. `extra="forbid"` überall |
| `backend/app/rate_limit.py` | slowapi-Limiter (SHA-256-Token-Hash-Key, IP-Fallback). `LUMEN_RATELIMIT_STORAGE` ueber env auf Redis-URI fuer Multi-Worker-Setups |
| `backend/alembic/versions/` | 001_initial → 002_keycloak → 003_images → 004_preset_masks → 005_marketplace → 006_preset_reports_set_null → 007_admin_feedback |
| `backend/app/routers/admin.py` | Admin-Endpoints (Users-Liste/Disable, Stats, Feedback-Inbox + PATCH). Gating via `current_admin` Dep |
| `backend/app/routers/feedback.py` | User-Feedback-Submit. Honeypot `website` (silent drop), Rate-Limit 5/h |
| `frontend/src/auth/useIsAdmin.ts` | Realm-/Resource-Access-Roles aus dem OIDC-Profile. `RequireAdmin` schuetzt `/admin` |
| `frontend/src/pages/Admin.tsx` | Tabs Users + Feedback, Stats-Strip oben |
| `frontend/src/components/FeedbackDialog.tsx` | Header-Button-getriggert, Honeypot a11y/visuell versteckt |
| `frontend/e2e/{auth,keycloak,api}-helper.ts` | E2E-Helpers: `loginAsNewUser`, `assignAdminRole`, `apiTokenFor` (ROPC), `seedPublishedPreset`. **Auth-Tests brauchen `await context.clearCookies()` in `beforeEach`** — KC-Session leakt sonst zwischen Tests. Realm-Roles VOR erstem Login zuweisen (Token-Roles-Liste ist fix bis Cookie-Clear + Re-Login). |
| `backend/app/routers/marketplace.py` | F1: 7 Endpunkte (list, detail, apply, fork, report, profile, published-presets), Atomic-Increment, Auto-Hide bei 3 Reports, Cursor-Validation MAX_CURSOR_OFFSET=10000 |
| `backend/app/schemas.py` | `CAMEL_BASE_CONFIG`/`CAMEL_OUT_CONFIG` mit `serialize_by_alias=True` — alle Wire-Keys camelCase, Eingang akzeptiert beide |
| `infra/keycloak/lumen-realm.json` | Dev-Realm: ROPC + verifyEmail off (Tests). Prod nutzt `lumen-realm.prod.json` (gehaertet) |
| `infra/caddy/lumen.caddyfile` | Prod-Snippet: CSP, HSTS-preload, Permissions-Policy, /docs Block |
| `frontend/src/editor/shaders.ts` | Fragment-Shader mit `MAX_LINEAR_MASKS = 4` und `MAX_RADIAL_MASKS = 4` (Schema-Sync-Test prüft) |
| `frontend/src/editor/store.ts` | Zustand-Store inkl. Undo/Redo (history-Snapshot debounced 250ms) |
| `frontend/src/editor/mask.ts` | Linear-/Radial-Typen, Limits-Konstanten — Single Source |
| `frontend/src/editor/Canvas.tsx` | Renderer-Mount, `takeBypassSnapshot()` für Compare-Split |
| `frontend/src/editor/lensProfile.ts` | 18 Lens-Profile aus `infra/lensfun/profiles.json` |
| `frontend/src/editor/EditorToolbar.tsx` | Untere Action-Bar (Bypass/Crop/Auto-Tone/Auto-WB/Compare/WB-Picker/Zoom/Undo/Redo + Mask + Help/Presets/Marketplace/Export) |
| `frontend/src/editor/EditorBanners.tsx` | 4 absolute Banners: Fehler, Decoding, Smart-Suggestion, Camera-Info |
| `frontend/src/editor/EditorOverlayCanvas.tsx` | Canvas + Pan/Zoom-Transform + 4 Overlays (Crop/Linear/Radial/Compare-Split) |
| `frontend/src/editor/HslPanel.tsx` | E1: 3 Achsen-Tabs (Hue/Sat/Lum) × 8 Farbkanal-Slider |
| `frontend/src/editor/ToneCurvePanel.tsx` | E2: SVG-200x200 Spline-Editor mit Drag-Punkten |
| `frontend/src/editor/toneCurve.ts` | Monotone Cubic Hermite + 256-Eintrag-LUT, Tangenten-Cache via WeakMap |
| `frontend/src/editor/autoStraighten.ts` | E5: Sobel + Hough-Voting fuer Tilt-Korrektur |
| `frontend/src/editor/faceDetector.ts` | E4: Lazy-loadende TF.js Face-Detection mit Consent-Gate |
| `frontend/src/editor/consent.ts` | DSGVO Consent-Toggles (Modul-Cache + localStorage) |
| `frontend/src/pages/Marketplace.tsx` | F1: Public-Preset-Browser mit Filter/Sort/Pagination + Detail-Modal |
| `frontend/src/pages/Editor.tsx` | Orchestrator, ~640 Zeilen. Sidebar/Toolbar/Banners/OverlayCanvas extrahiert |

## Code-Style

- **Backend Python**: Pydantic 2 mit `model_config = ConfigDict(extra="forbid")` auf In-Schemas. SQLAlchemy 2 declarative (Mapped[]). Typing strikt. Tests mit testcontainers, function-scope-Engine + SAVEPOINT-Rollback.
- **Frontend TS**: kein `any`, kein non-null assertion ohne Grund. ESLint mit `react-hooks/refs` und `no-unsafe-*`. Imports sortiert (lokal alphabetisch nach Modul). Comments deutsch ohne Umlaute.
- **Tests**: Beschreibung in deutsch ohne Umlaute (z.B. „Belichtung wird geklemmt"). `data-testid` ist die stabile Test-API.
- **UI-Strings (User-sichtbar) MIT echten Umlauten** — `ä`, `ö`, `ü`, `ß`, `Ä`, `Ö`, `Ü`. Betrifft JSX-Text, `title=`, `aria-label`, `placeholder`, Toast-Texts, Error-Messages an User. Code-Comments und Test-Beschreibungen bleiben ohne Umlaute. Faustregel: Wenn der String im Browser angezeigt wird, gehoeren echte Umlaute rein.

## Wireformat

- **Komplett camelCase** (D4 erledigt). Pydantic-Attribute bleiben
  snake_case, `alias_generator=to_camel` + `serialize_by_alias=True`
  in `CAMEL_BASE_CONFIG`/`CAMEL_OUT_CONFIG` mappen sie. Eingang
  akzeptiert via `populate_by_name=True` weiterhin Snake-Case
  (Backwards-Compat fuer alte Clients).
- Frontend-Typen in `src/api/client.ts` sind 1:1 camelCase.

## Gotchas

- **Schema-Drift**: `MAX_LINEAR_MASKS=4`, `MAX_RADIAL_MASKS=4`,
  `HSL_CHANNELS=8`, `DISTORTION_GAIN`, `VIGNETTE_GAIN` leben in
  TS-Modulen UND als GLSL-Literal. Sync-Test in
  `frontend/tests/shader-limits-sync.test.ts`.
- **`pnpm exec` braucht `cwd=frontend/`**: aus dem Repo-Root kommt
  `ERR_PNPM_RECURSIVE_EXEC_NO_PACKAGE`. `cd frontend && pnpm exec ...`.
- **localStorage in vitest ist flaky**: Module-Level-Variable als
  primaere Wahrheit + localStorage als Sync-Backup (siehe `consent.ts`
  `cachedConsent`-Pattern). `setItem` in `beforeEach` greift nicht
  zuverlaessig im naechsten Test.
- **WebGL-Tests in jsdom**: Canvas-getContext fehlt. Pure-Funktion
  schreiben, die einen RGBA-`Uint8Array` nimmt (siehe
  `autoStraighten.ts:analyzeStraightenAngle`) — Tests benutzen
  synthetische Buffer ohne OffscreenCanvas.
- **`@typescript-eslint/unbound-method` mit `vi.fn()`**: wenn ein Mock
  ueber Spread an einen ApiClient-Method-Slot gebunden wird, lint
  meckert. Fix: in der FakeApi-Interface die jeweilige Method als
  `: Mock` typisieren statt von ApiClient erben.
- **Mediapipe ESM-Bundling**: `@mediapipe/face_detection` ist UMD-only
  und bricht Rolldown. Vite-`resolve.alias` auf
  `src/editor/__shims__/mediapipe-face-detection-shim.ts`; TF.js-Runtime
  macht den Mediapipe-Pfad ohnehin nicht aktiv.
- **Crop-Output-Pipeline**: Canvas-Groesse = `imageDims × cropSize`
  (in `Renderer.render` via `outputSize`-Parameter, sonst wird das Crop
  gestreckt). Mask-Overlays speichern Mask-UV im Source-System;
  Drag/Anzeige laufen via `forwardUvTransform` /
  `invertUvTransform` aus `transform.ts`.
- **Bildschirmfoto*.png im Repo-Root** ist gitignored — bei `git add -A`
  trotzdem aufpassen, dass keine versehentlichen Screenshots reinrutschen.
- **Adjustments-Form**: 10 numerische Slider plus `hsl: HslAdjustments
  | null`. `Object.values(adjustments)` enthaelt daher `null` —
  ueber `ADJUSTMENTS` iterieren oder `hsl` separat behandeln. `null`
  bedeutet HSL inaktiv (spart 24 Felder im Preset-JSONB).
- **GLSL-Loop-Bound**: Const-Loop-Bound `MAX_*_MASKS` mit
  `if (i >= u_num*) break;` als uniform-driven Early-Termination —
  GLSL ES 3.00-konform. Nicht ändern auf dynamic loop bound.
- **Keycloak-Realm**: `registrationEmailAsUsername=true` macht aus
  Username automatisch die Email. `directAccessGrantsEnabled=true` ist
  für Tests an, sollte vor Public-Launch aus.
- **Pre-Signed PUT**: keine Content-Length-Constraint im URL —
  `confirm_upload` muss daher gegen `max_image_size_bytes` prüfen +
  Object löschen + DB-Row weg + 413 (siehe `backend/app/routers/images.py`).
- **Histogram-Readback** im Frontend nutzt `OffscreenCanvas` +
  `drawImage()` auf das WebGL-Canvas — funktioniert weil Renderer mit
  `preserveDrawingBuffer: true` läuft.
- **Sidebar-Section-State** in `localStorage.lumen.section.<id>`
  persistiert pro User-Browser. E2E-Tests müssen Sections via
  `${testId}-toggle` klicken, falls collapsed-by-default.
- **Genre-Default-Presets**: 10 Stück werden beim JIT-Provisioning
  angelegt. Bestehende User bekommen sie nicht nachträglich — nur über
  manuellen `POST /presets`. Sync-Endpoint ist Backlog.
- **WebGL-Compile-Time**: bei Shader-Änderungen kann der Renderer
  beim ersten Image-Load crashen. Browser-Devtools-Console gibt
  `WebGLRendererError` mit GLSL-Log aus.
- **Pydantic EmailStr und Test-User**: `EmailStr` lehnt special-use-TLDs
  (`.local`, `.test`, `.invalid`) ab. Wenn Legacy-Test-User mit
  `@test.local` in der DB stehen, bricht Output-Validation. Fix: `str`
  statt `EmailStr` in Out-Schemas (z.B. `AdminUserOut.email`,
  `FeedbackOut.userEmail`); Validation am Token-Decode reicht.
- **Keycloak-Realm-Roles im access_token**: `realm_access.roles` und
  `resource_access.<client>.roles` stehen im **Access-Token**, nicht im
  ID-Token. `auth.user.profile` (oidc-context) ist der ID-Token —
  Frontend-Role-Checks muessen `auth.user.access_token` decoden (siehe
  `useIsAdmin.ts`). Backend dekodiert ohnehin den access_token, also
  kein Drift.
- **react-hooks/set-state-in-effect**: ESLint blockt `setState` im
  `useEffect`-Body. Ersatz: lazy `useState(() => init())`, `useMemo`
  fuer derived state, oder Parent-Unmount via `{open && <X/>}` statt
  `open`-Prop. Beispiel: `OnboardingTour` wird vom Editor unmountet
  statt intern via `open`-Prop reset.
- **JSX + deutsche „..."-Quotes**: ASCII-`"` als Closing-Quote
  terminiert JS-Strings. In JSX-Text geht's, in JS-String-Literalen
  nutze U+201C (`"`) oder ASCII-single-quotes als Workaround.
- **Overlay-pointer-events**: Vollbild-Wrapper (Tour, Spotlight)
  muessen `pointer-events: none` sein und nur die Tooltip-/Modal-
  Karten `pointer-events: auto` setzen — sonst blockiert der Wrapper
  Klicks aufs hervorgehobene Target.

## Workflow

- **Iteration starten**: Spec in `docs/superpowers/specs/YYYY-MM-DD-<thema>-design.md`, optional Plan in `docs/superpowers/plans/`. Roadmap-Eintrag in `docs/06-roadmap.md` aktualisieren.
- **Commit-Style**: Conventional `feat()`/`fix()`/`refactor()`/`docs()`/`chore()`. Co-Author-Trailer für Claude-Sessions.
- **Reviews**: Code/Security/DSGVO/UX-Reviews dispatched parallel via Agent-Tool, Findings in einem zentralen Plan zusammengeführt.
- **Vor Push** an Production-Stack: `pnpm build && pnpm lint && pnpm test && pnpm exec tsc -b --noEmit` und `pytest -q` müssen grün.
- **Repo-Setup**: `gh repo create lumen-light --private --source . --push --description "..."` macht Init+Push in einem Schritt.

### Lokales Stack-Hochfahren

- `docker ps --filter "name=postgres"` checken, ob Port 5433 frei ist.
  Konflikt mit `aum-postgres-dev` (anderes Projekt) ist haeufig:
  `docker stop aum-postgres-dev` plus `docker compose -f deployment/docker-compose.dev.yml up -d --force-recreate postgres` repariert verlorene Port-Bindings.
- **Backend-uvicorn ohne `--reload`**: nach Schema-Aenderungen
  manuell neu starten, sonst alte OpenAPI/Endpoints. Quick-Check:
  `curl -s localhost:8000/openapi.json | python3 -c "import sys,json; print(sorted(json.load(sys.stdin)['paths']))"`.

### Env-Toggles

- `LUMEN_ENV=production` (in `docker-compose.prod.yml` gesetzt) blendet `/docs`, `/openapi.json`, `/redoc` aus.
- `LUMEN_RATELIMIT_STORAGE=redis://lumen-redis:6379/0` schaltet slowapi auf gemeinsamen Counter ueber alle Worker. Default `memory://` = single-worker-only.
- `LUMEN_RATELIMIT_DISABLED=1` schaltet slowapi komplett aus (Backend-Tests).
- `KEYCLOAK_ADMIN_CLIENT_ID` + `KEYCLOAK_ADMIN_CLIENT_SECRET` aktivieren den Service-Account-Pfad in `delete_me`. Leer = KC-Account bleibt nach `DELETE /me` stehen (Best-effort, kein 5xx).
- Service-Worker registriert nur in PROD-Build (`import.meta.env.PROD`); Dev frisst sonst den Vite-Hot-Reload.

### Janitor-Cron (Production)

`python -m scripts.janitor [TTL_MINUTES]` raeumt pending Uploads aelter als TTL aus DB+S3. Empfohlen alle 5 min im Production-Cluster. Stdout = einzeilige JSON-Statistik fuer Cron-Logging.

## Production-Cluster

VPS auf IONOS (siehe globales CLAUDE.md, MRD-Cluster-ID). Caddy-Network
`caddy-proxy` ist extern. `deployment/docker-compose.prod.yml` baut
backend + web. Keycloak + Garage laufen separat im Cluster (cross-
project shared).

CI: `.github/workflows/ci.yml` — frontend lint/typecheck/vitest/build +
backend pytest. E2E nicht in PR-Pipeline (Stack-Compose dauert).

## Aktueller Stand

- **Phase E komplett**: HSL (E1), Tonkurve (E2), Sharpening + Noise (E3), Face-Detection (E4, opt-in), Auto-Straighten (E5).
- **Phase F1 komplett**: Preset-Marketplace mit Backend (Migration 005, 7 Endpunkte, Auto-Hide), Frontend (Marketplace-Page, Detail-Modal, PresetDialog-Publish-Toggle, Account-Profil + veroeffentlichte Presets).
- **Phase D durch**: D1 (EditorToolbar/Banners/OverlayCanvas), D2 (LocalAdjBuffers), D4 (Wireformat camelCase), D6 (Component-Tests).
- **Reviews abgeschlossen**: Security/DSGVO/Code/UI-UX. Critical + High + Medium-Items umgesetzt.
- **Tests**: 122 backend pytest, 312 frontend vitest, lint + build sauber.
- **Admin & Feedback (MVP)**: `/admin` mit Users + Feedback-Inbox; Header-Feedback-Dialog mit Honeypot. Realm `admin`-Rolle muss in KC einem User zugewiesen werden, damit der Backend-`current_admin`-Dep durchlaesst.

## Offene Backlog-Items (vor public-Launch nochmal pruefen)

- **Pre-Signed-POST mit Content-Length-Range** (Sec High, ohne User nicht eilig) — heutiger Pfad: HEAD-Check + Cleanup im `confirm_upload` deckt den Worst-Case (Bucket-Overflow) ab. Vor Multi-Tenant-Live noch einen Janitor-Cron einbauen, der `images` mit `upload_state='pending' AND created_at < now()-15min` plus zugehoerige S3-Objekte loescht.
- **DELETE /me Keycloak-Account** (DSGVO High) — heute werden nur App-Daten geloescht, der KC-Account bleibt; Datenschutz-Hinweis ist drin. Sauberer Fix: Service-Account-Setup + Admin-API-Call.
- **E2E-Test fuer Marketplace** — Stack-Compose-Setup ausstehend.
