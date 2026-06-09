/**
 * Auth store (Zustand).
 *
 * Holds only the cached `user` record from /auth/me. The session itself lives
 * in HttpOnly cookies (`dhruva_at` + `dhruva_rt`) issued by the backend —
 * JavaScript can't read those, which is the whole point: XSS can't lift the
 * token.
 *
 * `user` is persisted to localStorage as a UI optimization so a page refresh
 * doesn't flash the login screen at someone who has a live cookie session.
 * The /auth/me query revalidates this on every app boot.
 *
 * Why Zustand and not React Context: Zustand reads don't cause re-renders
 * unless the selected slice changes, and selectors are explicit at call
 * site. It's the recognized "modern lightweight client state" answer.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User } from '@/lib/api';

interface AuthState {
  user: User | null;
  setUser: (user: User) => void;
  signOut: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      setUser: (user) => set({ user }),
      signOut: () => set({ user: null }),
    }),
    {
      name: 'ai-job-hunter:auth',
      // Persist only `user` — anything else would risk leaking transient state
      // we add later.
      partialize: (state) => ({ user: state.user }),
    },
  ),
);
