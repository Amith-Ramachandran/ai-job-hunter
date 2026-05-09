/**
 * Lever — public per-company postings API.
 * Endpoint: https://api.lever.co/v0/postings/{company}?mode=json
 *
 * Lever is per-company like Greenhouse. The list of companies comes from the
 * LEVER_COMPANIES env var (comma-separated slugs). The slug is the path
 * segment in `https://jobs.lever.co/<slug>`.
 *
 * Lever returns a flat array of postings with rich category metadata
 * (team, location, commitment) and a `workplaceType` field that we map
 * directly to our `remote` boolean.
 */
import { Injectable, Logger } from '@nestjs/common';
import type { FetchOptions, JobSource, NormalizedJob } from './job-source.interface';

interface LeverPosting {
  id: string;
  text: string; // title
  createdAt: number; // epoch ms
  categories: {
    team?: string;
    location?: string;
    commitment?: string;
    department?: string;
  };
  description?: string; // HTML
  descriptionPlain?: string;
  lists?: Array<{ text: string; content: string }>;
  additional?: string; // HTML
  additionalPlain?: string;
  hostedUrl: string;
  applyUrl?: string;
  workplaceType?: 'remote' | 'hybrid' | 'on-site' | 'unspecified';
}

@Injectable()
export class LeverSource implements JobSource {
  readonly name = 'lever';
  private readonly logger = new Logger(LeverSource.name);

  private readonly companies: string[] = (process.env.LEVER_COMPANIES ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  async *fetch(opts: FetchOptions): AsyncIterable<NormalizedJob> {
    if (this.companies.length === 0) {
      this.logger.warn('No Lever companies configured (set LEVER_COMPANIES).');
      return;
    }

    for (const company of this.companies) {
      const url = `https://api.lever.co/v0/postings/${encodeURIComponent(company)}?mode=json`;
      try {
        const res = await fetch(url, {
          headers: { 'User-Agent': 'ai-job-hunter/0.1 (personal project)' },
        });
        if (!res.ok) {
          this.logger.warn(`Lever ${company}: HTTP ${res.status}, skipping`);
          continue;
        }
        const postings = (await res.json()) as LeverPosting[];
        this.logger.debug(`Lever ${company}: ${postings.length} postings`);

        for (const raw of postings) {
          const postedAt = new Date(raw.createdAt);
          if (opts.since && postedAt < opts.since) continue;

          // Build a description that combines the main body with section
          // lists (Requirements, Responsibilities, etc.) since those often
          // hold the meatiest content.
          const sections = (raw.lists ?? [])
            .map((l) => `## ${l.text}\n\n${stripHtml(l.content)}`)
            .join('\n\n');
          const descriptionMd = [
            stripHtml(raw.description ?? raw.descriptionPlain ?? ''),
            sections,
            stripHtml(raw.additional ?? raw.additionalPlain ?? ''),
          ]
            .filter(Boolean)
            .join('\n\n');
          const descriptionRaw = [
            raw.description ?? '',
            ...(raw.lists ?? []).map((l) => `<h2>${l.text}</h2>${l.content}`),
            raw.additional ?? '',
          ]
            .filter(Boolean)
            .join('\n');

          const remote =
            raw.workplaceType === 'remote' ||
            /\bremote\b|anywhere/i.test(raw.categories?.location ?? '');

          yield {
            source: this.name,
            externalId: `${company}:${raw.id}`,
            title: raw.text,
            company: prettifySlug(company),
            location: raw.categories?.location ?? null,
            remote,
            salaryMin: null,
            salaryMax: null,
            currency: null,
            descriptionRaw,
            descriptionMd,
            applyUrl: raw.hostedUrl,
            postedAt,
          };
        }
      } catch (err) {
        this.logger.warn(`Lever ${company} fetch error: ${(err as Error).message}`);
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
