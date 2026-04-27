# 02 · Architektur

## Leitprinzip

**Schwergewicht im Browser, Backend bleibt schlank.** Bilder verlassen den Client nicht für die Bearbeitung. Das Backend kennt nur Metadaten und Presets, niemals Pixeldaten. Das macht den Server klein, billig zu hosten und minimiert Datenschutz-Risiken.

## Drei-Schichten-Aufbau

```
┌──────────────────────────────────────────────────────────┐
│ BROWSER (Client)                                         │
│  ┌────────────────────────────────────────────────────┐  │
│  │ React UI                                           │  │
│  │  - Slider, Histogramm, Preset-Liste, Toolbar       │  │
│  └────────────────┬───────────────────────────────────┘  │
│                   │ State (Zustand-Store)                │
│  ┌────────────────▼───────────────────────────────────┐  │
│  │ WebGL2 Renderer                                    │  │
│  │  - Shader-Pipeline (FRAG_SRC)                      │  │
│  │  - Texture-Upload, Framebuffer-Readback            │  │
│  └────────────────┬───────────────────────────────────┘  │
│  ┌────────────────▼───────────────────────────────────┐  │
│  │ Image Source                                       │  │
│  │  - JPEG/PNG via Browser-Decoder                    │  │
│  │  - RAW via libraw-wasm (Phase 3)                   │  │
│  └────────────────┬───────────────────────────────────┘  │
│  ┌────────────────▼───────────────────────────────────┐  │
│  │ IndexedDB (lokaler Cache)                          │  │
│  │  - Dekodierte RAWs (vermeidet Re-Decode)           │  │
│  │  - Letzte Session                                  │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────┬───────────────────────────────┘
                           │ HTTPS / JSON
                           │ Auth: JWT in Authorization-Header
                           ▼
┌──────────────────────────────────────────────────────────┐
│ BACKEND (FastAPI)                                        │
│  - /auth/register, /auth/login, /auth/refresh            │
│  - /presets (GET, POST, PUT, DELETE)                     │
│  - /me (User-Profil)                                     │
└──────────────────────────┬───────────────────────────────┘
                           │ asyncpg
                           ▼
┌──────────────────────────────────────────────────────────┐
│ PostgreSQL                                               │
│  - users                                                 │
│  - presets (adjustments JSONB)                           │
└──────────────────────────────────────────────────────────┘
```

Siehe `diagramme/architektur.mmd` für die Mermaid-Variante.

## Frontend-Stack

| Schicht | Technologie | Begründung |
|---|---|---|
| UI-Framework | React 18 | Bekannt, breite Ökosystem, du arbeitest schon damit |
| Build-Tool | Vite | Schnellster DX, native ES-Module, perfekt für WebGL-Projekte |
| Styling | Tailwind CSS | Du nutzt es bereits, passt zum Komponenten-Workflow |
| State | Zustand | Schlank, keine Boilerplate, perfekt für Slider-State |
| Routing | React Router | Nur 2–3 Routen nötig: /, /editor, /login |
| Image-Pipeline | WebGL2 (raw, kein three.js) | Voll Kontrolle über Shader, keine Overhead-Lib |
| RAW-Decoding | libraw-wasm | Einzige reife WASM-Lösung, läuft offline |
| HTTP-Client | fetch + leichte Wrapper | Kein axios nötig |
| Test | Vitest + React Testing Library | Vite-nativ |

## Backend-Stack

| Schicht | Technologie | Begründung |
|---|---|---|
| Web-Framework | FastAPI | Async, OpenAPI out-of-box, du nutzt es schon |
| ORM | SQLAlchemy 2.0 (async) | Standard, Migrations via Alembic |
| Migrations | Alembic | Zwingend bei JSONB-Schema-Evolution |
| Auth | JWT mit `python-jose` + `bcrypt` | Schlank, stateless |
| DB | PostgreSQL 16 | JSONB für Adjustments, GIN-Indizes bei Bedarf |
| Validierung | Pydantic v2 | FastAPI-nativ |
| Deployment | Docker Compose | Passt zu deiner VPS-Strategie |
| Reverse-Proxy | Nginx | TLS-Terminierung, statische Frontend-Auslieferung |

## Datenflüsse

### Bild-Bearbeitung (rein clientseitig)

1. User wählt Datei → `File`-Objekt
2. Bei JPEG/PNG: `Image`-Element → `gl.texImage2D`
3. Bei RAW: `libraw.open(buffer)` → `Uint8Array` (RGB) → `gl.texImage2D`
4. User bewegt Slider → State-Update → Shader-Uniform-Update → `gl.drawArrays`
5. Histogramm: `canvas.getContext('2d').drawImage(canvas, ...)` → `getImageData` → CPU-Bins
6. Export: `canvas.toBlob('image/jpeg', quality)` → Download

### Preset speichern

```
Browser                    Backend                     DB
   │                          │                         │
   │ POST /presets            │                         │
   │ { name, adjustments }    │                         │
   │ Authorization: Bearer..  │                         │
   ├─────────────────────────▶│                         │
   │                          │ INSERT INTO presets ... │
   │                          ├────────────────────────▶│
   │                          │                         │
   │                          │ ◀── PresetRow ──────────┤
   │ ◀── 201 PresetOut ───────┤                         │
   │                          │                         │
```

### Auth-Flow (JWT)

```
1. POST /auth/register { email, password }
   → 201 { id, email }
2. POST /auth/login { email, password }
   → 200 { access_token, refresh_token }
3. Alle weiteren Calls: Authorization: Bearer <access_token>
4. Bei 401: POST /auth/refresh { refresh_token }
   → neuer access_token
```

Access-Token: 15 min Lebensdauer. Refresh-Token: 7 Tage, wird in HttpOnly-Cookie gespeichert.

## Deployment-Architektur

```
                       VPS (z.B. Hetzner CX21, 4 GB RAM)
        ┌──────────────────────────────────────────────────┐
        │                                                  │
        │  ┌─────────┐   ┌──────────────┐  ┌───────────┐  │
443 ───▶│  │ Nginx   ├──▶│ FastAPI      │  │ Postgres  │  │
        │  │ (TLS)   │   │ (uvicorn)    ├─▶│ Volume    │  │
        │  │         ├──▶│ 4 Worker     │  │           │  │
        │  └─────────┘   └──────────────┘  └───────────┘  │
        │     ▲                                            │
        │     │ statische Files (Frontend-Build)           │
        │  ┌──┴──────┐                                     │
        │  │ /var/www│                                     │
        │  └─────────┘                                     │
        │                                                  │
        └──────────────────────────────────────────────────┘
```

- **Nginx** terminiert TLS (Let's Encrypt via certbot oder Caddy als Alternative)
- **FastAPI** über Unix-Socket an Nginx
- **Postgres** in eigenem Container, Daten via Bind-Mount oder Volume
- **Frontend** als statisches Build von Nginx ausgeliefert
- Optional: **Watchtower** für automatische Container-Updates

## Skalierung (sofern jemals nötig)

Für 1.000 aktive User reicht der oben skizzierte Single-Node-Deployment problemlos. Bei höherer Last:
- Postgres als Managed Service (Hetzner, Neon, Supabase)
- FastAPI horizontal skalieren über Load Balancer
- Frontend-Statics auf CDN

Da Pixel-Daten nie zum Backend wandern, ist das Skalierungs-Profil sehr entspannt.

## Sicherheit

- Passwörter: `bcrypt`, Cost-Faktor 12
- JWT: HS256 mit 256-bit-Secret, in Env-Variable, nie im Code
- CORS: Whitelist auf eigene Domain
- Rate Limiting: Nginx `limit_req` für `/auth/*`-Endpoints
- HTTPS: erzwungen, HSTS-Header
- CSP: streng, kein inline-script (Vite-Build erzeugt Hash-basierte Imports)
- DB-Backups: täglich via `pg_dump`, in eigenes Off-Site-Storage
