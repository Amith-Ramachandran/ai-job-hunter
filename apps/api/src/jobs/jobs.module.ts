import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { JobsService } from './jobs.service';
import { JobsRepository } from './jobs.repository';
import { JobsController } from './jobs.controller';

@Module({
  imports: [AuthModule],
  providers: [JobsService, JobsRepository],
  controllers: [JobsController],
  exports: [JobsRepository, JobsService],
})
export class JobsModule {}
