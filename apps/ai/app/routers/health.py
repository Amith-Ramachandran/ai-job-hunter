"""Liveness / readiness endpoints.

/health/live — process is up, no dependencies checked
/health/ready — Qdrant is reachable
"""

from fastapi import APIRouter, HTTPException

from app.vector_store import get_vector_store

router = APIRouter(prefix="/health", tags=["health"])


@router.get("/live")
async def live() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/ready")
async def ready() -> dict[str, str]:
    try:
        # Cheap call that proves Qdrant is reachable AND auth (when enabled) works.
        await get_vector_store()._client.get_collections()
    except Exception as err:
        raise HTTPException(status_code=503, detail={"status": "down", "dependency": "qdrant"}) from err
    return {"status": "ok"}
