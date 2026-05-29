#!/usr/bin/env bash
# Lumen · light — Backup (Postgres lumen + keycloak DB, MinIO-Bucket).
# Auf dem VPS:  bash deployment/backup.sh    (z.B. taeglich per cron)
#
#   0 3 * * *  cd /opt/lumen && bash deployment/backup.sh >> /var/log/lumen-backup.log 2>&1
set -euo pipefail

REPO_DIR="${REPO_DIR:-/opt/lumen}"
BACKUP_DIR="${BACKUP_DIR:-/opt/backups/lumen}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
MC_IMAGE="${MC_IMAGE:-minio/mc:RELEASE.2024-11-17T19-35-25Z}"

cd "$REPO_DIR"
set -a; . deployment/.env; set +a
mkdir -p "$BACKUP_DIR"
TS="$(date +%Y%m%d-%H%M%S)"

echo "==> Postgres-Dumps ($TS)"
docker exec lumen-db pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" \
  | gzip > "$BACKUP_DIR/lumen-db-$TS.sql.gz"
docker exec lumen-db pg_dump -U "$POSTGRES_USER" keycloak \
  | gzip > "$BACKUP_DIR/keycloak-db-$TS.sql.gz"
echo "   DB-Dumps: $(ls -1 "$BACKUP_DIR"/*-"$TS".sql.gz)"

echo "==> MinIO-Bucket '${GARAGE_S3_BUCKET}' spiegeln"
NET="$(docker network ls --format '{{.Name}}' | grep -E 'lumen-internal$' | head -1)"
if [ -n "$NET" ]; then
  docker run --rm --network "$NET" \
    -e "MC_HOST_local=http://${MINIO_ROOT_USER}:${MINIO_ROOT_PASSWORD}@lumen-minio:9000" \
    -v "$BACKUP_DIR:/backup" "$MC_IMAGE" \
    mirror --overwrite "local/${GARAGE_S3_BUCKET}" "/backup/minio-$TS" \
    && echo "   MinIO -> $BACKUP_DIR/minio-$TS" \
    || echo "   WARN: MinIO-Backup fehlgeschlagen (uebersprungen)"
else
  echo "   WARN: lumen-internal-Netz nicht gefunden — MinIO-Backup uebersprungen"
fi

echo "==> Retention: aelter als ${RETENTION_DAYS} Tage entfernen"
find "$BACKUP_DIR" -maxdepth 1 -name "*.sql.gz" -mtime "+${RETENTION_DAYS}" -delete
find "$BACKUP_DIR" -maxdepth 1 -type d -name "minio-*" -mtime "+${RETENTION_DAYS}" -exec rm -rf {} +
echo "==> Backup fertig ($TS) in $BACKUP_DIR"
