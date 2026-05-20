import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { GoogleAuthGuard } from '../auth/google-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/types';
import { JobsService, type SortKey, type SortOrder } from './jobs.service';

const SORT_KEYS: SortKey[] = ['posted', 'match', 'title', 'company', 'location', 'source'];
const SORT_ORDERS: SortOrder[] = ['asc', 'desc'];

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
}
