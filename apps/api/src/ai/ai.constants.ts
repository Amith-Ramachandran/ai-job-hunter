/**
 * Constants shared by the AI module — queue names + job-data shapes.
 *
 * Four queues, one per kind of work:
 *   - embed-cv:    triggered on every CV upload; calls Python /embed/cv
 *   - embed-job:   triggered on every job upsert; calls Python /embed/job
 *   - extract-job: triggered on every job upsert in parallel with embed-job;
 *                  calls Python /extract/job and persists extracted_json
 *   - score-cv:    triggered after embed-cv succeeds; calls Python /score/cv
 *                  and writes results to job_scores table
 *
 * Shapes are exported so processors and producers share the same TypeScript
 * type — adding a field forces every site to update.
 */

export const EMBED_CV_QUEUE = 'embed-cv';
export const EMBED_JOB_QUEUE = 'embed-job';
export const EXTRACT_JOB_QUEUE = 'extract-job';
export const SCORE_CV_QUEUE = 'score-cv';

export interface EmbedCvJobData {
  cvId: string;
}

export interface EmbedJobJobData {
  jobId: string;
}

export interface ExtractJobJobData {
  jobId: string;
}

export interface ScoreCvJobData {
  /** The user whose score table we'll write to. */
  userId: string;
  /** The CV used as the query — chunks of this CV are queried against job_chunks. */
  cvId: string;
}
