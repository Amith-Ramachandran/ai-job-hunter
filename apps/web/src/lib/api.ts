/**
 * Axios instance for talking to the Nest API.
 *
 * Auth: the API issues session cookies (HttpOnly `dhruva_at` + `dhruva_rt`)
 * which the browser attaches automatically as long as we set
 * `withCredentials: true`. There is no Authorization header to manage on the
 * client — and importantly, JS can't read the cookies, so XSS can't grab
 * them.
 *
 * 401 handling: a single in-flight `POST /auth/refresh` rotates the cookie
 * pair; subsequent failing requests queue behind it and replay on success.
 * If refresh itself 401s, we clear local user state and let
 * ProtectedRoute bounce the user to /login.
 */
import axios, { AxiosError, type AxiosRequestConfig, type InternalAxiosRequestConfig } from 'axios';
import { useAuthStore } from '@/stores/auth.store';

const baseURL = import.meta.env.VITE_API_BASE_URL ?? '/api';

export const api = axios.create({
  baseURL,
  // Send/receive the HttpOnly session cookies.
  withCredentials: true,
  // Reasonable default for the kinds of requests this app makes — overrides
  // can be passed per-call (e.g., longer timeout for CV upload).
  timeout: 15_000,
});

// ─── Refresh-on-401 with single-flight queue ─────────────────────────────
//
// If two requests fire simultaneously and both 401, we only want ONE
// /auth/refresh — every other request waits for that single rotation, then
// replays. The naive per-request retry would race and double-rotate the
// refresh token (which would trigger reuse detection and kill the session).

let refreshInFlight: Promise<void> | null = null;

type Retryable = InternalAxiosRequestConfig & { _retried?: boolean };

async function refreshOnce(): Promise<void> {
  if (!refreshInFlight) {
    refreshInFlight = api
      .post('/auth/refresh')
      .then(() => undefined)
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as Retryable | undefined;
    const status = error.response?.status;

    // Conditions for attempting a refresh:
    //  - 401 on a request that isn't itself /auth/refresh or /auth/google
    //    (those should fail cleanly, not loop)
    //  - we haven't already tried to refresh-and-retry this request
    const url = original?.url ?? '';
    const isAuthEndpoint = url.includes('/auth/refresh') || url.includes('/auth/google');
    if (status === 401 && original && !original._retried && !isAuthEndpoint) {
      original._retried = true;
      try {
        await refreshOnce();
        return api.request(original as AxiosRequestConfig);
      } catch {
        // Refresh failed → session is genuinely dead. Clear local user so
        // ProtectedRoute redirects to /login.
        useAuthStore.getState().signOut();
      }
    }
    return Promise.reject(error);
  },
);

// ─── Typed endpoints ──────────────────────────────────────────────────────

export interface User {
  id: string;
  googleSub: string;
  email: string;
  name: string | null;
  picture: string | null;
}

export interface Cv {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  version: number;
  uploadedAt: string;
}

export type Seniority = 'intern' | 'junior' | 'mid' | 'senior' | 'staff' | 'principal';
export type RemotePolicy = 'remote' | 'hybrid' | 'on-site';
export type RoleType =
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
  | 'other';

/** Mirror of the backend ExtractedJd shape (LLM-extracted structured fields). */
export interface ExtractedJd {
  seniority: Seniority | null;
  years_required_min: number | null;
  years_required_max: number | null;
  required_skills: string[];
  nice_to_have_skills: string[];
  salary_min: number | null;
  salary_max: number | null;
  currency: string | null;
  remote_policy: RemotePolicy | null;
  office_locations: string[];
  role_type: RoleType | null;
  tech_stack_summary: string | null;
}

export interface Job {
  id: string;
  source: string;
  title: string;
  company: string;
  location: string | null;
  remote: boolean;
  salaryMin: number | null;
  salaryMax: number | null;
  currency: string | null;
  applyUrl: string;
  postedAt: string;
  ingestedAt: string;
  /** Cosine similarity (0-1) between user's latest CV and this job. Null if not yet scored. */
  matchScore: number | null;
  /** Structured fields extracted from the JD. Null until extraction has run. */
  extractedJson: ExtractedJd | null;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export type SortBy = 'posted' | 'match' | 'title' | 'company' | 'location' | 'source';
export type SortOrder = 'asc' | 'desc';

export interface ListJobsParams {
  q?: string;
  remote?: boolean;
  country?: string;
  minSalary?: number;
  postedSinceDays?: number;
  page?: number;
  pageSize?: number;
  sortBy?: SortBy;
  sortOrder?: SortOrder;
  /** Slice 2.2 — extracted-JSON filters. */
  seniorityIn?: Seniority[];
  skillsAll?: string[];
  remotePolicyIn?: RemotePolicy[];
}

export interface SkillTally {
  skill: string;
  count: number;
}

// ─── Auth ─────────────────────────────────────────────────────────────────

export async function exchangeGoogleIdToken(idToken: string): Promise<User> {
  const { data } = await api.post<User>('/auth/google', { idToken });
  return data;
}

export async function fetchMe(): Promise<User> {
  const { data } = await api.get<User>('/auth/me');
  return data;
}

export async function logout(): Promise<void> {
  await api.post('/auth/logout');
}

// ─── CVs ──────────────────────────────────────────────────────────────────

export async function listCvs(): Promise<Cv[]> {
  const { data } = await api.get<Cv[]>('/cvs');
  return data;
}

export async function uploadCv(file: File): Promise<Cv> {
  const form = new FormData();
  form.append('file', file);
  const { data } = await api.post<Cv>('/cvs', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 60_000,
  });
  return data;
}

// ─── Jobs ─────────────────────────────────────────────────────────────────

export async function listJobs(params: ListJobsParams): Promise<Page<Job>> {
  const { data } = await api.get<Page<Job>>('/jobs', {
    params,
    // axios serializes arrays as `?key[]=…` by default; backend expects
    // comma-separated values, which class-transformer's toArray() splits.
    paramsSerializer: { indexes: null },
  });
  return data;
}

export async function listTopSkills(limit = 50): Promise<SkillTally[]> {
  const { data } = await api.get<SkillTally[]>('/jobs/top-skills', { params: { limit } });
  return data;
}
