/**
 * Axios instance for talking to the Nest API.
 *
 * The interceptor pulls the Google ID token from the auth store on every
 * request — no component has to remember to attach it. If the API responds
 * 401, we clear the auth store, which causes ProtectedRoute to redirect to
 * /login.
 */
import axios, { AxiosError } from 'axios';
import { useAuthStore } from '@/stores/auth.store';

const baseURL = import.meta.env.VITE_API_BASE_URL ?? '/api';

export const api = axios.create({
  baseURL,
  // Reasonable default for the kinds of requests this app makes — overrides
  // can be passed per-call (e.g., longer timeout for CV upload).
  timeout: 15_000,
});

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().idToken;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    if (error.response?.status === 401) {
      // Token has expired or been rejected. Clear local state so the next
      // navigation lands on /login.
      useAuthStore.getState().signOut();
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

export async function fetchMe(): Promise<User> {
  const { data } = await api.get<User>('/auth/me');
  return data;
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
