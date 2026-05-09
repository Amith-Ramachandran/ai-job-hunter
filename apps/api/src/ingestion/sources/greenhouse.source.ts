/**
 * Greenhouse — public per-company job board API.
 * Endpoint: https://boards-api.greenhouse.io/v1/boards/{board_token}/jobs
 *
 * Greenhouse is per-company: you supply a list of "board tokens" (company
 * slugs) and we fetch each one. The token list is configurable via
 * GREENHOUSE_BOARDS env var (comma-separated) so you can curate your
 * target companies without code changes.
 */
import { Injectable, Logger } from '@nestjs/common';
import type { FetchOptions, JobSource, NormalizedJob } from './job-source.interface';

interface GreenhouseJob {
  id: number;
  internal_job_id: number;
  title: string;
  updated_at: string;
  location: { name: string };
  absolute_url: string;
  content: string; // HTML
  company_name?: string;
  metadata?: Array<{ name: string; value: unknown }>;
}

interface GreenhouseListResponse {
  jobs: GreenhouseJob[];
}

@Injectable()
export class GreenhouseSource implements JobSource {
  readonly name = 'greenhouse';
  private readonly logger = new Logger(GreenhouseSource.name);

  /**
   * Comma-separated list from env (e.g., "stripe,airbnb,figma"). Each one
   * is a distinct Greenhouse board token. Empty/missing → no-op (won't crash).
   */
  private readonly boards: string[] = (process.env.GREENHOUSE_BOARDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  async *fetch(opts: FetchOptions): AsyncIterable<NormalizedJob> {
    if (this.boards.length === 0) {
      this.logger.warn('No Greenhouse boards configured (set GREENHOUSE_BOARDS).');
      return;
    }

    for (const board of this.boards) {
      const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs?content=true`;
      try {
        const res = await fetch(url, {
          headers: { 'User-Agent': 'ai-job-hunter/0.1 (personal project)' },
        });
        if (!res.ok) {
          this.logger.warn(`Greenhouse ${board}: HTTP ${res.status}, skipping`);
          continue;
        }
        const data = (await res.json()) as GreenhouseListResponse;
        this.logger.debug(`Greenhouse ${board}: ${data.jobs.length} jobs`);

        for (const raw of data.jobs) {
          const postedAt = new Date(raw.updated_at);
          if (opts.since && postedAt < opts.since) continue;

          // Greenhouse `content` is HTML-encoded HTML — decode then strip.
          const decoded = decodeHtmlEntities(raw.content);
          const remote = /remote|anywhere/i.test(raw.location?.name ?? '');

          yield {
            source: this.name,
            externalId: `${board}:${raw.id}`,
            title: raw.title,
            company: raw.company_name ?? prettifyBoardName(board),
            location: raw.location?.name ?? null,
            remote,
            salaryMin: null,
            salaryMax: null,
            currency: null,
            descriptionRaw: decoded,
            descriptionMd: stripHtml(decoded),
            applyUrl: raw.absolute_url,
            postedAt,
          };
        }
      } catch (err) {
        this.logger.warn(`Greenhouse ${board} fetch error: ${(err as Error).message}`);
      }
    }
  }
}

function prettifyBoardName(slug: string): string {
  return slug
    .split(/[-_]/)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' ');
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function stripHtml(html: string): string {
  return html
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/?(p|div|li|h[1-6])[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
