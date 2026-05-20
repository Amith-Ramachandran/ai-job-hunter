"""OpenAI embedding wrapper.

Single concern: turn a list of strings into a list of vectors, batched
efficiently. Wraps the OpenAI SDK so the rest of the service has one place
to change models, add retries, or swap providers.

OpenAI's embeddings endpoint accepts up to 2048 inputs per request. We send
all chunks of one document in a single call — far cheaper and faster than
one request per chunk.
"""

from __future__ import annotations

from dataclasses import dataclass

import structlog
from openai import AsyncOpenAI

from app.config import settings

log = structlog.get_logger(__name__)


@dataclass(frozen=True)
class EmbeddingResult:
    """Result of embedding a batch of texts."""

    vectors: list[list[float]]
    model: str
    prompt_tokens: int
    total_tokens: int


class Embedder:
    """Thin async wrapper over OpenAI's embeddings endpoint.

    Constructed once per app via dependency injection so we share the underlying
    HTTP client (connection pool reuse, fewer DNS lookups).
    """

    def __init__(self, api_key: str, model: str) -> None:
        self._client = AsyncOpenAI(api_key=api_key)
        self._model = model

    async def embed(self, texts: list[str]) -> EmbeddingResult:
        """Embed a list of texts in a single API call.

        Returns vectors in the same order as the input. Raises on API errors —
        callers should retry via BullMQ rather than catching here, so we keep
        this surface narrow.
        """
        if not texts:
            return EmbeddingResult(vectors=[], model=self._model, prompt_tokens=0, total_tokens=0)

        response = await self._client.embeddings.create(
            model=self._model,
            input=texts,
        )
        usage = response.usage
        log.debug(
            "embedder.batch",
            model=self._model,
            count=len(texts),
            prompt_tokens=usage.prompt_tokens,
            total_tokens=usage.total_tokens,
        )
        return EmbeddingResult(
            vectors=[item.embedding for item in response.data],
            model=self._model,
            prompt_tokens=usage.prompt_tokens,
            total_tokens=usage.total_tokens,
        )


# Module-level singleton — created lazily so test code can patch settings first.
_embedder: Embedder | None = None


def get_embedder() -> Embedder:
    global _embedder
    if _embedder is None:
        _embedder = Embedder(api_key=settings.openai_api_key, model=settings.openai_embedding_model)
    return _embedder
