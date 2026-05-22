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
│   ├── api.ts              # axios + typed endpoints; Job.matchScore, SortBy/SortOrder types
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
    ├── cv-upload.tsx       # form via react-hook-form + zod; mutation invalidates ['cvs']
    └── jobs.tsx            # sortable column headers, Match column with colored badge
```

## Auth model

1. User clicks Google sign-in (`pages/login.tsx` → `<GoogleLogin />`).
2. Google returns an ID token. We `jwtDecode` it for basic claims and store `{ idToken, user }` in Zustand (persisted).
3. Every API call attaches `Authorization: Bearer <idToken>` via the axios interceptor.
4. The Nest API verifies the token with Google's public keys on every request.
5. On 401 from any endpoint, the interceptor calls `signOut()`. ProtectedRoute then redirects to `/login`.

There is no refresh-token flow. Google ID tokens are valid for ~1h; once expired, the user signs in again. This is a deliberate simplification — adding refresh (via `google.accounts.id.prompt()` silent re-auth) is a planned polish item if the 1-hour re-login becomes annoying.

## Match scoring (Slice 2.1)

The Jobs page shows a **Match** column with cosine similarity (0–100%) between each job's chunked JD and the user's latest CV. Column headers are clickable; default sort is `match desc`. Scores come from the API's `matchScore` field, populated by the Python AI service when a CV is embedded or `POST /ai/score-now` is hit.

## Smart filters (Slice 2.2)

The Jobs page filter row exposes the LLM-extracted structured fields as chips:
- **Seniority** — junior / mid / senior / staff / principal (multi-select)
- **Work model** — remote / hybrid / on-site (multi-select)
- **Required skills** — typeahead pulling from `/jobs/top-skills`; AND semantics (every selected skill must appear in the JD's `required_skills`)

Active filters show in a strip with one-click "Clear all". Each row also surfaces the first 5 extracted skills as inline badges + overflow count.

## Visual style

- **Dark by default** — slate palette with a single warm amber accent reserved for the brand mark + active sort indicators
- **Sidebar navigation** with avatar + sign-out card docked at the bottom (mobile falls back to a compact top header)
- **Stat pills** at the top of the Jobs page summarise the current filtered set (matches count + average match %)
- **Sticky table header** with zebra rows + token-based hover

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
