"""Chat HTTP endpoints.

POST /chat                 — runs the agent and streams events back as SSE
POST /chat/cover-letter    — streams a tailored cover-letter draft as SSE

Both endpoints emit `text/event-stream` with the dict envelope:
    data: {"type": "...", ...}

The Nest API proxies these endpoints through to the React client, passing
events through verbatim.
"""

from __future__ import annotations

import json

import structlog
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.chat.agent import run_agent_stream
from app.chat.cover_letter import generate_cover_letter_stream
from app.chat.nest_client import get_nest_client
from app.config import settings

router = APIRouter(prefix="/chat", tags=["chat"])
log = structlog.get_logger(__name__)


class ChatMessageIn(BaseModel):
    role: str = Field(..., description="user | assistant | tool")
    content: str = ""


class ChatRequest(BaseModel):
    user_id: str
    cv_id: str | None = None
    messages: list[ChatMessageIn] = Field(default_factory=list)


class CoverLetterRequest(BaseModel):
    user_id: str
    job_id: str


def _sse(event: dict) -> bytes:
    """Format a dict as a single SSE `data:` line, terminated by blank line.
    Keeping the encoding here makes the streaming endpoints declarative."""
    return f"data: {json.dumps(event, ensure_ascii=False)}\n\n".encode()


@router.post("/")
async def chat(body: ChatRequest) -> StreamingResponse:
    async def gen():
        try:
            async for ev in run_agent_stream(
                user_id=body.user_id,
                cv_id=body.cv_id,
                messages=[m.model_dump() for m in body.messages],
            ):
                yield _sse(ev)
        except Exception as err:
            log.exception("chat.stream_failed")
            yield _sse({"type": "error", "message": str(err)[:300]})

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/cover-letter")
async def cover_letter(body: CoverLetterRequest) -> StreamingResponse:
    nest = get_nest_client()

    async def gen():
        try:
            job = await nest.get_job(body.job_id)
            cv = await nest.get_latest_cv(body.user_id)
        except Exception as err:
            log.exception("cover_letter.fetch_failed")
            yield _sse({"type": "error", "message": f"Could not load CV or job: {err}"[:300]})
            return

        cv_text = (cv.get("parsedText") or "").strip()
        if not cv_text:
            yield _sse(
                {"type": "error", "message": "Your CV has no parsed text yet — try re-uploading."}
            )
            return

        try:
            async for ev in generate_cover_letter_stream(
                cv_text=cv_text,
                job_title=job["title"],
                company=job["company"],
                jd_text=(job.get("descriptionMd") or "")[:6000],
                model=settings.openai_cover_letter_model,
            ):
                yield _sse(ev)
        except Exception as err:
            log.exception("cover_letter.stream_failed")
            yield _sse({"type": "error", "message": str(err)[:300]})

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
