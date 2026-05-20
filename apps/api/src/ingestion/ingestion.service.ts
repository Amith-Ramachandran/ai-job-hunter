/**
 * IngestionService — the orchestrator.
 *
 * Responsibilities:
 *   - On startup, schedule a repeating BullMQ task per registered source.
 *   - On each task: resolve the right source, fetch jobs, dedupe + upsert
 *     into Postgres via JobsRepository.
 *
 * Sources are pulled via DI (the JOB_SOURCES injection token). To add a new
 * source: implement JobSource, add to providers in IngestionModule. No
 * changes here.
 */
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { JobsRepository } from '../jobs/jobs.repository';
import { AiService } from '../ai/ai.service';
import type { Env } from '../common/config/env.schema';
import { JOB_SOURCES, type JobSource } from './sources/job-source.interface';
import { INGEST_QUEUE_NAME, type IngestJobData } from './ingestion.constants';

/**
 * Default per-source repeat interval. Per-source overrides could be added by
 * making this a map; one-size-fits-all hourly is fine for now.
 */
const REPEAT_EVERY_MS = 60 * 60 * 1000; // 1 hour

@Injectable()
export class IngestionService implements OnModuleInit {
  private readonly logger = new Logger(IngestionService.name);

  constructor(
    @InjectQueue(INGEST_QUEUE_NAME) private readonly queue: Queue<IngestJobData>,
    @Inject(JOB_SOURCES) private readonly sources: JobSource[],
    private readonly jobsRepo: JobsRepository,
    private readonly ai: AiService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async onModuleInit() {
    // Clear out any existing repeatable jobs from a prior boot (otherwise
    // we'd accumulate duplicates every restart) and re-register them fresh.
    const repeatables = await this.queue.getRepeatableJobs();
    for (const r of repeatables) {
      await this.queue.removeRepeatableByKey(r.key);
    }

    for (const source of this.sources) {
      await this.queue.add(
        `ingest:${source.name}`,
        { source: source.name },
        {
          repeat: { every: REPEAT_EVERY_MS },
          // Don't pile up duplicate runs if a previous one is still in flight.
          jobId: `ingest-${source.name}`,
          removeOnComplete: 50,
          removeOnFail: 100,
          attempts: 3,
          backoff: { type: 'exponential', delay: 30_000 },
        },
      );
      this.logger.log(`Scheduled ingestion for ${source.name} every ${REPEAT_EVERY_MS / 60000}m`);

      // Trigger an immediate run on first boot too — don't wait an hour to
      // see anything in the DB.
      await this.queue.add(`ingest:${source.name}:initial`, { source: source.name });
    }
  }

  /**
   * Runs one ingestion pass for the named source. Called by the BullMQ
   * processor — exposed as a method here so it's also testable in isolation.
   */
  async runOnce(sourceName: string): Promise<{ processed: number; upserted: number }> {
    const source = this.sources.find((s) => s.name === sourceName);
    if (!source) {
      throw new Error(`Unknown source: ${sourceName}`);
    }

    const since = await this.computeSince(sourceName);
    let processed = 0;
    let upserted = 0;

    for await (const normalized of source.fetch({ since })) {
      processed++;
      try {
        const job = await this.jobsRepo.upsert(normalized);
        upserted++;
        // Phase 2: enqueue embedding + extraction in parallel for newly-inserted
        // or description-changed rows. The repository resets embeddingStatus to
        // 'pending' on update — we use that as the signal so we don't redo work
        // for unchanged descriptions.
        if (job.embeddingStatus === 'pending') {
          await this.ai.enqueueEmbedJob(job.id);
          await this.ai.enqueueExtractJob(job.id);
        }
      } catch (err) {
        // One bad row shouldn't kill the run — log and continue.
        this.logger.warn(
          { err, externalId: normalized.externalId, source: sourceName },
          'Failed to upsert job',
        );
      }
    }

    this.logger.log(
      `Ingestion ${sourceName}: processed=${processed} upserted=${upserted} since=${since?.toISOString() ?? 'all-time'}`,
    );
    return { processed, upserted };
  }

  /**
   * `since` for the next fetch is the LATER of:
   *   - the latest postedAt we already have minus a 6h overlap window
   *     (catches out-of-order or edited postings)
   *   - the configured max-age floor (e.g. 7 days)
   *
   * On a fresh DB, only the floor applies — keeps us from refetching jobs
   * from years ago. After ingestion catches up, the natural-overlap window
   * is almost always inside the max-age cap so the floor is a no-op.
   */
  private async computeSince(sourceName: string): Promise<Date | undefined> {
    const maxAgeDays = this.config.get('INGESTION_MAX_AGE_DAYS', { infer: true });
    const ageFloor = new Date(Date.now() - maxAgeDays * 86_400_000);

    const lastSeen = await this.jobsRepo.lastPostedAtForSource(sourceName);
    if (!lastSeen) return ageFloor;

    const overlapMs = 6 * 60 * 60 * 1000; // 6 hours
    const naturalSince = new Date(lastSeen.getTime() - overlapMs);
    // Whichever is more recent — that's our cutoff.
    return naturalSince > ageFloor ? naturalSince : ageFloor;
  }
}
