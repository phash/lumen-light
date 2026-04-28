"""Anwendungs-Settings, geladen aus Environment-Variablen."""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    database_url: str = "postgresql+asyncpg://lumen:lumen@localhost:5432/lumen"

    # Keycloak (siehe ADR-010)
    keycloak_issuer: str = "http://localhost:18080/realms/lumen"
    keycloak_audience: str = "lumen-api"
    jwk_cache_seconds: int = 600

    # Garage S3 (siehe ADR-011) — Endpoints fuer Production via .env;
    # in Tests werden diese durch eine MinIO-Container-Fixture ueberschrieben.
    garage_s3_endpoint: str = "http://localhost:3900"
    garage_s3_region: str = "garage"
    garage_s3_bucket: str = "lumen-images"
    garage_s3_access_key_id: str = ""
    garage_s3_secret_access_key: str = ""
    presigned_url_expires_in: int = 900
    max_image_size_bytes: int = 200 * 1024 * 1024  # 200 MB

    cors_origin: str = "http://localhost:5173"

    # Production-Hardening: in dev-/Test-Mode bleiben /docs + /openapi.json
    # erreichbar fuer Schema-Inspektion und Test-Tools. In production wird
    # `LUMEN_ENV=production` gesetzt — dann blendet main.py die FastAPI-
    # Default-Docs aus, damit kein Schema-Disclosure passiert.
    env: str = "development"


settings = Settings()
