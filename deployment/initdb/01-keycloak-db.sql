-- Legt beim Erst-Init der Postgres-Instanz die separate Datenbank fuer
-- Keycloak an (lumen-keycloak nutzt KC_DB_URL .../keycloak). Laeuft als
-- POSTGRES_USER; 02-app-roles.sh uebergibt den Owner danach an die
-- Least-Privilege-Rolle 'keycloak'.
-- Idempotent genug: initdb-Scripts laufen nur beim ersten Start (leeres Volume).
SELECT 'CREATE DATABASE keycloak'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'keycloak')\gexec
