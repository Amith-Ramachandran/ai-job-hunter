/**
 * Environment variable schema.
 *
 * Validated at app bootstrap by ConfigModule. Fail-fast: a missing or malformed
 * env var crashes the process before any module starts, instead of producing
 * a vague runtime error in some downstream call.
 */
import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  WEB_ORIGIN: z.string().url().default('http://localhost:5173'),

  DATABASE_URL: z.string().min(1),

  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
  REDIS_PASSWORD: z.string().optional(),

  // Required in any environment that actually serves users. Tests stub it.
  GOOGLE_CLIENT_ID: z.string().min(1),

  // HMAC secret for signing session access JWTs. Must be high-entropy in any
  // env that serves users — 32+ chars is a sane floor. Rotating this
  // invalidates every outstanding access token (refresh tokens are unaffected
  // since they're opaque + DB-backed).
  JWT_SECRET: z.string().min(32),
  // Access tokens are short so revocation latency is bounded by this window.
  // 15 minutes is the conventional default.
  JWT_ACCESS_TTL_MIN: z.coerce.number().int().positive().default(15),
  // Refresh tokens live longer because that's the whole point — keeping users
  // signed in without re-running the Google OAuth flow. 30d matches what most
  // SaaS apps do.
  JWT_REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(30),

  AWS_REGION: z.string().default('us-east-1'),
  AWS_ACCESS_KEY_ID: z.string().min(1),
  AWS_SECRET_ACCESS_KEY: z.string().min(1),
  S3_BUCKET: z.string().min(1),
  // Custom S3 endpoint — set for LocalStack, leave undefined for real AWS.
  S3_ENDPOINT: z.string().url().optional(),
  S3_FORCE_PATH_STYLE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  AI_SERVICE_URL: z.string().url().default('http://localhost:8000'),

  // Shared secret for internal service-to-service calls between Nest and the
  // Python AI service. Carried as `Authorization: Bearer <token>` on calls
  // the Python tools make back into Nest (since Python can't read the user's
  // HttpOnly session cookie). Must be high-entropy in production; 32+ chars.
  // In dev a sensible default keeps boot frictionless.
  INTERNAL_SERVICE_TOKEN: z.string().min(16).default('dev-only-internal-token-please-rotate'),

  // How far back to fetch on ingestion. Even on an empty DB, the cutoff is
  // applied so we never burn API quota / OpenAI tokens on stale postings.
  // For incremental runs after the first, the natural `lastPostedAt - 6h`
  // window almost always lands inside this cap anyway.
  INGESTION_MAX_AGE_DAYS: z.coerce.number().int().min(1).max(365).default(7),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Used by `ConfigModule.forRoot({ validate })`. Returning the parsed object
 * makes the validated values available via `ConfigService.get(...)`.
 */
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    // Format zod errors into a single readable block so a CI failure is
    // immediately useful instead of a wall of JSON.
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  return result.data;
}
