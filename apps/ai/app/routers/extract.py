"""LLM extraction endpoint — POST /extract/job.

Reads a JD's raw text and returns a structured ExtractedJd object plus
token-usage info. The Nest extract-job worker persists the result into
the `jobs.extracted_json` column.

Errors propagate as HTTP 5xx so BullMQ retries. Don't swallow exceptions
here — the queue is the resilience layer.
"""

from __future__ import annotations

import structlog
from fastapi import APIRouter, Depends

from app.extraction import Extractor, get_extractor
from app.models import ExtractRequest, ExtractResponse

router = APIRouter(prefix="/extract", tags=["extract"])
log = structlog.get_logger(__name__)


@router.post("/job", response_model=ExtractResponse)
async def extract_job(
    body: ExtractRequest,
    extractor: Extractor = Depends(get_extractor),
) -> ExtractResponse:
    parsed, usage = await extractor.extract(body.text)
    log.info("extract.job.done", job_id=body.id, tokens=usage["total_tokens"])
    return ExtractResponse(
        id=body.id,
        extracted=parsed.model_dump(),
        model=extractor._model,
        prompt_tokens=usage["prompt_tokens"],
        completion_tokens=usage["completion_tokens"],
        total_tokens=usage["total_tokens"],
    )
