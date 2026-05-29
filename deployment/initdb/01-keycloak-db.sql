-- Legt beim Erst-Init der Postgres-Instanz die separate Datenbank fuer
-- Keycloak an (lumen-keycloak nutzt KC_DB_URL .../keycloak). Laeuft als
-- POSTGRES_USER (lumen), der damit Owner ist und KC die Tabellen anlegen darf.
-- Idempotent genug: initdb-Scripts laufen nur beim ersten Start (leeres Volume).
SELECT 'CREATE DATABASE keycloak'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'keycloak')\gexec
