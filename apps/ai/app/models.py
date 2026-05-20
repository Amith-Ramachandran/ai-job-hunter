"""Pydantic request/response schemas for AI service endpoints."""

from __future__ import annotations

from pydantic import BaseModel, Field


class EmbedRequest(BaseModel):
    """Request body for /embed/cv and /embed/job.

    The Nest API hands us the parent ID + raw text. We chunk + embed + upsert
    on this side; Nest gets a brief summary back for logging.
    """

    id: str = Field(..., min_length=1, description="cvId or jobId")
    text: str = Field(..., min_length=1)


class EmbedResponse(BaseModel):
    id: str
    chunk_count: int
    prompt_tokens: int
    total_tokens: int
    model: str


class ScoreRequest(BaseModel):
    """Compute match scores for one CV against the entire job_chunks collection."""

    cv_id: str = Field(..., min_length=1)


class JobScoreItem(BaseModel):
    job_id: str
    score: float = Field(..., ge=-1.0, le=1.0)
    matched_chunks: int


class ScoreResponse(BaseModel):
    cv_id: str
    scored: int
    items: list[JobScoreItem]


class ExtractRequest(BaseModel):
    """LLM extraction of structured fields from a single JD."""

    id: str = Field(..., min_length=1, description="jobId")
    text: str = Field(..., min_length=1)


class ExtractResponse(BaseModel):
    """Wraps the ExtractedJd payload + token-usage info for cost tracking."""

    id: str
    extracted: dict  # serialized ExtractedJd — kept generic here to avoid import cycle
    model: str
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
