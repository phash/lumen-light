"""Anwendungs-Settings, geladen aus Environment-Variablen."""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    database_url: str = "postgresql+asyncpg://lumen:lumen@localhost:5432/lumen"

    # Keycloak (siehe ADR-010)
    keycloak_issuer: str = "http://localhost:18080/realms/lumen"
    keycloak_audience: str = "lumen-api"
    jwk_cache_seconds: int = 600

    # Service-Account-Credentials fuer Admin-API-Calls (DSGVO Art. 17:
    # DELETE /me loescht den KC-User mit). Leer = nicht konfiguriert,
    # KC-Account bleibt stehen (Datenschutz-Hinweis im UI).
    keycloak_admin_client_id: str = ""
    keycloak_admin_client_secret: str = ""

    # Garage S3 (siehe ADR-011) — Endpoints fuer Production via .env;
    # in Tests werden diese durch eine MinIO-Container-Fixture ueberschrieben.
    garage_s3_endpoint: str = "http://localhost:3900"
    # Oeffentliche S3-Basis-URL fuer Pre-Signed-URLs (browser-erreichbar).
    # Leer = identisch mit garage_s3_endpoint (dev/single-host). In Production
    # hinter einem Reverse-Proxy: interner Endpoint fuer head/delete, oeffentlicher
    # fuer das Signieren der Browser-URLs (SigV4 wird ueber diesen Host berechnet).
    garage_s3_public_endpoint: str = ""
    garage_s3_region: str = "garage"
    garage_s3_bucket: str = "lumen-images"
    garage_s3_access_key_id: str = ""
    garage_s3_secret_access_key: str = ""
    presigned_url_expires_in: int = 900
    max_image_size_bytes: int = 200 * 1024 * 1024  # 200 MB
    # Soft-Quota: max. gleichzeitig offene (pending) Uploads pro User. Begrenzt
    # zusammen mit Rate-Limit + Janitor das Anlegen vieler Zombie-Rows/Objekte
    # (DB-/Bucket-DoS gegen den gemeinsamen Bucket).
    max_pending_uploads_per_user: int = 50

    cors_origin: str = "http://localhost:5173"

    # Production-Hardening: in dev-/Test-Mode bleiben /docs + /openapi.json
    # erreichbar fuer Schema-Inspektion und Test-Tools. In production wird
    # `LUMEN_ENV=production` gesetzt — dann blendet main.py die FastAPI-
    # Default-Docs aus, damit kein Schema-Disclosure passiert.
    env: str = "development"


settings = Settings()
