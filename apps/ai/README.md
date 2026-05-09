# `ai-job-hunter-ai` — Python FastAPI service

The AI layer for AI Career Copilot. **Phase 1: stub** — only `/health` is implemented. The service exists now so:
- the Nest API can already point `AI_SERVICE_URL` at it
- deployment plumbing is exercised end-to-end before AI work begins
- adding endpoints in Phase 2 is purely additive

## Phase 2 surface (planned)

| Endpoint | Purpose |
|---|---|
| `POST /embed` | Chunk CV/JD text, embed via OpenAI, upsert to Qdrant |
| `POST /search` | Vector search Qdrant, optionally re-ranked |
| `POST /chat` | Tool-calling agent over the user's pipeline |
| `POST /extract` | LLM-driven structured-JSON extraction from a JD |

## Service boundary

This service is **stateless w.r.t. Postgres** — it never reads or writes the relational store directly. The Nest API passes whatever context is needed in the request body. The only persistent state owned here is **Qdrant**.

Why: keeps the surface area small, makes the service trivially scalable, and lets us evolve the relational schema without coordinating Python migrations.

## Stack

- **FastAPI** — async HTTP, auto-generated OpenAPI docs at `/docs`
- **Pydantic v2** — request/response models + settings
- **structlog** — structured JSON logs
- **LangChain** (Phase 2) — embedding + RAG pipelines
- **OpenAI SDK** (Phase 2) — embeddings + chat
- **Qdrant client** (Phase 2) — vector storage

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
