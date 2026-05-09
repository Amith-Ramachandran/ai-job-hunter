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
import { Queue } from 'bullmq';
import { JobsRepository } from '../jobs/jobs.repository';
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
          jobId: `ingest:${source.name}`,
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
        await this.jobsRepo.upsert(normalized);
        upserted++;
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
   * `since` for the next fetch = latest postedAt we already have, minus a
   * small overlap window to catch posts that show up out-of-order or get
   * edited.
   */
  private async computeSince(sourceName: string): Promise<Date | undefined> {
    const lastSeen = await this.jobsRepo.lastPostedAtForSource(sourceName);
    if (!lastSeen) return undefined;
    const overlapMs = 6 * 60 * 60 * 1000; // 6 hours
    return new Date(lastSeen.getTime() - overlapMs);
  }
}
