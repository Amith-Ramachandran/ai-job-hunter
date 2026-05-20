# `ai-job-hunter-ai` — Python FastAPI service

The AI layer for AI Career Copilot. Phase 2 Slice 2.1 ships: embeddings + Qdrant upsert + match scoring.

## Endpoints

| Endpoint | Purpose |
|---|---|
| `GET /health/live` | Liveness — process up |
| `GET /health/ready` | Readiness — Qdrant reachable |
| `POST /embed/cv` | Section-aware chunk → embed → upsert to `cv_chunks` collection |
| `POST /embed/job` | Recursive chunk → embed → upsert to `job_chunks` collection |
| `POST /score/cv` | Compute per-job match scores for one CV (vector search + aggregation) |

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
├── config.py            # pydantic-settings env loader (OPENAI_API_KEY, QDRANT_URL, …)
├── chunking.py          # CV section-aware + JD recursive splitters (tiktoken-counted)
├── embedder.py          # AsyncOpenAI wrapper, batched embed
├── vector_store.py      # Qdrant async client — collections, upsert, search, delete-by-parent
├── scoring.py           # max-of-top-5 per-job aggregation
├── models.py            # Pydantic request/response schemas
└── routers/
    ├── health.py
    ├── embed.py         # POST /embed/cv, POST /embed/job
    └── score.py         # POST /score/cv
```

## Service boundary

This service is **stateless w.r.t. Postgres** — it never reads or writes the relational store directly. The Nest API passes whatever context is needed in the request body. The only persistent state owned here is **Qdrant**.

Why: keeps the surface area small, makes the service trivially scalable, and lets us evolve the relational schema without coordinating Python migrations.

## Stack

- **FastAPI** — async HTTP, auto-generated OpenAPI docs at `/docs`
- **Pydantic v2** — request/response models + settings
- **structlog** — structured JSON logs
- **OpenAI SDK** — `text-embedding-3-small` (1536-dim)
- **Qdrant client** — async, two collections (`cv_chunks`, `job_chunks`)
- **LangChain text-splitters** — `RecursiveCharacterTextSplitter` for recursive splits
- **tiktoken** — token-aware chunk sizing

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
