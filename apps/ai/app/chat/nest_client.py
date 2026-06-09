"""HTTP client for the Nest /internal/* callback endpoints.

Used by agent tools and the cover-letter helper. Single httpx.AsyncClient
instance reused across requests so we keep a connection pool warm.

Auth: every call carries `Authorization: Bearer <internal_service_token>`.
The Nest InternalAuthGuard validates this; the userId is a query / path
parameter, NOT derived from a session.
"""

from __future__ import annotations

from typing import Any

import httpx
import structlog

from app.config import settings

log = structlog.get_logger(__name__)


class NestClient:
    """Async httpx wrapper for the small set of /internal/* endpoints we use."""

    def __init__(self, base_url: str, token: str) -> None:
        self._client = httpx.AsyncClient(
            base_url=base_url.rstrip("/"),
            headers={"Authorization": f"Bearer {token}"},
            timeout=30.0,
        )

    async def aclose(self) -> None:
        await self._client.aclose()

    async def list_jobs(self, user_id: str, **filters: Any) -> dict[str, Any]:
        """Wraps GET /internal/jobs. Returns the same shape as the public API."""
        params: dict[str, Any] = {"userId": user_id}
        for k, v in filters.items():
            if v is None:
                continue
            if isinstance(v, list):
                # Backend's class-transformer toArray() accepts CSV.
                params[k] = ",".join(str(x) for x in v)
            else:
                params[k] = v
        res = await self._client.get("/internal/jobs", params=params)
        res.raise_for_status()
        return res.json()

    async def get_job(self, job_id: str) -> dict[str, Any]:
        res = await self._client.get(f"/internal/jobs/{job_id}")
        res.raise_for_status()
        return res.json()

    async def get_latest_cv(self, user_id: str) -> dict[str, Any]:
        res = await self._client.get(f"/internal/cvs/{user_id}/latest")
        res.raise_for_status()
        return res.json()


_nest_client: NestClient | None = None


def get_nest_client() -> NestClient:
    """Module-level singleton. Constructed lazily so test code can patch settings first."""
    global _nest_client
    if _nest_client is None:
        _nest_client = NestClient(
            base_url=settings.nest_api_url,
            token=settings.internal_service_token,
        )
    return _nest_client
