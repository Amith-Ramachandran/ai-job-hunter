/**
 * Jobs table.
 *
 * Sorting:
 *   - Every column header is clickable. Click cycles direction (asc ↔ desc).
 *   - Default sort is "match desc" (best matches first).
 *   - Each column has a "natural" direction used on first activation:
 *     match/posted → desc (most-recent / best first), text columns → asc.
 *
 * Data fetching: useQuery keyed on the filters object so changing a filter
 * triggers a refetch. `keepPreviousData` keeps the table populated while a
 * new page loads.
 */
import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronsUpDown, ChevronUp, ExternalLink } from 'lucide-react';
import {
  listJobs,
  type ListJobsParams,
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

  const totalPages = jobsQuery.data
    ? Math.max(1, Math.ceil(jobsQuery.data.total / (filters.pageSize ?? 20)))
    : 1;

  function handleSort(col: SortBy) {
    setFilters((f) => {
      // Same column → toggle direction. Different column → use its natural default.
      const nextOrder: SortOrder =
        f.sortBy === col
          ? f.sortOrder === 'asc'
            ? 'desc'
            : 'asc'
          : NATURAL_DIRECTION[col];
      return { ...f, sortBy: col, sortOrder: nextOrder, page: 1 };
    });
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
          <CardDescription>Narrow the list down.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-4">
            <Input
              placeholder="Search title, company, description"
              defaultValue={filters.q ?? ''}
              onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value || undefined, page: 1 }))}
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
              Remote only
            </label>
          </div>
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
                    <td className="px-4 py-3 font-medium">{job.title}</td>
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
