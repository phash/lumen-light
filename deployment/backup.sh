#!/usr/bin/env bash
# Lumen · light — Backup (Postgres lumen + keycloak DB, Garage-Bucket).
# Auf dem VPS:  bash deployment/backup.sh    (z.B. taeglich per cron)
#
#   0 3 * * *  cd /opt/lumen && bash deployment/backup.sh >> /var/log/lumen-backup.log 2>&1
#
# Verschluesselung: gpg --symmetric (AES256) mit BACKUP_PASSPHRASE_FILE.
# Offsite: rsync nach BACKUP_REMOTE (optional). Restore siehe
# infra/deployment-runbook.md.
#
# Aufbewahrung (fest, so auch in der Datenschutzerklaerung genannt):
#   - lokal:   RETENTION_DAYS (Default 14 Tage), raeumt dieses Script selbst.
#   - offsite: 30 Tage, ausgefuehrt AM ZIEL per Cron des Backup-Users (dieses
#              Script loescht dort bewusst nichts, rsync ohne --delete):
#                15 4 * * *  find /srv/lumen -maxdepth 1 -type f -name '*.gpg' -mtime +30 -delete
#
# Exit-Code: != 0, wenn IRGENDEIN Teil fehlschlaegt (auch der Bucket-Export —
# die bis dahin verschluesselten DB-Dumps bleiben dabei erhalten und gehen
# trotzdem offsite). Abgebrochene Laeufe hinterlassen KEINE unverschluesselten
# Teil-Dateien (trap unten).
set -euo pipefail
# Dumps enthalten Passwort-Hashes (Keycloak) + personenbezogene Daten ->
# nur fuer den ausfuehrenden User lesbar.
umask 077

REPO_DIR="${REPO_DIR:-/opt/lumen}"
BACKUP_DIR="${BACKUP_DIR:-/opt/backups/lumen}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

cd "$REPO_DIR"
# shellcheck source=lib/env.sh
. deployment/lib/env.sh
# .env als Daten laden, nicht als Shell-Code sourcen; Secrets nur fuer den
# ausfuehrenden User lesbar (Review L10/L11).
ensure_private_file deployment/.env || exit 1
load_dotenv deployment/.env || exit 1
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
TS="$(date +%Y%m%d-%H%M%S)"

# Dumps enthalten Passwort-Hashes + personenbezogene Daten: ohne Passphrase
# abbrechen. Bewusst unverschluesselt (z.B. lokaler Test): BACKUP_ALLOW_PLAINTEXT=1
# — dann wird auch NICHT offsite kopiert (rsync nimmt nur *.gpg).
PASSFILE="${BACKUP_PASSPHRASE_FILE:-}"
if [ -n "$PASSFILE" ] && [ -r "$PASSFILE" ]; then
  ensure_private_file "$PASSFILE" || exit 1
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

# Aufraeumen bei Abbruch/Fehler (pg_dump, gzip, gpg, Signal): die gerade
# geschriebene Datei ($CURRENT) ist unvollstaendig -> samt evtl. halbem .gpg
# weg. Im Verschluesselungs-Modus zusaetzlich JEDE unversiegelte Klartext-
# Datei dieses Laufs entfernen — Klartext-Dumps duerfen nie liegen bleiben.
CURRENT=""
cleanup() {
  local rc=$?
  if [ -n "$CURRENT" ]; then
    rm -f -- "$CURRENT" "$CURRENT.gpg"
  fi
  if [ "$EXT" = ".gpg" ]; then
    rm -f -- "$BACKUP_DIR"/*-"$TS".sql.gz "$BACKUP_DIR"/*-"$TS".tar.gz
  fi
  return "$rc"
}
trap cleanup EXIT
trap 'exit 130' INT TERM
FAILED=0

echo "==> Postgres-Dumps ($TS)"
# pg_dump als Superuser (POSTGRES_USER, lokaler Socket). Die Dumps enthalten
# die Owner (lumen_app / keycloak) — Restore siehe Runbook.
# $CURRENT im Haupt-Shell setzen (nicht in einer Pipe-Funktion = Subshell),
# damit der EXIT-Trap die offene Datei kennt. set -e + pipefail brechen bei
# jedem Fehler von pg_dump/gzip/gpg ab.
for db in "$POSTGRES_DB" keycloak; do
  [ "$db" = "$POSTGRES_DB" ] && name=lumen-db || name=keycloak-db
  CURRENT="$BACKUP_DIR/$name-$TS.sql.gz"
  docker exec lumen-db pg_dump -U "$POSTGRES_USER" "$db" | gzip > "$CURRENT"
  seal "$CURRENT"
  CURRENT=""
done
echo "   DB-Dumps: lumen-db-$TS.sql.gz$EXT keycloak-db-$TS.sql.gz$EXT"

echo "==> Bucket '${GARAGE_S3_BUCKET}' exportieren (Objekt-Ebene, tar)"
# Ueber die API (gleiche Credentials/Settings) statt Volume-Tar: konsistent
# ohne Garage-Metadaten-Snapshot und backend-unabhaengig.
# Fehler hier bricht NICHT sofort ab (DB-Dumps sollen trotzdem offsite),
# fuehrt aber am Ende zu Exit 1 (Cron-Mail / deploy.sh bricht ab).
# Im if-Kontext greift set -e nicht -> Status explizit per && verketten.
CURRENT="$BACKUP_DIR/bucket-$TS.tar.gz"
if docker exec lumen-api python -m scripts.s3_archive export | gzip > "$CURRENT" \
     && seal "$CURRENT"; then
  CURRENT=""
  echo "   Bucket -> bucket-$TS.tar.gz$EXT"
else
  rm -f -- "$CURRENT" "$CURRENT.gpg"; CURRENT=""
  echo "   FEHLER: Bucket-Export fehlgeschlagen (DB-Dumps bleiben erhalten)"
  FAILED=1
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
  # Retention am Ziel: fest 30 Tage per Ziel-Cron (siehe Kopf).
  rsync -a --include="*.gpg" --exclude="*" \
    "$BACKUP_DIR/" "$BACKUP_REMOTE/" \
    && echo "   Offsite OK" \
    || { echo "   FEHLER: Offsite-Kopie fehlgeschlagen"; exit 1; }
else
  echo "   WARN: BACKUP_REMOTE leer — Backup liegt nur auf diesem Host"
fi
if [ "$FAILED" != "0" ]; then
  echo "==> Backup UNVOLLSTAENDIG ($TS): Bucket-Export fehlgeschlagen"
  exit 1
fi
echo "==> Backup fertig ($TS) in $BACKUP_DIR"
