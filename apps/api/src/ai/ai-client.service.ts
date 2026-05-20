/**
 * Thin HTTP client to the Python AI service.
 *
 * Single concern: turn typed requests into HTTP calls + handle status codes.
 * No retry logic here — retries live in BullMQ, where they belong (we have a
 * single resilience layer for both transient HTTP and OpenAI rate-limit errors).
 *
 * Uses native fetch (Node 20+) — no axios dependency on the backend, keeps
 * the bundle smaller.
 */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../common/config/env.schema';

export interface EmbedRequest {
  id: string;
  text: string;
}

export interface EmbedResponse {
  id: string;
  chunk_count: number;
  prompt_tokens: number;
  total_tokens: number;
  model: string;
}

export interface ScoreRequest {
  cv_id: string;
}

export interface ScoreItem {
  job_id: string;
  score: number;
  matched_chunks: number;
}

export interface ScoreResponse {
  cv_id: string;
  scored: number;
  items: ScoreItem[];
}

export interface ExtractRequest {
  id: string;
  text: string;
}

/**
 * Mirror of the Python ExtractedJd Pydantic model. Kept as a TypeScript
 * interface (not a class) because we just store/forward the JSON — no
 * methods, no validation on this side.
 */
export interface ExtractedJd {
  seniority: 'intern' | 'junior' | 'mid' | 'senior' | 'staff' | 'principal' | null;
  years_required_min: number | null;
  years_required_max: number | null;
  required_skills: string[];
  nice_to_have_skills: string[];
  salary_min: number | null;
  salary_max: number | null;
  currency: string | null;
  remote_policy: 'remote' | 'hybrid' | 'on-site' | null;
  office_locations: string[];
  role_type:
    | 'backend'
    | 'frontend'
    | 'fullstack'
    | 'mobile'
    | 'data'
    | 'ml'
    | 'devops'
    | 'security'
    | 'qa'
    | 'design'
    | 'product'
    | 'other'
    | null;
  tech_stack_summary: string | null;
}

export interface ExtractResponse {
  id: string;
  extracted: ExtractedJd;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

@Injectable()
export class AiClientService {
  private readonly logger = new Logger(AiClientService.name);
  private readonly baseUrl: string;

  constructor(config: ConfigService<Env, true>) {
    this.baseUrl = config.get('AI_SERVICE_URL', { infer: true });
  }

  embedCv(body: EmbedRequest): Promise<EmbedResponse> {
    return this.post<EmbedResponse>('/embed/cv', body);
  }

  embedJob(body: EmbedRequest): Promise<EmbedResponse> {
    return this.post<EmbedResponse>('/embed/job', body);
  }

  scoreCv(body: ScoreRequest): Promise<ScoreResponse> {
    return this.post<ScoreResponse>('/score/cv', body);
  }

  extractJob(body: ExtractRequest): Promise<ExtractResponse> {
    // Extraction is slower than embedding (LLM call vs embeddings endpoint).
    // Override the default 15s timeout to be safe for verbose JDs.
    return this.post<ExtractResponse>('/extract/job', body, { timeoutMs: 60_000 });
  }

  private async post<T>(
    path: string,
    body: unknown,
    opts: { timeoutMs?: number } = {},
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15_000);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        this.logger.warn({ url, status: res.status, text }, 'AI service call failed');
        // Throw with the status so BullMQ logs it cleanly; the queue retries.
        throw new Error(`AI service ${path} failed: ${res.status} ${text.slice(0, 200)}`);
      }
      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }
}
