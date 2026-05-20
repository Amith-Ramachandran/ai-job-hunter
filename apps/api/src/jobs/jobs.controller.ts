import { Controller, Get, Query, UseGuards } from '@nestjs/common';
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
import { GoogleAuthGuard } from '../auth/google-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/types';
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

/**
 * Normalize a query param that may arrive as a single string or an array.
 * Array case happens with repeated keys (?seniorityIn=senior&seniorityIn=staff)
 * OR comma-separated (?seniorityIn=senior,staff). We accept both.
 */
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

class ListJobsQueryDto {
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
  @Max(100)
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

class TopSkillsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

@ApiTags('jobs')
@ApiBearerAuth()
@UseGuards(GoogleAuthGuard)
@Controller('jobs')
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  @Get()
  list(@Query() query: ListJobsQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.jobs.list(query, { userId: user.id });
  }

  /**
   * Top extracted skills across the current job pool. Used by the frontend
   * to populate the skill-chip typeahead — UI shows the most common skills
   * first so the user can build common filters with one click.
   */
  @Get('top-skills')
  topSkills(@Query() query: TopSkillsQueryDto) {
    return this.jobs.topSkills(query.limit);
  }
}
