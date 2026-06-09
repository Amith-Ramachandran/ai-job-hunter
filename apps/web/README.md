# `@ai-job-hunter/web` — React frontend

The user-facing app: sign in with Google, upload a CV, browse jobs.

## Stack & conventions

| Concern | Choice | Why |
|---|---|---|
| Bundler | Vite | Fast dev, modern default |
| Styling | Tailwind CSS + shadcn/ui | Restrained, "classy" design tokens; we own the UI components (no library lock-in) |
| Server state | TanStack Query | All `/api` data goes through `useQuery` / `useMutation` — caching + invalidation in one place |
| Client state | Zustand (non-persisted for auth) | Cached user record; auth state lives in HTTPOnly cookies (no token in JS-reachable storage) |
| Forms | react-hook-form + zod | Schema-driven validation; resolver glue is one line |
| Routing | React Router v6 | Standard |
| OAuth | @react-oauth/google | One-time Google ID-token grab → exchanged at `/auth/google` for a cookie session |
| HTTP | axios | `withCredentials: true` + a 401 interceptor that fires `/auth/refresh` once before failing |
| Markdown | `react-markdown` + `remark-gfm` | Assistant chat bubbles render markdown; user bubbles stay plain text |

## Source map

```
src/
├── main.tsx                # providers (OAuth, Query, Router) + bootstrap
├── App.tsx                 # routes (login, dashboard, cv-upload, jobs)
├── lib/
│   ├── api.ts              # axios (withCredentials) + typed endpoints; ChatStreamEvent
│   │                       # discriminated union; streamChatTurn + streamCoverLetter
│   │                       # async-generators built on fetch + ReadableStream (EventSource
│   │                       # doesn't support POST + cookies)
│   └── utils.ts            # cn(), formatBytes, formatRelativeTime
├── stores/
│   └── auth.store.ts       # Zustand: cached user record (no token — cookie-only)
├── hooks/
│   └── use-auth.ts         # combines store + /auth/me query
├── components/
│   ├── layout.tsx          # authenticated app shell (sidebar + content + "Ask Dhruva" CTA)
│   ├── protected-route.tsx # redirects to /login if unauthenticated
│   ├── chat/
│   │   ├── chat-panel.tsx        # slide-in chat sidebar (Sheet) — sessions rail +
│   │   │                         # streaming message list + markdown bubbles + citations
│   │   └── cover-letter-button.tsx # per-jobs-row icon button → streamed cover-letter Sheet
│   └── ui/                 # shadcn primitives (button, input, card, sheet, …)
└── pages/
    ├── login.tsx
    ├── dashboard.tsx
    ├── cv-upload.tsx       # form via react-hook-form + zod; mutation invalidates ['cvs']
    └── jobs.tsx            # sortable column headers, Match column, cover-letter button per row
```

## Auth model

1. User clicks Google sign-in (`pages/login.tsx` → `<GoogleLogin />`).
2. We POST the Google ID token once to `/auth/google`.
3. Nest verifies it with Google, mints two HTTPOnly cookies — a short-lived access JWT and an opaque refresh token — and sets them on the response.
4. Every subsequent `/api/*` call rides on the cookies (`withCredentials: true` on axios). Nothing token-shaped ever touches `localStorage`.
5. On a 401 the axios interceptor calls `/auth/refresh` exactly once and retries the original request. If the refresh itself 401s, we clear local user state and the ProtectedRoute redirects to `/login`. Refresh tokens are rotated server-side with reuse detection — a leaked refresh token gets the whole session burned the next time it's used.

## Match scoring (Slice 2.1)

The Jobs page shows a **Match** column with cosine similarity (0–100%) between each job's chunked JD and the user's latest CV. Column headers are clickable; default sort is `match desc`. Scores come from the API's `matchScore` field, populated by the Python AI service when a CV is embedded or `POST /ai/score-now` is hit.

## Smart filters (Slice 2.2)

The Jobs page filter row exposes the LLM-extracted structured fields as chips:
- **Seniority** — junior / mid / senior / staff / principal (multi-select)
- **Work model** — remote / hybrid / on-site (multi-select)
- **Required skills** — typeahead pulling from `/jobs/top-skills`; AND semantics (every selected skill must appear in the JD's `required_skills`)

Active filters show in a strip with one-click "Clear all". Each row also surfaces the first 5 extracted skills as inline badges + overflow count.

## Chat & cover-letters (Slice 2.3)

**Ask Dhruva** — a slide-in chat panel (Sheet) with a sessions rail on the left and a streaming conversation on the right:
- Sessions are server-persisted in Postgres (`chat_sessions` + `chat_messages`); the panel re-fetches on open so other tabs / the freshly-streamed session show up.
- The composer drives `streamChatTurn()`, an async generator that consumes the SSE stream via `fetch` + `ReadableStream` (EventSource doesn't support POST + cookies). Tokens accumulate into a `streamingText` state while the optimistic user bubble + the partial assistant bubble render side-by-side; the session re-fetch is **gated behind `!isStreaming`** so the persisted user message and the optimistic one can't briefly both render.
- Assistant bubbles render via `react-markdown` + `remark-gfm` (lists, links, inline code, bold). User bubbles stay plain text so user-typed markdown isn't accidentally rendered.
- Citation chips (truncated job IDs) appear under any assistant turn that called a job-fetching tool.
- The panel uses an `AbortController` so closing the Sheet mid-stream cleanly tears the SSE down.

**Cover-letter button** — a per-Jobs-row icon button. Opens a Sheet that streams a tailored draft (CV-grounded, JD-grounded, single LLM call — no agent loop). The Sheet has Copy + Regenerate actions; cancellation behaves like the chat panel.

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
