#!/usr/bin/env bash
# Lumen · light — Production-Deploy auf dem MRD-Cluster (self-contained Stack:
# db + redis + keycloak + garage + api + web, alles unter lumen.mr-development.de).
# Nur lumen-web haengt im cluster-geteilten caddy-proxy-Netz (Netztrennung).
#
# Idempotent: taugt fuer Erst-Deploy UND Re-Deploys. Auf dem VPS in /opt/lumen:
#   bash deployment/deploy.sh
#
# Voraussetzungen: Repo nach /opt/lumen geklont, deployment/.env + config.prod.js
# vorhanden, caddy-proxy-Container laeuft, Mailserver-Account (SMTP_USER) angelegt.
set -euo pipefail

REPO_DIR="${REPO_DIR:-/opt/lumen}"
CADDYFILE="${CADDYFILE:-/opt/caddyserver/Caddyfile}"
CADDY_CONTAINER="${CADDY_CONTAINER:-caddy-proxy}"
CADDY_ENV="${CADDY_ENV:-/opt/caddyserver/.env}"
BACKUP_DIR="${BACKUP_DIR:-/opt/backups/lumen}"
DOMAIN="${DOMAIN:-lumen.mr-development.de}"
export COMPOSE_PROJECT_NAME=lumen
COMPOSE=(docker compose -f deployment/docker-compose.prod.yml --env-file deployment/.env)

cd "$REPO_DIR"
# shellcheck source=lib/env.sh
. deployment/lib/env.sh

# Caddy-Block ersetzen. Neue Datei erst als Kopie bauen und mit dem
# Cluster-Caddy-Image validieren — eine kaputte Live-Datei wuerde beim
# naechsten Caddy-Restart (Reboot, Deploy eines anderen Projekts) ALLE Sites
# des VPS mitreissen. Danach per `cat >` IN PLACE schreiben: der Caddyfile ist
# als Einzeldatei gemountet, ein `mv` (neue Inode) saehe der Container nicht.
swap_caddy_block() {
  local new="${CADDYFILE}.lumen-new"
  cp "$CADDYFILE" "${CADDYFILE}.bak.$(date +%Y%m%d-%H%M%S)"
  python3 - "$CADDYFILE" "$DOMAIN" infra/caddy/lumen.caddyfile "$new" <<'PY'
import sys
caddyfile, domain, blockfile, target = sys.argv[1:5]
lines = open(caddyfile).read().splitlines(keepends=True)
out, i, n = [], 0, len(lines)
while i < n:
    if lines[i].startswith(domain + " {"):
        depth = lines[i].count("{") - lines[i].count("}"); i += 1
        while i < n and depth > 0:
            depth += lines[i].count("{") - lines[i].count("}"); i += 1
        continue  # ganzen Block ueberspringen
    out.append(lines[i]); i += 1
out = [l for l in out if not l.strip().startswith("# --- Lumen")]
text = "".join(out).rstrip() + "\n\n# --- Lumen ---\n" + open(blockfile).read()
open(target, "w").write(text)
PY
  local image env_args=()
  image="$(docker inspect -f '{{.Config.Image}}' "$CADDY_CONTAINER")"
  [ -f "$CADDY_ENV" ] && env_args=(--env-file "$CADDY_ENV")
  if ! docker run --rm "${env_args[@]}" -v "$new:/etc/caddy/Caddyfile:ro" "$image" \
       caddy validate --config /etc/caddy/Caddyfile >/dev/null; then
    echo "FEHLER: neuer Caddyfile ungueltig — Live-Datei unveraendert ($new)"; return 1
  fi
  cat "$new" > "$CADDYFILE"; rm -f "$new"
  # Der Cluster-Caddy hat `admin off` -> `caddy reload` (Admin-API) geht NICHT.
  # Konfig wird per Container-Restart geladen (kurzer Blip fuer alle Sites).
  docker restart "$CADDY_CONTAINER" >/dev/null
  echo "   Lumen-Block ersetzt, validiert, Caddy neu gestartet."
}


# deployment/.env idempotent pflegen: NAME=WERT setzen und in die laufende
# Shell exportieren (compose-Interpolation: Shell-Env schlaegt --env-file,
# ein leer exportierter Altwert wuerde sonst gewinnen). Modus "if-empty"
# schreibt nur, wenn der Wert fehlt/leer ist; "force" ueberschreibt.
# Werte per Env an python (nicht in argv/ps), Datei-Inode + Modus bleiben.
# Nur Zeichen, die load_dotenv unquoted 1:1 zuruecklesen kann (kein
# Leerzeichen/#/Quote/$) — die Werte sind hex bzw. KC-Secrets (alnum).
env_set() {
  local mode="$1" name="$2" value="$3"
  if [ "$mode" = "if-empty" ] && [ -n "${!name:-}" ]; then return 0; fi
  [[ "$value" =~ ^[A-Za-z0-9._~:/@+=,-]*$ ]] \
    || { echo "FEHLER: env_set $name: Wert mit unzulaessigen Zeichen (nicht in .env geschrieben)"; return 1; }
  ENV_NAME="$name" ENV_VALUE="$value" python3 - deployment/.env <<'PY'
import os, re, sys
path, name, value = sys.argv[1], os.environ["ENV_NAME"], os.environ["ENV_VALUE"]
lines = open(path).read().splitlines(keepends=True)
pat = re.compile(rf"^{re.escape(name)}=")
for i, line in enumerate(lines):
    if pat.match(line):
        lines[i] = f"{name}={value}\n"
        break
else:
    if lines and not lines[-1].endswith("\n"):
        lines[-1] += "\n"
    lines.append(f"{name}={value}\n")
with open(path, "w") as f:
    f.write("".join(lines))
PY
  export "$name=$value"
}

# Least-Privilege-DB-Rollen (lumen_app / keycloak) idempotent anlegen bzw.
# bestehende Prod-DBs umstellen (Owner + alle Objekte). Muss laufen, BEVOR
# lumen-api / lumen-keycloak mit den neuen Credentials starten. Gleiches
# Script wie beim initdb-Erst-Init (eine Quelle).
ensure_db_roles() {
  "${COMPOSE[@]}" up -d --wait --wait-timeout 180 lumen-db
  docker exec -i -e LUMEN_DB_APP_PASSWORD -e KEYCLOAK_DB_PASSWORD lumen-db \
    bash -euo pipefail -s < deployment/initdb/02-app-roles.sh
}

# Keycloak schon initialisiert (Master-Realm in der DB 'keycloak')? Abfrage
# als POSTGRES_USER ueber den lokalen Socket. Jeder Fehler (DB/Tabelle fehlt)
# zaehlt als "nicht initialisiert" -> Bootstrap-Admin wird uebergeben; bei
# bestehendem Master-Realm ignoriert Keycloak den ohnehin (harmlos).
kc_initialized() {
  docker exec lumen-db psql -U "$POSTGRES_USER" -d keycloak -tAc \
    "SELECT count(*) FROM realm WHERE name = 'master'" 2>/dev/null \
    | tr -d '[:space:]' | grep -qx '[1-9][0-9]*'
}

# Das KC-Image hat KEIN curl — daher von lumen-api aus pruefen (hat curl und
# erreicht lumen-keycloak ueber das gemeinsame Netz).
wait_keycloak() {
  for _ in $(seq 1 80); do
    if docker exec lumen-api curl -fsS \
        http://lumen-keycloak:8080/auth/realms/master/.well-known/openid-configuration >/dev/null 2>&1; then
      echo "   Keycloak bereit."; return 0
    fi
    sleep 3
  done
  echo "FEHLER: Keycloak nicht bereit"; "${COMPOSE[@]}" logs --tail 40 lumen-keycloak; return 1
}

echo "==> [1/8] Code aktualisieren (git pull)"
# Fehlgeschlagener Pull darf NICHT stillschweigend alten Code deployen.
# Bewusster Deploy des lokalen Stands: SKIP_PULL=1 bash deployment/deploy.sh
if [ "${SKIP_PULL:-0}" != "1" ]; then
  git pull --ff-only || { echo "FEHLER: git pull --ff-only fehlgeschlagen (SKIP_PULL=1 zum Uebergehen)"; exit 1; }
fi

echo "==> [2/8] Konfiguration pruefen"
test -f deployment/.env            || { echo "FEHLER: deployment/.env fehlt (aus .env.example)"; exit 1; }
test -f deployment/config.prod.js  || { echo "FEHLER: deployment/config.prod.js fehlt"; exit 1; }
# Secrets: nur fuer den Deploy-User lesbar (Review L10). Danach .env als
# Daten laden, NICHT als Shell-Code sourcen (Review L11, lib/env.sh).
ensure_private_file deployment/.env || exit 1
load_dotenv deployment/.env || exit 1
if [ -n "${BACKUP_PASSPHRASE_FILE:-}" ]; then
  ensure_private_file "$BACKUP_PASSPHRASE_FILE" || exit 1
fi
: "${KC_ADMIN_USER:?KC_ADMIN_USER fehlt in .env (kcadm-Login)}"
: "${KC_ADMIN_PASSWORD:?KC_ADMIN_PASSWORD fehlt in .env (kcadm-Login)}"
# DB-Rollen-Passwoerter (Review M1): fehlen sie, hier generieren und in .env
# eintragen (hex -> URL-sicher in DATABASE_URL). Bestehende Werte bleiben.
env_set if-empty LUMEN_DB_APP_PASSWORD "$(python3 -c 'import secrets;print(secrets.token_hex(24))')"
env_set if-empty KEYCLOAK_DB_PASSWORD "$(python3 -c 'import secrets;print(secrets.token_hex(24))')"
[[ "$LUMEN_DB_APP_PASSWORD" =~ ^[A-Za-z0-9._~-]+$ ]] \
  || { echo "FEHLER: LUMEN_DB_APP_PASSWORD nur [A-Za-z0-9._~-] (steht in der DATABASE_URL)"; exit 1; }

echo "==> [3/8] caddy-proxy-Netz sicherstellen"
docker network inspect caddy-proxy >/dev/null 2>&1 || docker network create caddy-proxy

echo "==> [4/8] Backup + Pull + Build (--no-cache, Cluster-Konvention) + Start"
# Vor Image-Upgrades (Keycloak migriert sein DB-Schema beim Start) Backup
# ziehen — nur wenn der Stack schon laeuft (Erst-Deploy hat nichts zu sichern).
if [ "${SKIP_BACKUP:-0}" != "1" ] && docker ps --format '{{.Names}}' | grep -qx lumen-db; then
  bash deployment/backup.sh
fi
# Garage-Key-Format pruefen, bevor irgendetwas neu startet (sonst scheitert
# lumen-garage-init und die API startet nicht).
python3 -c "import re,os,sys;k=os.environ.get('GARAGE_S3_ACCESS_KEY_ID','');s=os.environ.get('GARAGE_S3_SECRET_ACCESS_KEY','');sys.exit(0 if re.fullmatch('GK[0-9a-f]{24}',k) and re.fullmatch('[0-9a-f]{64}',s) else 1)" \
  || { echo "FEHLER: GARAGE_S3_ACCESS_KEY_ID ('GK'+24 hex) / _SECRET_ACCESS_KEY (64 hex) ungueltig"; exit 1; }
# Gepinnte Service-Images aktualisieren; Basis-Images per --pull frisch, sonst
# bleiben Security-Patches der Floating-Tags (python/node) aus.
"${COMPOSE[@]}" pull --ignore-buildable
"${COMPOSE[@]}" build --pull --no-cache
# Erst die DB (inkl. Rollen-Umstellung), dann den Rest mit den neuen
# Least-Privilege-Credentials.
ensure_db_roles
# Bootstrap-Admin (Review L12): KC_BOOTSTRAP_ADMIN_* stehen in compose ohne
# Wert -> nur gesetzt, wenn sie hier exportiert sind. Das passiert NUR bei
# leerer KC-DB (Erst-Install); sonst landet das Admin-Passwort nicht in der
# Container-Env. kcadm (Schritt 6) loggt sich mit KC_ADMIN_* aus .env ein
# (per docker exec -e), nicht ueber die Container-Env.
if grep -Eq '^[[:space:]]*(export[[:space:]]+)?KC_BOOTSTRAP_ADMIN_' deployment/.env; then
  echo "FEHLER: KC_BOOTSTRAP_ADMIN_* in deployment/.env entfernen (KC_ADMIN_USER/_PASSWORD genuegen)"; exit 1
fi
unset KC_BOOTSTRAP_ADMIN_USERNAME KC_BOOTSTRAP_ADMIN_PASSWORD
KC_FIRST_INSTALL=0
if ! kc_initialized; then
  KC_FIRST_INSTALL=1
  export KC_BOOTSTRAP_ADMIN_USERNAME="$KC_ADMIN_USER" KC_BOOTSTRAP_ADMIN_PASSWORD="$KC_ADMIN_PASSWORD"
  echo "   Keycloak-DB leer -> Bootstrap-Admin '$KC_ADMIN_USER' wird einmalig uebergeben"
fi
"${COMPOSE[@]}" up -d

echo "==> [5/8] Caddy-Block sofort umstellen"
# Mit `up -d` verlassen API/Keycloak das caddy-proxy-Netz; der alte Caddy-
# Block routet noch direkt dorthin (502). Daher direkt danach umstellen.
swap_caddy_block

echo "==> [5a/8] Auf Keycloak warten (well-known)"
wait_keycloak || exit 1

echo "==> [5b/8] Einmalige Migration MinIO -> Garage (nur solange lumen-minio laeuft)"
# lumen-minio ist seit der Garage-Umstellung kein Compose-Service mehr, laeuft
# als Alt-Container aber im lumen-internal-Netz weiter. Bucket per
# scripts.s3_archive (Objekt-Ebene) aus MinIO lesen und in Garage schreiben,
# Manifeste (key + size) vergleichen, dann MinIO entfernen. Das Volume
# lumen_lumen-minio-data bleibt fuer einen Rollback erhalten.
if docker ps --format '{{.Names}}' | grep -qx lumen-minio; then
  # Alt-Container sofort aus dem geteilten Netz (Netztrennung), auch wenn die
  # Migration danach scheitert.
  docker network disconnect caddy-proxy lumen-minio 2>/dev/null || true
  : "${MINIO_ROOT_USER:?MINIO_ROOT_USER fehlt in .env (fuer die Migration noetig)}"
  : "${MINIO_ROOT_PASSWORD:?MINIO_ROOT_PASSWORD fehlt in .env}"
  MIG="$(mktemp)"; SRC_MF="$(mktemp)"; DST_MF="$(mktemp)"
  trap 'rm -f "$MIG" "$SRC_MF" "$DST_MF"' EXIT
  # Credentials per Env-Namen (-e NAME ohne Wert), nicht in argv/ps.
  MIG_ENV=(-e GARAGE_S3_ENDPOINT=http://lumen-minio:9000 -e GARAGE_S3_REGION=us-east-1
           -e GARAGE_S3_ACCESS_KEY_ID -e GARAGE_S3_SECRET_ACCESS_KEY)
  GARAGE_S3_ACCESS_KEY_ID="$MINIO_ROOT_USER" GARAGE_S3_SECRET_ACCESS_KEY="$MINIO_ROOT_PASSWORD" \
    docker exec "${MIG_ENV[@]}" lumen-api python -m scripts.s3_archive manifest > "$SRC_MF"
  GARAGE_S3_ACCESS_KEY_ID="$MINIO_ROOT_USER" GARAGE_S3_SECRET_ACCESS_KEY="$MINIO_ROOT_PASSWORD" \
    docker exec "${MIG_ENV[@]}" lumen-api python -m scripts.s3_archive export > "$MIG"
  docker exec -i lumen-api python -m scripts.s3_archive import < "$MIG"
  docker exec lumen-api python -m scripts.s3_archive manifest > "$DST_MF"
  # Jedes MinIO-Objekt muss mit gleicher Groesse in Garage liegen.
  MISSING="$(LC_ALL=C comm -23 "$SRC_MF" "$DST_MF" | wc -l)"
  echo "   MinIO: $(wc -l < "$SRC_MF") Objekte, Garage: $(wc -l < "$DST_MF"), fehlend/abweichend: $MISSING"
  if [ "$MISSING" != "0" ]; then
    echo "FEHLER: Migration unvollstaendig — lumen-minio bleibt (ohne caddy-proxy) stehen."
    LC_ALL=C comm -23 "$SRC_MF" "$DST_MF" | head -5
    exit 1
  fi
  # Archiv als zusaetzliches Backup: verschluesselt + in die Backup-Retention.
  mkdir -p "$BACKUP_DIR"; chmod 700 "$BACKUP_DIR"
  if [ -n "${BACKUP_PASSPHRASE_FILE:-}" ] && [ -r "$BACKUP_PASSPHRASE_FILE" ]; then
    gzip -c "$MIG" | gpg --batch --yes --quiet --symmetric --cipher-algo AES256 \
      --passphrase-file "$BACKUP_PASSPHRASE_FILE" \
      -o "$BACKUP_DIR/bucket-minio-migration-$(date +%Y%m%d-%H%M%S).tar.gz.gpg"
  else
    echo "   WARN: keine Backup-Passphrase — Migrationsarchiv wird nicht aufbewahrt"
  fi
  docker stop lumen-minio >/dev/null && docker rm lumen-minio >/dev/null
  echo "   Migration fertig, lumen-minio entfernt (Volume bleibt)."
fi

echo "==> [5c/8] Marketplace-Vorschauen backfillen (Migration 011, idempotent)"
# Oeffentliche Presets von vor Migration 011 haben noch keinen preview_key
# (previewUrl null). Das Skript erzeugt fehlende Vorschauen; bereits
# vorhandene werden uebersprungen. Fehler blockieren den Deploy nicht.
docker exec lumen-api python -m scripts.backfill_previews \
  || echo "   WARN: backfill_previews fehlgeschlagen — spaeter manuell nachholen."

echo "==> [5d/8] Bild-Vorschaubilder backfillen (Migration 013, idempotent)"
# Bilder von vor H2a haben noch kein thumb_key (thumbUrl null). Das Skript
# erzeugt fuer JPEG/PNG/TIFF serverseitig Vorschauen (ohne Bearbeitung);
# RAW bekommt sie beim naechsten Oeffnen im Editor. Fehler blockieren den
# Deploy nicht.
docker exec lumen-api python -m scripts.backfill_thumbnails \
  || echo "   WARN: backfill_thumbnails fehlgeschlagen — spaeter manuell nachholen."

echo "==> [6/8] Keycloak-SMTP + Realm-Haertung im Realm 'lumen' setzen"
# Passwort per Env (KC_CLI_PASSWORD) statt --password: nicht in der Prozessliste.
KCADM=(docker exec -i lumen-keycloak /opt/keycloak/bin/kcadm.sh)
KC_CLI_PASSWORD="$KC_ADMIN_PASSWORD" docker exec -e KC_CLI_PASSWORD lumen-keycloak \
  /opt/keycloak/bin/kcadm.sh config credentials \
  --server http://localhost:8080/auth --realm master --user "$KC_ADMIN_USER"
# smtpServer ist ein Map-Feld — kcadm `-s smtpServer.host=...` (dotted) bzw.
# `-s smtpServer={json}` greifen NICHT zuverlaessig. Stattdessen Merge-Update
# via partiellem JSON ueber stdin (-f -). Werte aus .env.
python3 -c "import json,os;print(json.dumps({'smtpServer':{'host':os.environ['SMTP_HOST'],'port':os.environ['SMTP_PORT'],'from':os.environ['SMTP_FROM'],'fromDisplayName':os.environ['SMTP_FROM_DISPLAY'],'ssl':'false','starttls':'true','auth':'true','user':os.environ['SMTP_USER'],'password':os.environ['SMTP_PASSWORD'],'replyTo':os.environ['SMTP_FROM']}}))" \
  | "${KCADM[@]}" update realms/lumen -f -
echo "   SMTP gesetzt (from=$SMTP_FROM via $SMTP_HOST:$SMTP_PORT)"
# Realm-Import greift nur beim allerersten Start -> Haertung aus
# lumen-realm.prod.json hier idempotent auf den laufenden Realm uebertragen.
# Werte kommen AUSSCHLIESSLICH aus der Prod-Realm-JSON (kein Drift).
# Achtung verifyEmail: Bestands-User mit emailVerified=false muessen beim
# naechsten Login ihre Adresse bestaetigen (SMTP ist oben gesetzt).
python3 - <<'PY' | "${KCADM[@]}" update realms/lumen -f -
import json
r = json.load(open("infra/keycloak/lumen-realm.prod.json"))
keys = ["passwordPolicy", "eventsEnabled", "eventsExpiration",
        "adminEventsEnabled", "adminEventsDetailsEnabled",
        "verifyEmail", "sslRequired",
        "bruteForceProtected", "permanentLockout", "failureFactor",
        "maxFailureWaitSeconds", "minimumQuickLoginWaitSeconds",
        "waitIncrementSeconds", "quickLoginCheckMilliSeconds",
        "maxDeltaTimeSeconds",
        # Token-/Session-Laufzeiten + Registrierung (Review L13)
        "accessTokenLifespan", "ssoSessionMaxLifespan", "ssoSessionIdleTimeout",
        "revokeRefreshToken", "refreshTokenMaxReuse",
        "duplicateEmailsAllowed", "registrationAllowed"]
print(json.dumps({k: r[k] for k in keys}))
PY
# Client-Felder aus der Realm-JSON; die Prod-Domain darin wird auf $DOMAIN
# abgebildet (Default identisch).
realm_client_json() {
  python3 - "$1" "$DOMAIN" "${@:2}" <<'PY'
import json, sys
client_id, domain, keys = sys.argv[1], sys.argv[2], sys.argv[3:]
r = json.load(open("infra/keycloak/lumen-realm.prod.json"))
c = next(c for c in r["clients"] if c["clientId"] == client_id)
out = json.dumps({k: c[k] for k in keys if k in c})
print(out.replace("https://lumen.mr-development.de", "https://" + domain))
PY
}
CID="$("${KCADM[@]}" get clients -r lumen -q clientId=lumen-frontend --fields id --format csv --noquotes </dev/null | tr -d '\r')"
[ -n "$CID" ] || { echo "FEHLER: Client lumen-frontend nicht gefunden"; exit 1; }
# Public SPA-Client: kein ROPC (directAccessGrants), exakte Redirect-URIs +
# Web-Origins, PKCE S256, Post-Logout-Redirect.
realm_client_json lumen-frontend publicClient standardFlowEnabled implicitFlowEnabled \
    directAccessGrantsEnabled serviceAccountsEnabled redirectUris webOrigins attributes \
  | "${KCADM[@]}" update "clients/$CID" -r lumen --merge -f -
# Audience-Mapper: KC >= 26.x setzt "included.client.audience" nur noch fuer
# EXISTIERENDE Clients — einen Client "lumen-api" gibt es nicht, ohne
# Umstellung fehlt aud=lumen-api im Token und jeder API-Call wird 401.
MAPPERS="$("${KCADM[@]}" get "clients/$CID/protocol-mappers/models" -r lumen </dev/null)"
MID="$(printf '%s' "$MAPPERS" | python3 -c "import json,sys;print(next((m['id'] for m in json.load(sys.stdin) if m['name']=='audience-lumen-api'),''))")"
if [ -n "$MID" ]; then
  printf '%s' "$MAPPERS" | python3 -c "
import json,sys
m = next(m for m in json.load(sys.stdin) if m['name'] == 'audience-lumen-api')
m['config'].pop('included.client.audience', None)
m['config']['included.custom.audience'] = 'lumen-api'
print(json.dumps(m))" | "${KCADM[@]}" update "clients/$CID/protocol-mappers/models/$MID" -r lumen -f -
  echo "   Audience-Mapper auf custom audience 'lumen-api' gesetzt"
fi
# Public-SPA-Client soll keine Offline-Tokens (nie ablaufende Refresh-Tokens) bekommen.
"${KCADM[@]}" remove-roles -r lumen --rname default-roles-lumen --rolename offline_access 2>/dev/null || true
echo "   Realm-Haertung gesetzt (Password-Policy, Events, Brute-Force, verifyEmail, sslRequired, Frontend-Client, kein offline_access)"

echo "==> [6a/8] Service-Account 'lumen-admin' fuer DELETE /me (KC-Account-Loeschung)"
# Confidential Client nur mit client_credentials und GENAU der Rolle
# realm-management/manage-users (reicht fuer DELETE /admin/realms/lumen/
# users/{id}). Secret generiert Keycloak; es landet nur in deployment/.env.
ACID="$("${KCADM[@]}" get clients -r lumen -q clientId=lumen-admin --fields id --format csv --noquotes </dev/null | tr -d '\r')"
ADMIN_KEYS=(clientId name description enabled publicClient clientAuthenticatorType
            standardFlowEnabled implicitFlowEnabled directAccessGrantsEnabled
            serviceAccountsEnabled frontchannelLogout protocol redirectUris webOrigins attributes)
if [ -z "$ACID" ]; then
  ACID="$(realm_client_json lumen-admin "${ADMIN_KEYS[@]}" \
    | "${KCADM[@]}" create clients -r lumen -f - -i | tr -d '\r')"
  echo "   Client lumen-admin angelegt"
else
  realm_client_json lumen-admin "${ADMIN_KEYS[@]}" \
    | "${KCADM[@]}" update "clients/$ACID" -r lumen --merge -f -
fi
[ -n "$ACID" ] || { echo "FEHLER: Client lumen-admin nicht anlegbar"; exit 1; }
"${KCADM[@]}" add-roles -r lumen --uusername service-account-lumen-admin \
  --cclientid realm-management --rolename manage-users </dev/null
# Review M3 (accepted risk, docs/08 R9): Client-Flags gegenlesen — nur
# client_credentials, confidential, Access-Token 60 s. Abweichung = Abbruch.
"${KCADM[@]}" get "clients/$ACID" -r lumen </dev/null | python3 -c '
import json, sys
c = json.load(sys.stdin)
want = {"publicClient": False, "standardFlowEnabled": False, "implicitFlowEnabled": False,
        "directAccessGrantsEnabled": False, "serviceAccountsEnabled": True}
bad = [k for k, v in want.items() if c.get(k) != v]
if c.get("attributes", {}).get("access.token.lifespan") != "60":
    bad.append("attributes.access.token.lifespan")
if bad:
    sys.exit("FEHLER: lumen-admin-Client weicht ab: " + ", ".join(bad))
'
# Service-Account hat GENAU realm-management/manage-users: alles andere
# (v.a. default-roles-lumen, das KC jedem Service-Account gibt) entfernen.
SAID="$("${KCADM[@]}" get "clients/$ACID/service-account-user" -r lumen --fields id \
  --format csv --noquotes </dev/null | tr -d '\r')"
[ -n "$SAID" ] || { echo "FEHLER: service-account-lumen-admin nicht gefunden"; exit 1; }
"${KCADM[@]}" get "users/$SAID/role-mappings" -r lumen </dev/null | python3 -c '
import json, sys
m = json.load(sys.stdin)
for r in m.get("realmMappings", []):
    print("realm", "-", r["name"])
for cid, cm in (m.get("clientMappings") or {}).items():
    for r in cm.get("mappings", []):
        if (cid, r["name"]) != ("realm-management", "manage-users"):
            print("client", cid, r["name"])
' | while read -r kind cid role; do
  if [ "$kind" = realm ]; then
    "${KCADM[@]}" remove-roles -r lumen --uid "$SAID" --rolename "$role" </dev/null
  else
    "${KCADM[@]}" remove-roles -r lumen --uid "$SAID" --cclientid "$cid" --rolename "$role" </dev/null
  fi
  if [ "$kind" = realm ]; then echo "   service-account-lumen-admin: Realm-Rolle $role entfernt"; else echo "   service-account-lumen-admin: Rolle $cid/$role entfernt"; fi
done
ASECRET="$("${KCADM[@]}" get "clients/$ACID/client-secret" -r lumen </dev/null \
  | python3 -c "import json,sys;print(json.load(sys.stdin)['value'])")"
[ -n "$ASECRET" ] || { echo "FEHLER: lumen-admin-Secret nicht lesbar"; exit 1; }
# Eigener Client in .env (leer oder lumen-admin): Secret aus KC synchron
# halten (auch nach Rotation in KC). Fremder Client-Name: unangetastet.
if [ -z "${KEYCLOAK_ADMIN_CLIENT_ID:-}" ] || [ "$KEYCLOAK_ADMIN_CLIENT_ID" = "lumen-admin" ]; then
  OLD_SECRET="${KEYCLOAK_ADMIN_CLIENT_SECRET:-}"
  env_set force KEYCLOAK_ADMIN_CLIENT_ID lumen-admin
  env_set force KEYCLOAK_ADMIN_CLIENT_SECRET "$ASECRET"
  if [ "$OLD_SECRET" != "$ASECRET" ]; then
    # API mit den neuen Werten neu erzeugen (Env wird nur beim Create gelesen).
    "${COMPOSE[@]}" up -d --no-deps lumen-api
    echo "   KEYCLOAK_ADMIN_CLIENT_ID/SECRET in .env geschrieben, lumen-api neu erzeugt"
  fi
else
  echo "   WARN: KEYCLOAK_ADMIN_CLIENT_ID=$KEYCLOAK_ADMIN_CLIENT_ID (nicht lumen-admin) — unveraendert"
fi
unset ASECRET OLD_SECRET

if [ "$KC_FIRST_INSTALL" = 1 ]; then
  echo "==> [6b/8] Keycloak ohne Bootstrap-Admin-Env neu erzeugen (Erst-Install)"
  # Admin-Account bleibt in der KC-DB; nur das Passwort verschwindet aus der
  # Container-Env (docker inspect).
  unset KC_BOOTSTRAP_ADMIN_USERNAME KC_BOOTSTRAP_ADMIN_PASSWORD
  "${COMPOSE[@]}" up -d --no-deps lumen-keycloak
  wait_keycloak || exit 1
fi

echo "==> [7/8] Smoke-Test"
sleep 3
curl -fsS "https://${DOMAIN}/api/v1/health" && echo "  <- /api/v1/health OK"
curl -fsS "https://${DOMAIN}/auth/realms/lumen/.well-known/openid-configuration" \
  | grep -o '"issuer":"[^"]*"' && echo "  <- Keycloak-Issuer OK"
curl -fsS "https://${DOMAIN}/config.js" >/dev/null && echo "  <- config.js OK"
# Keycloak-Admin-REST-API/-Konsole darf von aussen NICHT erreichbar sein.
for path in /auth/admin/ /auth/admin/realms/lumen/users /auth/realms/master/; do
  code="$(curl -s -o /dev/null -w '%{http_code}' "https://${DOMAIN}${path}")"
  [ "$code" = "404" ] || { echo "FEHLER: ${path} liefert ${code} statt 404"; exit 1; }
done
echo "  <- /auth/admin + Master-Realm gesperrt (404)"
echo "==> Deploy abgeschlossen: https://${DOMAIN}"
