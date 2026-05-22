# Dhruva

A personal AI-powered job-hunt assistant. Ingests jobs from public sources, ranks them against your CV, and lets you chat over your pipeline.

> **Status — Phase 2 Slice 2.2.** Frontend, API, Google auth, CV upload (with PDF parsing), 5-source job ingestion (capped at last 7 days), CV/JD embeddings into Qdrant, per-job match scores, **LLM-extracted structured fields per JD (seniority / skills / salary / remote policy / role type)**, and **smart filter chips** on the Jobs page.

## Architecture

```
┌─────────────────┐
│  React SPA      │  Google OAuth client-side
│  (Vite)         │  Sends Google ID token in Authorization header
└────────┬────────┘
         │ HTTP
         ▼
┌──────────────────────────────────────────────────────────────┐
│  NestJS API                                                  │
│  • Verifies Google ID token                                  │
│  • Owns: users, cvs, jobs, applications, job_scores          │
│  • Owns: BullMQ queues — ingest-jobs / embed-cv /            │
│    embed-job / score-cv                                      │
│  • Parses uploaded PDFs (pdf-parse)                          │
│  • Calls Python AI service over HTTP for embed / score       │
└────┬───────────────────────────────────────┬─────────────────┘
     │                                       │
     ▼                                       ▼ HTTP
┌──────────┐                       ┌─────────────────────┐
│ Postgres │                       │  Python FastAPI     │
└──────────┘                       │  (AI service)       │
                                   │  • OpenAI embeds    │
                                   │  • Qdrant upserts   │
                                   │  • Match scoring    │
                                   │  • (Slice 2.2: LLM  │
                                   │    extraction)      │
                                   │  • (Slice 2.3: chat)│
                                   └──────┬──────────────┘
                                          │
                                    ┌─────▼──────┐
                                    │  Qdrant    │
                                    │ cv_chunks  │
                                    │ job_chunks │
                                    └────────────┘
```

## Repo layout

```
.
├── apps/
│   ├── api/          # NestJS backend (TypeScript)
│   ├── web/          # React frontend (Vite + Tailwind + shadcn/ui)
│   └── ai/           # Python FastAPI service (LangChain, Phase 2)
├── infra/
│   └── docker-compose.yml   # Postgres, Redis, LocalStack, Qdrant
├── .github/workflows/ci.yml
└── package.json      # workspace root
```

Each app has its own README with setup details.

## Prerequisites

- **Node.js 20+** and **pnpm 9+**
- **Python 3.12+**
- **Docker** (for the local infra stack)
- A **Google OAuth client ID** — create one at [Google Cloud Console](https://console.cloud.google.com/apis/credentials), authorized for `http://localhost:5173`
- An **OpenAI API key** for embeddings — get one at [platform.openai.com/api-keys](https://platform.openai.com/api-keys). Backfilling 3,500 jobs costs ~$0.30 at the `text-embedding-3-small` price point.

## Getting started

```bash
# 1. Clone + install JS dependencies
pnpm install

# 2. Copy env files
cp .env.example .env
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
cp apps/ai/.env.example apps/ai/.env

# 3. Fill in required values:
#    apps/api/.env: GOOGLE_CLIENT_ID
#    apps/web/.env: VITE_GOOGLE_CLIENT_ID (same value as above)
#    apps/ai/.env:  OPENAI_API_KEY

# 4. Start local infra (Postgres, Redis, LocalStack, Qdrant, RedisInsight)
pnpm dev:infra

# 5. Run database migrations
pnpm --filter @ai-job-hunter/api prisma:migrate

# 6. Install Python deps
cd apps/ai && python3 -m venv venv && source venv/bin/activate && pip install -e '.[dev]' && cd ../..

# 7. Run all three apps in separate terminals
pnpm dev:api      # NestJS on :3000
pnpm dev:web      # React on :5173
cd apps/ai && source venv/bin/activate && uvicorn app.main:app --reload --port 8000
```

Open [http://localhost:5173](http://localhost:5173), sign in, upload a CV (PDF or text).

### First-time AI backfill

The first time you run ingestion, jobs land in Postgres with `embedding_status = 'pending'` but no vectors yet. To embed the existing corpus in one shot:

```bash
# Get a bearer token from browser DevTools console:
#   JSON.parse(localStorage.getItem('ai-job-hunter:auth')).state.idToken
TOKEN="ey..."

curl -X POST http://localhost:3000/ai/backfill-jobs -H "Authorization: Bearer $TOKEN"
# → {"enqueued": <N>}

# Watch the embed-job queue drain (5–15 min). Then score your CV:
curl -X POST http://localhost:3000/ai/score-now    -H "Authorization: Bearer $TOKEN"
```

After scoring completes, the Jobs page Match column will populate.

## Phasing

| Phase | Scope | Status |
|---|---|---|
| **1** | Frontend + API + DB + auth + CV upload + job ingestion (no AI) | ✓ Done |
| **2.1** | Embeddings (CV + JDs) → Qdrant + match-score column on Jobs page | ✓ Done |
| **2.2** | LLM-driven structured JD extraction + smart filter chips | ✓ Done |
| 2.3 | RAG chat with tool-calling agent + cover-letter drafting | Planned |
| 2.4 | Evals (golden set + NDCG) + cost/token observability dashboard | Planned |
| 3 | Re-ranking, hybrid search, MCP server | Planned |

## Job sources

Job ingestion is built on an extensible adapter pattern (`apps/api/src/ingestion/sources/`). Adding a new source = implement the `JobSource` interface + register the class.

Phase 1 sources (5 implemented):

| Source | Type | Configuration |
|---|---|---|
| **Remotive** | Aggregator (remote-only) | None — pulls all listings |
| **Greenhouse** | Per-company public boards | `GREENHOUSE_BOARDS=stripe,airbnb,...` |
| **Lever** | Per-company public API | `LEVER_COMPANIES=netflix,box,...` |
| **Ashby** | Per-company public API | `ASHBY_COMPANIES=linear,posthog,...` |
| **Hacker News "Who is Hiring"** | Current monthly thread | None |

All five run on the same hourly schedule and share the same dedupe + retry logic. See [apps/api/README.md](apps/api/README.md) for how to add a new source.

## Why these tech choices

| Concern | Pick | Why |
|---|---|---|
| Backend | NestJS | Recognizable structure, good DI, Swagger generation |
| ORM | Prisma | Best DX, declarative migrations, fully-typed client |
| Logging | Pino | Fast, structured JSON, request-scoped child loggers |
| Queue | BullMQ + Redis | Industry standard, retries/repeat scheduling for free, ports cleanly to AWS ElastiCache |
| Vector DB | Qdrant | Real production vector DB; clearer architecture story than pgvector |
| AI service | Python + FastAPI | More mature OpenAI/embedding ecosystem; polyglot split lets each side evolve independently |
| Embeddings | OpenAI `text-embedding-3-small` (1536-dim) | Cheap (~$0.02/M tokens), well-supported, good retrieval quality |
| Chunking | `langchain-text-splitters` + `tiktoken` | Token-aware recursive splits; section-aware overlay for CVs |
| PDF parsing | `pdf-parse` | Works for text-layer PDFs; image-only PDFs degrade gracefully to filename-only embedding |
| Frontend bundler | Vite | Fast dev server, minimal config |
| Server state | TanStack Query | The 2026 standard for React data fetching |
| Client state | Zustand | Minimal, no boilerplate, easy to explain |
| UI components | shadcn/ui | Components copied into the repo (you own them) — clean, restrained design tokens |
| Forms | react-hook-form + zod | Performant, type-safe, schema-driven validation |
| Local AWS | LocalStack | Same SDK calls as real AWS — env-var swap to migrate |
| CI | GitHub Actions | Path-filtered per-app jobs; runs on PRs to main + pushes to main |

## License

[MIT](LICENSE) © 2026 Amith Ramachandran
