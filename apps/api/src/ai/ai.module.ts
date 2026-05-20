/**
 * AiModule wires:
 *   - the three BullMQ queues (registered + their workers)
 *   - the HTTP client to the Python AI service
 *   - the producer-side service used by other modules
 *   - an admin controller for backfill + manual re-score
 *
 * AiService is exported so CvsService and IngestionService can inject it.
 */
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AuthModule } from '../auth/auth.module';
import { EMBED_CV_QUEUE, EMBED_JOB_QUEUE, SCORE_CV_QUEUE } from './ai.constants';
import { AiClientService } from './ai-client.service';
import { AiService } from './ai.service';
import { AiController } from './ai.controller';
import { EmbedCvProcessor } from './embed-cv.processor';
import { EmbedJobProcessor } from './embed-job.processor';
import { ScoreCvProcessor } from './score-cv.processor';

@Module({
  imports: [
    AuthModule,
    BullModule.registerQueue(
      { name: EMBED_CV_QUEUE },
      { name: EMBED_JOB_QUEUE },
      { name: SCORE_CV_QUEUE },
    ),
  ],
  providers: [
    AiClientService,
    AiService,
    EmbedCvProcessor,
    EmbedJobProcessor,
    ScoreCvProcessor,
  ],
  controllers: [AiController],
  exports: [AiService],
})
export class AiModule {}
