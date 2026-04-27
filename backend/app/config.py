"""Anwendungs-Settings, geladen aus Environment-Variablen."""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    database_url: str = "postgresql+asyncpg://lumen:lumen@localhost:5432/lumen"
    jwt_secret: str = "dev-secret-bitte-ersetzen"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 15
    refresh_token_expire_days: int = 7
    cors_origin: str = "http://localhost:5173"
    bcrypt_rounds: int = 12


settings = Settings()
