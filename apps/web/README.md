# `@ai-job-hunter/web` — React frontend

The user-facing app: sign in with Google, upload a CV, browse jobs.

## Stack & conventions

| Concern | Choice | Why |
|---|---|---|
| Bundler | Vite | Fast dev, modern default |
| Styling | Tailwind CSS + shadcn/ui | Restrained, "classy" design tokens; we own the UI components (no library lock-in) |
| Server state | TanStack Query | All `/api` data goes through `useQuery` / `useMutation` — caching + invalidation in one place |
| Client state | Zustand (persisted) | Auth token + cached user; reads don't cause unrelated re-renders |
| Forms | react-hook-form + zod | Schema-driven validation; resolver glue is one line |
| Routing | React Router v6 | Standard |
| OAuth | @react-oauth/google | Wraps Google's Identity SDK in a React-friendly API |
| HTTP | axios | Bearer-token interceptor + 401-handling in one place (`src/lib/api.ts`) |

## Source map

```
src/
├── main.tsx                # providers (OAuth, Query, Router) + bootstrap
├── App.tsx                 # routes (login, dashboard, cv-upload, jobs)
├── lib/
│   ├── api.ts              # axios + typed endpoint functions
│   └── utils.ts            # cn(), formatBytes, formatRelativeTime
├── stores/
│   └── auth.store.ts       # Zustand: idToken + user, persisted to localStorage
├── hooks/
│   └── use-auth.ts         # combines store + /auth/me query
├── components/
│   ├── layout.tsx          # authenticated app shell (header + content)
│   ├── protected-route.tsx # redirects to /login if unauthenticated
│   └── ui/                 # shadcn primitives (button, input, card)
└── pages/
    ├── login.tsx
    ├── dashboard.tsx
    ├── cv-upload.tsx
    └── jobs.tsx
```

## Auth model

1. User clicks Google sign-in (`pages/login.tsx` → `<GoogleLogin />`).
2. Google returns an ID token. We `jwtDecode` it for basic claims and store `{ idToken, user }` in Zustand (persisted).
3. Every API call attaches `Authorization: Bearer <idToken>` via the axios interceptor.
4. The Nest API verifies the token with Google's public keys on every request.
5. On 401 from any endpoint, the interceptor calls `signOut()`. ProtectedRoute then redirects to `/login`.

There is no refresh-token flow. Google ID tokens are valid for ~1h; once expired, the user signs in again. This is a deliberate Phase-1 simplification — adding refresh would be the obvious next step if it becomes annoying.

## Running

```bash
# From the repo root:
pnpm install
pnpm --filter @ai-job-hunter/web dev   # starts on :5173
```

Vite proxies `/api/*` → `http://localhost:3000` so there's no CORS dance during development. In production, set `VITE_API_BASE_URL` to the full API origin.

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Vite dev server |
| `pnpm build` | Type-check + production build |
| `pnpm preview` | Serve the production build locally |
| `pnpm lint` | ESLint with zero-warning policy |
| `pnpm test` | Vitest |
| `pnpm test:e2e` | Playwright |
