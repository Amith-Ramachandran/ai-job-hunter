/**
 * Jobs table.
 *
 * Sorting:
 *   - Every column header is clickable. Click cycles direction (asc ↔ desc).
 *   - Default sort is "match desc" (best matches first).
 *
 * Filtering:
 *   - Free-text search + country + min salary inputs.
 *   - Multi-select chips for seniority and work-model (extracted via LLM).
 *   - Skill typeahead — picks populate `skillsAll[]` (AND semantics).
 *
 * Data fetching: useQuery keyed on the filters object so changing a filter
 * triggers a refetch. `keepPreviousData` keeps the table populated while a
 * new page loads.
 */
import { useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronsUpDown, ChevronUp, ExternalLink, X } from 'lucide-react';
import {
  listJobs,
  listTopSkills,
  type ListJobsParams,
  type RemotePolicy,
  type Seniority,
  type SortBy,
  type SortOrder,
} from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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

export function JobsPage() {
  const [filters, setFilters] = useState<ListJobsParams>({
    page: 1,
    pageSize: 20,
    postedSinceDays: 30,
    sortBy: 'match',
    sortOrder: 'desc',
  });

  const jobsQuery = useQuery({
    queryKey: ['jobs', filters],
    queryFn: () => listJobs(filters),
    placeholderData: keepPreviousData,
  });

  // The skill-chip typeahead pulls from this endpoint. Cached for 5 minutes
  // because the top-N skills don't change minute to minute.
  const topSkillsQuery = useQuery({
    queryKey: ['topSkills'],
    queryFn: () => listTopSkills(50),
    staleTime: 5 * 60_000,
  });

  const totalPages = jobsQuery.data
    ? Math.max(1, Math.ceil(jobsQuery.data.total / (filters.pageSize ?? 20)))
    : 1;

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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Jobs</h1>
        <p className="text-sm text-muted-foreground">
          Postings ingested from configured sources. The Match column shows
          how well each job matches your latest CV (cosine similarity, 0–100%).
          Click any column header to sort.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
          <CardDescription>Combine free-text + structured filters.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Row 1: free-text inputs */}
          <div className="grid gap-3 md:grid-cols-4">
            <Input
              placeholder="Search title, company, description"
              defaultValue={filters.q ?? ''}
              onChange={(e) =>
                setFilters((f) => ({ ...f, q: e.target.value || undefined, page: 1 }))
              }
            />
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
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={filters.remote ?? false}
                onChange={(e) =>
                  setFilters((f) => ({ ...f, remote: e.target.checked || undefined, page: 1 }))
                }
              />
              Remote only (source flag)
            </label>
          </div>

          {/* Row 2: chip groups */}
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

          {/* Row 3: skills typeahead */}
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
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b text-left text-muted-foreground">
                <tr>
                  <SortableHeader col="title" label="Title" filters={filters} onClick={handleSort} />
                  <SortableHeader col="company" label="Company" filters={filters} onClick={handleSort} />
                  <SortableHeader col="location" label="Location" filters={filters} onClick={handleSort} />
                  <SortableHeader col="posted" label="Posted" filters={filters} onClick={handleSort} />
                  <SortableHeader col="match" label="Match" filters={filters} onClick={handleSort} />
                  <SortableHeader col="source" label="Source" filters={filters} onClick={handleSort} />
                  <th className="px-4 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {jobsQuery.isLoading && !jobsQuery.data && (
                  <tr>
                    <td className="px-4 py-6 text-muted-foreground" colSpan={7}>
                      Loading…
                    </td>
                  </tr>
                )}
                {jobsQuery.data?.items.length === 0 && (
                  <tr>
                    <td className="px-4 py-6 text-muted-foreground" colSpan={7}>
                      No jobs match these filters.
                    </td>
                  </tr>
                )}
                {jobsQuery.data?.items.map((job) => (
                  <tr key={job.id} className="hover:bg-muted/50">
                    <td className="px-4 py-3">
                      <div className="font-medium">{job.title}</div>
                      {job.extractedJson?.required_skills?.length ? (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {job.extractedJson.required_skills.slice(0, 5).map((s) => (
                            <span
                              key={s}
                              className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-secondary-foreground"
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
                    <td className="px-4 py-3">{job.company}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {job.remote ? 'Remote' : (job.location ?? '—')}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {formatRelativeTime(job.postedAt)}
                    </td>
                    <td className="px-4 py-3">
                      <MatchBadge score={job.matchScore} />
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{job.source}</td>
                    <td className="px-4 py-3">
                      <Button asChild variant="ghost" size="sm">
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
            ? `Page ${filters.page ?? 1} of ${totalPages} · ${jobsQuery.data.total.toLocaleString()} total`
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

/**
 * A row of toggleable chips. Click to add to selection, click again to remove.
 * Active chips show in primary color; inactive in muted.
 */
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
      <div className="mb-2 text-xs font-medium text-muted-foreground">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt) => {
          const isActive = set.has(opt);
          return (
            <button
              key={opt}
              type="button"
              onClick={() => onToggle(opt)}
              className={cn(
                'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                isActive
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-input bg-background text-muted-foreground hover:bg-secondary',
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

/**
 * Skill picker: free-text input with a dropdown of top extracted skills.
 * Selected skills appear as removable chips above the input. AND semantics —
 * a job must include EVERY selected skill in its required_skills array.
 */
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
      <div className="mb-2 text-xs font-medium text-muted-foreground">
        Required skills (ALL of)
      </div>

      {selected.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {selected.map((s) => (
            <span
              key={s}
              className="inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground"
            >
              {s}
              <button
                type="button"
                onClick={() => onRemove(s)}
                className="rounded-full hover:bg-primary-foreground/20"
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
            // Enter adds the typed value as a custom skill (lets you filter
            // by skills not yet present in the top-N list).
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
                  // onMouseDown beats onBlur — keeps the dropdown open
                  // long enough for the click to register.
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

/**
 * Clickable column header. Shows an inactive double-arrow when not the current
 * sort, and a single arrow (up = asc / down = desc) when active.
 */
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
          isActive && 'text-foreground',
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

/**
 * Renders a colored badge for a match score.
 * - null = "—" (not yet scored)
 * - >= 0.7 = strong (green)
 * - 0.5–0.7 = moderate (amber)
 * - < 0.5 = weak (muted)
 */
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
