/**
 * Auth store (Zustand).
 *
 * Holds:
 *   - idToken: Google ID token used as a Bearer in API calls
 *   - user: cached User record from /auth/me
 *
 * Persisted to localStorage so a page refresh doesn't kick the user back
 * to /login. The ID token is short-lived (1 hour from Google) — once it
 * expires, the API returns 401 and the response interceptor clears state.
 *
 * Why Zustand and not React Context: Zustand reads don't cause re-renders
 * unless the selected slice changes, and selectors are explicit at call
 * site. It's the recognized "modern lightweight client state" answer.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User } from '@/lib/api';

interface AuthState {
  idToken: string | null;
  user: User | null;
  signIn: (idToken: string, user: User) => void;
  setUser: (user: User) => void;
  signOut: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      idToken: null,
      user: null,
      signIn: (idToken, user) => set({ idToken, user }),
      setUser: (user) => set({ user }),
      signOut: () => set({ idToken: null, user: null }),
    }),
    {
      name: 'ai-job-hunter:auth',
      // Don't persist anything other than these two keys — extra fields
      // could leak if we ever add transient state.
      partialize: (state) => ({ idToken: state.idToken, user: state.user }),
    },
  ),
);
