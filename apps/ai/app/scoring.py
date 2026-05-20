"""Match score aggregation.

Given a CV's chunk vectors, produce a per-job score by:
  1. For each CV chunk → vector-search the top-K most similar JD chunks
  2. Group those (job_id, score) tuples by job_id
  3. Per job, take the top-5 highest similarities and return their max

The "max-of-top-5" framing captures the strongest single match between any
CV chunk and any JD chunk for that job. We don't average — averaging dilutes
strong matches with weak ones, and a job that *strongly* matches one of your
strengths is more interesting than a job that weakly matches all of them.

This is the v1 strategy. Phase 3 candidates: cross-encoder re-ranking on the
top-50, hybrid BM25 + vector merge.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass

import structlog

from app.vector_store import VectorStore

log = structlog.get_logger(__name__)


@dataclass(frozen=True)
class JobScore:
    job_id: str
    score: float
    matched_chunks: int  # how many CV-chunk searches surfaced this job (informational)


async def score_cv_against_jobs(
    cv_id: str,
    store: VectorStore,
    *,
    top_k_per_chunk: int = 50,
    top_n_per_job: int = 5,
) -> list[JobScore]:
    """Compute per-job match scores for a CV.

    Args:
        cv_id: identifier of the CV whose chunks we'll query with.
        store: vector store with both collections populated.
        top_k_per_chunk: how many JD chunks to retrieve per CV chunk. 50 gives
            broad coverage without exploding the per-job aggregation step.
        top_n_per_job: how many top similarities to consider per job before
            taking the max. With max-of-top-5 the result equals max-of-1, but
            keeping the parameter makes it trivial to switch to mean-of-top-N
            later if evals show it helps.

    Returns:
        One JobScore per job that surfaced in any CV-chunk's top-K, sorted desc by score.
    """
    cv_chunks = await store.get_cv_chunk_vectors(cv_id)
    if not cv_chunks:
        log.warning("scoring.no_cv_chunks", cv_id=cv_id)
        return []

    # job_id -> list of similarity scores from any CV chunk's search results
    per_job_scores: dict[str, list[float]] = defaultdict(list)

    for _cv_chunk, cv_vec in cv_chunks:
        if not cv_vec:
            continue
        hits = await store.search_jobs(cv_vec, limit=top_k_per_chunk)
        for hit_chunk, sim in hits:
            per_job_scores[hit_chunk.parent_id].append(sim)

    results: list[JobScore] = []
    for job_id, sims in per_job_scores.items():
        sims.sort(reverse=True)
        top = sims[:top_n_per_job]
        results.append(JobScore(job_id=job_id, score=max(top), matched_chunks=len(sims)))

    results.sort(key=lambda r: r.score, reverse=True)
    log.info("scoring.computed", cv_id=cv_id, jobs_scored=len(results), cv_chunks=len(cv_chunks))
    return results
