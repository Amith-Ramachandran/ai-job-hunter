"""AI service entry point.

Phase 1: this is a stub — only `/health` is implemented. Phase 2 adds:
    - POST /embed     (chunk + embed text, upsert to Qdrant)
    - POST /search    (vector search Qdrant)
    - POST /chat      (RAG chat)
    - POST /extract   (structured-JSON extraction from JD)

Keeping it boots-and-serves now so the Nest API can already point at it
and so deployment plumbing is exercised end-to-end before AI work begins.
"""

from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routers import health

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
    yield
    log.info("ai_service.stopping")


app = FastAPI(
    title="AI Career Copilot — AI Service",
    description="Embeddings, RAG, and structured extraction. Phase 1 = stub.",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.allowed_origin],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
