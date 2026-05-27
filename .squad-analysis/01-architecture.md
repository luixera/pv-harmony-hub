# 01 — Architecture & Code Quality Audit

**Project:** GD Manager Energy (`pv-harmony-hub`) · React 18 + Vite + TS + Supabase
**Date:** 2026-05-26 · **Auditor focus:** architecture & code quality

---

## Executive Summary

The codebase is a typical mid-sized Lovable/Supabase starter that has scaled past its scaffolding without architectural reinforcement. The `src/` layout is reasonably conventional (pages / components / hooks / contexts / integrations) and TanStack Query is used consistently as the data layer, with one global `QueryClient` and per-hook `staleTime` tuning. However, the project ships **zero tests**, **zero route-level code splitting**, TypeScript in fully **non-strict** mode (`strict: false`, `strictNullChecks: false`, `noImplicitAny: false`), a single 1,779-line `ProjectModal.tsx`, three near-identical role-specific dashboards, the same `statusLabels` map redeclared in **10 files**, three independent `<LoadScript>` Google Maps loaders (which warn and re-load on navigation), and a stale generated `types.ts` causing `'table_name' as any` escapes in production hooks (`useProjectProtocol`, `useKanbanConfig`). Edge Functions are reasonably defensive for admin CRUD, but `scan-emails` and `test-gmail` are deployed with `--no-verify-jwt` AND have no in-function auth, and they read `SUPA_SERVICE_ROLE_KEY` (a custom secret) instead of the auto-injected `SUPABASE_SERVICE_ROLE_KEY` used by the other four functions — a fragile inconsistency. The frontend leans on RLS for security but also performs critical filtering client-side (e.g., `DashboardCompany` fetches **all** projects then `.filter(p => p.company_id === user.companyId)`), which is wasteful at best and a data-leak risk if RLS ever regresses. Action: strict-TS, route splitting, and centralizing label maps + Google Maps loader are 1-day wins; the bigger work is dashboard consolidation, `ProjectModal` decomposition, and tightening the Edge Function security model.

---

## Strengths

1. **TanStack Query is used the right way.** Hooks are colocated in `src/hooks/`, return typed Query/Mutation objects, invalidate caches narrowly, and `useUpdateProjectStatus` (`src/hooks/useProjects.ts:115-183`) is a textbook optimistic update with snapshot/rollback. Per-query `staleTime` is tuned thoughtfully (e.g., `staleTime: 4 min` in `useDocumentUrl` to match the 5-min signed-URL expiry — `src/hooks/useDocuments.ts:146`).
2. **Sensitive mutations correctly routed through Edge Functions.** `useUsers` calls `update-user`/`delete-user`/`create-user` via `supabase.functions.invoke(...)` (`src/hooks/useUsers.ts:55-153`), and each function re-verifies the caller is admin server-side and uses a **whitelist** for updatable fields (`supabase/functions/update-user/index.ts:9, 91-104`). No trust in the client for role-elevation.
3. **Auth bootstrap correctly orders the listener.** `AuthContext.tsx:69-104` subscribes to `onAuthStateChange` **before** calling `getSession()`, and defers profile fetch via `setTimeout(0)` to avoid the well-known Supabase deadlock — the comment even explains why. Profile inactivity is enforced both at login and on session restore.
4. **Heavy export libraries are lazy.** `mammoth`, `html2pdf.js`, `jspdf` are all dynamic-imported only when the user actually exports/preview (`src/components/projects/GenerateDocumentDialog.tsx:230,323`, `src/hooks/useDocumentPreview.ts:60`, `src/components/financial/FinancialReportModal.tsx:83`). Good instinct.
5. **Security helpers are real.** `src/lib/utils.ts` exposes `validateFile` (MIME + 10 MB cap), `sanitizeFileName` (NFD + path-traversal hardened), and `maskDocument` (CPF/CNPJ masking by role) — and they're actually used in upload hooks. Vite dev server sets sane security headers (`vite.config.ts:11-17`). `verify-turnstile` edge function does both CAPTCHA validation and per-IP/company rate-limiting (`supabase/functions/verify-turnstile/index.ts:80-106`).

---

## Issues (Prioritized)

### P0 — Security / correctness, address immediately

**P0-1 · `scan-emails` and `test-gmail` are publicly callable.**
`.github/workflows/deploy.yml:30-40` deploys both with `--no-verify-jwt`. Neither function checks `Authorization` server-side (`supabase/functions/test-gmail/index.ts:9-92`, `supabase/functions/scan-emails/index.ts:16-50`). Anyone on the internet can:
- trigger `scan-emails` to burn your Anthropic API budget (each scan calls Claude per matched email) and rate-limit your Gmail IMAP credentials;
- call `test-gmail` with arbitrary `{email, appPassword}` and use your edge function as an IMAP probe.
**Fix:** drop `--no-verify-jwt` for `test-gmail` (it's an admin UI action — keep it JWT-required and add the same admin-check pattern used in `create-user`). For `scan-emails` (cron-invoked), either keep `--no-verify-jwt` but require a shared-secret header (`Deno.env.get('CRON_SECRET')`) matched against the request, OR invoke via `pg_cron` + `supabase.functions.invoke` with the service role.

**P0-2 · `DashboardCompany` fetches all projects then filters client-side.**
`src/pages/DashboardCompany.tsx:23-26`:
```ts
const { data: allProjects = [] } = useProjects();
const companyProjects = allProjects.filter(p => p.company_id === user?.companyId);
```
RLS *should* block this, but if any policy ever returns more than the user's own rows, the company sees other companies' projects. Same shape repeats anywhere `useProjects()` is called by a company role.
**Fix:** add a `companyId?: string` param to `useProjects` and push the filter into the Supabase query (`.eq('company_id', companyId)`). Belt-and-suspenders alongside RLS.

**P0-3 · Generated `types.ts` is stale — three tables are accessed via `as any`.**
`src/hooks/useProjectProtocol.ts:23,72` (`'project_protocols' as any`), `src/hooks/useKanbanConfig.ts:509` (`'stale_projects' as any`). Plus `projects.protocol_number` is read with `(project as any).protocol_number` in `src/components/projects/ProjectModal.tsx:264`. This means schema drift is invisible to the type-checker — a column rename will compile and explode at runtime.
**Fix:** regenerate types: `npx supabase gen types typescript --project-id yqsqrdndvsnhbsoaoilf > src/integrations/supabase/types.ts`, remove the `as any` casts, and add a CI step (see P1-1) that fails when the file is stale.

**P0-4 · TypeScript runs effectively untyped.**
`tsconfig.app.json:18-22` sets `strict: false`, `noUnusedLocals: false`, `noUnusedParameters: false`, `noImplicitAny: false`. ESLint also disables `@typescript-eslint/no-unused-vars` (`eslint.config.js:23`). 33 raw `: any` / `as any` occurrences exist in `src/` (sample: `src/pages/Profile.tsx` has 7 in one file). This is the single biggest source of latent bugs and the reason the stale-types issue above slipped through.
**Fix (gradual):** enable `noImplicitAny: true` first (cheap), then `strictNullChecks: true` (will surface real bugs — fix file by file), then full `strict: true`. Re-enable `noUnusedLocals` and unused-vars rules so dead code surfaces.

---

### P1 — Architecture / scalability, address this quarter

**P1-1 · No CI for lint/typecheck/tests.**
`.github/workflows/deploy.yml` only builds and rsyncs. There is no `npm run lint`, no `tsc --noEmit`, no test step. A broken `tsc` lands in production unnoticed.
**Fix:** add a `verify` job that runs `npm run lint && tsc --noEmit` as a required gate before `build-and-deploy`. Add `tsc-files` or similar in a pre-commit hook.

**P1-2 · Zero tests.** `find . -name "*.test.*" -o -name "*.spec.*"` returns nothing outside `node_modules`. No vitest/jest config in `package.json`. Critical business logic with no safety net: status transitions (`useProjects.useUpdateProjectStatus`), financial math (`DashboardCompany.pendingPayment`, `DashboardAdmin.pendingValue`), document validation (`lib/utils.validateFile`, `sanitizeFileName`), CPF/CNPJ masking (`maskDocument`), edge function auth checks.
**Fix:** add Vitest + `@testing-library/react`. Start with pure functions in `src/lib/` (1 day of tests gets you 80% of `utils.ts` covered), then hooks via `renderHook`, then the edge functions via Deno's built-in test runner.

**P1-3 · `App.tsx` is one giant eager-loaded route table — no code splitting.**
`src/App.tsx:8-33` imports 30 pages statically. There is no `React.lazy` / `Suspense` anywhere in the app (`grep` returns zero). A first-time visitor downloads the admin panel, kanban editor, financial reports, mapbox bundles, recharts, framer-motion, and everything else just to see the login screen.
**Fix:** convert every non-login page to `React.lazy(() => import('./pages/X'))` and wrap `<Routes>` in `<Suspense fallback={<Loader/>}/>`. Combine with `vite.config.ts` `build.rollupOptions.output.manualChunks` to split `recharts`, `@react-google-maps/api`, `framer-motion`, `docxtemplater+pizzip` into their own chunks. Expected first-paint reduction: ~50–70% on cold load.

**P1-4 · Three Google Maps `<LoadScript>` instances compete.**
`src/components/maps/MapPicker.tsx:99`, `src/components/maps/DashboardMap.tsx:168`, `src/pages/ProjectsMap.tsx:156`. The `@react-google-maps/api` `LoadScript` component is documented as singleton — multiple instances cause the dev-tools warning "LoadScript has been reloaded unintentionally" and on slow connections you'll see the map flicker / re-init when navigating between pages.
**Fix:** use `useJsApiLoader` once at the app root (or in a `<GoogleMapsProvider>` mounted in `App.tsx`), then have the three consumers just check `isLoaded` from the shared hook. Removes ~150 KB of duplicated script-tag bookkeeping.

**P1-5 · `ProjectModal.tsx` is 1,779 lines.** `src/components/projects/ProjectModal.tsx` contains the doc-preview component, the progress bar, document upload UI, comments UI, history UI, checklists, payments, protocol, revisions, staff assignment, deletion, **and** generate-document — all in one file. It's the highest-traffic surface in the app, the most edited, and the riskiest to touch. (`ProjectDetail.tsx` at 1,378 lines duplicates most of this same UI for a full-page rendering.)
**Fix:** decompose into `ProjectModal/{Header,ProgressBar,DocumentsTab,CommentsTab,HistoryTab,PaymentsTab,ChecklistTab,index}.tsx`. Same modal file already has `ProgressBar` (`:106`) and `DocPreview` (`:73`) as inline functions — they're the obvious first extractions.

**P1-6 · Massive label-map duplication — `statusLabels` is declared in 10 files.**
`statusLabels` / `STATUS_LABELS` (same shape): `DashboardAdmin.tsx:14`, `DashboardStaff.tsx:13`, `DashboardCompany.tsx:11`, `ProjectDetail.tsx:48`, `ProjectsKanban.tsx:54`, `ProjectModal.tsx:43`, `Topbar.tsx:26`, `EmailUpdates.tsx:62`, `ReceivablesTable.tsx:25`, `ProjectFinancialCard.tsx:30`, `FinancialReportModal.tsx:12`, `useFinancialDashboard.ts:41`. `documentTypeLabels` also duplicated in 4 places. When you add a kanban column (e.g., `pendencia`, which is already in `VALID_PROJECT_STATUSES` in `src/lib/statusMapping.ts:11`), you must remember to update all 10 — and the codebase already shows several inconsistencies (some maps include `rejected: 'Reprovado'`, others don't; some include `pendencia`, others don't).
**Fix:** move both maps to `src/lib/statusMapping.ts` (which already exists for this purpose) as `STATUS_LABELS` and `DOCUMENT_TYPE_LABELS` const objects, exported once. Delete the 13 inline declarations. ~50 lines net reduction, eliminates a class of bugs.

**P1-7 · Three role-specific dashboards duplicate ~80% of their logic.**
`DashboardAdmin.tsx` (274 lines), `DashboardStaff.tsx`, `DashboardCompany.tsx` all: declare `statusLabels`, call `useProjects`, derive `inProgressProjects` / `pendingProjects` / `pendingValue` with slight variations, render KPI cards, render `DashboardMap`, render a "recent projects" list. The deltas are which KPIs to show and the role-filter applied.
**Fix:** extract `<DashboardShell role={...}/>` that takes a `kpis` config and an optional `projectFilter`. The three dashboards become 30-line files that compose the shell with role-specific KPI lists.

**P1-8 · Dead code + broken navigation in `Sidebar.tsx`.**
- `src/pages/Index.tsx` is a "Welcome to Your Blank App" placeholder, exported but not imported anywhere in `App.tsx`. Pure dead file.
- `src/data/mockData.ts` (402 lines of seed data) has exactly one live import: `brazilianStates` consumed by `NewProject.tsx:14`. The other ~395 lines (mock companies, projects, comments, users, history) are unused. Meanwhile `PublicProjectForm.tsx:39-43` redeclares `brazilianStates` inline rather than reusing it.
- `Sidebar.tsx:57` links to `/settings` — no such route exists in `App.tsx`. Admin clicks it and gets `<NotFound/>`.
- `MainLayout.tsx:26,32` link to `/notifications` (mobile bottom nav) — also doesn't exist, gated by `disabled: true` but the path is dead.
**Fix:** delete `Index.tsx`, extract `brazilianStates` to `src/lib/brazilianStates.ts` and import in both forms, delete the rest of `mockData.ts`, remove the `/settings` sidebar item (or implement it), remove `/notifications` from the bottom-nav `items` array.

**P1-9 · No `ErrorBoundary` anywhere.**
`grep` for `ErrorBoundary` / `componentDidCatch` returns zero results. A single unhandled error in `ProjectModal` (and there are several `as any` paths that could throw on schema drift) crashes the whole app to a blank white screen, not the `<NotFound/>` page.
**Fix:** wrap `<AppRoutes/>` in an `<ErrorBoundary>` that renders a "Algo deu errado" fallback and logs to console (and later to your error tracker — `SECURITY_REPORT.md` suggests Sentry is on the roadmap).

**P1-10 · Inconsistent toast library — Sonner and shadcn `use-toast` both in use.**
30 files import `from 'sonner'`; 3 files import `from '@/hooks/use-toast'` (one is `useFormConfig.ts:3`). Both toasters are mounted in `App.tsx:78-79`. Two different APIs, two different styling languages, two libraries shipping.
**Fix:** pick one (Sonner is already dominant). Replace the 3 `use-toast` imports, drop `<Toaster />` from line 78 of `App.tsx`, remove the `src/components/ui/toaster.tsx` + `src/components/ui/use-toast.ts` + `src/hooks/use-toast.ts` trio.

**P1-11 · Edge functions use two different env-var names for the service-role key.**
`create-user`, `delete-user`, `update-user`, `verify-turnstile` all read `SUPABASE_SERVICE_ROLE_KEY` (the auto-injected secret). `scan-emails` (`:21,201`) and `test-gmail` (`:16`) read `SUPA_SERVICE_ROLE_KEY` (a custom one). If a future operator only sets the standard name, the email functions silently fail with a 500 because `Deno.env.get(...)!` returns undefined and the `createClient` call rejects.
**Fix:** standardize on `SUPABASE_SERVICE_ROLE_KEY` in `scan-emails` and `test-gmail`. Remove the custom `SUPA_SERVICE_ROLE_KEY` secret. (Side note: `SUPABASE_*` env names are reserved and *cannot* be set via `supabase secrets set` — which is presumably why the custom name exists. The right fix is to use the auto-injected one and never `secrets set` it.)

**P1-12 · `useUpdateProjectData` injects history rows via `supabase.from('project_history').insert` directly from the client (`src/hooks/useProjects.ts:270-277`).**
A malicious company-role user with Postgres access (Supabase REST is public) can `POST /rest/v1/project_history` with arbitrary `user_name` and `action` strings, forging audit history. Same shape in `useUpdateProjectStatus` (`:153-165`). The audit log is therefore not trustworthy.
**Fix:** create a Postgres trigger on `projects` that inserts into `project_history` server-side with `auth.uid()`. Remove the client-side inserts. Also tighten RLS on `project_history` to insert-only-via-trigger (`USING (false)` for INSERT from anon/authenticated, allow only `security definer` functions).

---

### P2 — Polish / cleanup, address when convenient

**P2-1 · `new QueryClient()` with default settings.**
`src/App.tsx:35` — no `defaultOptions`. Default `refetchOnWindowFocus: true` causes the Kanban board (and dashboards loading `useProjects`) to refetch every time the user tabs back, which thrashes Supabase and can race with optimistic updates. Most hooks override `staleTime` ad-hoc.
**Fix:** set a sensible default: `defaultOptions: { queries: { staleTime: 60_000, refetchOnWindowFocus: false } }`.

**P2-2 · Snake-case ↔ camelCase mapping done by hand everywhere.**
Hooks like `useProjects` map `p.company_id`, `p.holder_name`, etc. inconsistently. `Project` interface in `src/types/index.ts` is camelCase, but `ProjectWithDetails` in `useProjects.ts` is snake_case (extends the Supabase Row). The codebase ends up writing `p.company_id` in some files and `project.companyId` in others. Confusing for new contributors.
**Fix:** pick one convention. Easiest: drop the camelCase `Project` / `Company` / `Document` interfaces in `src/types/index.ts` and have everything use the generated `Database['public']['Tables']['x']['Row']` types directly. The hand-rolled types in `src/types/index.ts` are largely vestigial since the Supabase types exist.

**P2-3 · 15 inline `supabase.from(...)` calls in `src/pages/` and even more in components.**
The `useXxx` hook pattern is established but bypassed in `ProjectDetail.tsx`, `NewProject.tsx`, `PublicProjectForm.tsx`, `Profile.tsx`, and `ProjectModal.tsx`. Means cache invalidation has to be done manually and won't always be remembered.
**Fix:** when touching one of these pages, move the inline query into a hook. Not urgent, but each one introduces a cache-coherence risk.

**P2-4 · 65 `console.log` / `console.warn` / `console.error` statements ship to production.**
`vite.config.ts` does not strip console calls. Some leak diagnostic info (e.g., `console.error('User is not admin:', profileError)` in `create-user`); some are dev-only noise.
**Fix:** add `esbuild: { drop: ['console', 'debugger'] }` to `vite.config.ts` for production builds, and gate intentional logs behind a `if (import.meta.env.DEV)` check. Keep `console.error` paths in edge functions (those are server-side logs).

**P2-5 · `RESTORE_POINT_2026-05-19.md`, `SECURITY_REPORT.md`, `SUPABASE_AUTH_CONFIG.md`, `supabase/SECURITY_AUDIT_SUPABASE.sql`, `supabase/run-this-in-supabase.sql`, `supabase/cron-setup.sql`, `supabase/fix-status-constraint.sql` clutter the repo root.**
These are operational notes / one-off SQL scripts that shouldn't sit at the project root. New contributors see them and don't know if they're current.
**Fix:** move to `docs/runbooks/` and `supabase/scripts/`. Date-stamp or delete the obsolete ones (the May 19 restore point is presumably stale by May 26).

**P2-6 · `tsconfig.json` (root) and `tsconfig.app.json` both define `paths` and `baseUrl` separately, with slightly different relaxations.** Two sources of truth for the same setting. Minor, but it bit me when reading.

---

## Strategic Refactor Recommendations

### 1. Adopt a `features/` slice layout
The current split (`components/`, `hooks/`, `pages/`) makes you hop across three directories to follow one feature. With 34 hooks, the `hooks/` directory is becoming opaque. Reorganize:
```
src/features/
  projects/   { hooks, components, pages, types }
  kanban/
  financial/
  email-agent/
  revisions/
  ...
src/shared/   { ui/, lib/, layout/ }
```
This makes feature-scoped refactors (e.g., decomposing `ProjectModal`) atomic and clarifies ownership. Do it incrementally — start when you next touch the financial module.

### 2. Treat RLS as the only security boundary; remove all client-side role checks for data filtering
The current pattern is "RLS plus also-filter-in-React" (P0-2). Pick one: RLS is authoritative. Refactor hooks to take role/scoping as **query parameters** (not post-hoc filters) so that if the query returns more than the user should see, you fail loudly. Frontend role gates (`ProtectedRoute`, sidebar visibility) remain — they're UX, not security.

### 3. Standardize Edge Function structure
The six functions today each reimplement: CORS preamble, auth header parse, admin-role check, body parse, error responses. Pull these into `supabase/functions/_shared/` (Supabase's documented convention) — `cors.ts`, `auth.ts` (`requireAdmin(req)`), `response.ts` (`ok(body)` / `err(status, msg)`). Each function shrinks ~40%. Forces consistency: any future function written against the shared helpers gets admin-check + CORS + error envelope for free.

### 4. Move ALL business logic out of React components into hooks (or Postgres)
`DashboardCompany.tsx:32-34` computes `pendingPayment` inline. `DashboardAdmin.tsx:33-35` repeats the same shape. `ProjectDetail.tsx` has financial calculations sprinkled across 1,378 lines. Push these into Postgres VIEWs or RPC functions (`get_company_dashboard_kpis(companyId)`) and consume them via dedicated hooks. Benefits: testable in SQL, computed once not per-render, can be cached by Postgres, and your KPIs always agree across pages.

### 5. Replace `framer-motion` with CSS transitions for the simple cases
You're shipping all of `framer-motion` (~50 KB gzipped) for what is mostly `initial={{opacity:0,y:20}} animate={{opacity:1,y:0}}` fade-in animations. The same effect is one tailwind class (`animate-in fade-in slide-in-from-bottom-4`) — and tailwindcss-animate is already in your dependencies. Keep `framer-motion` for the sidebar drawer / `AnimatePresence` cases only; replace the ~25 KPI-card-style fade-ins with CSS. Drop the dep when the last usage is gone.

---

## Top 3 Quick Wins (<1 day each)

1. **Centralize `statusLabels` and `documentTypeLabels` into `src/lib/statusMapping.ts`** (P1-6). Mechanical refactor: add two exports, delete 13 inline declarations across 10 files, run the app, fix any compile errors. Eliminates a recurring class of "added a status, forgot a place" bugs. ~2 hours.

2. **Regenerate `src/integrations/supabase/types.ts` and remove `as any` table-name casts** (P0-3). `npx supabase gen types typescript --project-id yqsqrdndvsnhbsoaoilf > src/integrations/supabase/types.ts`, then delete the three `'project_protocols' as any` / `'stale_projects' as any` casts (`useProjectProtocol.ts:23,72`, `useKanbanConfig.ts:509`), drop the `(project as any).protocol_number` cast in `ProjectModal.tsx:264`. Add the regeneration command to README + a CI check. ~3 hours.

3. **Add `defaultOptions` to the global `QueryClient` + add route-level `React.lazy` for the 6 heaviest pages** (P2-1 + half of P1-3). In `App.tsx`: `new QueryClient({ defaultOptions: { queries: { staleTime: 60_000, refetchOnWindowFocus: false } } })`. Lazy-load `Reports`, `ProjectsMap`, `EmailUpdates`, `KanbanConfig`, `FormConfig`, `Financial`. Wrap `<Routes>` in `<Suspense fallback={<Loader/>}/>`. ~4 hours including QA. Expect ~30% smaller initial JS bundle and zero more "refetch on focus" jank.
