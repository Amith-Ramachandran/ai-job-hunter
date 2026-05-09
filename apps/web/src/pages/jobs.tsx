/**
 * Jobs table — the headline UX. Phase 1 shows ingested postings with basic
 * filters (search, remote-only, posted-since). The "Match" column will
 * appear in Phase 2 once embeddings are wired up.
 *
 * Data fetching: useQuery keyed on the filters object so changing a filter
 * triggers a refetch. `keepPreviousData` keeps the table populated while a
 * new page loads — better UX than blanking the rows.
 */
import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import { listJobs, type ListJobsParams } from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { formatRelativeTime } from '@/lib/utils';

export function JobsPage() {
  const [filters, setFilters] = useState<ListJobsParams>({
    page: 1,
    pageSize: 20,
    postedSinceDays: 30,
  });

  const jobsQuery = useQuery({
    queryKey: ['jobs', filters],
    queryFn: () => listJobs(filters),
    placeholderData: keepPreviousData,
  });

  const totalPages = jobsQuery.data
    ? Math.max(1, Math.ceil(jobsQuery.data.total / (filters.pageSize ?? 20)))
    : 1;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Jobs</h1>
        <p className="text-sm text-muted-foreground">
          Postings ingested from configured sources.
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
                  <th className="px-4 py-3 font-medium">Title</th>
                  <th className="px-4 py-3 font-medium">Company</th>
                  <th className="px-4 py-3 font-medium">Location</th>
                  <th className="px-4 py-3 font-medium">Posted</th>
                  <th className="px-4 py-3 font-medium">Source</th>
                  <th className="px-4 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {jobsQuery.isLoading && !jobsQuery.data && (
                  <tr>
                    <td className="px-4 py-6 text-muted-foreground" colSpan={6}>
                      Loading…
                    </td>
                  </tr>
                )}
                {jobsQuery.data?.items.length === 0 && (
                  <tr>
                    <td className="px-4 py-6 text-muted-foreground" colSpan={6}>
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
