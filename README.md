# Lumen · light

> Browser-basierter, selbst-gehosteter RAW-Foto-Editor — eine schlanke, abofreie **Lightroom-Alternative** für Hobby-Fotografen. Ohne Software-Installation, ohne Cloud-Pflicht.

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](LICENSE)
[![CI](https://github.com/phash/lumen-light/actions/workflows/ci.yml/badge.svg)](https://github.com/phash/lumen-light/actions/workflows/ci.yml)
![React 19](https://img.shields.io/badge/React-19-149ECA?logo=react&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-async-009688?logo=fastapi&logoColor=white)
![WebGL2](https://img.shields.io/badge/WebGL2-shader_pipeline-990000)
![Self-hosted](https://img.shields.io/badge/self--hosted-Docker_Compose-2496ED?logo=docker&logoColor=white)

**[🔗 Live-Demo](https://lumen.mr-development.de)** · [Features](#was-lumen-kann) · [Schnellstart](#schnellstart-lokale-entwicklung) · [Selfhost](#production)

![Lumen · light — RAW-Editor im Browser](docs/screenshots/phase5/01-editor-default.png)

**Selfhost auf einem 4-GB-VPS · Open-Source-Stack · DSGVO-konform out-of-the-box.**

## Was Lumen kann

- **RAW direkt im Browser oeffnen**: CR2, CR3, NEF, ARW, DNG, RAF, RW2, ORF — via libraw-wasm in einem Web-Worker.
- **12 globale Slider** (Belichtung, Kontrast, Lichter, Tiefen, Weiss, Schwarz, Temperatur, Toenung, Dynamik, Saettigung, Schaerfen, Rauschen) plus **HSL-Mischer** (8 Farbkanaele × 3 Achsen) und **Spline-Tonkurve** (2-8 Stuetzpunkte mit Monotone-Hermite).
- **Bis zu 8 lokale Anpassungen pro Bild**: 4 lineare Verlaufsfilter + 4 elliptische Radialmasken, jede mit Belichtung/Kontrast/Saettigung/Temperatur.
- **Auto-Funktionen**: Auto-Tone (Histogramm-Analyse), Auto-WB (Gray-World), Auto-Begradigen (Sobel + Hough), Smart-Preset-Vorschlag (EXIF-Brennweite + optionale Face-Detection ueber TensorFlow.js).
- **Lens-Profile** fuer 18 verbreitete Kamera+Objektiv-Kombinationen (Verzeichnung + Vignette automatisch).
- **Vorher/Nachher-Vergleich**: Bypass-halten oder Compare-Split.
- **Export** als JPEG oder PNG, Quality- und Width-Slider.
- **Preset-Marketplace**: User koennen Presets oeffentlich teilen, andere wenden sie auf eigene Bilder an oder forken in die eigene Bibliothek. Reporting + Auto-Hide bei Missbrauch.

## Lumen vs. Lightroom

Lumen ersetzt nicht jeden Profi-Workflow — aber für RAW-Entwicklung ohne Abo und ohne Cloud-Zwang deckt es die wichtigsten Schritte ab.

|                      | Lumen · light            | Adobe Lightroom        |
| -------------------- | ------------------------ | ---------------------- |
| Preis                | Kostenlos, selbst-hostbar | Abo ab ~12 €/Monat     |
| Plattform            | Browser (WebGL2)         | Desktop + Cloud-App    |
| Deine Daten          | Bleiben bei dir          | Adobe Creative Cloud   |
| RAW im Browser       | Ja                       | Nein (Desktop)         |
| Lokale Masken        | Linear + Radial          | Umfangreich (inkl. KI) |
| Ohne Abo / offline   | Ja                       | Nein                   |

## Stack

- **Backend**: FastAPI · async SQLAlchemy 2 + asyncpg · Alembic · Pydantic 2 · slowapi (Redis-Backend in Production) · boto3
- **Frontend**: React 19 · Vite 8 · TypeScript strict · Tailwind 4 · Zustand 5 · WebGL2 (Single-Pass-Fragment-Shader mit Uniform-Arrays fuer Multi-Mask)
- **Auth**: Keycloak (OIDC, Realm `lumen`, JWT RS256-Whitelist)
- **Storage**: Postgres 16 · Garage S3 (Pre-Signed-URLs, Pixel laufen NICHT durch FastAPI)
- **Deployment**: Docker Compose · Caddy als Reverse-Proxy (CSP + HSTS + Permissions-Policy)
- **ML (optional)**: TensorFlow.js Mediapipe-Face-Detection — Lazy-Load, Default-aus, ausdrueckliche User-Einwilligung

## Schnellstart (lokale Entwicklung)

```bash
# 1. Postgres + Keycloak + MinIO (Garage-Ersatz in dev) hochfahren
docker compose -f deployment/docker-compose.dev.yml up -d
until curl -fs http://localhost:19000/health/ready >/dev/null; do sleep 2; done

# 2. Backend-Migration + Server
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt -r requirements-dev.txt
DATABASE_URL="postgresql+asyncpg://lumen:lumen@localhost:5433/lumen" \
  .venv/bin/alembic upgrade head

DATABASE_URL="postgresql+asyncpg://lumen:lumen@localhost:5433/lumen" \
KEYCLOAK_ISSUER="http://localhost:18080/realms/lumen" \
KEYCLOAK_AUDIENCE="lumen-api" \
GARAGE_S3_ENDPOINT="http://localhost:9000" GARAGE_S3_REGION="us-east-1" \
GARAGE_S3_BUCKET="lumen-images" \
GARAGE_S3_ACCESS_KEY_ID="minioadmin" GARAGE_S3_SECRET_ACCESS_KEY="minioadmin" \
CORS_ORIGIN="http://localhost:5173" \
.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000

# 3. Frontend (anderes Terminal)
cd frontend
cp .env.example .env.local   # ggf. anpassen
pnpm install
pnpm dev                     # http://localhost:5173
```

Test-User in Keycloak via Admin-API anlegen — siehe `CLAUDE.md` Abschnitt „Test-User in Keycloak".

## Tests

```bash
# Backend (testcontainers fuer PG + MinIO + Keycloak — Docker muss laufen)
cd backend && .venv/bin/pytest -q
# Aktuell: 99 Tests, ~50 s nach Image-Cache.

# Frontend Unit + Component
cd frontend && pnpm test
# Aktuell: 333 Tests in 40 Files, ~7 s.

# E2E (Stack muss komplett laufen)
cd frontend && pnpm exec playwright test

# Statisch
cd frontend && pnpm lint && pnpm build && pnpm exec tsc -b --noEmit
```

## Architektur (Kurzfassung)

```
                        ┌─────────────┐
                        │   Browser   │
                        │  React + WebGL2 │
                        └──────┬──────┘
            JWT (Bearer)       │     Pre-Signed PUT/GET
        ┌──────────────────────┼──────────────────────┐
        │                      │                      │
        ▼                      ▼                      ▼
┌──────────────┐      ┌──────────────┐      ┌──────────────┐
│   Keycloak   │      │   FastAPI    │      │  Garage S3   │
│  Realm lumen │      │  /api/v1     │      │  lumen-images│
└──────────────┘      │  Auth/RS256  │      └──────────────┘
                      │  Marketplace │
                      │  Presets/CRUD│
                      └──────┬───────┘
                             │
                             ▼
                      ┌──────────────┐
                      │ Postgres 16  │
                      │ + Alembic    │
                      └──────────────┘
```

WebGL-Pipeline (Fragment-Shader, Single-Pass): Lens-Distortion → Bilateral-Noise → sRGB→Linear → WB → Belichtung → Linear→sRGB → Highlights/Shadows/Whites/Blacks → Kontrast → Vibrance/Saettigung → HSL-Mischer → Tonkurve (LUT) → Unsharp-Mask → Vignette.

## Datenschutz / DSGVO

- **Privacy by Default**: Presets sind privat, Profilfelder leer, Marketplace-Toggle aus, Face-Detection aus.
- **DSGVO Art. 15 + 20**: vollstaendiger JSON-Export aller User-Daten (inklusive Marketplace-Felder, eigene Reports, presigned-Download-URLs fuer Bilder) auf der Account-Seite.
- **DSGVO Art. 17**: User kann seinen Account in der UI loeschen — Cascade auf Presets/Bilder/S3-Objekte. Reports werden anonymisiert (reporter_user_id auf NULL), damit die Moderationsspur erhalten bleibt.
- **Drittland-Transfer**: Nur, wenn der User explizit „Smart-Preset mit Gesichtserkennung" aktiviert — dann wird einmalig das TF.js-Modell von `storage.googleapis.com` (Google US) geladen. Die Bilderkennung selbst laeuft lokal im Browser, Bilder verlassen den Client nie. Datenschutz-Erklaerung enthaelt alle Details.
- **Selfhost-Stack**: Postgres + Garage + Keycloak laufen auf einem deutschen IONOS-VPS, kein anderer Auftragsverarbeiter ausser dem Hoster.

## Production

Production-Stack ist im `deployment/docker-compose.prod.yml` und benutzt eine separate Realm-Konfiguration (`infra/keycloak/lumen-realm.prod.json`) mit gehaerteten Flags (kein ROPC-Flow, verifyEmail an, nur Production-Origin in den Redirect-URIs). Caddy-Snippet (`infra/caddy/lumen.caddyfile`) setzt Content-Security-Policy, HSTS-preload, Permissions-Policy und blockt `/docs|/redoc|/openapi.json` als Defense-in-Depth.

Volle Anleitung: `infra/deployment-runbook.md`.

## Dokumentation

- `docs/beta-onboarding.md` — Quickstart fuer End-User (Account, erstes Bild, Auto-Funktionen, Presets, Marketplace, Datenschutz)
- `CHANGELOG.md` — pro Release zusammengefasste Aenderungen
- `docs/01-konzept.md` … `docs/08-risiken-offene-fragen.md` — Konzept, Architektur, Datenmodell, API, Frontend, Roadmap, ADRs, Risiken
- `docs/06-roadmap.md` — Iterations-Stand
- `docs/superpowers/specs/` — Pro Iteration eine Spec (HSL, Tonkurve, Sharpen+Noise, Auto-Straighten, Face-Detection, Marketplace …)
- `CLAUDE.md` — Hands-on-Anleitung fuer Claude-Code-Sessions in diesem Repo

## Lizenz

[GNU AGPL-3.0](LICENSE). Du darfst Lumen selbst hosten, anpassen und weitergeben — wenn du eine modifizierte Version als Netzwerk-Dienst anbietest, müssen die Änderungen unter derselben Lizenz offengelegt werden.
