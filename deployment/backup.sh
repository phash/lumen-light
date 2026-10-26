#!/usr/bin/env bash
# Lumen · light — Backup (Postgres lumen + keycloak DB, Garage-Bucket).
# Auf dem VPS:  bash deployment/backup.sh    (z.B. taeglich per cron)
#
#   0 3 * * *  cd /opt/lumen && bash deployment/backup.sh >> /var/log/lumen-backup.log 2>&1
#
# Verschluesselung: gpg --symmetric (AES256) mit BACKUP_PASSPHRASE_FILE.
# Offsite: rsync nach BACKUP_REMOTE (optional). Restore siehe
# infra/deployment-runbook.md.
set -euo pipefail
# Dumps enthalten Passwort-Hashes (Keycloak) + personenbezogene Daten ->
# nur fuer den ausfuehrenden User lesbar.
umask 077

REPO_DIR="${REPO_DIR:-/opt/lumen}"
BACKUP_DIR="${BACKUP_DIR:-/opt/backups/lumen}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

cd "$REPO_DIR"
set -a; . deployment/.env; set +a
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
TS="$(date +%Y%m%d-%H%M%S)"

# Dumps enthalten Passwort-Hashes + personenbezogene Daten: ohne Passphrase
# abbrechen. Bewusst unverschluesselt (z.B. lokaler Test): BACKUP_ALLOW_PLAINTEXT=1
# — dann wird auch NICHT offsite kopiert (rsync nimmt nur *.gpg).
PASSFILE="${BACKUP_PASSPHRASE_FILE:-}"
if [ -n "$PASSFILE" ] && [ -r "$PASSFILE" ]; then
  seal() { gpg --batch --yes --quiet --symmetric --cipher-algo AES256 \
             --passphrase-file "$PASSFILE" -o "$1.gpg" "$1" && rm -f "$1"; }
  EXT=".gpg"
elif [ "${BACKUP_ALLOW_PLAINTEXT:-0}" = "1" ]; then
  echo "   WARN: BACKUP_ALLOW_PLAINTEXT=1 — Backup UNVERSCHLUESSELT, kein Offsite"
  seal() { :; }
  EXT=""
else
  echo "FEHLER: BACKUP_PASSPHRASE_FILE fehlt/unlesbar (siehe infra/deployment-runbook.md)"
  exit 1
fi

echo "==> Postgres-Dumps ($TS)"
docker exec lumen-db pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" \
  | gzip > "$BACKUP_DIR/lumen-db-$TS.sql.gz"
docker exec lumen-db pg_dump -U "$POSTGRES_USER" keycloak \
  | gzip > "$BACKUP_DIR/keycloak-db-$TS.sql.gz"
seal "$BACKUP_DIR/lumen-db-$TS.sql.gz"
seal "$BACKUP_DIR/keycloak-db-$TS.sql.gz"
echo "   DB-Dumps: lumen-db-$TS.sql.gz$EXT keycloak-db-$TS.sql.gz$EXT"

echo "==> Bucket '${GARAGE_S3_BUCKET}' exportieren (Objekt-Ebene, tar)"
# Ueber die API (gleiche Credentials/Settings) statt Volume-Tar: konsistent
# ohne Garage-Metadaten-Snapshot und backend-unabhaengig.
if docker exec lumen-api python -m scripts.s3_archive export \
     | gzip > "$BACKUP_DIR/bucket-$TS.tar.gz"; then
  seal "$BACKUP_DIR/bucket-$TS.tar.gz"
  echo "   Bucket -> bucket-$TS.tar.gz$EXT"
else
  rm -f "$BACKUP_DIR/bucket-$TS.tar.gz"
  echo "   WARN: Bucket-Export fehlgeschlagen (uebersprungen)"
fi

echo "==> Retention: aelter als ${RETENTION_DAYS} Tage entfernen"
find "$BACKUP_DIR" -maxdepth 1 -type f \( -name "*.sql.gz*" -o -name "bucket-*.tar.gz*" \) \
  -mtime "+${RETENTION_DAYS}" -delete
# Alt-Format (MinIO-Spiegel-Verzeichnisse bis 2026-10) laeuft mit aus.
find "$BACKUP_DIR" -maxdepth 1 -type d -name "minio-*" -mtime "+${RETENTION_DAYS}" -exec rm -rf {} +

if [ -n "${BACKUP_REMOTE:-}" ]; then
  echo "==> Offsite-Kopie nach $BACKUP_REMOTE"
  # Nur verschluesselte Dateien. KEIN --delete: wer lokal Backups loescht
  # (Angreifer, Bug), soll die Offsite-Historie nicht mitloeschen koennen —
  # Retention am Ziel separat (z.B. find -mtime im Ziel-Cron).
  rsync -a --include="*.gpg" --exclude="*" \
    "$BACKUP_DIR/" "$BACKUP_REMOTE/" \
    && echo "   Offsite OK" \
    || { echo "   FEHLER: Offsite-Kopie fehlgeschlagen"; exit 1; }
else
  echo "   WARN: BACKUP_REMOTE leer — Backup liegt nur auf diesem Host"
fi
echo "==> Backup fertig ($TS) in $BACKUP_DIR"
