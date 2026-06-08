/**
 * Internal jobs endpoints called by the Python AI service's agent tools.
 *
 * Mounted under `/internal/jobs` and guarded by `InternalAuthGuard` (shared
 * bearer secret). The `userId` is a request parameter, not derived from a
 * session — the caller is our own AI service, not a browser.
 *
 * Re-uses `JobsService.list()` so the public and internal surfaces stay in
 * lockstep on filters, sort, match-score join, and extracted-JSON shape.
 */
import { Controller, Get, NotFoundException, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { InternalAuthGuard } from '../common/internal-auth/internal-auth.guard';
import { PrismaService } from '../common/prisma/prisma.service';
import {
  JobsService,
  type RemotePolicy,
  type Seniority,
  type SortKey,
  type SortOrder,
} from './jobs.service';

const SORT_KEYS: SortKey[] = ['posted', 'match', 'title', 'company', 'location', 'source'];
const SORT_ORDERS: SortOrder[] = ['asc', 'desc'];
const SENIORITIES: Seniority[] = ['intern', 'junior', 'mid', 'senior', 'staff', 'principal'];
const REMOTE_POLICIES: RemotePolicy[] = ['remote', 'hybrid', 'on-site'];

function toArray(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === 'string')
    return value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  return undefined;
}

class InternalListJobsDto {
  @IsString()
  userId!: string;

  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  remote?: boolean;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minSalary?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  postedSinceDays?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  pageSize?: number;

  @IsOptional()
  @IsIn(SORT_KEYS)
  sortBy?: SortKey;

  @IsOptional()
  @IsIn(SORT_ORDERS)
  sortOrder?: SortOrder;

  @IsOptional()
  @Transform(({ value }) => toArray(value))
  @IsArray()
  @ArrayMaxSize(10)
  @ArrayUnique()
  @IsIn(SENIORITIES, { each: true })
  seniorityIn?: Seniority[];

  @IsOptional()
  @Transform(({ value }) => toArray(value))
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsString({ each: true })
  skillsAll?: string[];

  @IsOptional()
  @Transform(({ value }) => toArray(value))
  @IsArray()
  @ArrayMaxSize(3)
  @ArrayUnique()
  @IsIn(REMOTE_POLICIES, { each: true })
  remotePolicyIn?: RemotePolicy[];
}

@ApiTags('internal')
@ApiBearerAuth()
@UseGuards(InternalAuthGuard)
@Controller('internal/jobs')
export class InternalJobsController {
  constructor(
    private readonly jobs: JobsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  list(@Query() query: InternalListJobsDto) {
    const { userId, ...filters } = query;
    return this.jobs.list(filters, { userId });
  }

  @Get(':id')
  async one(@Param('id') id: string) {
    const job = await this.prisma.job.findUnique({ where: { id } });
    if (!job) throw new NotFoundException('Job not found');
    return job;
  }
}
