"""Application settings loaded from environment via pydantic-settings.

Failing fast at import time means a missing env var crashes the worker
before serving any traffic, instead of producing a vague runtime error.
"""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    log_level: str = "info"
    port: int = 8000
    allowed_origin: str = "http://localhost:3000"


settings = Settings()
