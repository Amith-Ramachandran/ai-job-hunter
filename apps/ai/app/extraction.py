"""LLM-driven structured extraction from job descriptions.

Takes the raw JD text and returns a typed Pydantic object with skills,
seniority, salary, remote policy, etc. Uses OpenAI's "structured outputs"
feature — the model is constrained to produce JSON matching the schema, so
we never have to parse-and-pray.

Why this beats regex / rule-based extraction:
- JD text is wildly inconsistent across companies (salary as "150k", "$150,000",
  "USD 150-180k", "competitive", or missing entirely)
- Skills can be in headings, bullet lists, prose, or "nice to have" sections
- Seniority is often implied, not stated

Why structured outputs vs free-form JSON in a prompt:
- Guaranteed valid JSON conforming to the schema (no parse failures)
- The model can return `null` for unknown fields rather than hallucinating
- The Pydantic model doubles as the API response type
"""

from __future__ import annotations

from typing import Literal

import structlog
from openai import AsyncOpenAI
from pydantic import BaseModel, Field

from app.config import settings

log = structlog.get_logger(__name__)


# ─── The schema we extract ───────────────────────────────────────────────


class ExtractedJd(BaseModel):
    """Structured fields extracted from a job description.

    Every field is optional/nullable — if the JD doesn't say, the model
    returns null rather than guessing. Downstream filters treat null as
    "unknown" (excluded from filters that require the field).
    """

    seniority: Literal["intern", "junior", "mid", "senior", "staff", "principal"] | None = Field(
        default=None,
        description="Seniority level. Map titles like 'Lead Engineer' → 'staff', 'SDE I' → 'junior'.",
    )
    years_required_min: int | None = Field(
        default=None, ge=0, le=40, description="Minimum years of experience required."
    )
    years_required_max: int | None = Field(
        default=None, ge=0, le=40, description="Maximum years if stated as a range."
    )
    required_skills: list[str] = Field(
        default_factory=list,
        description=(
            "Concrete technical skills explicitly REQUIRED — languages, frameworks, "
            "databases, cloud services, tools. Normalize to canonical names "
            "(e.g. 'TypeScript' not 'TS', 'PostgreSQL' not 'Postgres'). "
            "Exclude soft skills and generic terms like 'communication'."
        ),
    )
    nice_to_have_skills: list[str] = Field(
        default_factory=list,
        description="Skills listed under 'nice to have', 'bonus', 'plus'.",
    )
    salary_min: int | None = Field(
        default=None, ge=0, description="Minimum salary in the stated currency, ANNUAL basis."
    )
    salary_max: int | None = Field(
        default=None, ge=0, description="Maximum salary in the stated currency, ANNUAL basis."
    )
    currency: str | None = Field(
        default=None, description="ISO 4217 code if stated (USD, EUR, GBP, INR, AED, …)."
    )
    remote_policy: Literal["remote", "hybrid", "on-site"] | None = Field(
        default=None,
        description="'remote' for fully remote, 'hybrid' if any in-office requirement, 'on-site' otherwise.",
    )
    office_locations: list[str] = Field(
        default_factory=list,
        description="City names where the role can be based on-site (empty if fully remote).",
    )
    role_type: (
        Literal[
            "backend",
            "frontend",
            "fullstack",
            "mobile",
            "data",
            "ml",
            "devops",
            "security",
            "qa",
            "design",
            "product",
            "other",
        ]
        | None
    ) = Field(default=None, description="Primary engineering discipline.")
    tech_stack_summary: str | None = Field(
        default=None,
        max_length=200,
        description="One-line summary of the core stack. Empty/null if unclear.",
    )


# ─── The extractor ───────────────────────────────────────────────────────


class Extractor:
    """Thin wrapper over OpenAI's structured-output chat completion."""

    SYSTEM_PROMPT = (
        "You extract structured fields from job descriptions. "
        "Return null for any field the JD doesn't explicitly state — do not guess. "
        "Skills must be concrete technologies, not soft skills. "
        "Normalize technology names to their canonical form."
    )

    def __init__(self, api_key: str, model: str) -> None:
        self._client = AsyncOpenAI(api_key=api_key)
        self._model = model

    async def extract(self, jd_text: str) -> tuple[ExtractedJd, dict]:
        """Run extraction.

        Returns (parsed extraction, usage dict). Caller can log/aggregate
        the usage for cost tracking. Raises on API errors — BullMQ retries.
        """
        completion = await self._client.chat.completions.parse(
            model=self._model,
            messages=[
                {"role": "system", "content": self.SYSTEM_PROMPT},
                {"role": "user", "content": jd_text},
            ],
            response_format=ExtractedJd,
        )
        parsed = completion.choices[0].message.parsed
        if parsed is None:
            # Safety belt — `.parse()` should never return None on success, but
            # if the schema is impossible to fit it can refuse.
            refusal = completion.choices[0].message.refusal
            raise RuntimeError(f"Extraction refused or returned no parsed value: {refusal}")

        usage = {
            "prompt_tokens": completion.usage.prompt_tokens if completion.usage else 0,
            "completion_tokens": completion.usage.completion_tokens if completion.usage else 0,
            "total_tokens": completion.usage.total_tokens if completion.usage else 0,
        }
        log.debug("extractor.done", model=self._model, **usage)
        return parsed, usage


_extractor: Extractor | None = None


def get_extractor() -> Extractor:
    global _extractor
    if _extractor is None:
        _extractor = Extractor(
            api_key=settings.openai_api_key, model=settings.openai_extraction_model
        )
    return _extractor
