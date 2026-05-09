/**
 * Remotive — public API for remote job listings.
 * Endpoint: https://remotive.com/api/remote-jobs
 *
 * Their API returns the full result set in one call (no pagination), which
 * is fine — total volume is small. We still yield per-job so the consumer
 * can stream-process.
 */
import { Injectable, Logger } from '@nestjs/common';
import type { FetchOptions, JobSource, NormalizedJob } from './job-source.interface';

interface RemotiveJob {
  id: number;
  url: string;
  title: string;
  company_name: string;
  category: string;
  job_type: string;
  publication_date: string;
  candidate_required_location: string;
  salary: string;
  description: string;
}

interface RemotiveResponse {
  jobs: RemotiveJob[];
}

@Injectable()
export class RemotiveSource implements JobSource {
  readonly name = 'remotive';
  private readonly logger = new Logger(RemotiveSource.name);
  private readonly endpoint = 'https://remotive.com/api/remote-jobs';

  async *fetch(opts: FetchOptions): AsyncIterable<NormalizedJob> {
    const res = await fetch(this.endpoint, {
      headers: { 'User-Agent': 'ai-job-hunter/0.1 (personal project)' },
    });
    if (!res.ok) {
      throw new Error(`Remotive fetch failed: ${res.status} ${res.statusText}`);
    }
    const data = (await res.json()) as RemotiveResponse;
    this.logger.log(`Remotive returned ${data.jobs.length} jobs`);

    for (const raw of data.jobs) {
      const postedAt = new Date(raw.publication_date);
      if (opts.since && postedAt < opts.since) continue;

      yield {
        source: this.name,
        externalId: String(raw.id),
        title: raw.title,
        company: raw.company_name,
        location: raw.candidate_required_location || null,
        remote: true, // Remotive is remote-only by definition.
        salaryMin: null,
        salaryMax: null,
        currency: null,
        descriptionRaw: raw.description,
        descriptionMd: stripHtml(raw.description),
        applyUrl: raw.url,
        postedAt,
      };
    }
  }
}

/**
 * Lightweight HTML→text conversion. Good enough for description previews
 * and embedding input; we're not trying to preserve formatting.
 */
function stripHtml(html: string): string {
  return html
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/?(p|div|li|h[1-6])[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
