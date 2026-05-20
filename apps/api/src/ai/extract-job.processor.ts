/**
 * BullMQ worker for the extract-job queue.
 *
 * Reads the job's descriptionMd from Postgres, calls the AI service to run
 * LLM extraction, persists the resulting structured fields into
 * `jobs.extracted_json`. Runs in parallel with embed-job (both fire after
 * the same upsert) — extraction depends on Postgres state, embed depends on
 * Qdrant; they're independent pipelines.
 *
 * Failures bubble out so BullMQ retries with exponential backoff.
 */
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { PrismaService } from '../common/prisma/prisma.service';
import { AiClientService } from './ai-client.service';
import { EXTRACT_JOB_QUEUE, type ExtractJobJobData } from './ai.constants';

@Processor(EXTRACT_JOB_QUEUE)
export class ExtractJobProcessor extends WorkerHost {
  private readonly logger = new Logger(ExtractJobProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiClientService,
  ) {
    super();
  }

  async process(task: Job<ExtractJobJobData>) {
    const job = await this.prisma.job.findUnique({
      where: { id: task.data.jobId },
      select: { id: true, descriptionMd: true },
    });
    if (!job) {
      this.logger.warn({ jobId: task.data.jobId }, 'Job not found, skipping extract');
      return { skipped: true };
    }
    if (!job.descriptionMd?.trim()) {
      this.logger.warn({ jobId: job.id }, 'Job has empty descriptionMd, skipping extract');
      return { skipped: true };
    }

    const result = await this.ai.extractJob({ id: job.id, text: job.descriptionMd });

    // Persist as JSONB. Cast through `unknown` because Prisma's JSON typing
    // doesn't recognize structured objects without a JsonValue assertion.
    await this.prisma.job.update({
      where: { id: job.id },
      data: { extractedJson: result.extracted as unknown as object },
    });

    this.logger.log(
      {
        jobId: job.id,
        tokens: result.total_tokens,
        skills: result.extracted.required_skills.length,
      },
      'Extracted job',
    );
    return result;
  }

  @OnWorkerEvent('failed')
  onFailed(task: Job<ExtractJobJobData>, err: Error) {
    this.logger.error(
      { jobId: task.data.jobId, attemptsMade: task.attemptsMade, err: err.message },
      'Extract job failed',
    );
  }
}
