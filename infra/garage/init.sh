#!/usr/bin/env bash
# Idempotente Bucket- und Access-Key-Anlage in einem laufenden Garage-Cluster.
#
# Voraussetzungen:
#   - Container 'garage' laeuft im caddy-proxy-Cluster
#   - garage-CLI im Container verfuegbar (Default-Image dxflrs/garage:v1.x)
#
# Aufruf:
#   bash infra/garage/init.sh
#
# Schreibt am Ende einen .env-Snippet nach STDOUT, der per Hand in das
# deployment/.env-File uebertragen werden muss (Secrets nie ins Repo).

set -euo pipefail

GARAGE_CONTAINER="${GARAGE_CONTAINER:-garage}"
BUCKET_NAME="${BUCKET_NAME:-lumen-images}"
KEY_NAME="${KEY_NAME:-lumen-app-rw}"

run_garage() {
    docker exec "$GARAGE_CONTAINER" /garage "$@"
}

echo "==> Pruefe Garage-Container '$GARAGE_CONTAINER'..."
if ! docker ps --format '{{.Names}}' | grep -qx "$GARAGE_CONTAINER"; then
    echo "FEHLER: Container '$GARAGE_CONTAINER' laeuft nicht." >&2
    exit 1
fi

echo "==> Bucket '$BUCKET_NAME' anlegen (idempotent)..."
if run_garage bucket info "$BUCKET_NAME" >/dev/null 2>&1; then
    echo "    Bucket existiert bereits."
else
    run_garage bucket create "$BUCKET_NAME"
    echo "    Bucket angelegt."
fi

echo "==> Key '$KEY_NAME' anlegen (idempotent)..."
if run_garage key info "$KEY_NAME" >/dev/null 2>&1; then
    echo "    Key existiert bereits."
else
    run_garage key create "$KEY_NAME"
fi

# Key-Info abrufen (Access + Secret)
KEY_INFO_RAW="$(run_garage key info "$KEY_NAME" --show-secret)"

ACCESS_KEY="$(echo "$KEY_INFO_RAW" | awk '/Key ID:/ {print $3}')"
SECRET_KEY="$(echo "$KEY_INFO_RAW" | awk '/Secret key:/ {print $3}')"

if [[ -z "$ACCESS_KEY" || -z "$SECRET_KEY" ]]; then
    echo "FEHLER: Key-Info konnte nicht geparst werden:" >&2
    echo "$KEY_INFO_RAW" >&2
    exit 1
fi

echo "==> Bucket-Permissions setzen..."
run_garage bucket allow --read --write --owner "$BUCKET_NAME" --key "$KEY_NAME" || true

echo
echo "==> Fertig. Diese Zeilen ins deployment/.env uebernehmen:"
cat <<EOF
GARAGE_S3_ACCESS_KEY_ID=$ACCESS_KEY
GARAGE_S3_SECRET_ACCESS_KEY=$SECRET_KEY
GARAGE_S3_BUCKET=$BUCKET_NAME
EOF
