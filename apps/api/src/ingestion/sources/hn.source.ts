/**
 * Hacker News "Who is Hiring" monthly thread.
 *
 * Algolia HN Search API: every month a new "Ask HN: Who is hiring?" thread
 * is posted; top-level comments under it are job posts in free-form text.
 *
 * Phase 1 stores them as-is (title = first line of comment, company =
 * extracted heuristically). LLM extraction in Phase 2 will normalize the
 * messy fields (salary, location, remote-status) properly.
 *
 * This adapter is the simplest one — no auth, no pagination beyond the
 * thread's comment count.
 */
import { Injectable, Logger } from '@nestjs/common';
import type { FetchOptions, JobSource, NormalizedJob } from './job-source.interface';

interface HNAlgoliaHit {
  objectID: string;
  author: string;
  comment_text: string | null;
  story_id: number;
  parent_id: number;
  created_at: string;
  created_at_i: number;
}

interface HNAlgoliaSearchResponse {
  hits: HNAlgoliaHit[];
  page: number;
  nbPages: number;
}

@Injectable()
export class HnWhoIsHiringSource implements JobSource {
  readonly name = 'hn-who-is-hiring';
  private readonly logger = new Logger(HnWhoIsHiringSource.name);

  async *fetch(opts: FetchOptions): AsyncIterable<NormalizedJob> {
    // Find the latest "Ask HN: Who is hiring?" submission.
    const storyRes = await fetch(
      'https://hn.algolia.com/api/v1/search?query=Ask+HN+Who+is+hiring&tags=story&hitsPerPage=1',
      { headers: { 'User-Agent': 'ai-job-hunter/0.1 (personal project)' } },
    );
    if (!storyRes.ok) {
      throw new Error(`HN search failed: ${storyRes.status}`);
    }
    const storyData = (await storyRes.json()) as { hits: Array<{ objectID: string }> };
    const storyId = storyData.hits[0]?.objectID;
    if (!storyId) {
      this.logger.warn('No HN "Who is hiring" story found');
      return;
    }
    this.logger.log(`HN current "Who is hiring" thread: ${storyId}`);

    // Pull all comments under that story.
    let page = 0;
    let totalPages = 1;
    while (page < totalPages) {
      const url = `https://hn.algolia.com/api/v1/search?tags=comment,story_${storyId}&hitsPerPage=100&page=${page}`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'ai-job-hunter/0.1 (personal project)' },
      });
      if (!res.ok) {
        this.logger.warn(`HN page ${page}: HTTP ${res.status}, stopping`);
        break;
      }
      const data = (await res.json()) as HNAlgoliaSearchResponse;
      totalPages = data.nbPages;

      for (const hit of data.hits) {
        if (!hit.comment_text || hit.parent_id !== Number(storyId)) continue;
        const postedAt = new Date(hit.created_at);
        if (opts.since && postedAt < opts.since) continue;

        const text = decodeAndStrip(hit.comment_text);
        const firstLine =
          text
            .split('\n')
            .find((l) => l.trim().length > 0)
            ?.trim() ?? 'Job post';
        const { company, title } = extractCompanyAndTitle(firstLine);
        const remote = /\bremote\b/i.test(text);

        yield {
          source: this.name,
          externalId: hit.objectID,
          title,
          company,
          location: null, // Phase 2 LLM extraction will populate.
          remote,
          salaryMin: null,
          salaryMax: null,
          currency: null,
          descriptionRaw: hit.comment_text,
          descriptionMd: text,
          applyUrl: `https://news.ycombinator.com/item?id=${hit.objectID}`,
          postedAt,
        };
      }
      page++;
    }
  }
}

/**
 * "Acme | Senior Backend Engineer | Remote" → { company: "Acme", title: "Senior Backend Engineer" }
 * Falls back to using the whole line as the title if no separator found.
 */
function extractCompanyAndTitle(line: string): { company: string; title: string } {
  const parts = line.split(/\s*[|·•—–-]\s*/).filter(Boolean);
  if (parts.length >= 2) {
    return { company: parts[0], title: parts[1] };
  }
  return { company: 'Unknown', title: line.slice(0, 200) };
}

function decodeAndStrip(html: string): string {
  return html
    .replace(/<p>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/')
    .trim();
}
