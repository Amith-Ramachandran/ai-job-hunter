/**
 * Jobs page.
 *
 * Layout:
 *   - Page header with stats strip (matched / total / avg score)
 *   - Filter panel (search row, chip rows, active-filters summary)
 *   - Results table (sticky header, zebra rows, gold active sort)
 *
 * Default sort is `match desc`. Click any column header to toggle.
 */
import { useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  ChevronDown,
  ChevronsUpDown,
  ChevronUp,
  ExternalLink,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import {
  listJobs,
  listTopSkills,
  type ListJobsParams,
  type RemotePolicy,
  type Seniority,
  type SortBy,
  type SortOrder,
} from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn, formatRelativeTime } from '@/lib/utils';

/** First-click direction for each column. Subsequent clicks toggle. */
const NATURAL_DIRECTION: Record<SortBy, SortOrder> = {
  match: 'desc',
  posted: 'desc',
  title: 'asc',
  company: 'asc',
  location: 'asc',
  source: 'asc',
};

const SENIORITY_OPTIONS: Seniority[] = ['junior', 'mid', 'senior', 'staff', 'principal'];
const REMOTE_OPTIONS: RemotePolicy[] = ['remote', 'hybrid', 'on-site'];

const INITIAL_FILTERS: ListJobsParams = {
  page: 1,
  pageSize: 20,
  postedSinceDays: 30,
  sortBy: 'match',
  sortOrder: 'desc',
};

export function JobsPage() {
  const [filters, setFilters] = useState<ListJobsParams>(INITIAL_FILTERS);

  const jobsQuery = useQuery({
    queryKey: ['jobs', filters],
    queryFn: () => listJobs(filters),
    placeholderData: keepPreviousData,
  });

  // Top extracted skills — populates the typeahead. Cached 5 min.
  const topSkillsQuery = useQuery({
    queryKey: ['topSkills'],
    queryFn: () => listTopSkills(50),
    staleTime: 5 * 60_000,
  });

  const totalPages = jobsQuery.data
    ? Math.max(1, Math.ceil(jobsQuery.data.total / (filters.pageSize ?? 20)))
    : 1;

  // Page-level summary stats — read from the current query result so they
  // always reflect the active filter, not the global corpus.
  const stats = useMemo(() => {
    const items = jobsQuery.data?.items ?? [];
    const withScore = items.filter((j) => typeof j.matchScore === 'number');
    const avg =
      withScore.length > 0
        ? withScore.reduce((s, j) => s + (j.matchScore ?? 0), 0) / withScore.length
        : null;
    return {
      total: jobsQuery.data?.total ?? 0,
      onPage: items.length,
      avgPct: avg !== null ? Math.round(avg * 100) : null,
    };
  }, [jobsQuery.data]);

  // Track whether ANY of the structured filters are active — used to render
  // the active-filters chip strip + Clear All button.
  const hasActiveFilters =
    !!filters.q ||
    !!filters.country ||
    typeof filters.minSalary === 'number' ||
    filters.remote === true ||
    (filters.seniorityIn?.length ?? 0) > 0 ||
    (filters.remotePolicyIn?.length ?? 0) > 0 ||
    (filters.skillsAll?.length ?? 0) > 0;

  function handleSort(col: SortBy) {
    setFilters((f) => {
      const nextOrder: SortOrder =
        f.sortBy === col
          ? f.sortOrder === 'asc'
            ? 'desc'
            : 'asc'
          : NATURAL_DIRECTION[col];
      return { ...f, sortBy: col, sortOrder: nextOrder, page: 1 };
    });
  }

  function toggleInArray<T>(arr: T[] | undefined, value: T): T[] | undefined {
    const set = new Set(arr ?? []);
    if (set.has(value)) set.delete(value);
    else set.add(value);
    const next = Array.from(set);
    return next.length > 0 ? next : undefined;
  }

  function clearAll() {
    setFilters({ ...INITIAL_FILTERS });
  }

  return (
    <div className="space-y-6">
      {/* ─── Page header + stats strip ──────────────────────────── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Jobs</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Postings ingested from public sources, scored against your CV.
          </p>
        </div>
        <div className="flex gap-3">
          <StatPill label="Matches" value={stats.total.toLocaleString()} />
          <StatPill
            label="Avg match"
            value={stats.avgPct !== null ? `${stats.avgPct}%` : '—'}
            accent
          />
        </div>
      </div>

      {/* ─── Filter panel ─────────────────────────────────────── */}
      <Card>
        <CardContent className="space-y-5 pt-6">
          {/* Search row: prominent, full-width */}
          <div className="grid gap-3 md:grid-cols-[2fr_1fr_1fr_auto]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Search by title or company"
                defaultValue={filters.q ?? ''}
                onChange={(e) =>
                  setFilters((f) => ({ ...f, q: e.target.value || undefined, page: 1 }))
                }
              />
            </div>
            <Input
              placeholder="Country / location"
              defaultValue={filters.country ?? ''}
              onChange={(e) =>
                setFilters((f) => ({ ...f, country: e.target.value || undefined, page: 1 }))
              }
            />
            <Input
              type="number"
              placeholder="Min salary"
              onChange={(e) =>
                setFilters((f) => ({
                  ...f,
                  minSalary: e.target.value ? Number(e.target.value) : undefined,
                  page: 1,
                }))
              }
            />
            <label className="inline-flex items-center gap-2 whitespace-nowrap px-3 text-sm text-muted-foreground">
              <input
                type="checkbox"
                className="accent-foreground"
                checked={filters.remote ?? false}
                onChange={(e) =>
                  setFilters((f) => ({ ...f, remote: e.target.checked || undefined, page: 1 }))
                }
              />
              Remote-only flag
            </label>
          </div>

          {/* Chip rows */}
          <div className="grid gap-4 md:grid-cols-2">
            <ChipGroup
              label="Seniority"
              options={SENIORITY_OPTIONS}
              selected={filters.seniorityIn ?? []}
              onToggle={(v) =>
                setFilters((f) => ({ ...f, seniorityIn: toggleInArray(f.seniorityIn, v), page: 1 }))
              }
            />
            <ChipGroup
              label="Work model"
              options={REMOTE_OPTIONS}
              selected={filters.remotePolicyIn ?? []}
              onToggle={(v) =>
                setFilters((f) => ({
                  ...f,
                  remotePolicyIn: toggleInArray(f.remotePolicyIn, v),
                  page: 1,
                }))
              }
            />
          </div>

          {/* Skill picker (its own row — typeahead needs width) */}
          <SkillsPicker
            selected={filters.skillsAll ?? []}
            suggestions={topSkillsQuery.data ?? []}
            onAdd={(skill) =>
              setFilters((f) => {
                const next = new Set(f.skillsAll ?? []);
                next.add(skill);
                return { ...f, skillsAll: Array.from(next), page: 1 };
              })
            }
            onRemove={(skill) =>
              setFilters((f) => ({
                ...f,
                skillsAll: (f.skillsAll ?? []).filter((s) => s !== skill) || undefined,
                page: 1,
              }))
            }
          />

          {/* Active-filters strip with "Clear all" — appears only when at
              least one filter is set. Gives users a single-glance view of
              what's filtering + a one-click reset. */}
          {hasActiveFilters && (
            <div className="flex flex-wrap items-center gap-2 border-t pt-4 text-xs">
              <Sparkles className="h-3.5 w-3.5 text-brand" />
              <span className="text-muted-foreground">Filtering by</span>
              {filters.q && <ActiveTag>“{filters.q}”</ActiveTag>}
              {filters.country && <ActiveTag>📍 {filters.country}</ActiveTag>}
              {typeof filters.minSalary === 'number' && (
                <ActiveTag>💰 ≥ {filters.minSalary.toLocaleString()}</ActiveTag>
              )}
              {filters.remote && <ActiveTag>Remote-only flag</ActiveTag>}
              {(filters.seniorityIn ?? []).map((s) => (
                <ActiveTag key={s}>{s}</ActiveTag>
              ))}
              {(filters.remotePolicyIn ?? []).map((p) => (
                <ActiveTag key={p}>{p}</ActiveTag>
              ))}
              {(filters.skillsAll ?? []).map((s) => (
                <ActiveTag key={s}>{s}</ActiveTag>
              ))}
              <button
                type="button"
                onClick={clearAll}
                className="ml-auto text-xs text-muted-foreground underline decoration-dotted hover:text-foreground"
              >
                Clear all
              </button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─── Results table ────────────────────────────────────── */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 border-b bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground backdrop-blur">
                <tr>
                  <SortableHeader col="title" label="Title" filters={filters} onClick={handleSort} />
                  <SortableHeader col="company" label="Company" filters={filters} onClick={handleSort} />
                  <SortableHeader col="location" label="Location" filters={filters} onClick={handleSort} />
                  <SortableHeader col="posted" label="Posted" filters={filters} onClick={handleSort} />
                  <SortableHeader col="match" label="Match" filters={filters} onClick={handleSort} />
                  <SortableHeader col="source" label="Source" filters={filters} onClick={handleSort} />
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border [&_tr:nth-child(even)]:bg-muted/20">
                {jobsQuery.isLoading && !jobsQuery.data && (
                  <tr>
                    <td className="px-4 py-10 text-center text-muted-foreground" colSpan={7}>
                      Loading…
                    </td>
                  </tr>
                )}
                {jobsQuery.data?.items.length === 0 && (
                  <tr>
                    <td className="px-4 py-10 text-center text-muted-foreground" colSpan={7}>
                      No jobs match these filters. Try removing a chip.
                    </td>
                  </tr>
                )}
                {jobsQuery.data?.items.map((job) => (
                  <tr
                    key={job.id}
                    // Token-based hover (works in both light + dark themes) +
                    // hairline amber line on the left for the "active row"
                    // feel without painting a whole-row tint.
                    className="transition-colors hover:bg-muted/60"
                  >
                    <td className="max-w-md px-4 py-3 align-top">
                      <div className="font-medium leading-tight">{job.title}</div>
                      {job.extractedJson?.required_skills?.length ? (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {job.extractedJson.required_skills.slice(0, 5).map((s) => (
                            <span
                              key={s}
                              className="rounded-sm bg-secondary px-1.5 py-0.5 text-[10px] text-secondary-foreground"
                            >
                              {s}
                            </span>
                          ))}
                          {job.extractedJson.required_skills.length > 5 && (
                            <span className="text-[10px] text-muted-foreground">
                              +{job.extractedJson.required_skills.length - 5}
                            </span>
                          )}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 align-top">{job.company}</td>
                    <td className="px-4 py-3 align-top text-muted-foreground">
                      {job.remote ? 'Remote' : (job.location ?? '—')}
                    </td>
                    <td className="px-4 py-3 align-top text-muted-foreground">
                      {formatRelativeTime(job.postedAt)}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <MatchBadge score={job.matchScore} />
                    </td>
                    <td className="px-4 py-3 align-top text-muted-foreground">{job.source}</td>
                    <td className="px-4 py-3 align-top">
                      <Button
                        asChild
                        size="sm"
                        className="bg-brand text-foreground hover:bg-brand/90"
                      >
                        <a href={job.applyUrl} target="_blank" rel="noopener noreferrer">
                          Apply <ExternalLink className="ml-1 h-3 w-3" />
                        </a>
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {jobsQuery.data
            ? `Page ${filters.page ?? 1} of ${totalPages} · ${stats.onPage} on this page`
            : ''}
        </span>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={(filters.page ?? 1) <= 1}
            onClick={() => setFilters((f) => ({ ...f, page: (f.page ?? 1) - 1 }))}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={(filters.page ?? 1) >= totalPages}
            onClick={() => setFilters((f) => ({ ...f, page: (f.page ?? 1) + 1 }))}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ─── small components ───────────────────────────────────────── */

function StatPill({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div
      className={cn(
        'rounded-lg border bg-card px-4 py-2 text-right shadow-sm',
        accent && 'border-amber-200/60 bg-amber-50/60 dark:border-amber-900/40 dark:bg-amber-900/20',
      )}
    >
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div
        className={cn(
          'text-xl font-semibold tabular-nums',
          accent && 'text-amber-700 dark:text-amber-300',
        )}
      >
        {value}
      </div>
    </div>
  );
}

function ActiveTag({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border bg-secondary/60 px-2 py-0.5 text-xs">
      {children}
    </span>
  );
}

function ChipGroup<T extends string>({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: readonly T[];
  selected: T[];
  onToggle: (value: T) => void;
}) {
  const set = new Set(selected);
  return (
    <div>
      <div className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt) => {
          const isActive = set.has(opt);
          return (
            <button
              key={opt}
              type="button"
              onClick={() => onToggle(opt)}
              className={cn(
                'rounded-full border px-3 py-1 text-xs font-medium transition-all',
                isActive
                  ? 'border-foreground bg-foreground text-background shadow-sm'
                  : 'border-input bg-background text-muted-foreground hover:border-foreground/30 hover:bg-secondary',
              )}
            >
              {opt}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SkillsPicker({
  selected,
  suggestions,
  onAdd,
  onRemove,
}: {
  selected: string[];
  suggestions: { skill: string; count: number }[];
  onAdd: (skill: string) => void;
  onRemove: (skill: string) => void;
}) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const filtered = useMemo(() => {
    const q = text.trim().toLowerCase();
    return suggestions
      .filter((s) => !selectedSet.has(s.skill))
      .filter((s) => (q ? s.skill.toLowerCase().includes(q) : true))
      .slice(0, 8);
  }, [suggestions, selectedSet, text]);

  return (
    <div>
      <div className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        Required skills <span className="lowercase">(all of)</span>
      </div>

      {selected.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {selected.map((s) => (
            <span
              key={s}
              className="inline-flex items-center gap-1 rounded-full bg-foreground px-3 py-1 text-xs font-medium text-background"
            >
              {s}
              <button
                type="button"
                onClick={() => onRemove(s)}
                className="rounded-full hover:bg-background/20"
                aria-label={`Remove ${s}`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="relative">
        <Input
          value={text}
          placeholder="Type a skill, or pick from the list…"
          onChange={(e) => setText(e.target.value)}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 100)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && text.trim()) {
              e.preventDefault();
              onAdd(text.trim());
              setText('');
            }
          }}
        />
        {open && filtered.length > 0 && (
          <div className="absolute z-10 mt-1 max-h-60 w-full overflow-y-auto rounded-md border bg-popover p-1 shadow-md">
            {filtered.map((s) => (
              <button
                key={s.skill}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onAdd(s.skill);
                  setText('');
                }}
                className="flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
              >
                <span>{s.skill}</span>
                <span className="text-xs text-muted-foreground">{s.count}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SortableHeader({
  col,
  label,
  filters,
  onClick,
}: {
  col: SortBy;
  label: string;
  filters: ListJobsParams;
  onClick: (col: SortBy) => void;
}) {
  const isActive = filters.sortBy === col;
  const order = filters.sortOrder ?? 'desc';
  return (
    <th className="px-4 py-3 font-medium">
      <button
        type="button"
        onClick={() => onClick(col)}
        className={cn(
          'inline-flex items-center gap-1 transition-colors hover:text-foreground',
          isActive && 'text-brand',
        )}
      >
        {label}
        {isActive ? (
          order === 'asc' ? (
            <ChevronUp className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )
        ) : (
          <ChevronsUpDown className="h-3.5 w-3.5 opacity-30" />
        )}
      </button>
    </th>
  );
}

function MatchBadge({ score }: { score: number | null }) {
  if (score === null) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  const pct = Math.round(score * 100);
  const tone =
    score >= 0.7
      ? 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-200'
      : score >= 0.5
        ? 'bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200'
        : 'bg-muted text-muted-foreground';
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium tabular-nums',
        tone,
      )}
    >
      {pct}%
    </span>
  );
}
