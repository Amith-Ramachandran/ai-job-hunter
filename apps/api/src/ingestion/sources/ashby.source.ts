/**
 * Ashby — public per-company job board API.
 * Endpoint: https://api.ashbyhq.com/posting-api/job-board/{company}?includeCompensation=true
 *
 * Ashby is per-company; companies come from the ASHBY_COMPANIES env var.
 * The slug is the path segment in `https://jobs.ashbyhq.com/<slug>`.
 *
 * Ashby is the newest of the three per-company ATS platforms — used heavily
 * by AI-native companies (Linear, Anthropic, Replit, etc.).
 *
 * Compensation is exposed when `includeCompensation=true`. Salary parsing
 * is left to a Phase 2 LLM step — Ashby returns a free-text summary like
 * "$140k - $180k" that's not worth regex-parsing here.
 */
import { Injectable, Logger } from '@nestjs/common';
import type { FetchOptions, JobSource, NormalizedJob } from './job-source.interface';

interface AshbyJob {
  id: string;
  title: string;
  department?: string;
  team?: string;
  employmentType?: string;
  location?: string;
  secondaryLocations?: Array<{ location: string }>;
  publishedAt: string;         // ISO 8601 timestamp from Ashby
  jobUrl: string;
  applicationUrl?: string;
  isRemote?: boolean;
  isListed?: boolean;
  descriptionHtml?: string;
  descriptionPlain?: string;
  compensation?: {
    compensationTierSummary?: string;
    scrapeableCompensationSalarySummary?: string;
  };
}

interface AshbyResponse {
  jobs: AshbyJob[];
}

@Injectable()
export class AshbySource implements JobSource {
  readonly name = 'ashby';
  private readonly logger = new Logger(AshbySource.name);

  private readonly companies: string[] = (process.env.ASHBY_COMPANIES ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  async *fetch(opts: FetchOptions): AsyncIterable<NormalizedJob> {
    if (this.companies.length === 0) {
      this.logger.warn('No Ashby companies configured (set ASHBY_COMPANIES).');
      return;
    }

    for (const company of this.companies) {
      const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(
        company,
      )}?includeCompensation=true`;
      try {
        const res = await fetch(url, {
          headers: { 'User-Agent': 'ai-job-hunter/0.1 (personal project)' },
        });
        if (!res.ok) {
          this.logger.warn(`Ashby ${company}: HTTP ${res.status}, skipping`);
          continue;
        }
        const data = (await res.json()) as AshbyResponse;
        this.logger.debug(`Ashby ${company}: ${data.jobs.length} jobs`);

        for (const raw of data.jobs) {
          // Some companies set isListed=false to keep specific roles hidden;
          // respect that flag.
          if (raw.isListed === false) continue;

          const postedAt = new Date(raw.publishedAt);
          // Defensive: if the API ever changes the field name or returns
          // a malformed value, skip the row instead of polluting the DB
          // (or crashing the upsert with "Invalid Date").
          if (Number.isNaN(postedAt.getTime())) {
            this.logger.warn(
              `Ashby ${company}/${raw.id}: missing/invalid publishedAt, skipping`,
            );
            continue;
          }
          if (opts.since && postedAt < opts.since) continue;

          // Combine primary + secondary locations into one string for display.
          const locations = [
            raw.location,
            ...(raw.secondaryLocations ?? []).map((s) => s.location),
          ].filter(Boolean) as string[];
          const location = locations.length > 0 ? locations.join(' / ') : null;

          const remote =
            raw.isRemote === true || (location ? /\bremote\b|anywhere/i.test(location) : false);

          yield {
            source: this.name,
            externalId: `${company}:${raw.id}`,
            title: raw.title,
            company: prettifySlug(company),
            location,
            remote,
            salaryMin: null,
            salaryMax: null,
            currency: null,
            descriptionRaw: raw.descriptionHtml ?? raw.descriptionPlain ?? '',
            descriptionMd: stripHtml(raw.descriptionHtml ?? raw.descriptionPlain ?? ''),
            applyUrl: raw.applicationUrl ?? raw.jobUrl,
            postedAt,
          };
        }
      } catch (err) {
        this.logger.warn(`Ashby ${company} fetch error: ${(err as Error).message}`);
      }
    }
  }
}

function prettifySlug(slug: string): string {
  return slug
    .split(/[-_]/)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' ');
}

function stripHtml(html: string): string {
  return html
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/?(p|div|li|h[1-6])[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
