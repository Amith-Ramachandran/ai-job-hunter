/**
 * BullMQ worker for the embed-cv queue.
 *
 * Phase 1 stored only the raw S3 key for CVs; parsedText lives in the `cvs`
 * table but is filled in by a future PDF-parsing step (Phase 2 polish).
 * For now the worker uses parsedText if present, else falls back to filename.
 *
 * On success, enqueues a follow-up score-cv job so the user's match scores
 * recompute against the latest CV.
 */
import { Processor, WorkerHost, OnWorkerEvent, InjectQueue } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { PrismaService } from '../common/prisma/prisma.service';
import { AiClientService } from './ai-client.service';
import {
  EMBED_CV_QUEUE,
  SCORE_CV_QUEUE,
  type EmbedCvJobData,
  type ScoreCvJobData,
} from './ai.constants';

@Processor(EMBED_CV_QUEUE)
export class EmbedCvProcessor extends WorkerHost {
  private readonly logger = new Logger(EmbedCvProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiClientService,
    @InjectQueue(SCORE_CV_QUEUE) private readonly scoreQueue: Queue<ScoreCvJobData>,
  ) {
    super();
  }

  async process(task: Job<EmbedCvJobData>) {
    const cv = await this.prisma.cv.findUnique({
      where: { id: task.data.cvId },
      select: { id: true, userId: true, parsedText: true, filename: true },
    });
    if (!cv) {
      this.logger.warn({ cvId: task.data.cvId }, 'CV not found, skipping embed');
      return { skipped: true };
    }

    // Phase 1 placeholder: until we wire a PDF parser, embed whatever text we have.
    // The filename alone is enough to test the pipeline; quality improves once
    // parsedText is populated.
    const text = cv.parsedText?.trim() || `Resume: ${cv.filename}`;

    const result = await this.ai.embedCv({ id: cv.id, text });
    this.logger.log(
      { cvId: cv.id, chunks: result.chunk_count, tokens: result.total_tokens },
      'Embedded CV',
    );

    // Now compute match scores using this CV.
    await this.scoreQueue.add(
      `score:${cv.id}`,
      { userId: cv.userId, cvId: cv.id },
      {
        // Dedupe: if multiple CV uploads happen rapidly, only score the latest.
        jobId: `score-${cv.id}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 30_000 },
        // Auto-remove on final failure so retries aren't blocked by a stale
        // failed job sharing the same dedupe id. Same reasoning as
        // STANDARD_RETRY in ai.service.ts.
        removeOnFail: true,
      },
    );

    return result;
  }

  @OnWorkerEvent('failed')
  onFailed(task: Job<EmbedCvJobData>, err: Error) {
    this.logger.error(
      { cvId: task.data.cvId, attemptsMade: task.attemptsMade, err: err.message },
      'Embed CV failed',
    );
  }
}
