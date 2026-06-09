# `@ai-job-hunter/api` — NestJS backend

The HTTP API and background worker for Dhruva.

## Responsibilities

- **Auth**: exchanges a Google ID token for a server-side session — HTTPOnly access JWT (short-lived) + rotating opaque refresh token with reuse detection
- **CV storage**: accepts uploads, writes to S3 (LocalStack in dev), records metadata in Postgres
- **CV parsing**: extracts text from PDF / TXT via `pdf-parse` so embeddings have real content to work with
- **Job catalog**: serves the filtered/paginated/sortable jobs list to the frontend; joins per-job match scores from `job_scores` for the user's latest CV
- **Ingestion**: scheduled BullMQ workers fetch from 5 job sources and upsert into Postgres
- **AI orchestration**: BullMQ queues (`embed-cv`, `embed-job`, `extract-job`, `score-cv`) call the Python AI service over HTTP; admin endpoints for backfill and manual re-score
- **Chat**: SSE proxy from Python `/chat` → the browser, plus persistence of every turn (model / tokens_in / tokens_out / latency_ms / cost_usd) into `chat_messages`
- **Internal service surface**: `/internal/*` endpoints for the Python AI service, guarded by a shared bearer with constant-time compare
- **Health probes**: `/health/live` and `/health/ready`

## Module map

```
src/
├── main.ts                       # bootstrap (Pino, validation, CORS, Swagger)
├── app.module.ts                 # wires every feature module + BullMQ + Prisma
├── common/
│   ├── config/env.schema.ts      # zod validation of env vars
│   ├── logger/                   # Pino setup
│   └── prisma/                   # PrismaService
├── common/
│   ├── internal-auth/            # InternalAuthGuard — shared-bearer auth for Python → Nest /internal/*
│   ├── session-auth/             # SessionAuthGuard — cookie-based session validation
│   └── ...                       # config, logger, prisma
├── auth/                         # Google ID-token exchange → cookie session; /auth/refresh; reuse detection
├── users/                        # /users/me
├── cvs/
│   ├── cvs.service.ts            # upload + list + presigned download URL; enqueues embed-cv
│   ├── cvs.controller.ts         # /cvs endpoints incl. POST /cvs/:id/reparse
│   ├── cvs.internal.controller.ts # /internal/cvs/:userId/latest (called by Python)
│   ├── parser/cv-parser.service.ts  # pdf-parse + text/plain extractor
│   └── storage/s3-storage.service.ts  # AWS SDK against LocalStack or real S3
├── jobs/
│   ├── jobs.controller.ts        # /jobs list + filters; joins job_scores for matchScore field
│   ├── jobs.internal.controller.ts # /internal/jobs + /internal/jobs/:id (called by Python tools)
│   └── jobs.repository.ts        # single chokepoint for upserts; descriptionMd-change guard
│                                 #   stops the embed/extract pipeline from firing on unchanged jobs
├── ingestion/
│   ├── ingestion.service.ts      # orchestrator, schedules BullMQ tasks; enqueues embed-job
│   ├── ingestion.processor.ts    # BullMQ worker
│   └── sources/                  # JobSource adapters (remotive, greenhouse, lever, ashby, hn)
├── ai/                           # Phase 2 Slices 2.1 + 2.2
│   ├── ai.module.ts              # wires queues + workers + producer
│   ├── ai.service.ts             # producer — enqueueEmbedCv / enqueueEmbedJob / enqueueExtractJob / backfills
│   ├── ai-client.service.ts      # HTTP client to Python AI service
│   ├── ai.controller.ts          # admin endpoints (/ai/backfill-jobs, /ai/backfill-extractions, /ai/score-now)
│   ├── embed-cv.processor.ts     # worker — calls /embed/cv, then enqueues score-cv
│   ├── embed-job.processor.ts    # worker — calls /embed/job, marks embedding_status
│   ├── extract-job.processor.ts  # worker — calls /extract/job, writes extracted_json
│   └── score-cv.processor.ts     # worker — calls /score/cv, writes job_scores rows
├── chat/                         # Phase 2 Slice 2.3
│   ├── chat.controller.ts        # POST /chat/stream, /chat/cover-letter (both SSE);
│   │                             # GET/DELETE /chat/sessions[/:id]
│   ├── chat.service.ts           # AsyncIterable proxy of Python SSE → DB write of the final
│   │                             # assistant message with model + tokens + cost + latency
│   └── chat.constants.ts         # MODEL_PRICING table + computeCostUsd() helper
└── health/                       # /health/* endpoints
```

## Adding a new job source

1. Create `src/ingestion/sources/<name>.source.ts` implementing `JobSource`:
   ```ts
   @Injectable()
   export class MySource implements JobSource {
     readonly name = 'my-source';
     async *fetch(opts) { /* yield NormalizedJob */ }
   }
   ```
2. Add the class to `SOURCE_PROVIDERS` in `ingestion.module.ts`.
3. Done. The orchestrator picks it up at the next boot and schedules it.

## Running

```bash
# From the repo root:
pnpm install
pnpm dev:infra                                 # starts Postgres, Redis, LocalStack, Qdrant
pnpm --filter @ai-job-hunter/api prisma:migrate  # creates tables
pnpm --filter @ai-job-hunter/api dev           # starts the API on :3000
```

Swagger UI: [http://localhost:3000/docs](http://localhost:3000/docs).

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | `nest start --watch` — hot-reload dev server |
| `pnpm build` | `nest build` — compiled output to `dist/` |
| `pnpm test` | Jest unit tests |
| `pnpm lint` | ESLint over `src/` and `test/` |
| `pnpm prisma:migrate` | Apply schema migrations |
| `pnpm prisma:studio` | Visual DB browser |

## Env vars

See `.env.example`. The app refuses to start if any required value is missing — bad envs are caught before the first request, not on the first failed query.

## AI service integration (Slices 2.1 + 2.2 — shipped)

| Trigger | Queue | Worker action |
|---|---|---|
| CV uploaded (`CvsService.uploadCv`) | `embed-cv` | Calls Python `POST /embed/cv` → on success, enqueues `score-cv` |
| Job upserted with `embedding_status='pending'` (`IngestionService.runOnce`) | `embed-job` | Calls Python `POST /embed/job` → flips status to `done` |
| Job upserted (same trigger as above, parallel) | `extract-job` | Calls Python `POST /extract/job` → writes structured fields to `jobs.extracted_json` |
| Manual: `POST /ai/score-now` | `score-cv` | Calls Python `POST /score/cv` → wipes + batch-inserts `job_scores` rows |
| Manual: `POST /ai/backfill-jobs` | `embed-job` (×N) | Bulk-enqueues every pending-embed job |
| Manual: `POST /ai/backfill-extractions` | `extract-job` (×N) | Bulk-enqueues every job whose `extracted_json` is null |

All four queues share `STANDARD_RETRY` in `ai.service.ts`: 3 attempts, 30s exponential backoff, `removeOnFail: true` (auto-removes after final retry so a stuck failed job doesn't block future enqueues via the jobId dedupe).

Re-ingestion is **token-leak-guarded**: the `JobsRepository.upsert` chokepoint only resets `embedding_status='pending'` + `extracted_json=null` when `descriptionMd` actually changed since the last ingest. Hourly re-ingestion of an unchanged corpus now costs ~$0 instead of ~$5/day.

Ingestion is also capped at the last `INGESTION_MAX_AGE_DAYS` (default 7) so we don't burn OpenAI tokens on stale postings.

The `AI_SERVICE_URL` env var points at the Python service (default `http://localhost:8000`).

## Chat (Slice 2.3 — shipped)

| Endpoint | Auth | Behaviour |
|---|---|---|
| `POST /chat/stream` | session cookie | Streams Python `POST /chat/` through verbatim as SSE; writes the assistant message at end-of-stream with model / tokens_in / tokens_out / latency_ms / cost_usd into `chat_messages` |
| `POST /chat/cover-letter` | session cookie | Streams Python `POST /chat/cover-letter` SSE through to the browser |
| `GET /chat/sessions` | session cookie | List the user's chat sessions (most-recent-first) |
| `GET /chat/sessions/:id` | session cookie | Full message history for one session |
| `DELETE /chat/sessions/:id` | session cookie | Cascade-delete session + its messages |

Pricing for cost computation lives in `chat/chat.constants.ts` (`MODEL_PRICING`) so adding a model = one line.

### Internal service surface

The Python service calls **back into Nest** for data it doesn't own (jobs, CVs). Python can't see browser cookies, so those routes use a shared bearer:

| Endpoint | Caller | Purpose |
|---|---|---|
| `GET /internal/jobs` | Python `search_jobs` tool | Same filter shape as the public `/jobs`, but takes `userId` as a query param instead of reading the session cookie |
| `GET /internal/jobs/:id` | Python `get_job_details` tool | Single-job fetch with the full descriptionMd + extractedJson |
| `GET /internal/cvs/:userId/latest` | Python cover-letter pipeline | Latest CV's parsedText for the user |

Guard: `InternalAuthGuard` does a constant-time compare against `INTERNAL_SERVICE_TOKEN` (must be ≥16 chars, must match in both `apps/api/.env` and `apps/ai/.env`).
