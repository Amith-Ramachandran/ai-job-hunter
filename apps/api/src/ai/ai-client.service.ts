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

  private async post<T>(path: string, body: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      this.logger.warn({ url, status: res.status, text }, 'AI service call failed');
      // Throw with the status so BullMQ logs it cleanly; the queue retries.
      throw new Error(`AI service ${path} failed: ${res.status} ${text.slice(0, 200)}`);
    }
    return (await res.json()) as T;
  }
}
