/**
 * BullMQ worker for the score-cv queue.
 *
 * Calls the AI service to compute (job_id, score) pairs for the given CV,
 * then writes them to the job_scores table. We keep one row per
 * (user, cv, job) — old CV scores survive when a new CV is uploaded so the
 * user can compare match quality across CV versions.
 *
 * Writes happen in batches via Prisma's createMany so this stays fast even
 * for thousands of jobs.
 */
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { PrismaService } from '../common/prisma/prisma.service';
import { AiClientService } from './ai-client.service';
import { SCORE_CV_QUEUE, type ScoreCvJobData } from './ai.constants';

const BATCH_SIZE = 500;

@Processor(SCORE_CV_QUEUE)
export class ScoreCvProcessor extends WorkerHost {
  private readonly logger = new Logger(ScoreCvProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiClientService,
  ) {
    super();
  }

  async process(task: Job<ScoreCvJobData>) {
    const { userId, cvId } = task.data;

    const result = await this.ai.scoreCv({ cv_id: cvId });
    if (result.items.length === 0) {
      this.logger.warn({ cvId }, 'No scores returned (CV likely not embedded yet)');
      return { upserted: 0 };
    }

    // Wipe previous scores for this (user, cv) so we don't carry over stale
    // entries for jobs that no longer surface in the top-K.
    await this.prisma.jobScore.deleteMany({ where: { userId, cvId } });

    let upserted = 0;
    for (let i = 0; i < result.items.length; i += BATCH_SIZE) {
      const batch = result.items.slice(i, i + BATCH_SIZE);
      const created = await this.prisma.jobScore.createMany({
        data: batch.map((item) => ({
          userId,
          cvId,
          jobId: item.job_id,
          score: item.score,
          scoreBreakdown: { matched_chunks: item.matched_chunks },
        })),
        // Skip rows whose jobId no longer exists in the DB (job got pruned, etc.).
        skipDuplicates: true,
      });
      upserted += created.count;
    }

    this.logger.log({ cvId, scored: result.scored, upserted }, 'Wrote job scores');
    return { upserted };
  }

  @OnWorkerEvent('failed')
  onFailed(task: Job<ScoreCvJobData>, err: Error) {
    this.logger.error(
      { cvId: task.data.cvId, attemptsMade: task.attemptsMade, err: err.message },
      'Score CV failed',
    );
  }
}
