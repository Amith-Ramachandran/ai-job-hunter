"""Match scoring endpoint — POST /score/cv.

Retrieves all CV chunk vectors for the given cv_id, runs vector search against
the job_chunks collection, aggregates per-job scores, and returns the sorted list.
The Nest worker takes this list and writes it to the job_scores table.
"""

from __future__ import annotations

import structlog
from fastapi import APIRouter, Depends

from app.models import JobScoreItem, ScoreRequest, ScoreResponse
from app.scoring import score_cv_against_jobs
from app.vector_store import VectorStore, get_vector_store

router = APIRouter(prefix="/score", tags=["score"])
log = structlog.get_logger(__name__)


@router.post("/cv", response_model=ScoreResponse)
async def score_cv(
    body: ScoreRequest,
    store: VectorStore = Depends(get_vector_store),
) -> ScoreResponse:
    scores = await score_cv_against_jobs(body.cv_id, store)
    log.info("score.cv.done", cv_id=body.cv_id, scored=len(scores))
    return ScoreResponse(
        cv_id=body.cv_id,
        scored=len(scores),
        items=[
            JobScoreItem(job_id=s.job_id, score=s.score, matched_chunks=s.matched_chunks)
            for s in scores
        ],
    )
