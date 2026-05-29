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
docker exec lumen-keycloak /opt/keycloak/bin/kcadm.sh update realms/lumen \
  -s "smtpServer.host=$SMTP_HOST" -s "smtpServer.port=$SMTP_PORT" \
  -s "smtpServer.from=$SMTP_FROM" -s "smtpServer.fromDisplayName=$SMTP_FROM_DISPLAY" \
  -s "smtpServer.ssl=false" -s "smtpServer.starttls=true" -s "smtpServer.auth=true" \
  -s "smtpServer.user=$SMTP_USER" -s "smtpServer.password=$SMTP_PASSWORD" \
  && echo "   SMTP gesetzt (from=$SMTP_FROM via $SMTP_HOST:$SMTP_PORT)"

echo "==> [7/8] Caddy-Block sicherstellen + validieren + reload"
if ! grep -q "^${DOMAIN} {" "$CADDYFILE"; then
  cp "$CADDYFILE" "${CADDYFILE}.bak.$(date +%Y%m%d-%H%M%S)"
  printf '\n# --- Lumen (auto-eingefuegt von deployment/deploy.sh) ---\n' >> "$CADDYFILE"
  cat infra/caddy/lumen.caddyfile >> "$CADDYFILE"
  echo "   Lumen-Block angehaengt (Backup der Caddyfile angelegt)."
else
  echo "   Lumen-Block bereits vorhanden."
fi
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
