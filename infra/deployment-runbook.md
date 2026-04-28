# Lumen · light — Initiales Deployment auf MRD Production Cluster

**Stand:** 2026-04-27 — Iteration 7 abgeschlossen.

**Wer macht das?** Manuel selbst auf dem VPS (`82.165.40.140`). Claude deployed nicht eigenständig (Cluster-Conventions).

**Voraussetzungen:**
- VPS läuft, `caddy-proxy`-Network existiert.
- Cluster-shared Keycloak und Garage laufen.
- DNS `lumen.mr-development.de` zeigt auf den VPS.
- SSH-Zugang `musikersuche@82.165.40.140`.

---

## 1. Repo klonen

```bash
ssh musikersuche@82.165.40.140
cd /opt
git clone <lumen-repo> lumen
cd /opt/lumen
```

## 2. Keycloak-Realm `lumen` importieren

Cluster-Keycloak ist geteilt. Realm einmalig einspielen (überschreibt nichts, weil Realm-Name `lumen` neu ist).

**Production nutzt `lumen-realm.prod.json`** (nicht das dev-File!): `directAccessGrantsEnabled=false` (kein ROPC-Flow, schliesst Phishing/Credential-Stuffing-Vektoren), `verifyEmail=true` (Schutz gegen Sock-Puppet-Reports im Marketplace), nur die Production-Origin in den Redirect-/Web-Origins.

```bash
docker cp infra/keycloak/lumen-realm.prod.json keycloak:/tmp/lumen-realm.json
docker exec keycloak /opt/keycloak/bin/kc.sh import \
    --file /tmp/lumen-realm.json --override true
docker restart keycloak
```

> Die dev-Variante (`lumen-realm.json`) hat ROPC + verifyEmail=false aktiv, weil die Backend-Tests via Direct-Access-Grant-Flow Test-Tokens beziehen. **Dev-File niemals in Production importieren.**

**Verifizieren:**
```bash
curl -fsS https://auth.mr-development.de/realms/lumen/.well-known/openid-configuration | jq -r .issuer
# erwartet: https://auth.mr-development.de/realms/lumen
```

## 3. Garage-Bucket + Access-Key anlegen

```bash
bash infra/garage/init.sh
# Output enthaelt GARAGE_S3_ACCESS_KEY_ID + SECRET — fuer Schritt 4 merken.
```

Falls die Kontonamen oder Container-Namen abweichen, Variables setzen:
```bash
GARAGE_CONTAINER=garage-prod BUCKET_NAME=lumen-images bash infra/garage/init.sh
```

## 4. `.env` für die Lumen-Stack erstellen

```bash
cd /opt/lumen/deployment
cp .env.example .env
```

Werte ergänzen:
```env
POSTGRES_USER=lumen
POSTGRES_PASSWORD=<openssl rand -hex 24>
POSTGRES_DB=lumen
KEYCLOAK_ISSUER=https://auth.mr-development.de/realms/lumen
KEYCLOAK_AUDIENCE=lumen-api
GARAGE_S3_ENDPOINT=http://garage:3900
GARAGE_S3_REGION=garage
GARAGE_S3_BUCKET=lumen-images
GARAGE_S3_ACCESS_KEY_ID=<aus Schritt 3>
GARAGE_S3_SECRET_ACCESS_KEY=<aus Schritt 3>
CORS_ORIGIN=https://lumen.mr-development.de
```

## 5. Frontend Run-Time-Config schreiben

```bash
cd /opt/lumen/deployment
cat > config.prod.js <<'EOF'
window.__APP_CONFIG__ = {
  KEYCLOAK_AUTHORITY: "https://auth.mr-development.de/realms/lumen",
  KEYCLOAK_CLIENT_ID: "lumen-frontend",
  API_BASE: "/api/v1"
};
EOF
```

## 6. Stack bauen und starten

```bash
cd /opt/lumen
docker compose -f deployment/docker-compose.prod.yml build --no-cache
docker compose -f deployment/docker-compose.prod.yml up -d
```

`lumen-api` führt Alembic-Migration beim Start automatisch aus. Mit
```bash
docker compose -f deployment/docker-compose.prod.yml logs -f lumen-api
```
verifizieren, dass alle drei Migrationen (`001_initial`, `002_keycloak`, `003_images`) durchlaufen.

## 7. Caddy-Network-Aliase setzen

```bash
docker network connect --alias lumen-api caddy-proxy lumen-api
docker network connect --alias lumen-web caddy-proxy lumen-web
```

(Container sind bereits im `caddy-proxy`-Netz — der Alias-Befehl gibt nur den DNS-Namen.)

## 8. Caddyfile ergänzen

`/opt/caddyserver/Caddyfile` um den Block aus `infra/caddy/lumen.caddyfile` ergänzen.

```bash
cat /opt/lumen/infra/caddy/lumen.caddyfile >> /opt/caddyserver/Caddyfile
docker exec caddy caddy reload --config /etc/caddy/Caddyfile
```

## 9. Smoke-Test

```bash
# Health
curl -fsS https://lumen.mr-development.de/api/v1/health
# erwartet: {"status":"ok"}

# Frontend laed
curl -fsS https://lumen.mr-development.de/ | head -5
# erwartet: <!doctype html> ...

# config.js wird ausgeliefert
curl -fsS https://lumen.mr-development.de/config.js
# erwartet: window.__APP_CONFIG__ = { KEYCLOAK_AUTHORITY: ..., ... }
```

UI im Browser auf `https://lumen.mr-development.de`:
- Klick "Login" → leitet zu Keycloak
- Account anlegen
- /editor und /library sind erreichbar
- In /library ein Bild hochladen → Upload, Confirm, Liste, Delete funktionieren.

## 10. MRD-API Status-Update

```bash
curl -X PUT \
    -H "X-API-Key: $MRD_API_KEY" \
    -H "Content-Type: application/json" \
    "https://www.mr-development.de/api/v1/external/clusters/1258842b-b60b-41b8-bf21-0df6f4b21b9d/status" \
    -d '{
        "projectId": "aacc8f75-9b15-48b5-a7ce-8efa8ee01a7d",
        "status": "running",
        "deployedAt": "'"$(date -u +%FT%TZ)"'"
    }'
```

## Updates / Re-Deploys

```bash
cd /opt/lumen
git pull
docker compose -f deployment/docker-compose.prod.yml build --no-cache
docker compose -f deployment/docker-compose.prod.yml up -d
# Migrationen laufen automatisch beim API-Container-Restart.
```

## Backup

```bash
# Lumen-DB
docker compose -f deployment/docker-compose.prod.yml exec lumen-db \
    pg_dump -U lumen lumen > /opt/backups/lumen-$(date +%Y%m%d).sql

# Garage hat eigene Replikation; optional Bucket-Snapshot
docker exec garage /garage bucket snapshot lumen-images
```

## Rollback

Bei kaputtem Deploy:
```bash
cd /opt/lumen
git checkout <last-known-good-commit>
docker compose -f deployment/docker-compose.prod.yml build --no-cache
docker compose -f deployment/docker-compose.prod.yml up -d
```

Bei Datenbank-Schema-Problem:
```bash
docker compose -f deployment/docker-compose.prod.yml exec lumen-api \
    alembic downgrade -1
```

## Häufige Stolpersteine

| Symptom | Ursache | Fix |
|---|---|---|
| 502 von Caddy | Container-Alias fehlt | `docker network connect --alias lumen-{api,web} caddy-proxy ...` |
| Login redirected, aber `/auth/me` ist 401 | Issuer-Mismatch zwischen `KEYCLOAK_ISSUER` und Token-`iss`-Claim | `.env`-Wert auf den exakt selben URL setzen, der im Token steht |
| Pre-Signed-URL 403 beim Browser-PUT | CORS auf dem Garage-Bucket fehlt | `garage bucket cors-set lumen-images <CORS-Konfig>` |
| Image-Confirm gibt 409 | Object liegt nicht im Bucket | Upload-PUT prüfen — Browser-Console öffnen |
| `alembic upgrade head` hängt | DB-Healthcheck nicht durch | Postgres-Logs prüfen, ggf. `docker compose down` und wieder hoch |
