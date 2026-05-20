/**
 * CVs service — handles CV upload, listing, reparse, and embedding triggers.
 *
 * Upload flow:
 *   1. Validate file type + size at the controller (Multer + DTO)
 *   2. Push the file buffer to S3 via S3StorageService
 *   3. Extract text via CvParserService (PDF / TXT supported; DOCX deferred)
 *   4. Insert a row in the `cvs` table with the S3 key + parsedText
 *   5. Enqueue embed-cv (which on success enqueues score-cv)
 *
 * Reparse flow (for CVs uploaded before parser was wired):
 *   1. Authorize the caller owns the CV
 *   2. Re-download the original file from S3
 *   3. Re-extract text + update parsedText on the row
 *   4. Re-enqueue embed-cv → re-fires score-cv
 */
import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { CvParserService } from './parser/cv-parser.service';
import { S3StorageService } from './storage/s3-storage.service';

const ACCEPTED_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/msword', // .doc
  'text/plain',
]);

const MAX_BYTES = 5 * 1024 * 1024; // 5MB — CVs should be tiny.

@Injectable()
export class CvsService {
  private readonly logger = new Logger(CvsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: S3StorageService,
    private readonly parser: CvParserService,
    private readonly ai: AiService,
  ) {}

  async uploadCv(params: { userId: string; filename: string; contentType: string; body: Buffer }) {
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

    // Extract text now (sync) instead of via a background job — the upload is
    // already a slow request, parsing a 5MB PDF takes <1s, and having the text
    // ready means embedding can start immediately. If parse fails, parsedText
    // stays null and the embedder uses a filename fallback.
    const parsedText = await this.parser.extractText({
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
        parsedText,
      },
    });
    this.logger.log(
      { cvId: cv.id, userId: params.userId, parsedChars: parsedText?.length ?? 0 },
      'CV uploaded',
    );

    // Phase 2: kick off embedding. The embed-cv worker will, on success,
    // enqueue a follow-up score-cv task that populates job_scores. Both run
    // in the background — the upload response returns immediately.
    await this.ai.enqueueEmbedCv(cv.id);

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

  /**
   * Re-extract parsedText for a CV that was uploaded before parsing was wired
   * in (or whose parsedText needs refreshing for any other reason).
   *
   * Pulls the original file from S3, runs it through the parser, updates the
   * row, and re-enqueues embed-cv so vectors and scores update.
   */
  async reparse(cvId: string, userId: string) {
    const cv = await this.prisma.cv.findUnique({ where: { id: cvId } });
    if (!cv) throw new NotFoundException('CV not found');
    if (cv.userId !== userId) throw new ForbiddenException();

    const body = await this.storage.download(cv.objectKey);
    const parsedText = await this.parser.extractText({ contentType: cv.contentType, body });

    const updated = await this.prisma.cv.update({
      where: { id: cv.id },
      data: { parsedText },
    });
    this.logger.log(
      { cvId: cv.id, parsedChars: parsedText?.length ?? 0 },
      'CV reparsed; re-enqueuing embed',
    );

    await this.ai.enqueueEmbedCv(cv.id);
    return updated;
  }
}
