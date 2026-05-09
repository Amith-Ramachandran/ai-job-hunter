/**
 * Prisma client wrapped as a Nest injectable.
 *
 * Connects on module init so any startup-time misconfiguration (bad
 * DATABASE_URL, unreachable Postgres) crashes the process immediately instead
 * of failing on the first query. Disconnects cleanly on shutdown so dev
 * reloads don't leak connections.
 */
import { Injectable, OnModuleDestroy, OnModuleInit, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit() {
    await this.$connect();
    this.logger.log('Prisma connected');
  }

  async onModuleDestroy() {
    await this.$disconnect();
    this.logger.log('Prisma disconnected');
  }
}
