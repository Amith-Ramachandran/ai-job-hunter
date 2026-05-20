/**
 * Admin-style endpoints for AI operations.
 *
 * /ai/backfill-jobs — enqueues all jobs with embedding_status='pending'.
 * Used once after Phase 2 ships to seed Qdrant with the existing job corpus.
 * Guarded so only an authenticated user can hit it (single-tenant assumption
 * for now; would gate by role in a multi-user setup).
 *
 * /ai/score-now — manually re-trigger scoring for the user's latest CV.
 * Useful while developing; in steady state, scoring runs automatically after
 * every CV upload.
 */
import { Controller, NotFoundException, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { GoogleAuthGuard } from '../auth/google-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/types';
import { PrismaService } from '../common/prisma/prisma.service';
import { AiService } from './ai.service';

@ApiTags('ai')
@ApiBearerAuth()
@UseGuards(GoogleAuthGuard)
@Controller('ai')
export class AiController {
  constructor(
    private readonly ai: AiService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('backfill-jobs')
  backfillJobs() {
    return this.ai.enqueuePendingJobBackfill();
  }

  @Post('score-now')
  async scoreNow(@CurrentUser() user: AuthenticatedUser) {
    const latestCv = await this.prisma.cv.findFirst({
      where: { userId: user.id },
      orderBy: { uploadedAt: 'desc' },
      select: { id: true },
    });
    if (!latestCv) throw new NotFoundException('No CV uploaded yet');
    await this.ai.enqueueScoreCv(user.id, latestCv.id);
    return { enqueued: true, cvId: latestCv.id };
  }
}
