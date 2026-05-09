/**
 * Dashboard — quick overview of the user's pipeline. Phase 1 keeps this
 * minimal: latest CV + job count + entry points to the other sections.
 */
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { listCvs, listJobs } from '@/lib/api';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { formatRelativeTime } from '@/lib/utils';

export function DashboardPage() {
  const cvsQuery = useQuery({ queryKey: ['cvs'], queryFn: listCvs });
  const jobsQuery = useQuery({
    queryKey: ['jobs', { page: 1, pageSize: 1 }],
    queryFn: () => listJobs({ page: 1, pageSize: 1 }),
  });

  const latestCv = cvsQuery.data?.[0];
  const totalJobs = jobsQuery.data?.total ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          A quick view of your pipeline.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Your CV</CardTitle>
            <CardDescription>
              {cvsQuery.isLoading
                ? 'Loading…'
                : latestCv
                  ? `Latest: ${latestCv.filename} · ${formatRelativeTime(latestCv.uploadedAt)}`
                  : 'No CV uploaded yet.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant={latestCv ? 'outline' : 'default'} size="sm">
              <Link to="/cv">{latestCv ? 'Manage CVs' : 'Upload CV'}</Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Jobs in pipeline</CardTitle>
            <CardDescription>
              {jobsQuery.isLoading ? 'Loading…' : `${totalJobs.toLocaleString()} jobs ingested`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline" size="sm">
              <Link to="/jobs">Browse jobs</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
