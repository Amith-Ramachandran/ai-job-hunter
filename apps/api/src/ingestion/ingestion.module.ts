/**
 * IngestionModule wires up:
 *   - the BullMQ queue
 *   - the worker processor
 *   - the orchestration service
 *   - the registered set of JobSource adapters
 *
 * Sources are aggregated into a single array under the JOB_SOURCES token so
 * IngestionService can iterate them without knowing each one by name.
 */
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { JobsModule } from '../jobs/jobs.module';
import { AiModule } from '../ai/ai.module';
import { IngestionService } from './ingestion.service';
import { IngestionProcessor } from './ingestion.processor';
import { INGEST_QUEUE_NAME } from './ingestion.constants';
import { JOB_SOURCES, type JobSource } from './sources/job-source.interface';
import { RemotiveSource } from './sources/remotive.source';
import { GreenhouseSource } from './sources/greenhouse.source';
import { LeverSource } from './sources/lever.source';
import { AshbySource } from './sources/ashby.source';
import { HnWhoIsHiringSource } from './sources/hn.source';

const SOURCE_PROVIDERS = [
  RemotiveSource,
  GreenhouseSource,
  LeverSource,
  AshbySource,
  HnWhoIsHiringSource,
];

@Module({
  imports: [JobsModule, AiModule, BullModule.registerQueue({ name: INGEST_QUEUE_NAME })],
  providers: [
    IngestionService,
    IngestionProcessor,
    ...SOURCE_PROVIDERS,
    {
      // Aggregate every registered source into a single array, injected
      // wherever JobSource[] is needed (currently just IngestionService).
      provide: JOB_SOURCES,
      useFactory: (...sources: JobSource[]) => sources,
      inject: SOURCE_PROVIDERS,
    },
  ],
})
export class IngestionModule {}
