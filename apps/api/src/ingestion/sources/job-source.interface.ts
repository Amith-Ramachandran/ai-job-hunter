/**
 * The contract every job source must satisfy.
 *
 * Adding a new source means:
 *   1. Implement this interface in a new file under sources/
 *   2. Register it in IngestionModule's `JOB_SOURCES` provider array
 *
 * Sources stay narrow on purpose — they only know how to fetch + normalize
 * from one place. Cross-cutting concerns (dedupe, persistence, queueing,
 * rate-limit coordination across sources) live in IngestionService.
 *
 * The interface yields an AsyncIterable so a source with paginated APIs can
 * stream pages instead of buffering everything in memory.
 */

/** Provider token for the array of registered JobSource implementations. */
export const JOB_SOURCES = Symbol('JOB_SOURCES');

/**
 * Output of a JobSource — one normalized job ready for upsert into Postgres.
 * Sources are responsible for parsing source-specific payloads into this shape.
 */
export interface NormalizedJob {
  source: string;
  externalId: string;
  title: string;
  company: string;
  location: string | null;
  remote: boolean;
  salaryMin: number | null;
  salaryMax: number | null;
  currency: string | null;
  /** Original HTML/markdown — kept for debugging and future re-extraction. */
  descriptionRaw: string;
  /** Cleaned markdown — used for display and embedding. */
  descriptionMd: string;
  applyUrl: string;
  postedAt: Date;
}

export interface FetchOptions {
  /** Only return jobs posted on/after this timestamp. */
  since?: Date;
}

export interface JobSource {
  readonly name: string;

  fetch(opts: FetchOptions): AsyncIterable<NormalizedJob>;
}
