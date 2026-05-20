"""Qdrant client wrapper.

Two collections:
- cv_chunks: one point per (cv_id, chunk_index)
- job_chunks: one point per (job_id, chunk_index)

We use deterministic UUIDs derived from (parent_id, chunk_index) as point IDs
so re-embedding the same document overwrites cleanly. To handle the case where
re-chunking produces a *different* number of chunks (and would leave orphan
points), every upsert is preceded by a payload-filter delete of all existing
points for that parent_id.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass

import structlog
from qdrant_client import AsyncQdrantClient
from qdrant_client.http import models as qmodels

from app.chunking import Chunk
from app.config import settings

log = structlog.get_logger(__name__)

# Stable namespace UUIDs — used to derive deterministic point IDs.
# These are arbitrary but constant; changing them would orphan all existing points.
_CV_NAMESPACE = uuid.UUID("4b1a4e23-2c55-4f4f-9ab2-39c7c0a0a001")
_JOB_NAMESPACE = uuid.UUID("4b1a4e23-2c55-4f4f-9ab2-39c7c0a0a002")


@dataclass(frozen=True)
class StoredChunk:
    """Subset of chunk metadata we keep alongside the vector for retrieval display."""

    parent_id: str
    chunk_index: int
    text: str


class VectorStore:
    """Qdrant operations specific to this app — collection init, upsert, search."""

    def __init__(self, url: str, dim: int, cv_collection: str, job_collection: str) -> None:
        self._client = AsyncQdrantClient(url=url)
        self._dim = dim
        self._cv_collection = cv_collection
        self._job_collection = job_collection

    async def init_collections(self) -> None:
        """Create both collections if they don't exist. Safe to call repeatedly."""
        for name in (self._cv_collection, self._job_collection):
            exists = await self._client.collection_exists(name)
            if not exists:
                log.info("vector_store.create_collection", name=name, dim=self._dim)
                await self._client.create_collection(
                    collection_name=name,
                    vectors_config=qmodels.VectorParams(
                        size=self._dim,
                        distance=qmodels.Distance.COSINE,
                    ),
                )
                # Index parent_id for fast filter-by-document queries.
                await self._client.create_payload_index(
                    collection_name=name,
                    field_name="parent_id",
                    field_schema=qmodels.PayloadSchemaType.KEYWORD,
                )

    async def upsert_cv_chunks(
        self, cv_id: str, chunks: list[Chunk], vectors: list[list[float]]
    ) -> int:
        return await self._upsert(self._cv_collection, _CV_NAMESPACE, cv_id, chunks, vectors)

    async def upsert_job_chunks(
        self, job_id: str, chunks: list[Chunk], vectors: list[list[float]]
    ) -> int:
        return await self._upsert(self._job_collection, _JOB_NAMESPACE, job_id, chunks, vectors)

    async def _upsert(
        self,
        collection: str,
        namespace: uuid.UUID,
        parent_id: str,
        chunks: list[Chunk],
        vectors: list[list[float]],
    ) -> int:
        if len(chunks) != len(vectors):
            raise ValueError(f"chunks/vectors length mismatch: {len(chunks)} vs {len(vectors)}")
        if not chunks:
            return 0

        # Step 1: delete any existing points for this parent_id. Handles the case
        # where re-chunking produces a different chunk count — orphan points
        # would otherwise stick around with stale text.
        await self._client.delete(
            collection_name=collection,
            points_selector=qmodels.FilterSelector(
                filter=qmodels.Filter(
                    must=[
                        qmodels.FieldCondition(
                            key="parent_id",
                            match=qmodels.MatchValue(value=parent_id),
                        )
                    ]
                )
            ),
        )

        # Step 2: upsert the fresh batch.
        points = [
            qmodels.PointStruct(
                id=str(uuid.uuid5(namespace, f"{parent_id}:{chunk.index}")),
                vector=vector,
                payload={
                    "parent_id": parent_id,
                    "chunk_index": chunk.index,
                    "text": chunk.text,
                    "token_count": chunk.token_count,
                },
            )
            for chunk, vector in zip(chunks, vectors, strict=True)
        ]
        await self._client.upsert(collection_name=collection, points=points)
        log.debug(
            "vector_store.upsert", collection=collection, parent_id=parent_id, count=len(points)
        )
        return len(points)

    async def get_cv_chunk_vectors(self, cv_id: str) -> list[tuple[StoredChunk, list[float]]]:
        """Fetch all chunk vectors for a CV. Used by /score/cv to query against jobs."""
        # `scroll` paginates over points matching a filter; with_vectors=True returns vectors too.
        records, _ = await self._client.scroll(
            collection_name=self._cv_collection,
            scroll_filter=qmodels.Filter(
                must=[
                    qmodels.FieldCondition(key="parent_id", match=qmodels.MatchValue(value=cv_id))
                ]
            ),
            with_payload=True,
            with_vectors=True,
            limit=200,  # CVs realistically have <50 chunks; 200 is a hard ceiling.
        )
        out: list[tuple[StoredChunk, list[float]]] = []
        for r in records:
            payload = r.payload or {}
            out.append(
                (
                    StoredChunk(
                        parent_id=payload.get("parent_id", ""),
                        chunk_index=int(payload.get("chunk_index", 0)),
                        text=payload.get("text", ""),
                    ),
                    list(r.vector) if r.vector else [],
                )
            )
        return out

    async def search_jobs(
        self, query_vector: list[float], limit: int = 50
    ) -> list[tuple[StoredChunk, float]]:
        """Top-K most similar JD chunks for a single CV-chunk query vector.

        Returns (chunk_metadata, similarity_score). Cosine similarity is in [-1, 1];
        with normalized OpenAI vectors it's typically in [0, 1].

        Uses `query_points` rather than the deprecated `search` method —
        qdrant-client 1.10+ moved retrieval under the unified Query API,
        and 1.18 removed `search()` entirely. The result wraps a `.points`
        list of ScoredPoint objects.
        """
        response = await self._client.query_points(
            collection_name=self._job_collection,
            query=query_vector,
            limit=limit,
            with_payload=True,
        )
        return [
            (
                StoredChunk(
                    parent_id=(p.payload or {}).get("parent_id", ""),
                    chunk_index=int((p.payload or {}).get("chunk_index", 0)),
                    text=(p.payload or {}).get("text", ""),
                ),
                float(p.score),
            )
            for p in response.points
        ]


_store: VectorStore | None = None


def get_vector_store() -> VectorStore:
    global _store
    if _store is None:
        _store = VectorStore(
            url=settings.qdrant_url,
            dim=settings.openai_embedding_dim,
            cv_collection=settings.qdrant_cv_collection,
            job_collection=settings.qdrant_job_collection,
        )
    return _store
