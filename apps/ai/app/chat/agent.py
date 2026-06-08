"""Chat agent — wraps LangChain's `create_agent` with our tools + streaming.

We use create_agent (which runs on LangGraph under the hood) because it's
the canonical 2026 path for "RAG + tool calling" agents and gives us
- tool routing,
- multi-turn message history pass-through,
- streamable events (text + tool calls + tool results)
…with ~10 lines instead of an explicit StateGraph.

`run_agent_stream()` yields a flat stream of typed events the FastAPI
SSE endpoint can forward straight through to the React client.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

import structlog
from langchain.agents import create_agent
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

from app.chat.nest_client import get_nest_client
from app.chat.tools import build_tools
from app.config import settings

log = structlog.get_logger(__name__)


# The system prompt sets the agent's role + guardrails. Same rationale as
# the extraction prompt — direct instructions, negative constraints, narrow.
_SYSTEM_PROMPT = """You are Dhruva — a helpful AI assistant inside a job-hunt app. You help the user find, understand, and apply to jobs that match their CV.

You have three tools:
  - search_jobs: search the user's job pool with filters
  - get_job_details: fetch full info on a single job
  - draft_cover_letter: write a tailored cover letter draft

Rules:
- Always call search_jobs first when the user asks about jobs — never invent jobs.
- When you reference specific jobs, list them by their `id` so the UI can render provenance.
- Cite numbers (count, match scores) precisely as the tool returns them — don't round, don't paraphrase.
- Keep responses concise. Use markdown for structure. No giant tables.
- If the user has no CV uploaded yet, the cover-letter tool will tell you — say so plainly and suggest they upload one.
- If a tool errors, say "I hit an error fetching that — try again in a moment" rather than guessing.
"""


def _to_lc_messages(messages: list[dict[str, Any]]) -> list:
    """Convert the [{role, content}] history passed by Nest into LangChain
    message objects. Tool-role messages from earlier turns aren't replayed —
    the agent re-runs its own tools as needed."""
    out: list = [SystemMessage(content=_SYSTEM_PROMPT)]
    for m in messages:
        role = m.get("role")
        content = m.get("content") or ""
        if role == "user":
            out.append(HumanMessage(content=content))
        elif role == "assistant":
            out.append(AIMessage(content=content))
        # Tool messages aren't replayed — the agent doesn't need them and
        # they'd bloat context.
    return out


async def run_agent_stream(
    *,
    user_id: str,
    cv_id: str | None,
    messages: list[dict[str, Any]],
) -> AsyncIterator[dict]:
    """Run the agent and stream typed events for the SSE caller.

    Yields:
        {"type": "token", "content": str}        — token of assistant reply
        {"type": "tool_call", "name": str, "args": dict, "id": str}
        {"type": "tool_result", "name": str, "result": Any, "id": str}
        {"type": "done", "cited_job_ids": [str], "model": str}
    """
    nest = get_nest_client()
    tools = build_tools(user_id=user_id, cv_id=cv_id, nest=nest)
    agent = create_agent(model=f"openai:{settings.openai_chat_model}", tools=tools)
    lc_messages = _to_lc_messages(messages)

    cited_ids: set[str] = set()

    async for event in agent.astream_events({"messages": lc_messages}):
        ev_name = event.get("event", "")
        data = event.get("data", {})

        if ev_name == "on_chat_model_stream":
            chunk = data.get("chunk")
            if chunk is not None and getattr(chunk, "content", None):
                yield {"type": "token", "content": chunk.content}

        elif ev_name == "on_tool_start":
            input_args = data.get("input") or {}
            yield {
                "type": "tool_call",
                "name": event.get("name", ""),
                "args": input_args,
                "id": event.get("run_id", ""),
            }

        elif ev_name == "on_tool_end":
            output = data.get("output")
            # Best-effort job-id extraction from search_jobs / get_job_details
            # results so the UI can render provenance chips.
            extracted_ids = _harvest_job_ids(output)
            cited_ids.update(extracted_ids)
            yield {
                "type": "tool_result",
                "name": event.get("name", ""),
                "id": event.get("run_id", ""),
                "result_preview": _truncate_for_event(output),
            }

    yield {
        "type": "done",
        "cited_job_ids": sorted(cited_ids),
        "model": settings.openai_chat_model,
    }


def _harvest_job_ids(output: Any) -> list[str]:
    """Walk a tool result and collect cuid-shaped job ids."""
    found: list[str] = []
    if isinstance(output, dict):
        if isinstance(output.get("id"), str):
            found.append(output["id"])
        items = output.get("items")
        if isinstance(items, list):
            for it in items:
                if isinstance(it, dict) and isinstance(it.get("id"), str):
                    found.append(it["id"])
    return found


def _truncate_for_event(output: Any) -> Any:
    """Tool results sent over SSE should stay small — the agent already
    consumed the full result. The UI mostly cares about the count + ids."""
    if isinstance(output, dict):
        if "items" in output and isinstance(output["items"], list):
            return {
                "total": output.get("total"),
                "count": len(output["items"]),
            }
        if "id" in output and "title" in output:
            return {"id": output["id"], "title": output.get("title")}
    return None
