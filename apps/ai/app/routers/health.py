"""Liveness / readiness endpoints.

Phase 1: only `/health/live` returns ok. Phase 2 will extend `/health/ready`
to ping Qdrant and confirm OpenAI credentials are valid.
"""

from fastapi import APIRouter

router = APIRouter(prefix="/health", tags=["health"])


@router.get("/live")
async def live() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/ready")
async def ready() -> dict[str, str]:
    # In Phase 2: check Qdrant reachable, OpenAI API key present, etc.
    return {"status": "ok"}
