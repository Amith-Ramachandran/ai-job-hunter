"""Cover-letter generation — shared between the direct endpoint and the
agent's `draft_cover_letter` tool.

This is intentionally NOT an agent — a single LLM call with a tight system
prompt. Cover letters are a focused generation task; an agent loop adds
latency + cost without helping quality.

Returns the assembled cover-letter text as a string. The caller is
responsible for streaming token-by-token (use generate_cover_letter_stream
for that path).
"""

from __future__ import annotations

from collections.abc import AsyncIterator

import structlog
from openai import AsyncOpenAI

from app.config import settings

log = structlog.get_logger(__name__)


# The system prompt is the contract — it dictates voice, structure, and
# what NOT to do (fabricate, pad, exaggerate). Written as direct
# instructions because LLMs follow imperatives better than descriptions.
_SYSTEM_PROMPT = """You are a tailored cover-letter writer. Given a candidate's CV and a job description, write a concise, specific cover letter.

Rules — do not violate:
- Ground every claim in the CV. Never fabricate skills, employers, or accomplishments.
- Be specific. Reference one or two concrete projects or achievements from the CV that map to the JD's needs.
- 3 paragraphs maximum, ~250 words. Brevity is signal, not weakness.
- Direct opening; no "I am writing to apply for...". Open with what makes this candidate distinctly suited.
- No bullet lists, no hyperbole, no clichés ("passionate", "synergy", "team player").
- Match the JD's seniority and tone. If JD is formal, formal. If casual, casual but not flippant.
- End with one sentence inviting next conversation. No template sign-off.
"""


_client: AsyncOpenAI | None = None


def _get_client() -> AsyncOpenAI:
    global _client
    if _client is None:
        _client = AsyncOpenAI(api_key=settings.openai_api_key)
    return _client


def _build_user_message(cv_text: str, job_title: str, company: str, jd_text: str) -> str:
    """User-role message containing the grounded context."""
    return (
        f"Candidate CV:\n{cv_text}\n\n"
        f"---\n\n"
        f"Job: {job_title} at {company}\n\n"
        f"Job description:\n{jd_text}\n\n"
        f"---\n\n"
        f"Write the cover letter now. No preamble, no closing meta-commentary."
    )


async def generate_cover_letter(
    *, cv_text: str, job_title: str, company: str, jd_text: str, model: str
) -> str:
    """Single-shot generation. Returns the assembled draft text."""
    client = _get_client()
    completion = await client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": _SYSTEM_PROMPT},
            {
                "role": "user",
                "content": _build_user_message(cv_text, job_title, company, jd_text),
            },
        ],
        temperature=0.6,
    )
    text = completion.choices[0].message.content or ""
    log.info(
        "cover_letter.generated",
        model=model,
        chars=len(text),
        prompt_tokens=completion.usage.prompt_tokens if completion.usage else None,
        completion_tokens=completion.usage.completion_tokens if completion.usage else None,
    )
    return text.strip()


async def generate_cover_letter_stream(
    *, cv_text: str, job_title: str, company: str, jd_text: str, model: str
) -> AsyncIterator[dict]:
    """Streamed variant. Yields dicts:
    - {"type": "token", "content": str}
    - {"type": "done", "model": str, "tokens_in": int, "tokens_out": int}
    """
    client = _get_client()
    stream = await client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": _SYSTEM_PROMPT},
            {
                "role": "user",
                "content": _build_user_message(cv_text, job_title, company, jd_text),
            },
        ],
        temperature=0.6,
        stream=True,
        stream_options={"include_usage": True},  # ask the API to emit usage in the final chunk
    )

    tokens_in = 0
    tokens_out = 0
    async for chunk in stream:
        # Final chunk carries usage; intermediate chunks carry deltas
        if chunk.usage:
            tokens_in = chunk.usage.prompt_tokens or 0
            tokens_out = chunk.usage.completion_tokens or 0
        for choice in chunk.choices or []:
            delta = choice.delta.content if choice.delta else None
            if delta:
                yield {"type": "token", "content": delta}
    yield {"type": "done", "model": model, "tokens_in": tokens_in, "tokens_out": tokens_out}
