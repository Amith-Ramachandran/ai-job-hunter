/**
 * Composite auth hook — combines the cached user (Zustand) with the "live"
 * /auth/me query (TanStack Query). The session itself is server-side: an
 * HttpOnly cookie pair the browser attaches automatically. From the
 * component's perspective auth is simply:
 *   - isAuthenticated
 *   - isLoading
 *   - user
 *   - signOut()
 *
 * On boot we ALWAYS call /auth/me. If the access cookie is fresh, it returns
 * the user. If the access cookie is stale but the refresh cookie is alive,
 * the axios interceptor silently rotates and replays — still returns the user.
 * If both are dead, /auth/me 401s and we treat the user as signed out.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { fetchMe, logout as logoutRequest } from '@/lib/api';
import { useAuthStore } from '@/stores/auth.store';

export function useAuth() {
  const queryClient = useQueryClient();
  const { user, setUser, signOut: clearUser } = useAuthStore();

  const meQuery = useQuery({
    queryKey: ['me'],
    queryFn: fetchMe,
    staleTime: 5 * 60_000,
    // /auth/me can legitimately 401 (no session) — that's not a server bug,
    // so don't retry; let the auth flow handle it.
    retry: false,
  });

  // Keep the cached user in the store fresh from the server response, and
  // clear it on a 401 so ProtectedRoute redirects to /login.
  useEffect(() => {
    if (meQuery.data) setUser(meQuery.data);
  }, [meQuery.data, setUser]);
  useEffect(() => {
    if (meQuery.isError) clearUser();
  }, [meQuery.isError, clearUser]);

  const logoutMutation = useMutation({
    mutationFn: logoutRequest,
    onSettled: () => {
      // Clear local cache + react-query state regardless of server outcome;
      // a server error on logout shouldn't strand the user in a half-state.
      clearUser();
      queryClient.clear();
    },
  });

  return {
    isAuthenticated: !!user && !meQuery.isError,
    // We're loading only on the first /auth/me — once we have either a user
    // or an error, downstream components can branch.
    isLoading: meQuery.isLoading,
    user,
    signOut: () => logoutMutation.mutate(),
  };
}
