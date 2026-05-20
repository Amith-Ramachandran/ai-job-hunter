# `@ai-job-hunter/api` — NestJS backend

The HTTP API and background worker for Dhruva.

## Responsibilities

- **Auth**: verifies Google ID tokens, upserts the local user record
- **CV storage**: accepts uploads, writes to S3 (LocalStack in dev), records metadata in Postgres
- **CV parsing**: extracts text from PDF / TXT via `pdf-parse` so embeddings have real content to work with
- **Job catalog**: serves the filtered/paginated/sortable jobs list to the frontend; joins per-job match scores from `job_scores` for the user's latest CV
- **Ingestion**: scheduled BullMQ workers fetch from 5 job sources and upsert into Postgres
- **AI orchestration**: BullMQ queues (`embed-cv`, `embed-job`, `score-cv`) call the Python AI service over HTTP; admin endpoints for backfill and manual re-score
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
├── auth/                         # Google ID token verification + guard
├── users/                        # /users/me
├── cvs/
│   ├── cvs.service.ts            # upload + list + presigned download URL; enqueues embed-cv
│   ├── cvs.controller.ts         # /cvs endpoints incl. POST /cvs/:id/reparse
│   ├── parser/cv-parser.service.ts  # pdf-parse + text/plain extractor
│   └── storage/s3-storage.service.ts  # AWS SDK against LocalStack or real S3
├── jobs/                         # /jobs list + filters; joins job_scores for matchScore field
├── ingestion/
│   ├── ingestion.service.ts      # orchestrator, schedules BullMQ tasks; enqueues embed-job
│   ├── ingestion.processor.ts    # BullMQ worker
│   └── sources/                  # JobSource adapters (remotive, greenhouse, lever, ashby, hn)
├── ai/                           # Phase 2 Slice 2.1
│   ├── ai.module.ts              # wires queues + workers + producer
│   ├── ai.service.ts             # producer — enqueueEmbedCv / enqueueEmbedJob / backfill
│   ├── ai-client.service.ts      # HTTP client to Python AI service
│   ├── ai.controller.ts          # admin endpoints (/ai/backfill-jobs, /ai/score-now)
│   ├── embed-cv.processor.ts     # worker — calls /embed/cv, then enqueues score-cv
│   ├── embed-job.processor.ts    # worker — calls /embed/job, marks embedding_status
│   └── score-cv.processor.ts     # worker — calls /score/cv, writes job_scores rows
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

## AI service integration (Slice 2.1 — shipped)

| Trigger | Queue | Worker action |
|---|---|---|
| CV uploaded (`CvsService.uploadCv`) | `embed-cv` | Calls Python `POST /embed/cv` → on success, enqueues `score-cv` |
| Job upserted with `embedding_status='pending'` (`IngestionService.runOnce`) | `embed-job` | Calls Python `POST /embed/job` → flips status to `done` |
| Manual: `POST /ai/score-now` | `score-cv` | Calls Python `POST /score/cv` → wipes + batch-inserts `job_scores` rows |
| Manual: `POST /ai/backfill-jobs` | `embed-job` (×N) | Bulk-enqueues every pending job; useful after first deploy |

All three queues share `STANDARD_RETRY` in `ai.service.ts`: 3 attempts, 30s exponential backoff, `removeOnFail: true` (auto-removes after final retry so a stuck failed job doesn't block future enqueues via the jobId dedupe).

The `AI_SERVICE_URL` env var points at the Python service (default `http://localhost:8000`).
