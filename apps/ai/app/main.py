"""AI service entry point.

Endpoints:
    GET  /health/live     liveness
    GET  /health/ready    readiness (Qdrant reachable)
    POST /embed/cv        chunk + embed CV text → Qdrant
    POST /embed/job       chunk + embed JD text → Qdrant
    POST /score/cv        compute per-job match scores for one CV
    POST /extract/job     LLM-driven structured-JSON extraction from a JD

Future slice 2.3 adds:
    POST /chat            tool-calling agent over the user's pipeline
"""

from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routers import embed, extract, health, score
from app.vector_store import get_vector_store

structlog.configure(
    processors=[
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.JSONRenderer(),
    ],
)

log = structlog.get_logger()


@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("ai_service.starting", port=settings.port)
    # Ensure Qdrant collections exist before serving any traffic. Idempotent —
    # safe across restarts.
    await get_vector_store().init_collections()
    log.info("ai_service.ready")
    yield
    log.info("ai_service.stopping")


app = FastAPI(
    title="Dhruva — AI Service",
    description="Embeddings, RAG, and structured extraction.",
    version="0.2.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.allowed_origin],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(embed.router)
app.include_router(score.router)
app.include_router(extract.router)
