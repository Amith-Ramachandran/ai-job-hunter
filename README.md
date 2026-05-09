# AI Career Copilot

A personal AI-powered job-hunt assistant. Ingests jobs from public sources, ranks them against your CV, and lets you chat over your pipeline.

> **Status — Phase 1.** Frontend, API, auth, CV upload, and job ingestion. No AI features yet — the AI service stub is in place so Phase 2 can land cleanly.

## Architecture

```
┌─────────────────┐
│  React SPA      │  Google OAuth client-side
│  (Vite)         │  Sends Google ID token in Authorization header
└────────┬────────┘
         │ HTTP
         ▼
┌─────────────────────────────────────────────────┐
│  NestJS API                                     │
│  • Verifies Google ID token                     │
│  • Owns: users, cvs, jobs, applications         │
│  • Owns: ingestion workers (BullMQ + Redis)     │
│  • Calls AI service over HTTP (Phase 2)         │
└────┬─────────────────────────────────┬──────────┘
     │                                 │
     ▼                                 ▼ HTTP (Phase 2)
┌──────────┐                 ┌─────────────────────┐
│ Postgres │                 │  Python FastAPI     │
└──────────┘                 │  (AI service)       │
                             │  • LangChain        │
                             │  • Embeddings       │
                             │  • RAG / chat       │
                             │  • JD extraction    │
                             └──────┬──────────────┘
                                    │
                              ┌─────▼──────┐
                              │  Qdrant    │
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

## Getting started

```bash
# 1. Clone + install JS dependencies
pnpm install

# 2. Copy env files
cp .env.example .env
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
cp apps/ai/.env.example apps/ai/.env

# 3. Fill in GOOGLE_CLIENT_ID in apps/api/.env and VITE_GOOGLE_CLIENT_ID in apps/web/.env

# 4. Start local infra (Postgres, Redis, LocalStack, Qdrant)
pnpm dev:infra

# 5. Run database migrations
pnpm --filter @ai-job-hunter/api prisma:migrate

# 6. Install Python deps
cd apps/ai && pip install -e '.[dev]' && cd ../..

# 7. Run all three apps in separate terminals
pnpm dev:api      # NestJS on :3000
pnpm dev:web      # React on :5173
cd apps/ai && uvicorn app.main:app --reload --port 8000
```

Open [http://localhost:5173](http://localhost:5173).

## Phasing

| Phase | Scope | Status |
|---|---|---|
| **1** | Frontend + API + DB + auth + CV upload + job ingestion (no AI) | ✓ Done |
| 2 | AI service: embeddings, structured extraction, RAG chat, match scoring | Planned |
| 3 | Re-ranking, hybrid search, evals, MCP server | Planned |

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
| AI service | Python + LangChain | More mature ecosystem; polyglot split tells the right story |
| Frontend bundler | Vite | Fast dev server, minimal config |
| Server state | TanStack Query | The 2026 standard for React data fetching |
| Client state | Zustand | Minimal, no boilerplate, easy to explain |
| UI components | shadcn/ui | Components copied into the repo (you own them) — clean, restrained design tokens |
| Forms | react-hook-form + zod | Performant, type-safe, schema-driven validation |
| Local AWS | LocalStack | Same SDK calls as real AWS — env-var swap to migrate |
| CI | GitHub Actions | Path-filtered per-app jobs; runs on PRs to main + pushes to main |

## License

Private — not licensed for redistribution.
