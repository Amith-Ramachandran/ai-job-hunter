/**
 * Single chokepoint for `jobs` table writes from ingestion.
 *
 * The UPSERT key is (source, externalId) — re-running an ingestion is
 * idempotent (same source + externalId → same row, no duplicates).
 *
 * Token-leak guard:
 *   The OpenAI re-embed + re-extract pipelines fire whenever
 *   embedding_status='pending' OR extracted_json is null. To avoid burning
 *   tokens on every hourly re-ingestion, we only mark a row as "needs
 *   re-processing" when its descriptionMd has actually changed since last
 *   ingest. Non-content field updates (postedAt nudges, salary edits, etc.)
 *   do NOT trigger re-embedding or re-extraction.
 */
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import type { NormalizedJob } from '../ingestion/sources/job-source.interface';

@Injectable()
export class JobsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async upsert(job: NormalizedJob) {
    // Step 1 — check current state of the row (if it exists). One extra query
    // per upsert is cheap compared to one wasted OpenAI call.
    const existing = await this.prisma.job.findUnique({
      where: { source_externalId: { source: job.source, externalId: job.externalId } },
      select: { id: true, descriptionMd: true, embeddingStatus: true },
    });

    const descriptionChanged = existing && existing.descriptionMd !== job.descriptionMd;

    // Step 2 — only stamp status fields when work actually needs to happen.
    // For an unchanged row, leave embeddingStatus + extractedJson alone so
    // the downstream queues see a "done" job and don't fire.
    const statusReset: Prisma.JobUpdateInput = descriptionChanged
      ? {
          embeddingStatus: 'pending',
          embeddedAt: null,
          extractedJson: Prisma.DbNull,
        }
      : {};

    return this.prisma.job.upsert({
      where: { source_externalId: { source: job.source, externalId: job.externalId } },
      create: {
        source: job.source,
        externalId: job.externalId,
        title: job.title,
        company: job.company,
        location: job.location,
        remote: job.remote,
        salaryMin: job.salaryMin,
        salaryMax: job.salaryMax,
        currency: job.currency,
        descriptionRaw: job.descriptionRaw,
        descriptionMd: job.descriptionMd,
        applyUrl: job.applyUrl,
        postedAt: job.postedAt,
        // embeddingStatus defaults to 'pending' via the Prisma schema;
        // a brand-new row always needs embed + extract.
      },
      update: {
        title: job.title,
        company: job.company,
        location: job.location,
        remote: job.remote,
        salaryMin: job.salaryMin,
        salaryMax: job.salaryMax,
        currency: job.currency,
        descriptionRaw: job.descriptionRaw,
        descriptionMd: job.descriptionMd,
        applyUrl: job.applyUrl,
        postedAt: job.postedAt,
        ...statusReset,
      },
    });
  }

  /**
   * Most recent posting we have from a given source. Used by ingestion to
   * compute the `since` filter so we don't re-fetch the full history every run.
   */
  async lastPostedAtForSource(source: string): Promise<Date | null> {
    const last = await this.prisma.job.findFirst({
      where: { source },
      orderBy: { postedAt: 'desc' },
      select: { postedAt: true },
    });
    return last?.postedAt ?? null;
  }
}
