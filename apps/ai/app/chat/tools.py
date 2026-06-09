"""Agent tools for the chat experience.

Three tools — narrow on purpose. OpenAI's docs note that beyond ~10 tools
the model starts mis-routing; under-10 is the sweet spot. We use three:

  - search_jobs:        list with the same filter surface as the public API
  - get_job_details:    fetch one job's full payload
  - draft_cover_letter: ask the LLM to write a CV+JD-grounded draft

Tools are Pydantic-decorated so the JSON schema auto-generates from the
signature — keeps the contract and the docstring in lockstep.

Each tool is a closure over (user_id, nest_client) so the agent doesn't
have to thread user context into every call.
"""

from __future__ import annotations

from typing import Annotated

import structlog
from langchain_core.tools import tool

from app.chat.cover_letter import generate_cover_letter
from app.chat.nest_client import NestClient
from app.config import settings

log = structlog.get_logger(__name__)


def build_tools(user_id: str, cv_id: str | None, nest: NestClient) -> list:
    """Builds tools that close over the current user + their latest CV.

    Returns plain LangChain `@tool`-decorated callables, ready to pass into
    `create_agent(tools=...)`.
    """

    @tool
    async def search_jobs(
        query: Annotated[
            str, "Free-text search applied to title + company. Empty string for no keyword filter."
        ] = "",
        seniority_in: Annotated[
            list[str] | None,
            "List of seniority levels to include. Values: intern, junior, mid, senior, staff, principal.",
        ] = None,
        skills_all: Annotated[
            list[str] | None,
            "Skills the job MUST require (AND semantics). E.g. ['Python', 'AWS'].",
        ] = None,
        remote_policy_in: Annotated[
            list[str] | None,
            "Work model values to include. Values: remote, hybrid, on-site.",
        ] = None,
        posted_since_days: Annotated[
            int | None, "Only include jobs posted within this many days."
        ] = None,
        sort_by: Annotated[
            str,
            "How to sort. Values: match, posted, title, company, location, source. Default 'match'.",
        ] = "match",
        sort_order: Annotated[str, "asc or desc. Default 'desc'."] = "desc",
        page_size: Annotated[int, "How many to return. Max 50. Default 10."] = 10,
    ) -> dict:
        """Search ingested job postings, scored against the user's CV.

        Returns the top matching jobs with title, company, location, match score,
        extracted skills, salary range, and apply URL. Use this when the user
        asks broad questions like 'find me senior Python remote roles' or
        'what jobs match my skills'.
        """
        result = await nest.list_jobs(
            user_id=user_id,
            q=query or None,
            seniorityIn=seniority_in,
            skillsAll=skills_all,
            remotePolicyIn=remote_policy_in,
            postedSinceDays=posted_since_days,
            sortBy=sort_by,
            sortOrder=sort_order,
            pageSize=min(max(page_size, 1), 50),
        )
        # Trim the response shape to what the model needs — keeps tokens down
        # and stops the agent over-quoting raw JSON.
        items = []
        for j in result.get("items", []):
            items.append(
                {
                    "id": j["id"],
                    "title": j["title"],
                    "company": j["company"],
                    "location": j.get("location"),
                    "remote": j.get("remote"),
                    "postedAt": j.get("postedAt"),
                    "matchScore": j.get("matchScore"),
                    "applyUrl": j.get("applyUrl"),
                    "extracted": j.get("extractedJson"),
                    "source": j.get("source"),
                }
            )
        log.debug("tool.search_jobs", user_id=user_id, returned=len(items))
        return {"total": result.get("total", 0), "items": items}

    @tool
    async def get_job_details(
        job_id: Annotated[str, "The job's id (cuid). Get this from a prior search_jobs call."],
    ) -> dict:
        """Fetch a single job's full details — including the cleaned JD text
        and the LLM-extracted structured fields. Use this when the user asks
        about a specific role, or before drafting a cover letter."""
        job = await nest.get_job(job_id)
        return {
            "id": job["id"],
            "title": job["title"],
            "company": job["company"],
            "location": job.get("location"),
            "remote": job.get("remote"),
            "salaryMin": job.get("salaryMin"),
            "salaryMax": job.get("salaryMax"),
            "currency": job.get("currency"),
            "applyUrl": job.get("applyUrl"),
            "description": (job.get("descriptionMd") or "")[:6000],  # bound the token cost
            "extracted": job.get("extractedJson"),
        }

    @tool
    async def draft_cover_letter(
        job_id: Annotated[str, "The job's id to write the cover letter for."],
    ) -> dict:
        """Generate a tailored cover-letter draft grounded in the user's CV
        and this job's description. Returns the full draft text.
        Use sparingly — it's the slowest tool."""
        if not cv_id:
            return {"error": "User has no CV uploaded yet."}
        # Fetch both sides
        job = await nest.get_job(job_id)
        cv = await nest.get_latest_cv(user_id)
        draft = await generate_cover_letter(
            cv_text=cv.get("parsedText") or "",
            job_title=job["title"],
            company=job["company"],
            jd_text=(job.get("descriptionMd") or "")[:6000],
            model=settings.openai_cover_letter_model,
        )
        return {"job_id": job_id, "draft": draft}

    return [search_jobs, get_job_details, draft_cover_letter]
