# Lumen · light — Deployment auf MRD Production Cluster

**Stand:** 2026-11-10 — self-contained Stack, Garage statt MinIO, Netztrennung,
Least-Privilege-DB-Rollen, `lumen-web` unprivilegiert auf Port 8080.

> **Wichtig (Topologie-Korrektur):** Der Cluster hat KEIN shared Keycloak und
> KEIN shared Garage — jedes Projekt bringt seine eigenen mit. Lumen läuft
> daher **self-contained** unter EINER Domain `lumen.mr-development.de`:
> SPA + `/api` (FastAPI) + `/auth` (eigenes Keycloak, `KC_HTTP_RELATIVE_PATH=/auth`)
> + `/lumen-images` (eigenes Garage, S3, same-origin Pre-Signed POST/GET).
> **Netztrennung:** nur `lumen-web` (nginx) haengt im cluster-geteilten
> `caddy-proxy`-Netz; nginx reicht `/api`, `/auth`, `/lumen-images` ueber
> `lumen-internal` an API/Keycloak/Garage weiter (siehe `frontend/nginx.conf`).
> Der gesamte Ablauf unten ist in **`deployment/deploy.sh`** automatisiert
> (idempotent), Backups in **`deployment/backup.sh`**. Die Abschnitte 2/3
> (shared KC/Garage) sind historisch und entfallen — siehe stattdessen die
> Services `lumen-keycloak` + `lumen-garage` in `docker-compose.prod.yml`.

**Voraussetzungen:**
- VPS läuft, `caddy-proxy`-Network + `caddy-proxy`-Container existieren.
- DNS `lumen.mr-development.de` zeigt auf den VPS (✓ vorhanden).
- SSH-Zugang `musikersuche@musikersuche.org` (= 82.165.40.140).
- Mailserver-Account `noreply-lumen@mr-development.de` (für Keycloak-SMTP).

**Schnellweg (empfohlen):**
```bash
ssh musikersuche@musikersuche.org
cd /opt && git clone https://github.com/phash/lumen-light.git lumen && cd lumen
cp deployment/.env.example deployment/.env   # Secrets ausfüllen!
#   cat > deployment/config.prod.js  (liegt schon im Repo, ggf. Domain prüfen)
bash deployment/deploy.sh
```

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

Entfaellt als Handarbeit: `lumen-garage-init` legt Layout, Key und Bucket
beim `up -d` an. Nur die Werte in `.env` setzen (siehe Abschnitt
„Garage statt MinIO" unten).

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
# Least-Privilege-Rollen; leer lassen = deploy.sh generiert + traegt ein
LUMEN_DB_APP_PASSWORD=
KEYCLOAK_DB_PASSWORD=
KEYCLOAK_ISSUER=https://auth.mr-development.de/realms/lumen
KEYCLOAK_AUDIENCE=lumen-api
GARAGE_S3_ENDPOINT=http://garage:3900
GARAGE_S3_REGION=garage
GARAGE_S3_BUCKET=lumen-images
GARAGE_S3_ACCESS_KEY_ID=<aus Schritt 3>
GARAGE_S3_SECRET_ACCESS_KEY=<aus Schritt 3>
CORS_ORIGIN=https://lumen.mr-development.de
```

> Optional fuer Multi-Worker-API: `LUMEN_RATELIMIT_STORAGE=redis://lumen-redis:6379/0`
> ist im prod-compose schon als Default gesetzt. Wenn die `lumen-api`
> mit `--workers 1` laeuft (Default), ist Redis nicht zwingend
> noetig — der Counter bleibt dann pro Prozess in-memory.

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

## 7. Caddy-Netz

Nur `lumen-web` ist im `caddy-proxy`-Netz (Compose setzt das, kein manueller
`network connect`). API, Keycloak und Garage NICHT ins `caddy-proxy`-Netz
haengen — sonst ist die Netztrennung aufgehoben.

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
bash deployment/deploy.sh
# Migrationen laufen automatisch beim API-Container-Restart.
```

## Security-Haertung (Stand 2026-10)

**Re-Deploy immer ueber `bash deployment/deploy.sh`** — das Script zieht vor
Image-Upgrades ein Backup, pullt Service-Images, baut mit `--pull` und
uebertraegt die Realm-Haertung (Password-Policy, Events, exakte Redirect-URIs,
kein `offline_access`) per `kcadm` auf den laufenden Realm.

**Keycloak 26.1 -> 26.8:** KC migriert sein DB-Schema beim ersten Start
automatisch. deploy.sh legt vorher ein Backup an (`SKIP_BACKUP=1` zum
Ueberspringen). Bootstrap-Admin heisst jetzt `KC_BOOTSTRAP_ADMIN_*` (greift
nur bei leerer KC-DB).

**Bootstrap-Admin nicht in der Container-Env (2026-11):** In compose stehen
`KC_BOOTSTRAP_ADMIN_USERNAME/_PASSWORD` ohne Wert. `deploy.sh` exportiert sie
(aus `KC_ADMIN_USER/_PASSWORD`) NUR, wenn die DB `keycloak` noch keinen
Master-Realm hat, und erzeugt `lumen-keycloak` am Ende des Erst-Installs ohne
sie neu (Schritt 6b). Der Admin-Account bleibt in der KC-DB; `kcadm` loggt sich
weiter mit `KC_ADMIN_*` aus `.env` ein (per `docker exec -e KC_CLI_PASSWORD`).
`KC_BOOTSTRAP_ADMIN_*` NICHT in `.env` eintragen (deploy.sh bricht dann ab).
Wird das Admin-Passwort in Keycloak geaendert, `KC_ADMIN_PASSWORD` in `.env`
nachziehen — sonst scheitert Schritt 6.

**`.env` wird nicht mehr gesourct (2026-11):** `deploy.sh`/`backup.sh` lesen sie
mit `load_dotenv` (`deployment/lib/env.sh`): `KEY=WERT`, optionale `"..."`/`'...'`,
`#`-Kommentare, keine Expansion. Ein `$` in unquoted oder `"..."`-Werten bricht
ab (compose wuerde dort expandieren) — literales `$` in `'...'` setzen.
Beide Scripts erzwingen `chmod 600` auf `.env` und `BACKUP_PASSPHRASE_FILE`
und brechen ab, wenn das nicht geht (fremder Owner) und die Datei fuer
Gruppe/Andere lesbar bleibt. Tests: `bash deployment/tests/test-env.sh`.

**Keycloak-Admin-Konsole ist nicht mehr oeffentlich** (Caddy liefert 404 fuer
`/auth/admin` + `/auth/admin/*` komplett inkl. Admin-REST-API aller Realms,
sowie `/auth/realms/master/*`; nginx spiegelt das). Die API ruft die
Admin-REST-API fuer `DELETE /me` intern ueber `KEYCLOAK_INTERNAL_URL`
(`http://lumen-keycloak:8080/auth`) auf. Zugriff per SSH-Tunnel:

```bash
# auf dem VPS: Container-IP im lumen-internal-Netz ermitteln
docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' lumen-keycloak
# lokal: Tunnel aufbauen, dann http://localhost:18080/auth/admin/ oeffnen
ssh -L 18080:<kc-container-ip>:8080 root@82.165.40.140
```

Einzelne Aktionen gehen auch ohne Konsole per `kcadm` im Container, z.B.
Admin-Rolle vergeben:

```bash
KC_CLI_PASSWORD="$KC_ADMIN_PASSWORD" docker exec -e KC_CLI_PASSWORD lumen-keycloak \
  /opt/keycloak/bin/kcadm.sh config credentials --server http://localhost:8080/auth \
  --realm master --user "$KC_ADMIN_USER"
docker exec lumen-keycloak /opt/keycloak/bin/kcadm.sh add-roles -r lumen \
  --uusername <email> --rolename admin
```

**Garage statt MinIO (2026-10):** `lumen-garage` (dxflrs/garage v1.3.1,
Single-Node) ersetzt das EOL-MinIO. `lumen-garage-init` richtet Layout,
API-Key und Bucket idempotent ueber die Admin-API ein
(`backend/scripts/garage_init.py`). Der API-Key hat read+write auf genau
diesen Bucket, kein owner-Recht. Neue `.env`-Werte:

```bash
GARAGE_RPC_SECRET=$(openssl rand -hex 32)
GARAGE_ADMIN_TOKEN=$(openssl rand -hex 32)
GARAGE_S3_ENDPOINT=http://lumen-garage:3900
GARAGE_S3_REGION=garage
GARAGE_S3_ACCESS_KEY_ID=GK$(openssl rand -hex 12)
GARAGE_S3_SECRET_ACCESS_KEY=$(openssl rand -hex 32)
```

**Migration MinIO -> Garage** macht `deploy.sh` (Schritt 5b) einmalig, solange
der Alt-Container `lumen-minio` laeuft: Bucket per `scripts.s3_archive` aus
MinIO exportieren, nach Garage importieren, Manifeste (Key + Groesse)
vergleichen, Archiv verschluesselt als `bucket-minio-migration-*.tar.gz.gpg`
in `BACKUP_DIR` ablegen, `lumen-minio` entfernen. Scheitert der Abgleich,
bricht das Script ab; `lumen-minio` bleibt (ohne `caddy-proxy`-Netz) stehen. Das Volume
`lumen_lumen-minio-data` bleibt fuer einen Rollback; nach ein paar Tagen
Betrieb: `docker volume rm lumen_lumen-minio-data` und `MINIO_*` aus `.env`.

**Uploads per Pre-Signed POST:** die signierte Policy begrenzt die Groesse
(`content-length-range` = angekuendigte Dateigroesse), Key und Content-Type.
Caddy laesst auf `/lumen-images/*` nur GET/HEAD/POST durch (405 sonst) und
setzt eine Sandbox-CSP auf S3-Antworten.

## Least Privilege + KC-Account-Loeschung (Stand 2026-11)

**DB-Rollen:** API und Keycloak laufen nicht mehr als Postgres-Superuser.
`lumen_app` ist Owner der App-DB (API + Alembic), `keycloak` Owner der DB
`keycloak`; `POSTGRES_USER` bleibt nur fuer Init/Admin/Backup. CONNECT fuer
PUBLIC ist auf beiden DBs entzogen. Ein Script fuer beide Wege:
`deployment/initdb/02-app-roles.sh` (Erst-Init per initdb, Bestand per
`deploy.sh` -> `ensure_db_roles`, laeuft VOR dem Start von API/KC).
Idempotent; Passwort-Rotation = Wert in `.env` aendern + `deploy.sh`.
Manuell (ohne deploy.sh):

```bash
. deployment/lib/env.sh && load_dotenv deployment/.env   # .env als Daten, nicht als Shell-Code
docker exec -i -e LUMEN_DB_APP_PASSWORD -e KEYCLOAK_DB_PASSWORD lumen-db \
  bash -euo pipefail -s < deployment/initdb/02-app-roles.sh
```

**Service-Account `lumen-admin`:** confidential Client nur mit
`client_credentials` und der Rolle `realm-management/manage-users`.
`deploy.sh` (Schritt 6a) legt ihn idempotent an, liest das von Keycloak
generierte Secret und schreibt `KEYCLOAK_ADMIN_CLIENT_ID/SECRET` in `.env`
(danach `lumen-api` neu erzeugt). Damit loescht `DELETE /me` auch den
Keycloak-Account. Bei jedem Lauf erzwungen: nur client_credentials (Flags
werden zurueckgelesen, Abweichung = Abbruch), Access-Token 60 s, und der
Service-Account behaelt GENAU `manage-users` (alle anderen Rollen inkl.
`default-roles-lumen` werden entfernt). Restrisiko siehe
`docs/08-risiken-offene-fragen.md` R9. Secret rotieren: in KC neu generieren
(`kcadm.sh create clients/<id>/client-secret -r lumen`) + `deploy.sh`.

**Realm-Haertung:** `deploy.sh` uebertraegt aus `lumen-realm.prod.json`
zusaetzlich `verifyEmail`, `sslRequired`, Brute-Force-Parameter,
Token-/Session-Laufzeiten (`accessTokenLifespan`, `ssoSessionMaxLifespan`,
`ssoSessionIdleTimeout`, `revokeRefreshToken`, `refreshTokenMaxReuse`) sowie
`duplicateEmailsAllowed`/`registrationAllowed` und fuer
`lumen-frontend` `directAccessGrantsEnabled=false`, Redirect-URIs,
Web-Origins und Attribute (Merge, nichts anderes wird geloescht).

**lumen-web:** `nginxinc/nginx-unprivileged` (uid 101, Port **8080**, keine
Capabilities). Caddy routet auf `lumen-web:8080`. `lumen-db`/`lumen-redis`
laufen mit `cap_drop: ALL` + minimalem `cap_add` und `no-new-privileges`.

## Backup

`deployment/backup.sh` (Cron auf dem VPS) sichert beide Postgres-DBs und den
Bucket (`scripts.s3_archive export`, Objekt-Ebene als tar), verschluesselt
alles per `gpg --symmetric` (AES256) und kopiert es optional per rsync weg.
Ohne lesbare Passphrase-Datei bricht es ab. rsync laeuft ohne `--delete`
(lokales Loeschen raeumt die Offsite-Kopie nicht ab).

**Aufbewahrung (fest, so in der Datenschutzerklaerung genannt):** lokal
`RETENTION_DAYS` (Default 14 Tage, raeumt `backup.sh`), offsite **30 Tage**,
ausgefuehrt **am Ziel** per Cron des Backup-Users:

```bash
# crontab -e auf dem Offsite-Host (Pfad = BACKUP_REMOTE-Ziel)
15 4 * * *  find /srv/lumen -maxdepth 1 -type f -name '*.gpg' -mtime +30 -delete
```

`backup.sh` endet mit Exit != 0, wenn ein Teil fehlschlaegt (auch der
Bucket-Export; die bereits verschluesselten DB-Dumps bleiben und gehen
offsite). Abgebrochene Laeufe hinterlassen keine Klartext-Teildateien.

```bash
# Einmalig: Passphrase anlegen (zusaetzlich offline/im Passwortmanager ablegen!)
openssl rand -base64 32 > /opt/lumen/deployment/.backup-passphrase
chmod 600 /opt/lumen/deployment/.backup-passphrase
# .env: BACKUP_PASSPHRASE_FILE=/opt/lumen/deployment/.backup-passphrase
#       BACKUP_REMOTE=backup@<host>:/srv/lumen   (SSH-Key des Cron-Users)
```

Restore:

```bash
P=/opt/lumen/deployment/.backup-passphrase
gpg --batch --passphrase-file $P -d lumen-db-<TS>.sql.gz.gpg | gunzip \
  | docker exec -i lumen-db psql -U lumen lumen
gpg --batch --passphrase-file $P -d bucket-<TS>.tar.gz.gpg | gunzip \
  | docker exec -i lumen-api python -m scripts.s3_archive import
```

Restore laeuft als Superuser; die Dumps enthalten `OWNER TO lumen_app` bzw.
`keycloak`, die Rollen muessen also existieren. Danach (oder bei einem
Dump von vor 2026-11) `02-app-roles.sh` wie oben erneut ausfuehren — es
stellt alle Owner wieder auf die Least-Privilege-Rollen.

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
| 502 von Caddy | Caddy-Block zeigt noch auf `lumen-web:80` (seit 2026-11: `:8080`) bzw. `lumen-web` nicht im `caddy-proxy`-Netz | `deploy.sh` erneut (tauscht den Block), `docker network inspect caddy-proxy` |
| API/KC: `password authentication failed for user "lumen_app"/"keycloak"` | Rollen-Umstellung nicht gelaufen oder Passwort in `.env` geaendert | `02-app-roles.sh` (siehe „Least Privilege") ausfuehren |
| Login redirected, aber `/auth/me` ist 401 | Issuer-Mismatch zwischen `KEYCLOAK_ISSUER` und Token-`iss`-Claim | `.env`-Wert auf den exakt selben URL setzen, der im Token steht |
| Pre-Signed-URL 403 beim Browser-PUT | CORS auf dem Garage-Bucket fehlt | `garage bucket cors-set lumen-images <CORS-Konfig>` |
| Image-Confirm gibt 409 | Object liegt nicht im Bucket | Upload-PUT prüfen — Browser-Console öffnen |
| `alembic upgrade head` hängt | DB-Healthcheck nicht durch | Postgres-Logs prüfen, ggf. `docker compose down` und wieder hoch |
