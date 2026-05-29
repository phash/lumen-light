#!/usr/bin/env bash
# Lumen · light — Production-Deploy auf dem MRD-Cluster (self-contained Stack:
# db + redis + keycloak + minio + api + web, alles unter lumen.mr-development.de).
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
DOMAIN="${DOMAIN:-lumen.mr-development.de}"
export COMPOSE_PROJECT_NAME=lumen
COMPOSE=(docker compose -f deployment/docker-compose.prod.yml --env-file deployment/.env)

cd "$REPO_DIR"

echo "==> [1/8] Code aktualisieren (git pull)"
git pull --ff-only || echo "   (kein FF-Pull moeglich — uebersprungen)"

echo "==> [2/8] Konfiguration pruefen"
test -f deployment/.env            || { echo "FEHLER: deployment/.env fehlt (aus .env.example)"; exit 1; }
test -f deployment/config.prod.js  || { echo "FEHLER: deployment/config.prod.js fehlt"; exit 1; }
set -a; . deployment/.env; set +a

echo "==> [3/8] caddy-proxy-Netz sicherstellen"
docker network inspect caddy-proxy >/dev/null 2>&1 || docker network create caddy-proxy

echo "==> [4/8] Build (--no-cache, Cluster-Konvention) + Start"
"${COMPOSE[@]}" build --no-cache
"${COMPOSE[@]}" up -d

echo "==> [5/8] Auf Keycloak warten (well-known)"
# Das KC-Image hat KEIN curl — daher von lumen-api aus pruefen (hat curl und
# erreicht lumen-keycloak ueber das gemeinsame Netz).
for i in $(seq 1 80); do
  if docker exec lumen-api curl -fsS \
      http://lumen-keycloak:8080/auth/realms/master/.well-known/openid-configuration >/dev/null 2>&1; then
    echo "   Keycloak bereit."; break
  fi
  sleep 3
  [ "$i" = 80 ] && { echo "FEHLER: Keycloak nicht bereit"; "${COMPOSE[@]}" logs --tail 40 lumen-keycloak; exit 1; }
done

echo "==> [6/8] Keycloak-SMTP (Projektmailserver) im Realm 'lumen' setzen"
docker exec lumen-keycloak /opt/keycloak/bin/kcadm.sh config credentials \
  --server http://localhost:8080/auth --realm master \
  --user "$KC_ADMIN_USER" --password "$KC_ADMIN_PASSWORD"
# smtpServer ist ein Map-Feld — kcadm `-s smtpServer.host=...` (dotted) bzw.
# `-s smtpServer={json}` greifen NICHT zuverlaessig. Stattdessen Merge-Update
# via partiellem JSON ueber stdin (-f -). Werte aus .env.
python3 -c "import json,os;print(json.dumps({'smtpServer':{'host':os.environ['SMTP_HOST'],'port':os.environ['SMTP_PORT'],'from':os.environ['SMTP_FROM'],'fromDisplayName':os.environ['SMTP_FROM_DISPLAY'],'ssl':'false','starttls':'true','auth':'true','user':os.environ['SMTP_USER'],'password':os.environ['SMTP_PASSWORD'],'replyTo':os.environ['SMTP_FROM']}}))" \
  | docker exec -i lumen-keycloak /opt/keycloak/bin/kcadm.sh update realms/lumen -f -
echo "   SMTP gesetzt (from=$SMTP_FROM via $SMTP_HOST:$SMTP_PORT)"

echo "==> [7/8] Caddy-Block (neu) setzen + validieren + restart"
# Bestehenden Lumen-Block + Marker entfernen und frisch anhaengen — so greifen
# auch CSP-/Routing-Aenderungen bei Re-Deploys (nicht nur beim ersten Mal).
cp "$CADDYFILE" "${CADDYFILE}.bak.$(date +%Y%m%d-%H%M%S)"
python3 - "$CADDYFILE" "$DOMAIN" infra/caddy/lumen.caddyfile <<'PY'
import sys
caddyfile, domain, blockfile = sys.argv[1], sys.argv[2], sys.argv[3]
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
open(caddyfile, "w").write(text)
print("   Lumen-Block ersetzt (Backup angelegt).")
PY
# Erst validieren (faengt Syntaxfehler ab, bevor wir neu starten).
docker exec "$CADDY_CONTAINER" caddy validate --config /etc/caddy/Caddyfile
# Der Cluster-Caddy hat `admin off` -> `caddy reload` (Admin-API) geht NICHT.
# Konfig wird per Container-Restart geladen (kurzer Blip fuer alle Sites).
docker restart "$CADDY_CONTAINER" >/dev/null
echo "   Caddy neu gestartet (Config geladen)."

echo "==> [8/8] Smoke-Test"
sleep 3
curl -fsS "https://${DOMAIN}/api/v1/health" && echo "  <- /api/v1/health OK"
curl -fsS "https://${DOMAIN}/auth/realms/lumen/.well-known/openid-configuration" \
  | grep -o '"issuer":"[^"]*"' && echo "  <- Keycloak-Issuer OK"
curl -fsS "https://${DOMAIN}/config.js" >/dev/null && echo "  <- config.js OK"
echo "==> Deploy abgeschlossen: https://${DOMAIN}"
