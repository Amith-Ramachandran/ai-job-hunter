/**
 * BullMQ worker for the embed-job queue.
 *
 * Reads the job's descriptionMd from Postgres (we don't trust whatever was on
 * the queue at enqueue time — descriptions can be updated by re-ingestion),
 * calls the AI service to chunk + embed + upsert into Qdrant, marks
 * embedding_status='done' on success.
 *
 * Failures bubble out so BullMQ retries with exponential backoff. The
 * embedding_status flips to 'failed' only after the final attempt.
 */
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { PrismaService } from '../common/prisma/prisma.service';
import { AiClientService } from './ai-client.service';
import { EMBED_JOB_QUEUE, type EmbedJobJobData } from './ai.constants';

@Processor(EMBED_JOB_QUEUE)
export class EmbedJobProcessor extends WorkerHost {
  private readonly logger = new Logger(EmbedJobProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiClientService,
  ) {
    super();
  }

  async process(task: Job<EmbedJobJobData>) {
    const job = await this.prisma.job.findUnique({
      where: { id: task.data.jobId },
      select: { id: true, descriptionMd: true },
    });
    if (!job) {
      // Source job was deleted between enqueue and process — drop silently.
      this.logger.warn({ jobId: task.data.jobId }, 'Job not found, skipping embed');
      return { skipped: true };
    }
    if (!job.descriptionMd?.trim()) {
      this.logger.warn({ jobId: job.id }, 'Job has empty descriptionMd, marking done');
      await this.prisma.job.update({
        where: { id: job.id },
        data: { embeddingStatus: 'done', embeddedAt: new Date() },
      });
      return { skipped: true };
    }

    // Mark in-flight so the backfill query doesn't re-enqueue while we work.
    await this.prisma.job.update({
      where: { id: job.id },
      data: { embeddingStatus: 'processing' },
    });

    try {
      const result = await this.ai.embedJob({ id: job.id, text: job.descriptionMd });
      await this.prisma.job.update({
        where: { id: job.id },
        data: { embeddingStatus: 'done', embeddedAt: new Date() },
      });
      this.logger.log(
        { jobId: job.id, chunks: result.chunk_count, tokens: result.total_tokens },
        'Embedded job',
      );
      return result;
    } catch (err) {
      // Roll status back to pending so the next backfill picks it up
      // (BullMQ retries first; if all retries fail, this rollback ensures
      //  a manual rerun isn't blocked).
      await this.prisma.job.update({
        where: { id: job.id },
        data: { embeddingStatus: 'pending' },
      });
      throw err;
    }
  }

  @OnWorkerEvent('failed')
  onFailed(task: Job<EmbedJobJobData>, err: Error) {
    this.logger.error(
      { jobId: task.data.jobId, attemptsMade: task.attemptsMade, err: err.message },
      'Embed job failed',
    );
  }
}
