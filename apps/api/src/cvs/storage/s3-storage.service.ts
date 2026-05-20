/**
 * S3 storage abstraction for CV files.
 *
 * Uses the real AWS SDK pointed at LocalStack in dev (custom endpoint URL)
 * and at real S3 in prod (no endpoint override). The same code path serves
 * both — that's the whole point of LocalStack.
 *
 * We deliberately upload via the backend rather than doing presigned-URL
 * uploads from the browser. Reasons:
 *   - We want to scan/parse the file server-side anyway.
 *   - Bypassing the backend means no place to enforce file size/type limits
 *     centrally.
 *   - Presigned uploads are an optimization for large files; CVs are small.
 *
 * If/when we need to serve files back to the browser, we'll generate a
 * short-lived presigned GET URL via getSignedDownloadUrl().
 */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';
import type { Env } from '../../common/config/env.schema';

@Injectable()
export class S3StorageService {
  private readonly logger = new Logger(S3StorageService.name);
  private readonly s3: S3Client;
  private readonly bucket: string;

  constructor(private readonly config: ConfigService<Env, true>) {
    const endpoint = this.config.get('S3_ENDPOINT', { infer: true });
    const forcePathStyle = this.config.get('S3_FORCE_PATH_STYLE', { infer: true });

    this.s3 = new S3Client({
      region: this.config.get('AWS_REGION', { infer: true }),
      // endpoint is undefined in real-AWS deployment; set to LocalStack URL in dev.
      endpoint: endpoint || undefined,
      // LocalStack requires path-style addressing (bucket in URL path, not subdomain).
      forcePathStyle,
      credentials: {
        accessKeyId: this.config.get('AWS_ACCESS_KEY_ID', { infer: true }),
        secretAccessKey: this.config.get('AWS_SECRET_ACCESS_KEY', { infer: true }),
      },
    });
    this.bucket = this.config.get('S3_BUCKET', { infer: true });
  }

  /**
   * Uploads a buffer to S3 and returns the object key. Key layout:
   *   cvs/{userId}/{uuid}-{originalFilename}
   *
   * Including userId in the key makes it easy to enforce per-user access
   * via bucket policy in prod, and to cleanly delete a user's data.
   */
  async upload(params: {
    userId: string;
    filename: string;
    contentType: string;
    body: Buffer;
  }): Promise<string> {
    const safeFilename = params.filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const key = `cvs/${params.userId}/${randomUUID()}-${safeFilename}`;

    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: params.body,
        ContentType: params.contentType,
      }),
    );
    this.logger.debug({ key }, 'Uploaded CV to S3');
    return key;
  }

  /**
   * Returns a presigned GET URL valid for `expiresInSeconds` (default 5 min).
   * Used to let the browser download the original file without making the
   * API stream large blobs.
   */
  async getSignedDownloadUrl(key: string, expiresInSeconds = 300): Promise<string> {
    return getSignedUrl(this.s3, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: expiresInSeconds,
    });
  }

  /**
   * Downloads an object as a Buffer. Used by the CV reparse endpoint to
   * re-extract text from a previously-uploaded file without making the user
   * upload it again.
   */
  async download(key: string): Promise<Buffer> {
    const res = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!res.Body) {
      throw new Error(`S3 object ${key} returned empty body`);
    }
    return Buffer.from(await res.Body.transformToByteArray());
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }
}
