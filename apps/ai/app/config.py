"""Application settings loaded from environment via pydantic-settings.

Failing fast at import time means a missing or malformed env var crashes the
worker before serving any traffic, instead of producing a vague runtime error.
"""

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # ─── Server ────────────────────────────────────────────
    log_level: str = "info"
    port: int = 8000
    allowed_origin: str = "http://localhost:3000"

    # ─── OpenAI ────────────────────────────────────────────
    openai_api_key: str = Field(..., min_length=1)
    openai_embedding_model: str = "text-embedding-3-small"
    # Hard-coded for now — text-embedding-3-small is 1536; large is 3072.
    # If we change models, this needs to match or Qdrant will reject vectors.
    openai_embedding_dim: int = 1536

    # ─── Qdrant ────────────────────────────────────────────
    qdrant_url: str = "http://localhost:6333"
    qdrant_cv_collection: str = "cv_chunks"
    qdrant_job_collection: str = "job_chunks"


settings = Settings()
