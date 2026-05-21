/**
 * Authenticated app shell — left sidebar navigation + main content.
 *
 * Why a sidebar over the previous top-nav: as the app grows (chat, settings,
 * applications), there's more nav surface area than a horizontal row can
 * absorb cleanly. Sidebar also reads more "real product, less toy" — useful
 * signal for recruiter eyes on the demo.
 *
 * The brand mark (star + Dhruva) anchors the top of the sidebar; the user
 * card sits at the bottom — standard SaaS-shell pattern.
 */
import { Outlet, NavLink } from 'react-router-dom';
import {
  Briefcase,
  FileText,
  LayoutDashboard,
  LogOut,
  Star,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/jobs', label: 'Jobs', icon: Briefcase },
  { to: '/cv', label: 'CV', icon: FileText },
];

export function Layout() {
  const { user, signOut } = useAuth();
  const initials = (user?.name ?? user?.email ?? '?')
    .split(/[\s@]/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? '')
    .join('');

  return (
    <div className="flex min-h-screen">
      <aside className="fixed left-0 top-0 z-30 hidden h-screen w-60 flex-col border-r bg-card/60 backdrop-blur-md md:flex">
        {/* Brand */}
        <div className="flex h-14 items-center gap-2 px-5">
          <Star className="h-5 w-5 fill-brand text-brand" />
          <span className="text-base font-semibold tracking-tight">Dhruva</span>
        </div>

        {/* Nav */}
        <nav className="flex flex-1 flex-col gap-0.5 px-3 py-2">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  'group relative flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
                  isActive
                    ? 'bg-secondary text-foreground'
                    : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
                )
              }
            >
              {({ isActive }) => (
                <>
                  {/* Left bar accent on the active item — uses the brand color
                      sparingly so it functions as a true active indicator. */}
                  <span
                    aria-hidden
                    className={cn(
                      'absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r-full bg-brand transition-opacity',
                      isActive ? 'opacity-100' : 'opacity-0',
                    )}
                  />
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        {/* User card */}
        <div className="border-t p-3">
          <div className="flex items-center gap-3">
            <Avatar>
              {user?.picture && <AvatarImage src={user.picture} alt={user.name ?? user.email} />}
              <AvatarFallback>{initials}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{user?.name ?? 'Account'}</div>
              <div className="truncate text-xs text-muted-foreground">{user?.email}</div>
            </div>
            <Button variant="ghost" size="icon" onClick={signOut} aria-label="Sign out" title="Sign out">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </aside>

      {/* Mobile fallback header — sidebar is hidden < md, so a compact bar
          keeps the brand + sign-out reachable without building a full
          mobile menu (out of scope for v1). */}
      <header className="sticky top-0 z-30 flex h-14 w-full items-center justify-between border-b bg-card/80 px-4 backdrop-blur-md md:hidden">
        <div className="flex items-center gap-1.5">
          <Star className="h-4 w-4 fill-brand text-brand" />
          <span className="font-semibold tracking-tight">Dhruva</span>
        </div>
        <Button variant="ghost" size="sm" onClick={signOut}>
          Sign out
        </Button>
      </header>

      <main className="flex-1 md:ml-60">
        <div className="container max-w-screen-xl py-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
