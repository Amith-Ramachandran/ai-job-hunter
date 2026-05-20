/**
 * Read-side service for jobs — what the frontend table consumes.
 *
 * Filters: keyword (title/company/description), remote, country, salary
 * minimum, posted-since cutoff. Sort by any column (title, company, location,
 * posted, source, match) ascending or descending.
 *
 * Default sort:
 *   - If the user has an embedded CV → `match desc` (best matches first)
 *   - Otherwise → `posted desc` (newest first)
 *
 * Pagination is offset-based for now (simple); cursor pagination is a Phase 3
 * concern when the table gets large.
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import type { Job, JobScore, Prisma } from '@prisma/client';

export type SortKey = 'posted' | 'match' | 'title' | 'company' | 'location' | 'source';
export type SortOrder = 'asc' | 'desc';

export interface ListJobsFilters {
  q?: string;
  remote?: boolean;
  country?: string;
  minSalary?: number;
  postedSinceDays?: number;
  page?: number;
  pageSize?: number;
  sortBy?: SortKey;
  sortOrder?: SortOrder;
}

export interface ListJobsContext {
  /** When provided, the response includes per-row `matchScore` for that user's latest CV. */
  userId?: string;
}

/** Job row with optional joined score — both query paths land here before projection. */
type JobRow = Job & { scores?: Pick<JobScore, 'score'>[] };

@Injectable()
export class JobsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(filters: ListJobsFilters, ctx: ListJobsContext = {}) {
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 20));

    const where = this.buildWhere(filters);

    // Resolve which CV's scores to attach. Latest upload wins; older CVs'
    // scores survive in the table but aren't shown here.
    const scoredCvId = ctx.userId ? await this.latestCvIdForUser(ctx.userId) : null;

    // Default sort: match desc if there's a scored CV; posted desc otherwise.
    // The frontend can override either field.
    const sortBy: SortKey = filters.sortBy ?? (scoredCvId ? 'match' : 'posted');
    const sortOrder: SortOrder = filters.sortOrder ?? 'desc';

    const total = await this.prisma.job.count({ where });

    const rows = await this.fetchPage({
      where,
      page,
      pageSize,
      userId: ctx.userId,
      scoredCvId,
      sortBy,
      sortOrder,
    });

    // Project: lift the joined score (if any) to a top-level matchScore field.
    const items = rows.map((row) => ({
      ...this.stripScores(row),
      matchScore: row.scores?.[0]?.score ?? null,
    }));

    return { items, total, page, pageSize, sortBy, sortOrder };
  }

  private buildWhere(filters: ListJobsFilters): Prisma.JobWhereInput {
    const where: Prisma.JobWhereInput = {};

    if (filters.q) {
      where.OR = [
        { title: { contains: filters.q, mode: 'insensitive' } },
        { company: { contains: filters.q, mode: 'insensitive' } },
        { descriptionMd: { contains: filters.q, mode: 'insensitive' } },
      ];
    }
    if (typeof filters.remote === 'boolean') {
      where.remote = filters.remote;
    }
    if (filters.country) {
      where.location = { contains: filters.country, mode: 'insensitive' };
    }
    if (typeof filters.minSalary === 'number') {
      where.salaryMax = { gte: filters.minSalary };
    }
    if (filters.postedSinceDays) {
      const cutoff = new Date(Date.now() - filters.postedSinceDays * 86_400_000);
      where.postedAt = { gte: cutoff };
    }
    return where;
  }

  private async latestCvIdForUser(userId: string): Promise<string | null> {
    const cv = await this.prisma.cv.findFirst({
      where: { userId },
      orderBy: { uploadedAt: 'desc' },
      select: { id: true },
    });
    return cv?.id ?? null;
  }

  /**
   * Two query strategies:
   *  - sortBy=match: pull job IDs ordered by score from job_scores (Postgres
   *    does the heavy sort), page in JS, then hydrate the page with one
   *    findMany. Trades a tiny bit of overhead for a clean Prisma expression
   *    — Prisma doesn't natively express `ORDER BY joined_table.col`.
   *  - All other sorts: single findMany with the appropriate orderBy clause.
   */
  private async fetchPage(args: {
    where: Prisma.JobWhereInput;
    page: number;
    pageSize: number;
    userId: string | undefined;
    scoredCvId: string | null;
    sortBy: SortKey;
    sortOrder: SortOrder;
  }): Promise<JobRow[]> {
    const { where, page, pageSize, userId, scoredCvId, sortBy, sortOrder } = args;

    const includeScores = scoredCvId
      ? { scores: { where: { cvId: scoredCvId }, select: { score: true }, take: 1 } }
      : undefined;

    if (sortBy === 'match' && scoredCvId && userId) {
      // Pull job_score rows for jobs matching the where filter, sorted by score.
      const ordered = await this.prisma.jobScore.findMany({
        where: { userId, cvId: scoredCvId, job: where },
        orderBy: { score: sortOrder },
        select: { jobId: true },
      });
      const idsForPage = ordered.slice((page - 1) * pageSize, page * pageSize).map((r) => r.jobId);
      if (idsForPage.length === 0) return [];

      const fetched = await this.prisma.job.findMany({
        where: { id: { in: idsForPage } },
        include: includeScores,
      });
      // findMany with `in` doesn't preserve list order — restore it.
      const orderIndex = new Map(idsForPage.map((id, i) => [id, i]));
      return fetched.sort((a, b) => (orderIndex.get(a.id) ?? 0) - (orderIndex.get(b.id) ?? 0));
    }

    return this.prisma.job.findMany({
      where,
      orderBy: this.buildOrderBy(sortBy, sortOrder),
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: includeScores,
    });
  }

  /**
   * Map a sort key to a Prisma orderBy clause.
   * Nullable columns (location) use NULLS LAST so unset values sink to the
   * bottom regardless of direction — standard table-sort UX expectation.
   */
  private buildOrderBy(sortBy: SortKey, sortOrder: SortOrder): Prisma.JobOrderByWithRelationInput {
    switch (sortBy) {
      case 'title':
        return { title: sortOrder };
      case 'company':
        return { company: sortOrder };
      case 'location':
        return { location: { sort: sortOrder, nulls: 'last' } };
      case 'source':
        return { source: sortOrder };
      case 'posted':
      case 'match': // fallback if scored CV unavailable; caller already chose 'posted' default
      default:
        return { postedAt: sortOrder };
    }
  }

  private stripScores(row: JobRow): Job {
    const { scores: _scores, ...rest } = row;
    return rest;
  }
}
