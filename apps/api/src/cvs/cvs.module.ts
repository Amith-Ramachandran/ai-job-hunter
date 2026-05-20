import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { AuthModule } from '../auth/auth.module';
import { AiModule } from '../ai/ai.module';
import { StorageModule } from './storage/storage.module';
import { CvParserService } from './parser/cv-parser.service';
import { CvsService } from './cvs.service';
import { CvsController } from './cvs.controller';

@Module({
  imports: [
    AuthModule,
    AiModule,
    StorageModule,
    // Memory storage so we have the buffer in-process for direct S3 upload.
    // Disk storage would require a temp path; not needed here given the 5MB cap.
    MulterModule.register({
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    }),
  ],
  providers: [CvsService, CvParserService],
  controllers: [CvsController],
  exports: [CvsService],
})
export class CvsModule {}
