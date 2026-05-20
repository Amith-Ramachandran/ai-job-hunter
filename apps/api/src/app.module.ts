/**
 * Root module — wires together every feature module plus cross-cutting concerns
 * (config, logging, queue infrastructure, Prisma).
 *
 * Feature modules (auth, users, cvs, jobs, ingestion) are kept narrowly scoped
 * so each one can be reasoned about and tested in isolation.
 */
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { LoggerModule } from './common/logger/logger.module';
import { PrismaModule } from './common/prisma/prisma.module';
import { validateEnv } from './common/config/env.schema';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { CvsModule } from './cvs/cvs.module';
import { JobsModule } from './jobs/jobs.module';
import { IngestionModule } from './ingestion/ingestion.module';
import { AiModule } from './ai/ai.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    // ConfigModule loads .env, validates against zod schema, and exposes
    // typed values to anywhere via ConfigService.
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
      cache: true,
    }),

    LoggerModule,
    PrismaModule,

    // BullMQ shared connection — every queue in the app reuses this Redis
    // connection rather than opening its own.
    BullModule.forRootAsync({
      useFactory: () => ({
        connection: {
          host: process.env.REDIS_HOST ?? 'localhost',
          port: Number(process.env.REDIS_PORT ?? 6379),
          password: process.env.REDIS_PASSWORD,
        },
      }),
    }),

    AuthModule,
    UsersModule,
    CvsModule,
    JobsModule,
    IngestionModule,
    AiModule,
    HealthModule,
  ],
})
export class AppModule {}
