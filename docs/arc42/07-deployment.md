# arc42 §7 · Verteilungssicht (Deployment)

Konkrete Verteilung von Lumen · light auf den **MRD Production Cluster** (IONOS VPS, 82.165.40.140).

## Ziel-Topologie

```
                           Internet
                              │
                          (TLS, Port 443)
                              │
                ┌─────────────▼─────────────┐
                │         caddy             │  (caddy-proxy network)
                │  *.mr-development.de      │
                └──────┬─────────────┬──────┘
                       │             │
        /api/v1/*      │             │  Rest (statisch)
                       ▼             ▼
            ┌───────────────┐   ┌──────────────────────┐
            │  lumen-api    │   │  lumen-web           │
            │  FastAPI      │   │  nginx + Vite-Build  │
            │  :4100        │   │  :80 (intern)        │
            └──────┬────────┘   └──────────────────────┘
                   │
                   │ asyncpg
                   ▼
            ┌───────────────┐
            │  lumen-db     │
            │  Postgres 16  │
            │  Volume       │
            └───────────────┘
```

## Container

| Container | Image | Zweck | Intern Port | Caddy-Alias |
|---|---|---|---|---|
| `lumen-api` | self-built (FastAPI) | API-Endpoints | 4100 | `lumen-api` |
| `lumen-web` | self-built (nginx + dist/) | Statisches Frontend | 80 | `lumen-web` |
| `lumen-db` | postgres:16-alpine | Persistenz | 5432 (nur intern) | – |

## Caddyfile-Eintrag

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

## Initiales Deployment

Macht **Manuel selbst** auf `82.165.40.140` (Cluster-Conventions: Claude deployed nicht eigenständig).

Schritte:

1. Repo nach `/opt/lumen` klonen
2. `.env` ableiten von `deployment/.env.example`, `JWT_SECRET` mit `openssl rand -hex 32` generieren
3. `docker compose build --no-cache` und `docker compose up -d`
4. `docker network connect --alias lumen-api caddy-proxy lumen-api`
5. `docker network connect --alias lumen-web caddy-proxy lumen-web`
6. Caddyfile-Eintrag (siehe oben) ergänzen, `caddy reload`
7. Alembic läuft beim API-Container-Start automatisch
8. Status-Update via MRD-API: `PUT /clusters/:id/status`

## Backup

- **Datenbank:** täglich `pg_dump lumen-db` ins Off-Site-Storage, 14 Tage Retention
- **Anwendungsdaten:** keine — Pixel-Daten verlassen den Client nie, das Backend ist zustandslos außer DB

## Skalierung

Single-Node reicht für ~1.000 aktive User. Bei mehr:
- Postgres → Managed Service (Hetzner / Neon)
- API → mehrere Replikas hinter Caddy `reverse_proxy`-Pool
- Frontend → CDN für statische Assets
