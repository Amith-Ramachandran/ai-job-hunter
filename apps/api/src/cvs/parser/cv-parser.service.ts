/**
 * Extracts plain text from uploaded CV files.
 *
 * Supported types:
 *   application/pdf   → pdf-parse
 *   text/plain        → utf-8 decode
 *   .docx / .doc      → not yet wired (returns null; falls back to filename embedding)
 *
 * Errors are non-fatal: a corrupted PDF or an image-only PDF returns null
 * rather than throwing. The caller stores null in `parsedText`, which means
 * embedding falls back to "Resume: <filename>" — degraded but not broken.
 *
 * Why not import 'pdf-parse' directly: the package's index.js does a
 * fs.readFileSync at import time when NODE_ENV !== 'test', which crashes
 * if you run the file from a working directory that doesn't have the
 * sample PDF the package ships with. Importing the inner module avoids
 * that footgun.
 */
import { Injectable, Logger } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse/lib/pdf-parse.js') as (
  buffer: Buffer,
) => Promise<{ text: string; numpages: number }>;

@Injectable()
export class CvParserService {
  private readonly logger = new Logger(CvParserService.name);

  async extractText(params: { contentType: string; body: Buffer }): Promise<string | null> {
    try {
      if (params.contentType === 'application/pdf') {
        const result = await pdfParse(params.body);
        const text = result.text.trim();
        if (!text) {
          this.logger.warn('PDF parsed but contained no extractable text (likely image-only)');
          return null;
        }
        this.logger.debug({ pages: result.numpages, chars: text.length }, 'Parsed PDF');
        return text;
      }
      if (params.contentType === 'text/plain') {
        const text = params.body.toString('utf8').trim();
        return text || null;
      }
      // DOCX / DOC handling deferred — would use mammoth.js when needed.
      this.logger.warn(
        { contentType: params.contentType },
        'Unsupported content type for parsing, falling back to filename-only embedding',
      );
      return null;
    } catch (err) {
      // Don't fail the upload over a parse error — log and degrade gracefully.
      this.logger.warn(
        { err: (err as Error).message, contentType: params.contentType },
        'CV parse failed',
      );
      return null;
    }
  }
}
