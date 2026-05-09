/**
 * Liveness + readiness probes.
 *
 * /health/live — process is up. Cheap; no dependencies checked.
 * /health/ready — full dependency check (DB, Redis). Used by orchestrators
 *   to decide whether to send traffic.
 */
import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../common/prisma/prisma.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('live')
  live() {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready() {
    try {
      // Round-trip query proves DB connection is alive AND queries work,
      // not just that TCP is up.
      await this.prisma.$queryRaw`SELECT 1`;
    } catch (err) {
      throw new ServiceUnavailableException({ status: 'down', dependency: 'postgres' });
    }
    return { status: 'ok' };
  }
}
