# Phase-5-Screenshots

Generiert von `frontend/e2e/screenshots.spec.ts` gegen den vollen Dev-Stack
(Postgres + Keycloak + MinIO via `deployment/docker-compose.dev.yml`,
Backend uvicorn + Frontend vite). Beweis fuer den End-to-End-Roundtrip
der lokalen Anpassungen + Preset-Persistenz.

| # | Datei | Zustand |
|---|---|---|
| 1 | [01-editor-default.png](01-editor-default.png) | Editor mit geladenem Test-Bild (gradient.jpg), Sidebar im Default |
| 2 | [02-linear-mask.png](02-linear-mask.png) | Linearer Verlauf hinzugefuegt, Belichtung +1.50 — die untere Bildhaelfte ist sichtbar heller |
| 3 | [03-multi-mask.png](03-multi-mask.png) | Plus elliptische Radial-Maske mit Belichtung -1.00, Saettigung +40 — Ellipse ist klar abgegrenzt |
| 4 | [04-mask-selection.png](04-mask-selection.png) | Wechsel der Selection auf Verlauf 1 ueber die Mask-Liste; Sidebar zeigt entsprechende Local-Sliders |
| 5 | [05-preset-dialog-list.png](05-preset-dialog-list.png) | PresetDialog mit den 4 JIT-Default-Presets (Neutral, Punchy, Schwarzweiss-Vorbereitung, Soft Mood) |
| 6 | [06-preset-save-name.png](06-preset-save-name.png) | Name fuer ein neues Preset eingegeben |
| 7 | [07-preset-saved-with-update.png](07-preset-saved-with-update.png) | Nach Save: eigenes Preset ist aktiv markiert (Amber), Sublabel "2 Masken", Update-Button "„…" ueberschreiben" sichtbar |
| 8 | [08-after-preset-load.png](08-after-preset-load.png) | Nach Reset und P-Shortcut + Re-Load: beide Masken sind wieder da, Effekt im Bild reproduziert |

## Wiedererzeugen

```bash
docker compose -f deployment/docker-compose.dev.yml up -d
cd backend && DATABASE_URL=postgresql+asyncpg://lumen:lumen@localhost:5433/lumen \
  KEYCLOAK_ISSUER=http://localhost:18080/realms/lumen \
  KEYCLOAK_AUDIENCE=lumen-api \
  GARAGE_S3_ENDPOINT=http://localhost:9000 GARAGE_S3_REGION=us-east-1 \
  GARAGE_S3_BUCKET=lumen-images \
  GARAGE_S3_ACCESS_KEY_ID=minioadmin GARAGE_S3_SECRET_ACCESS_KEY=minioadmin \
  CORS_ORIGIN=http://localhost:5173 .venv/bin/uvicorn app.main:app --port 8000 &
cd frontend && pnpm dev &
pnpm exec playwright test e2e/screenshots.spec.ts
```
