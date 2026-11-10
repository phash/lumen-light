#!/usr/bin/env bash
# Least-Privilege-DB-Rollen (Review M1): API und Keycloak arbeiten NICHT mehr
# als Postgres-Superuser (POSTGRES_USER), sondern als
#   lumen_app — Owner der App-DB ($POSTGRES_DB) und aller Objekte darin
#   keycloak  — Owner der DB 'keycloak' und aller Objekte darin
# POSTGRES_USER bleibt nur fuer Init/Admin/Backup (pg_dump).
#
# Zwei Aufrufwege, EIN Code (idempotent, beliebig oft ausfuehrbar):
#   1. Neuinstallation: docker-entrypoint-initdb.d fuehrt das Script nach
#      01-keycloak-db.sql aus (Passwoerter aus der lumen-db-Container-Env).
#   2. Bestehende Prod: deployment/deploy.sh pipet es per
#        docker exec -i -e LUMEN_DB_APP_PASSWORD -e KEYCLOAK_DB_PASSWORD \
#          lumen-db bash -s < deployment/initdb/02-app-roles.sh
#      BEVOR api/keycloak mit den neuen Credentials starten.
#
# Was passiert: Rollen anlegen (falls fehlend), Passwort + Attribute setzen
# (NOSUPERUSER usw.; Passwort-Rotation = .env aendern + erneut ausfuehren),
# DB-Owner umstellen, CONNECT fuer PUBLIC entziehen (keycloak kommt nicht in
# die App-DB und umgekehrt) und alle Tabellen/Sequenzen/Views/Typen/Funktionen
# im Schema public auf den neuen Owner uebertragen. REASSIGN OWNED geht NICHT:
# POSTGRES_USER ist der Bootstrap-Superuser, dessen Objekte Postgres nicht
# per REASSIGN abgibt. Extension-Objekte (pgcrypto) bleiben beim Superuser.
#
# Passwoerter gehen per Env an psql (\getenv), nicht ueber argv/ps.
# Kein `set -e`/`exit` auf Top-Level: initdb koennte das Script auch sourcen.

lumen_db_roles() {
  local su="${POSTGRES_USER:?POSTGRES_USER fehlt}"
  local appdb="${POSTGRES_DB:-$su}"
  if [ -z "${LUMEN_DB_APP_PASSWORD:-}" ] || [ -z "${KEYCLOAK_DB_PASSWORD:-}" ]; then
    echo "lumen-db-roles: LUMEN_DB_APP_PASSWORD/KEYCLOAK_DB_PASSWORD leer — uebersprungen (deploy.sh holt das nach)"
    return 0
  fi
  case "$su" in
    lumen_app|keycloak)
      echo "lumen-db-roles: FEHLER — POSTGRES_USER darf nicht '$su' heissen" >&2
      return 1 ;;
  esac
  if [ "$appdb" = "keycloak" ]; then
    echo "lumen-db-roles: FEHLER — POSTGRES_DB darf nicht 'keycloak' heissen" >&2
    return 1
  fi
  local psql=(psql -X -q -v ON_ERROR_STOP=1 --username "$su" --no-password)

  # 1) Rollen + Datenbanken (cluster-weit, ueber die DB 'postgres').
  "${psql[@]}" --dbname postgres -v appdb="$appdb" <<'SQL' || return 1
\getenv app_pw LUMEN_DB_APP_PASSWORD
\getenv kc_pw KEYCLOAK_DB_PASSWORD
SELECT 'CREATE ROLE lumen_app' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'lumen_app')\gexec
SELECT 'CREATE ROLE keycloak' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'keycloak')\gexec
-- Passwort kommt aus der Env (psql-Variable), per format(%L) sicher gequotet.
SELECT format('ALTER ROLE %I WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L', 'lumen_app', :'app_pw')\gexec
SELECT format('ALTER ROLE %I WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L', 'keycloak', :'kc_pw')\gexec
SELECT 'CREATE DATABASE keycloak' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'keycloak')\gexec
ALTER DATABASE :"appdb" OWNER TO lumen_app;
ALTER DATABASE keycloak OWNER TO keycloak;
REVOKE CONNECT, TEMPORARY ON DATABASE :"appdb" FROM PUBLIC;
REVOKE CONNECT, TEMPORARY ON DATABASE keycloak FROM PUBLIC;
SQL

  # 2) Objekt-Ownership je DB. Ziel-Rolle per Session-GUC in den DO-Block
  #    (psql-Variablen werden in $$-Strings nicht ersetzt).
  local db target
  for pair in "$appdb:lumen_app" "keycloak:keycloak"; do
    db="${pair%%:*}"; target="${pair##*:}"
    "${psql[@]}" --dbname "$db" -v target="$target" <<'SQL' || return 1
SELECT set_config('lumen.target', :'target', false) \g /dev/null
DO $$
DECLARE
  tgt     text := current_setting('lumen.target');
  tgt_oid oid  := (SELECT oid FROM pg_roles WHERE rolname = current_setting('lumen.target'));
  r       record;
BEGIN
  EXECUTE format('GRANT USAGE, CREATE ON SCHEMA public TO %I', tgt);

  -- Tabellen/Views zuerst; Sequenzen danach (serial-Sequenzen wandern mit
  -- ALTER TABLE mit, Identity-Sequenzen duerfen gar nicht direkt -> Owner
  -- je Objekt frisch lesen).
  FOR r IN
    SELECT c.oid, c.relkind, format('%I.%I', n.nspname, c.relname) AS fq
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
       AND NOT EXISTS (SELECT FROM pg_depend d
                        WHERE d.classid = 'pg_class'::regclass
                          AND d.objid = c.oid AND d.deptype = 'e')
     ORDER BY (c.relkind = 'S'), c.relname
  LOOP
    IF (SELECT relowner FROM pg_class WHERE oid = r.oid) <> tgt_oid THEN
      EXECUTE format('ALTER %s %s OWNER TO %I',
        CASE r.relkind WHEN 'S' THEN 'SEQUENCE' WHEN 'v' THEN 'VIEW'
                       WHEN 'm' THEN 'MATERIALIZED VIEW'
                       WHEN 'f' THEN 'FOREIGN TABLE' ELSE 'TABLE' END,
        r.fq, tgt);
    END IF;
  END LOOP;

  -- Enums/Domains/Ranges (Array- und Zeilentypen folgen automatisch).
  FOR r IN
    SELECT t.typtype, format('%I.%I', n.nspname, t.typname) AS fq
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE n.nspname = 'public'
       AND t.typtype IN ('e', 'd', 'r')
       AND t.typowner <> tgt_oid
       AND NOT EXISTS (SELECT FROM pg_depend d
                        WHERE d.classid = 'pg_type'::regclass
                          AND d.objid = t.oid AND d.deptype = 'e')
  LOOP
    EXECUTE format('ALTER %s %s OWNER TO %I',
      CASE r.typtype WHEN 'd' THEN 'DOMAIN' ELSE 'TYPE' END, r.fq, tgt);
  END LOOP;

  -- Funktionen/Prozeduren (ohne Extension-Mitglieder wie pgcrypto).
  FOR r IN
    SELECT p.prokind, p.oid::regprocedure AS sig
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proowner <> tgt_oid
       AND NOT EXISTS (SELECT FROM pg_depend d
                        WHERE d.classid = 'pg_proc'::regclass
                          AND d.objid = p.oid AND d.deptype = 'e')
  LOOP
    EXECUTE format('ALTER %s %s OWNER TO %I',
      CASE r.prokind WHEN 'p' THEN 'PROCEDURE' WHEN 'a' THEN 'AGGREGATE'
                     ELSE 'FUNCTION' END, r.sig, tgt);
  END LOOP;
END
$$;
SQL
  done
  echo "lumen-db-roles: lumen_app -> ${appdb}, keycloak -> keycloak (Owner + Objekte) ok"
}

lumen_db_roles
