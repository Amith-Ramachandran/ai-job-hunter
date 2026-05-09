/**
 * App entry point.
 *
 * Three providers wrap the entire tree:
 *   - GoogleOAuthProvider: makes the Google Identity client available to
 *     any component using @react-oauth/google.
 *   - QueryClientProvider: TanStack Query — handles all server-state
 *     (caching, background refetch, mutation lifecycle).
 *   - BrowserRouter: client-side routing.
 *
 * Why this composition: providers are independent (no inner provider needs
 * outer state), so order doesn't matter much; we put OAuth outermost so the
 * sign-in button works on any route, including the unauthenticated /login.
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { GoogleOAuthProvider } from '@react-oauth/google';
import App from './App';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 30s stale time = the hot list of jobs doesn't refetch on every nav.
      // Tune per query when needed via useQuery options.
      staleTime: 30_000,
      retry: 1,
    },
  },
});

const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
if (!googleClientId) {
  // Fail loud in dev — silent OAuth misconfiguration is the worst kind of bug.
  console.warn(
    '[bootstrap] VITE_GOOGLE_CLIENT_ID not set — Google sign-in will not work.',
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <GoogleOAuthProvider clientId={googleClientId ?? ''}>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
        {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
      </QueryClientProvider>
    </GoogleOAuthProvider>
  </React.StrictMode>,
);
