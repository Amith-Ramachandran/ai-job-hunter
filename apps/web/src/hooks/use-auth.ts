/**
 * Composite auth hook — combines the persisted token (Zustand) with the
 * "live" /auth/me query (TanStack Query). Components just ask:
 *   - isAuthenticated
 *   - isLoading
 *   - user
 *   - signOut()
 * without caring whether the source of truth is local cache or the server.
 */
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { fetchMe } from '@/lib/api';
import { useAuthStore } from '@/stores/auth.store';

export function useAuth() {
  const { idToken, user, signOut, setUser } = useAuthStore();

  const meQuery = useQuery({
    queryKey: ['me'],
    queryFn: fetchMe,
    // Only call /auth/me if we have a token — otherwise we know we're logged out.
    enabled: !!idToken,
    staleTime: 5 * 60_000,
  });

  // Keep the cached user in the store fresh from the server response.
  useEffect(() => {
    if (meQuery.data) setUser(meQuery.data);
  }, [meQuery.data, setUser]);

  return {
    isAuthenticated: !!idToken && !!user,
    isLoading: !!idToken && meQuery.isLoading,
    user,
    signOut,
  };
}
