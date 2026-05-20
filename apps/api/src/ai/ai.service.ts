/**
 * AiService — the producer side of the AI queues.
 *
 * Other modules (CvsService, IngestionService) inject this and call
 * `enqueueEmbedCv` / `enqueueEmbedJob` instead of touching the queues directly.
 * Centralizing the enqueue calls means BullMQ options (attempts, backoff,
 * dedupe keys) are tuned in one place.
 *
 * Also exposes `enqueuePendingJobBackfill()` — a one-shot used by an admin
 * endpoint to enqueue every job currently marked embedding_status='pending'.
 * Run this once after Phase 2 ships to embed the existing 3,465 jobs.
 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { PrismaService } from '../common/prisma/prisma.service';
import {
  EMBED_CV_QUEUE,
  EMBED_JOB_QUEUE,
  SCORE_CV_QUEUE,
  type EmbedCvJobData,
  type EmbedJobJobData,
  type ScoreCvJobData,
} from './ai.constants';

const STANDARD_RETRY = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 30_000 },
  removeOnComplete: 100,
  // Auto-remove after the final retry. We use jobId-based dedupe to prevent
  // rapid duplicate enqueues, but retaining failed jobs forever blocks future
  // retries with the same id (BullMQ short-circuits add() if any job with the
  // jobId exists in any state). Removing on final failure self-heals the
  // queue — operator visibility comes from @OnWorkerEvent('failed') Pino logs.
  removeOnFail: true,
};

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(EMBED_CV_QUEUE) private readonly embedCvQueue: Queue<EmbedCvJobData>,
    @InjectQueue(EMBED_JOB_QUEUE) private readonly embedJobQueue: Queue<EmbedJobJobData>,
    @InjectQueue(SCORE_CV_QUEUE) private readonly scoreCvQueue: Queue<ScoreCvJobData>,
  ) {}

  async enqueueEmbedCv(cvId: string) {
    return this.embedCvQueue.add(
      `embed-cv:${cvId}`,
      { cvId },
      { jobId: `embed-cv-${cvId}`, ...STANDARD_RETRY },
    );
  }

  async enqueueEmbedJob(jobId: string) {
    return this.embedJobQueue.add(
      `embed-job:${jobId}`,
      { jobId },
      { jobId: `embed-job-${jobId}`, ...STANDARD_RETRY },
    );
  }

  async enqueueScoreCv(userId: string, cvId: string) {
    return this.scoreCvQueue.add(
      `score:${cvId}`,
      { userId, cvId },
      { jobId: `score-${cvId}`, ...STANDARD_RETRY },
    );
  }

  /**
   * Enqueue an embed task for every job currently in 'pending' state.
   * Idempotent due to dedupe jobIds — calling this twice in a row is safe.
   */
  async enqueuePendingJobBackfill(): Promise<{ enqueued: number }> {
    const pending = await this.prisma.job.findMany({
      where: { embeddingStatus: 'pending' },
      select: { id: true },
    });
    for (const j of pending) {
      await this.enqueueEmbedJob(j.id);
    }
    this.logger.log({ count: pending.length }, 'Enqueued pending jobs for embedding');
    return { enqueued: pending.length };
  }
}
