# 02 · Architektur

## Leitprinzip

**Schwergewicht im Browser, Backend bleibt schlank.** Pixel-Daten laufen *niemals* durch die FastAPI — entweder bleiben sie auf dem Client (Standard), oder sie wandern direkt Browser↔Garage S3 via Pre-Signed URL (optionaler Upload, vom User initiiert). Das Backend kennt nur Metadaten, Presets und Image-Listen — nie Pixeldaten. Auth ist komplett ausgelagert an Keycloak.

## Vier-Komponenten-Aufbau (mit externen IdP & Storage)

```
┌──────────────────────────────────────────────────────────┐
│ BROWSER (Client)                                         │
│  ┌────────────────────────────────────────────────────┐  │
│  │ React UI                                           │  │
│  │  - Slider, Histogramm, Preset-Liste, Toolbar       │  │
│  │  - Library/Upload-Panel (optional)                 │  │
│  └────────────────┬───────────────────────────────────┘  │
│                   │ State (Zustand-Store)                │
│  ┌────────────────▼───────────────────────────────────┐  │
│  │ WebGL2 Renderer · libraw-wasm · IndexedDB          │  │
│  └────────────────────────────────────────────────────┘  │
└────────┬─────────┬──────────────────┬────────────────────┘
         │         │                  │
         │         │OIDC              │S3 (Pre-Signed URL)
         │HTTPS    │Code+PKCE         │direkt PUT/GET, NICHT
         │JSON     │                  │ueber Backend
         │         ▼                  ▼
         │   ┌──────────┐       ┌──────────┐
         │   │ Keycloak │       │  Garage  │
         │   │  Realm:  │       │  S3 API  │
         │   │  lumen   │       │  Bucket: │
         │   │          │       │  lumen-  │
         │   │ JWK-Set  │       │  images  │
         │   └────┬─────┘       └──────────┘
         │        │JWK-Set
         ▼        │intern
┌──────────────────▼───────────────────────────────────────┐
│ BACKEND (FastAPI · Resource Server)                      │
│  - JWT-Verifikation gegen Keycloak-JWK-Set               │
│  - /presets       (GET, POST, PUT, DELETE)               │
│  - /images        (POST init, POST confirm, GET list,    │
│                    GET :id/url, DELETE)                  │
│  - /me            (Profil aus Token + lokaler users-Row) │
│  Kein /auth/register, kein /auth/login mehr.             │
└──────────────────────────┬───────────────────────────────┘
                           │ asyncpg
                           ▼
┌──────────────────────────────────────────────────────────┐
│ PostgreSQL                                               │
│  - users      (keycloak_sub, email — Spiegel)            │
│  - presets    (adjustments JSONB, user_id FK)            │
│  - images     (bucket_key, content_type, size,           │
│                upload_state, user_id FK)                 │
└──────────────────────────────────────────────────────────┘
```

Siehe `diagramme/architektur.mmd` für die aktualisierte Mermaid-Variante.

## Frontend-Stack

| Schicht | Technologie | Begründung |
|---|---|---|
| UI-Framework | React 19 | Aktueller Stable-Major (Nov 2024), Concurrent-Features default |
| Build-Tool | Vite 8 | Schnellster DX, native ES-Module, perfekt für WebGL-Projekte |
| Styling | Tailwind CSS 4 | v4 ohne `tailwind.config.js`, `@theme`-Direktiven im CSS |
| State | Zustand (ab Iteration 3) | Schlank, keine Boilerplate, perfekt für Slider-State |
| Routing | React Router 7 (Library Mode) | Nur 5 Routen nötig: /, /login, /register, /editor, /account |
| Image-Pipeline | WebGL2 (raw, kein three.js) | Voll Kontrolle über Shader, keine Overhead-Lib |
| RAW-Decoding | libraw-wasm | Einzige reife WASM-Lösung, läuft offline |
| HTTP-Client | fetch + leichte Wrapper | Kein axios nötig |
| Test | Vitest 4 + React Testing Library | Vite-nativ |
| Sprache | TypeScript 6 (strict, `noUncheckedIndexedAccess`) | Compile-Zeit-Sicherheit, kein `any` |

## Backend-Stack

| Schicht | Technologie | Begründung |
|---|---|---|
| Web-Framework | FastAPI 0.136 | Async, OpenAPI out-of-box |
| ORM | SQLAlchemy 2.0 (async) | Standard, Migrations via Alembic |
| Migrations | Alembic 1.18 | Zwingend bei JSONB-Schema-Evolution |
| Auth (Resource Server) | `python-jose` (JWK-Verifikation) | Verifiziert Tokens gegen Keycloak — kein eigenes Hashing/Issuing mehr |
| Auth (IdP) | **Keycloak 26** (externer Container, eigener Realm `lumen`) | Cluster-Konvention, SSO-fähig, OIDC-Standard |
| Storage (extern) | **Garage S3 v1.x** (externer Container, Bucket `lumen-images`) | Cluster-Konvention, S3-API, Pre-Signed URLs |
| S3-Client | `aioboto3` oder `boto3` (sync, da nur URL-Generierung) | Standard-AWS-SDK, funktioniert mit Garage |
| DB | PostgreSQL 16 | JSONB für Adjustments, GIN-Indizes bei Bedarf |
| Validierung | Pydantic v2 | FastAPI-nativ |
| Deployment | Docker Compose | Lokal eigenständig, Production als Add-On im `caddy-proxy`-Network |
| Reverse-Proxy | **Caddy** (Cluster-extern, geteilt) | Cluster-Konvention, TLS via Let's Encrypt out-of-box |

## Datenflüsse

### Bild-Bearbeitung (rein clientseitig, unverändert)

1. User wählt Datei → `File`-Objekt
2. Bei JPEG/PNG: `Image`-Element → `gl.texImage2D`
3. Bei RAW: `libraw.open(buffer)` → `Uint8Array` (RGB) → `gl.texImage2D`
4. User bewegt Slider → State-Update → Shader-Uniform-Update → `gl.drawArrays`
5. Histogramm: `canvas.getContext('2d').drawImage(canvas, ...)` → `getImageData` → CPU-Bins
6. Export: `canvas.toBlob('image/jpeg', quality)` → Download (lokal)

### Preset speichern (Auth via Keycloak-JWT)

```
Browser                    Backend                     DB
   │                          │                         │
   │ POST /presets            │                         │
   │ { name, adjustments }    │                         │
   │ Authorization: Bearer    │                         │
   │   <Keycloak-Access-JWT>  │                         │
   ├─────────────────────────▶│                         │
   │                          │ JWT verifizieren        │
   │                          │ via JWK-Set (cached)    │
   │                          │ INSERT INTO presets ... │
   │                          ├────────────────────────▶│
   │                          │ ◀── PresetRow ──────────┤
   │ ◀── 201 PresetOut ───────┤                         │
```

### Auth-Flow (OIDC Authorization Code + PKCE)

```
1. User klickt "Login" im Frontend
2. Browser redirect → https://auth.<domain>/realms/lumen/.../auth?
                       client_id=lumen-frontend
                       response_type=code
                       code_challenge=<PKCE>
                       redirect_uri=https://lumen.<domain>/callback
3. Keycloak: Login-Screen, User authentifiziert sich, Keycloak setzt
   Session-Cookie und redirected zurueck zum Frontend mit ?code=...
4. Frontend tauscht Code gegen Token-Pair beim Keycloak-Token-Endpoint
   (PKCE-Verifier mitschicken, kein Client-Secret im Frontend).
5. Frontend speichert Access-Token in Memory, Refresh in
   sessionStorage (oder iframe-basiert via react-oidc-context).
6. Fuer alle Backend-Calls: Authorization: Bearer <access>.
7. Bei Token-Expiry: Silent Refresh via Keycloak (iframe oder
   refresh-token-Endpoint, abhaengig von der OIDC-Library).
```

**Backend-seitig:** kein `/auth/*`-Endpoint mehr. JWT-Verifikation erfolgt in einer FastAPI-Dependency `current_user`, die das `Authorization: Bearer ...`-Header gegen das Keycloak-JWK-Set prüft (gecached für 10 min). User wird aus dem `sub`-Claim abgeleitet, beim ersten Auftreten eine Row in der lokalen `users`-Tabelle angelegt (Just-in-Time-Provisioning).

### Image-Upload-Flow (Browser↔Garage direkt)

```
Browser                    Backend                  Garage
   │                          │                       │
   │ POST /images             │                       │
   │ { filename, type, size } │                       │
   │ Authorization: Bearer    │                       │
   ├─────────────────────────▶│                       │
   │                          │ users-Row aus JWT     │
   │                          │ INSERT image-Row      │
   │                          │  (state=pending)      │
   │                          │ pre-signed PUT-URL    │
   │                          │ generieren (15 min)   │
   │ ◀── ImageInit (id+url) ──┤                       │
   │                          │                       │
   │ PUT <pre-signed-url>     │                       │
   │ binary                   │                       │
   ├──────────────────────────────────────────────────▶│
   │ ◀────────────── 200 ──────────────────────────────│
   │                          │                       │
   │ POST /images/:id/confirm │                       │
   ├─────────────────────────▶│                       │
   │                          │ HEAD object via       │
   │                          │ S3-API (existiert?)   │
   │                          ├──────────────────────▶│
   │                          │ ◀── 200 + size ───────┤
   │                          │ image-Row state=ready │
   │ ◀── 200 ImageOut ────────┤                       │
```

Zugriff (GET) analog: Backend liefert pre-signed GET-URL, Browser holt direkt von Garage.

## Deployment-Architektur

Lumen läuft als Add-On in einem bestehenden Cluster mit geteiltem **`caddy-proxy`-Network**. Konkretes Ziel-Setup ist `MRD Production` (IONOS VPS), siehe `docs/arc42/07-deployment.md` für Details.

```
              Cluster (z. B. MRD Production VPS)
   ┌──────────────────────────────────────────────────────┐
   │  caddy-proxy network                                 │
   │   ┌──────────────────┐                               │
   │   │  caddy           │  TLS: Let's Encrypt           │
   │   │  Caddyfile       │                               │
   │   └─┬────────┬─────┬─┘                               │
   │     │        │     │                                 │
   │     │        │     │                                 │
   │ lumen-api  lumen-  keycloak  garage  …weitere Apps   │
   │  :4100     web:80  :8080     :3900                   │
   │     │        │     │           │                     │
   │     ▼        │     │           │                     │
   │  lumen-db    │     ▼           │                     │
   │  postgres    │ keycloak-db     │                     │
   │              │ postgres        │                     │
   │              │                 │                     │
   └──────────────┼─────────────────┼─────────────────────┘
                  │                 │
                  ▼                 ▼
            statisch            S3-API extern
            nur Browser         pre-signed URLs
```

Caddy übernimmt:
- TLS für `lumen.mr-development.de`, ggf. `auth.mr-development.de`
- `/api/v1/*` → `lumen-api:4100`
- Rest → `lumen-web:80` (statisches Vite-Build via nginx-Container)
- Optional pro Realm eigene Subdomain für Keycloak (sonst geteilt mit anderen MRD-Apps)

**Container-Aliase** (Pflicht im Cluster):
- `docker network connect --alias lumen-api caddy-proxy lumen-api`
- `docker network connect --alias lumen-web caddy-proxy lumen-web`

**Watchtower** ist Cluster-weit zentral (nicht pro Projekt).

## Skalierung (sofern jemals nötig)

Für 1.000 aktive User reicht der oben skizzierte Single-Node-Deployment problemlos. Bei höherer Last:
- Postgres als Managed Service (Hetzner, Neon, Supabase)
- FastAPI horizontal skalieren über Load Balancer
- Frontend-Statics auf CDN

Da Pixel-Daten nie zum Backend wandern, ist das Skalierungs-Profil sehr entspannt.

## Sicherheit

- **Passwörter:** *keine* mehr im Lumen-Code — Keycloak handhabt Passwort-Speicherung, MFA, Recovery zentral.
- **JWT:** RS256 (Keycloak-default), Public Key kommt vom JWK-Set des Keycloak-Realms. Backend cached Schlüssel 10 min.
- **PKCE im Frontend:** Authorization Code Flow + PKCE — kein Client-Secret im Browser.
- **CORS:** Whitelist auf die Frontend-Origin (Env-Variable `CORS_ORIGIN`).
- **Rate Limiting:** Caddy `limit_req` (clusterweit) + Keycloak hat eigene Brute-Force-Schutzmechanismen.
- **HTTPS:** erzwungen, HSTS-Header (Caddy default).
- **CSP:** streng, kein inline-script (Vite-Build erzeugt Hash-basierte Imports).
- **Pre-Signed URLs:** kurze Lebensdauer (15 min), enge Bedingungen (Bucket-Prefix, Content-Type, Max-Size).
- **DB-Backups:** täglich via `pg_dump` für Lumen + Keycloak, separate Backups, gemeinsame Off-Site-Strategie (cluster-weit).
- **Garage-Backups:** Garage hat eigene Replication; Bucket-Snapshots optional.
