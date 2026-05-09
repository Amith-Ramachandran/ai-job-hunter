/**
 * Single chokepoint for `jobs` table writes from ingestion.
 *
 * The UPSERT key is (source, externalId) — re-running an ingestion is
 * idempotent. The `embeddingStatus` is reset to 'pending' on update so a
 * description change re-triggers embedding (Phase 2).
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import type { NormalizedJob } from '../ingestion/sources/job-source.interface';

@Injectable()
export class JobsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async upsert(job: NormalizedJob) {
    return this.prisma.job.upsert({
      where: {
        source_externalId: { source: job.source, externalId: job.externalId },
      },
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
        // Description may have changed — re-embed.
        embeddingStatus: 'pending',
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
