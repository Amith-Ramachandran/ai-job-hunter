# `ai-job-hunter-ai` — Python FastAPI service

The AI layer for Dhruva. Phase 2 Slices 2.1 + 2.2 + 2.3 ship: embeddings + Qdrant upsert + match scoring + LLM-driven structured JD extraction + a tool-calling chat agent + streamed cover-letter drafts.

## Endpoints

| Endpoint | Purpose |
|---|---|
| `GET /health/live` | Liveness — process up |
| `GET /health/ready` | Readiness — Qdrant reachable |
| `POST /embed/cv` | Section-aware chunk → embed → upsert to `cv_chunks` collection |
| `POST /embed/job` | Recursive chunk → embed → upsert to `job_chunks` collection |
| `POST /score/cv` | Compute per-job match scores for one CV (vector search + aggregation) |
| `POST /extract/job` | LLM-driven structured-JSON extraction from a JD (gpt-4o-mini + OpenAI structured outputs) |
| `POST /chat/` | LangChain `create_agent` (over LangGraph) with three tools; streams typed SSE events (`token`, `tool_call`, `tool_result`, `done`) |
| `POST /chat/cover-letter` | Single-shot LLM call with strict system prompt; streams tokens + a final `done` envelope with token counts |

## Architecture

```
Nest BullMQ worker
       │
       ▼ HTTP POST
┌─────────────────────────────────────────┐
│  FastAPI route (e.g. /embed/job)        │
│    │                                    │
│    ▼                                    │
│  app/chunking.py                        │
│    - chunk_cv()  → section-aware split  │
│    - chunk_jd()  → recursive splitter   │
│    │                                    │
│    ▼                                    │
│  app/embedder.py                        │
│    - OpenAI text-embedding-3-small      │
│    - Batched (one API call per doc)     │
│    │                                    │
│    ▼                                    │
│  app/vector_store.py                    │
│    - Delete existing points by parent_id│
│    - Upsert new points (UUID5 keys)     │
└─────────────────────────────────────────┘
                 │
                 ▼
            ┌──────────┐
            │  Qdrant  │
            │  :6333   │
            └──────────┘
```

## Module map

```
app/
├── main.py              # FastAPI app + lifespan + middleware + router wiring
│                        #   structlog processors include format_exc_info so
│                        #   log.exception() actually renders the traceback
├── config.py            # pydantic-settings env loader (OPENAI_API_KEY,
│                        #   INTERNAL_SERVICE_TOKEN, QDRANT_URL, model names, …)
├── chunking.py          # CV section-aware + JD recursive splitters (tiktoken-counted)
├── embedder.py          # AsyncOpenAI wrapper, batched embed
├── vector_store.py      # Qdrant async client — collections, upsert, query_points, delete-by-parent
├── scoring.py           # max-of-top-5 per-job aggregation
├── extraction.py        # Structured-output JD parser (Pydantic schema → OpenAI structured outputs)
├── models.py            # Pydantic request/response schemas
├── chat/                # Slice 2.3
│   ├── agent.py         # LangChain create_agent + streaming via astream_events;
│   │                    #   ChatOpenAI built with api_key=settings.openai_api_key
│   │                    #   explicitly so credentials flow through one source of truth
│   ├── tools.py         # search_jobs / get_job_details / draft_cover_letter
│   │                    #   (Annotated parameters → auto-generated JSON schema)
│   ├── nest_client.py   # httpx-based caller for /internal/* (shared-bearer auth)
│   └── cover_letter.py  # System prompt + AsyncOpenAI streaming for the cover-letter draft
└── routers/
    ├── health.py
    ├── embed.py         # POST /embed/cv, POST /embed/job
    ├── score.py         # POST /score/cv
    ├── extract.py       # POST /extract/job
    └── chat.py          # POST /chat/, POST /chat/cover-letter (both SSE)
```

## Service boundary

This service is **stateless w.r.t. Postgres** — it never reads or writes the relational store directly. The Nest API passes whatever context is needed in the request body. The only persistent state owned here is **Qdrant**.

Why: keeps the surface area small, makes the service trivially scalable, and lets us evolve the relational schema without coordinating Python migrations.

## Stack

- **FastAPI** — async HTTP, auto-generated OpenAPI docs at `/docs`
- **Pydantic v2** — request/response models + settings
- **structlog** — structured JSON logs (with `format_exc_info` so exceptions render)
- **OpenAI SDK** — `text-embedding-3-small` (1536-dim) for embeddings, `gpt-4o-mini` for extraction/chat/cover-letter
- **LangChain 1.x** — `create_agent` (which runs on **LangGraph 1.x**) for the tool-calling chat agent
- **LangChain text-splitters** — `RecursiveCharacterTextSplitter` for recursive splits
- **Qdrant client** — async, two collections (`cv_chunks`, `job_chunks`)
- **tiktoken** — token-aware chunk sizing
- **httpx** — async HTTP client for `/internal/*` calls back to Nest

## Why LangChain `create_agent` (not raw OpenAI / not LangGraph from scratch)

- `create_agent` is a thin, opinionated wrapper that ships an entire ReAct-style agent loop in ~10 lines. The underlying execution graph **is** LangGraph — you get the same primitives (state, nodes, edges, streamable events) without hand-writing them.
- For comparison, the pure OpenAI SDK path would force us to write our own tool-call dispatch + message-history accumulator + streaming reassembly. That's interesting once; it's churn forever.
- LangChain 1.0 (Oct 2025) has a public no-breaking-changes commitment until 2.0, which made it safe to depend on for a portfolio project.

## Running

```bash
cd apps/ai
python -m venv .venv
source .venv/bin/activate
pip install -e '.[dev]'
cp .env.example .env

uvicorn app.main:app --reload --port 8000
```

Docs: [http://localhost:8000/docs](http://localhost:8000/docs).

## Scripts

| Command | What it does |
|---|---|
| `uvicorn app.main:app --reload` | Hot-reload dev server |
| `pytest -q` | Run tests |
| `ruff check .` | Lint |
| `black .` | Format |
| `mypy app` | Type check |
