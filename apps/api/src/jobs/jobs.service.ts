/**
 * Read-side service for jobs — what the frontend table consumes.
 * Filters: keyword (title/company/description), remote, country, salary
 * minimum, posted-since cutoff. Pagination is offset-based for now (simple);
 * cursor pagination is a Phase 3 concern when the table gets large.
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import type { Prisma } from '@prisma/client';

export interface ListJobsFilters {
  q?: string;
  remote?: boolean;
  country?: string;
  minSalary?: number;
  postedSinceDays?: number;
  page?: number;
  pageSize?: number;
}

@Injectable()
export class JobsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(filters: ListJobsFilters) {
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 20));

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

    const [items, total] = await this.prisma.$transaction([
      this.prisma.job.findMany({
        where,
        orderBy: { postedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.job.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }
}
