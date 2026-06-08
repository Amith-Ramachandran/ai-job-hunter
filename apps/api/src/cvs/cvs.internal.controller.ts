/**
 * Internal CV endpoints called by the Python AI service.
 *
 * Currently the only consumer is the cover-letter tool, which needs the
 * user's latest CV parsedText to ground its draft. Guarded by the shared
 * internal-token bearer.
 */
import { Controller, Get, NotFoundException, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { InternalAuthGuard } from '../common/internal-auth/internal-auth.guard';
import { PrismaService } from '../common/prisma/prisma.service';

@ApiTags('internal')
@ApiBearerAuth()
@UseGuards(InternalAuthGuard)
@Controller('internal/cvs')
export class InternalCvsController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Latest CV for a user — just enough to ground a cover-letter draft.
   * Returns { id, filename, parsedText } or 404 if the user has none.
   */
  @Get(':userId/latest')
  async latest(@Param('userId') userId: string) {
    const cv = await this.prisma.cv.findFirst({
      where: { userId },
      orderBy: { uploadedAt: 'desc' },
      select: { id: true, filename: true, parsedText: true, uploadedAt: true },
    });
    if (!cv) throw new NotFoundException('No CV uploaded yet');
    return cv;
  }
}
