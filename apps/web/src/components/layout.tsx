/**
 * Authenticated app shell — header + main content.
 * The classy aesthetic comes from: thin border-bottom on the header,
 * generous container padding, restrained typography, no chrome on the body.
 */
import { Outlet, NavLink } from 'react-router-dom';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function Layout() {
  const { user, signOut } = useAuth();

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container flex h-14 items-center justify-between">
          <div className="flex items-center gap-8">
            <span className="font-semibold tracking-tight">Dhruva</span>
            <nav className="flex items-center gap-1 text-sm">
              <NavLink to="/" end className={navLinkClass}>
                Dashboard
              </NavLink>
              <NavLink to="/jobs" className={navLinkClass}>
                Jobs
              </NavLink>
              <NavLink to="/cv" className={navLinkClass}>
                CV
              </NavLink>
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-muted-foreground">{user?.email}</span>
            <Button variant="ghost" size="sm" onClick={signOut}>
              Sign out
            </Button>
          </div>
        </div>
      </header>
      <main className="container py-10">
        <Outlet />
      </main>
    </div>
  );
}

function navLinkClass({ isActive }: { isActive: boolean }) {
  return cn(
    'rounded-md px-3 py-1.5 transition-colors',
    isActive
      ? 'bg-secondary text-secondary-foreground'
      : 'text-muted-foreground hover:text-foreground',
  );
}
