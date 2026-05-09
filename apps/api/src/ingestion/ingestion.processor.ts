/**
 * BullMQ worker that consumes the `ingest-jobs` queue.
 *
 * Each queue entry has shape { source: 'remotive' } — the processor delegates
 * to IngestionService.runOnce(). Keeping the actual work in a service (not
 * the processor) makes it easy to unit-test the ingestion logic without
 * spinning up Redis.
 *
 * BullMQ handles retries and backoff (configured at enqueue time in
 * IngestionService); throwing here = a failed attempt.
 */
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { IngestionService } from './ingestion.service';
import { INGEST_QUEUE_NAME, type IngestJobData } from './ingestion.constants';

@Processor(INGEST_QUEUE_NAME)
export class IngestionProcessor extends WorkerHost {
  private readonly logger = new Logger(IngestionProcessor.name);

  constructor(private readonly ingestion: IngestionService) {
    super();
  }

  async process(job: Job<IngestJobData>) {
    this.logger.log(`Running ingestion: ${job.data.source} (queue id ${job.id})`);
    return this.ingestion.runOnce(job.data.source);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<IngestJobData>, err: Error) {
    this.logger.error(
      { source: job.data.source, attemptsMade: job.attemptsMade, err: err.message },
      'Ingestion task failed',
    );
  }
}
