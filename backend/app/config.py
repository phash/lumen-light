"""Anwendungs-Settings, geladen aus Environment-Variablen."""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    database_url: str = "postgresql+asyncpg://lumen:lumen@localhost:5432/lumen"

    # Keycloak (siehe ADR-010)
    keycloak_issuer: str = "http://localhost:18080/realms/lumen"
    keycloak_audience: str = "lumen-api"
    jwk_cache_seconds: int = 600

    cors_origin: str = "http://localhost:5173"


settings = Settings()
