/**
 * CVs service — handles CV upload, listing, and deletion.
 *
 * Upload flow (Phase 1):
 *   1. Validate file type + size at the controller (Multer + DTO)
 *   2. Push the file buffer to S3 via S3StorageService
 *   3. Insert a row in the `cvs` table with the S3 key
 *
 * Phase 2 will enqueue a `parse-cv` and `embed-cv` job after step 3.
 */
import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { S3StorageService } from './storage/s3-storage.service';

const ACCEPTED_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/msword',                                                        // .doc
  'text/plain',
]);

const MAX_BYTES = 5 * 1024 * 1024; // 5MB — CVs should be tiny.

@Injectable()
export class CvsService {
  private readonly logger = new Logger(CvsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: S3StorageService,
  ) {}

  async uploadCv(params: {
    userId: string;
    filename: string;
    contentType: string;
    body: Buffer;
  }) {
    if (!ACCEPTED_MIME_TYPES.has(params.contentType)) {
      // Throwing as ForbiddenException because UnsupportedMediaType isn't a
      // built-in Nest exception class; "forbidden" reads cleanly to the client.
      throw new ForbiddenException(
        `Unsupported file type: ${params.contentType}. Accepted: PDF, DOCX, DOC, TXT.`,
      );
    }
    if (params.body.byteLength > MAX_BYTES) {
      throw new ForbiddenException(
        `File too large: ${params.body.byteLength} bytes (max ${MAX_BYTES}).`,
      );
    }

    const objectKey = await this.storage.upload({
      userId: params.userId,
      filename: params.filename,
      contentType: params.contentType,
      body: params.body,
    });

    // Increment version: each upload creates a new row, never overwrites.
    // Old CVs stay so historical scores remain reproducible.
    const previousCount = await this.prisma.cv.count({ where: { userId: params.userId } });
    const cv = await this.prisma.cv.create({
      data: {
        userId: params.userId,
        objectKey,
        filename: params.filename,
        contentType: params.contentType,
        sizeBytes: params.body.byteLength,
        version: previousCount + 1,
      },
    });
    this.logger.log({ cvId: cv.id, userId: params.userId }, 'CV uploaded');
    return cv;
  }

  async listForUser(userId: string) {
    return this.prisma.cv.findMany({
      where: { userId },
      orderBy: { uploadedAt: 'desc' },
    });
  }

  /**
   * Returns a CV with a fresh presigned download URL.
   * Caller is expected to have already authenticated and authorized the user.
   */
  async getWithDownloadUrl(cvId: string, userId: string) {
    const cv = await this.prisma.cv.findUnique({ where: { id: cvId } });
    if (!cv) throw new NotFoundException('CV not found');
    if (cv.userId !== userId) throw new ForbiddenException();
    const downloadUrl = await this.storage.getSignedDownloadUrl(cv.objectKey);
    return { ...cv, downloadUrl };
  }
}
