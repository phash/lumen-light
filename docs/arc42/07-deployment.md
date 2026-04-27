# arc42 §7 · Verteilungssicht (Deployment)

Konkrete Verteilung von Lumen · light auf den **MRD Production Cluster** (IONOS VPS, 82.165.40.140) — gemäß ADR-010 (Keycloak), ADR-011 (Garage), ADR-012 (Caddy).

## Ziel-Topologie

```
                                 Internet
                                    │
                                (TLS, Port 443)
                                    │
                         ┌──────────▼──────────┐
                         │     caddy           │  (caddy-proxy network)
                         │     /opt/caddy      │
                         │     server/         │
                         │     Caddyfile       │
                         └─┬──────────┬──────┬─┘
                           │          │      │
                lumen.<d>  │          │      │ auth.<d>
                /api/v1/*  │          │      │
                           ▼          ▼      ▼
                  ┌──────────────┐ ┌─────────┐ ┌──────────┐
                  │  lumen-api   │ │ lumen-  │ │ keycloak │
                  │  FastAPI     │ │ web     │ │ :8080    │
                  │  :4100       │ │ nginx   │ │          │
                  │              │ │ :80     │ │          │
                  └──────┬───────┘ └─────────┘ └────┬─────┘
                         │                          │
                         │ asyncpg                  │ JDBC
                         ▼                          ▼
                  ┌──────────────┐            ┌────────────┐
                  │  lumen-db    │            │ keycloak-  │
                  │  postgres:16 │            │ db         │
                  │  Volume      │            │ postgres:16│
                  └──────────────┘            └────────────┘

                  ┌──────────────┐
                  │  garage      │   (cluster-shared, S3-API :3900)
                  │  Bucket:     │
                  │  lumen-images│
                  └──────────────┘
                         ▲
                         │ Pre-Signed URLs (Browser↔Garage direkt,
                         │  NICHT ueber Backend)
```

## Caddyfile-Eintrag (Cluster-Caddy)

```caddy
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

`auth.mr-development.de` für Keycloak ist Cluster-shared (existiert ggf. schon für andere Apps; Realm-Pfad `/realms/lumen` reicht für Trennung).

## Container-Übersicht

| Container | Image | Verantwortung | Intern-Port | Caddy-Alias | Volumes |
|---|---|---|---|---|---|
| `lumen-api` | self-built (FastAPI) | API + JWT-Verifikation + Pre-Signed URLs | 4100 | `lumen-api` | – |
| `lumen-web` | self-built (nginx + Vite-Build) | statisches Frontend | 80 | `lumen-web` | – |
| `lumen-db` | postgres:16-alpine | Lumen-DB (`presets`, `users`, `images`) | 5432 | – | `lumen-postgres-data` |
| `keycloak` | quay.io/keycloak/keycloak:26 | IdP, Realm `lumen` (geteilt mit anderen Apps) | 8080 | `keycloak` | – |
| `keycloak-db` | postgres:16-alpine | Keycloak-DB (geteilt) | 5432 | – | `keycloak-postgres-data` |
| `garage` | dxflrs/garage:v1.x | S3-Storage (`lumen-images`-Bucket) | 3900 (S3) | `garage` | `garage-meta`, `garage-data` |

## Initiales Deployment (durch Manuel)

Macht Manuel selbst — Claude deployed nicht eigenständig (Cluster-Conventions, dokumentiert in `docs/superpowers/specs/...`).

```bash
# 0. Voraussetzung: Cluster läuft, caddy-proxy-Network existiert
ssh musikersuche@82.165.40.140

# 1. Repo klonen
cd /opt && git clone <lumen-repo> lumen && cd lumen

# 2. .env aus deployment/.env.example ableiten
cp deployment/.env.example deployment/.env
# Wichtige Werte:
#  - JWT_KEYCLOAK_ISSUER=https://auth.mr-development.de/realms/lumen
#  - JWT_KEYCLOAK_AUDIENCE=lumen-api
#  - GARAGE_S3_ENDPOINT=http://garage:3900
#  - GARAGE_S3_BUCKET=lumen-images
#  - GARAGE_S3_ACCESS_KEY_ID=<aus garage key create>
#  - GARAGE_S3_SECRET_ACCESS_KEY=<dito>

# 3. Keycloak-Realm anlegen (einmalig — Cluster-Keycloak ist geteilt)
docker exec -i keycloak /opt/keycloak/bin/kc.sh import \
    --file - --override true < infra/keycloak/lumen-realm.json

# 4. Garage-Bucket anlegen
bash infra/garage/init.sh   # legt Bucket lumen-images an, erstellt
                            # Access-Key und schreibt ihn in .env

# 5. Stack bauen und starten
docker compose -f deployment/docker-compose.prod.yml build --no-cache
docker compose -f deployment/docker-compose.prod.yml up -d

# 6. Caddy-Aliase verbinden
docker network connect --alias lumen-api caddy-proxy lumen-api
docker network connect --alias lumen-web caddy-proxy lumen-web

# 7. Caddyfile-Eintrag in /opt/caddyserver/Caddyfile ergaenzen
#    (siehe oben), dann reload
docker exec caddy caddy reload --config /etc/caddy/Caddyfile

# 8. Alembic-Migration laeuft beim API-Container-Start automatisch
#    Verifizieren:
docker compose -f deployment/docker-compose.prod.yml \
    exec lumen-api alembic current

# 9. Status-Update via MRD-API
curl -X PUT -H "X-API-Key: $MRD_API_KEY" \
     "https://www.mr-development.de/api/v1/external/clusters/<id>/status" \
     -d '{"projectId":"aacc8f75-…","status":"running"}'
```

## Realm-Export (Source of Truth)

`infra/keycloak/lumen-realm.json` enthält:
- Realm-Name: `lumen`
- Public Client: `lumen-frontend` (PKCE, redirectUris für lokale Dev + Production)
- Confidential Client: `lumen-api` (Resource Server, Audience-Validation)
- Default Roles: `user`
- Login-Theme: optional, später

Realm-Änderungen via Keycloak-Admin-UI werden re-exportiert und committed:

```bash
docker exec keycloak /opt/keycloak/bin/kc.sh export \
    --realm lumen --file /tmp/lumen-realm.json --users realm_file
docker cp keycloak:/tmp/lumen-realm.json infra/keycloak/lumen-realm.json
```

## Garage-Initialisierung

`infra/garage/init.sh` (Pflicht-Reihenfolge):
1. Cluster-Layout sicherstellen (Garage hat das ggf. schon)
2. `garage bucket create lumen-images`
3. `garage key create lumen-app-rw` → Access-Key + Secret in stdout
4. `garage bucket allow --read --write --owner lumen-images --key lumen-app-rw`
5. Output ins `.env` schreiben (manuell oder via `sed`)
6. CORS auf dem Bucket konfigurieren (PUT/GET vom Frontend-Origin erlauben)

## Backup

| Was | Strategie | Frequenz |
|---|---|---|
| Lumen-DB | `pg_dump lumen` ins Off-Site-Storage | täglich, 14 Tage Retention |
| Keycloak-DB | `pg_dump keycloak` (Cluster-shared) | täglich, 30 Tage Retention |
| Garage-Bucket | Garage hat eingebaute Replikation; Snapshot via `garage snapshot` | wöchentlich |
| Repo | Git-Remote (Github o. ä.) | bei jedem Push |

## Lokale Entwicklung (Standalone-Compose)

Für rein lokale Entwicklung (kein Cluster nötig) gibt es `deployment/docker-compose.dev.yml`:
- Eigener Caddy-Container (statt geteiltem)
- Keycloak-Container mit dem Realm-Export importiert
- Garage-Container mit dem Init-Script
- Alle auf `localhost`

So kann ein neuer Entwickler den vollen Stack mit `docker compose -f deployment/docker-compose.dev.yml up -d` hochfahren, ohne Zugang zum Cluster zu brauchen.

## Skalierung

Single-Node reicht für ~1.000 aktive User. Bei mehr:
- Postgres → Managed Service (Hetzner / Neon)
- API → mehrere Replikas hinter Caddy `reverse_proxy`-Pool
- Frontend → CDN für statische Assets
- Garage → mehrere Nodes mit Replikation (3-Node-Setup ist der Garage-Standard)
- Keycloak → Cluster-Modus mit `cache=ispn` und shared DB
