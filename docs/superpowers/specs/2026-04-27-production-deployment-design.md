# Spec · Production-Deployment

**Datum:** 2026-04-27
**Iteration:** 7
**Vorgänger:** Iteration 6 (Image-Storage), lokaler Smoke-Test grün

## Motivation

Das Konzept ist Cluster-Add-On: Lumen läuft auf dem MRD Production Cluster (IONOS VPS) im geteilten `caddy-proxy`-Netz, nutzt Cluster-shared Keycloak und Garage. Iteration 7 liefert alle Bausteine, damit Manuel das initiale Deployment selbst durchführen kann.

## Ziel

- `docker-compose.prod.yml` für `lumen-api` + `lumen-web` + `lumen-db` (Lumen-eigene DB).
- `frontend/Dockerfile` mit nginx + statischem Vite-Build.
- **Run-Time-Konfiguration** via `/config.js`, statt `VITE_*`-Vars zur Build-Zeit eingebrannt → ein Image für Dev, Staging, Production.
- `backend/Dockerfile` läuft Migration beim Start, dann uvicorn.
- `infra/garage/init.sh` als Bucket+Key-Setup.
- Caddyfile-Snippet im Repo, Deployment-Anleitung in `arc42/07-deployment.md` (existiert bereits, wird verfeinert).
- Schritt-für-Schritt-Runbook in `infra/deployment-runbook.md`.

## Nicht-Ziel

- Tatsächlicher Deploy auf den Cluster — macht Manuel.
- CI/CD via GitHub Actions — folgt in einer eigenen Iteration.
- Frontend-Tests gegen den nginx-Build — wäre overkill.

## Run-Time-Config-Strategie

`frontend/public/config.example.js`:
```js
window.__APP_CONFIG__ = {
  KEYCLOAK_AUTHORITY: "https://auth.mr-development.de/realms/lumen",
  KEYCLOAK_CLIENT_ID: "lumen-frontend",
  API_BASE: "/api/v1",
};
```

`index.html` lädt `/config.js` **vor** dem Modul-Bundle:
```html
<script src="/config.js"></script>
<script type="module" src="/src/main.tsx"></script>
```

`src/runtime-config.ts`:
```ts
const w = window as unknown as { __APP_CONFIG__?: Partial<...> };
const cfg = w.__APP_CONFIG__ ?? {};
export const RUNTIME_CONFIG = {
  KEYCLOAK_AUTHORITY: cfg.KEYCLOAK_AUTHORITY ?? import.meta.env.VITE_KEYCLOAK_AUTHORITY,
  KEYCLOAK_CLIENT_ID: cfg.KEYCLOAK_CLIENT_ID ?? import.meta.env.VITE_KEYCLOAK_CLIENT_ID,
  API_BASE: cfg.API_BASE ?? import.meta.env.VITE_API_BASE,
};
```

`src/auth/config.ts` und `src/api/use-api.ts` lesen aus `RUNTIME_CONFIG` statt `import.meta.env`.

In Production wird `/config.js` als Bind-Mount gegen den nginx-Container gemountet, lokal nutzt man weiterhin die `VITE_*`-Env-Vars.

## frontend/Dockerfile

Multi-Stage:
1. Build-Stage: `node:22-alpine`, `npm ci`, `npm run build`.
2. Run-Stage: `nginx:1.27-alpine`, `dist/` nach `/usr/share/nginx/html/`, eigene `nginx.conf` mit SPA-Fallback (`try_files $uri /index.html`).

`config.js` wird **nicht** ins Image gebaut — es wird zur Run-Time gemountet. Wenn die Datei fehlt, fallen die `RUNTIME_CONFIG`-Defaults auf die Vite-Build-Time-Vars zurück.

## backend/Dockerfile

Existiert. Anpassungen:
- Port 4100 statt 8000 (passt zur Cluster-Registrierung).
- HEALTHCHECK ergänzen.

## docker-compose.prod.yml

```yaml
services:
  lumen-db:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB}
    volumes:
      - lumen-db-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER}"]

  lumen-api:
    build: { context: ../backend, dockerfile: Dockerfile }
    restart: unless-stopped
    environment:
      DATABASE_URL: "postgresql+asyncpg://${POSTGRES_USER}:${POSTGRES_PASSWORD}@lumen-db:5432/${POSTGRES_DB}"
      KEYCLOAK_ISSUER: ${KEYCLOAK_ISSUER}
      KEYCLOAK_AUDIENCE: ${KEYCLOAK_AUDIENCE}
      GARAGE_S3_ENDPOINT: ${GARAGE_S3_ENDPOINT}
      GARAGE_S3_REGION: ${GARAGE_S3_REGION}
      GARAGE_S3_BUCKET: ${GARAGE_S3_BUCKET}
      GARAGE_S3_ACCESS_KEY_ID: ${GARAGE_S3_ACCESS_KEY_ID}
      GARAGE_S3_SECRET_ACCESS_KEY: ${GARAGE_S3_SECRET_ACCESS_KEY}
      CORS_ORIGIN: ${CORS_ORIGIN}
    depends_on:
      lumen-db: { condition: service_healthy }
    networks: [ default, caddy-proxy ]

  lumen-web:
    build: { context: ../frontend, dockerfile: Dockerfile }
    restart: unless-stopped
    volumes:
      - ./config.prod.js:/usr/share/nginx/html/config.js:ro
    networks: [ caddy-proxy ]

networks:
  caddy-proxy:
    external: true

volumes:
  lumen-db-data:
```

`caddy-proxy` ist extern — wird im Cluster bereitgestellt.

## infra/garage/init.sh

Idempotentes Bash-Script, das gegen einen Garage-Cluster (intern via `docker exec garage garage ...`) läuft:
1. Bucket `lumen-images` anlegen (oder skip, wenn da)
2. Access-Key `lumen-app-rw` anlegen (oder skip)
3. Bucket-Permissions (`--read --write`)
4. Output: Access-Key + Secret in eine `.env.garage`-Datei

## Caddyfile-Snippet

`infra/caddy/lumen.caddyfile`:
```
lumen.mr-development.de {
    encode gzip zstd

    @api path /api/* /docs /openapi.json /redoc
    handle @api {
        reverse_proxy lumen-api:4100
    }

    handle {
        reverse_proxy lumen-web:80
    }
}
```

## Deployment-Runbook

`infra/deployment-runbook.md` mit den genauen Schritten, die Manuel auf dem VPS ausführt — geknüpft an `arc42/07-deployment.md`, aber als ausführbarer Cookbook-Style.

## Akzeptanzkriterien

1. `docker compose -f deployment/docker-compose.prod.yml build` läuft fehlerfrei (lokal verifizierbar; nicht der eigentliche Deploy).
2. Frontend-Build mit Run-Time-Config: `RUNTIME_CONFIG`-Lookup hat Fallbacks, alle bestehenden Tests bleiben grün.
3. `infra/garage/init.sh` ist syntaktisch valide (`bash -n`), führt erforderliche Garage-CLI-Aufrufe aus.
4. `infra/deployment-runbook.md` und Caddyfile-Snippet existieren und sind in `arc42/07-deployment.md` referenziert.
5. README aktualisiert mit Produktions-Schnellstart.

## Risiken

- **Garage-CLI-Verfügbarkeit:** das Init-Script geht davon aus, dass auf dem VPS ein Container `garage` läuft, in dem das CLI verfügbar ist. Falls Garage anders deployed ist, muss das Script angepasst werden — dokumentiert.
- **Caddy-Network-Aliase:** Lumen-Container müssen nach Compose-Up via `docker network connect --alias lumen-api caddy-proxy lumen-api` aliasiert werden. Im Runbook explizit.
- **Frontend-Run-Time-Config:** wenn `config.js` falsch konfiguriert ist (z. B. Tippfehler in der Authority-URL), läuft die App ohne Fehler, aber Login schlägt fehl. Im Runbook validation-step ergänzt.
