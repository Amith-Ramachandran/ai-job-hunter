"""Embedding endpoints — POST /embed/cv and POST /embed/job.

Each one:
  1. Chunks the input text (CV: section-aware; JD: recursive)
  2. Embeds all chunks in a single OpenAI call (batched)
  3. Upserts into Qdrant — replacing any existing chunks for that parent_id

Errors propagate as HTTP 5xx so the Nest BullMQ worker retries. Don't swallow
exceptions here — the queue is the resilience layer.
"""

from __future__ import annotations

import structlog
from fastapi import APIRouter, Depends

from app.chunking import chunk_cv, chunk_jd
from app.embedder import Embedder, get_embedder
from app.models import EmbedRequest, EmbedResponse
from app.vector_store import VectorStore, get_vector_store

router = APIRouter(prefix="/embed", tags=["embed"])
log = structlog.get_logger(__name__)


@router.post("/cv", response_model=EmbedResponse)
async def embed_cv(
    body: EmbedRequest,
    embedder: Embedder = Depends(get_embedder),
    store: VectorStore = Depends(get_vector_store),
) -> EmbedResponse:
    chunks = chunk_cv(body.text)
    if not chunks:
        log.warning("embed.cv.empty", cv_id=body.id)
        return EmbedResponse(
            id=body.id, chunk_count=0, prompt_tokens=0, total_tokens=0, model=embedder._model
        )

    result = await embedder.embed([c.text for c in chunks])
    written = await store.upsert_cv_chunks(body.id, chunks, result.vectors)
    log.info(
        "embed.cv.done",
        cv_id=body.id,
        chunks=written,
        tokens=result.total_tokens,
    )
    return EmbedResponse(
        id=body.id,
        chunk_count=written,
        prompt_tokens=result.prompt_tokens,
        total_tokens=result.total_tokens,
        model=result.model,
    )


@router.post("/job", response_model=EmbedResponse)
async def embed_job(
    body: EmbedRequest,
    embedder: Embedder = Depends(get_embedder),
    store: VectorStore = Depends(get_vector_store),
) -> EmbedResponse:
    chunks = chunk_jd(body.text)
    if not chunks:
        log.warning("embed.job.empty", job_id=body.id)
        return EmbedResponse(
            id=body.id, chunk_count=0, prompt_tokens=0, total_tokens=0, model=embedder._model
        )

    result = await embedder.embed([c.text for c in chunks])
    written = await store.upsert_job_chunks(body.id, chunks, result.vectors)
    log.info(
        "embed.job.done",
        job_id=body.id,
        chunks=written,
        tokens=result.total_tokens,
    )
    return EmbedResponse(
        id=body.id,
        chunk_count=written,
        prompt_tokens=result.prompt_tokens,
        total_tokens=result.total_tokens,
        model=result.model,
    )
