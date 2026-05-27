# UI/UX Audit — GD Manager Energy

**Auditor:** Senior product designer review (source-code based, no live app)
**Date:** 2026-05-26
**Stack:** React 18 + Vite + Tailwind + shadcn-ui + Radix + framer-motion + lucide-react
**Scope:** `src/components/`, `src/pages/`, `tailwind.config.ts`, `src/index.css`, `src/App.css`

---

## Executive Summary

GD Manager Energy is, on the whole, a **mid-tier internal tool that is one disciplined design pass away from being a credible B2B SaaS**. The foundations are in place: a real brand palette (gold `#F5A800` on near-black `#1A1A1A`) defined in `src/index.css`, the Inter type family, a dedicated kanban color scale, role-aware navigation in `src/components/layout/Sidebar.tsx`, mobile-aware affordances (drawer + bottom nav, 48px tap targets, iOS auto-zoom prevention, bottom-sheet dialogs), framer-motion entrance animations on nearly every card, and a thoughtful 3-step public intake form in `src/pages/PublicProjectForm.tsx`. The Login page (`src/pages/Login.tsx`) is the visual high-water mark — a proper split-screen with brand panel, gradient, and stat strip that genuinely *looks* like a SaaS. shadcn-ui is installed in full (40+ primitives in `src/components/ui/`) and lightly customized with a `cta` button variant and status-aware `Badge` variants.

What undermines the product, however, is a **two-track design system**: half the codebase uses the Tailwind/shadcn token system; the other half (Topbar, ProjectModal, NewProject, PublicProjectForm, EmailUpdates, Financial, kanban CardMenu, NotificationBell, GlobalSearch) is written with **608 inline `style={{ ... }}` blocks and hex literals like `#F5A800`, `#1A1A1A`, `#FEF3D0`, `#E24B4A` repeated dozens of times** instead of CSS variables. The result is *visible* inconsistency: borders are sometimes `border-input`, sometimes `#E5E7EB`, sometimes `#E0E0E0`, sometimes `0.5px solid #F0F0F0`; rounded corners alternate between `rounded-lg` (8px), `rounded-xl` (12px), `borderRadius: 9`, `borderRadius: 10`, `borderRadius: 12`. The dashboard ships **fabricated KPI deltas** ("+12%", "+8%", "-5%", "+2%", "98% taxa de aprovação" — all hardcoded in `src/pages/DashboardAdmin.tsx:38-42`), and the Login page advertises "500+ projetos · 50+ empresas · 98% taxa" that are likewise hardcoded — a trust-killer the day a real customer sees it. `react-hook-form` and `zod` are installed but never actually used (`grep useForm src/pages` → 0 hits); validation is `toast.error('Preencha os dados do titular')` strings inside `if` chains. There are exactly **6 `aria-label` attributes in the entire app source** (Radix supplies the rest implicitly), no `Skeleton` is used outside the unused shadcn sidebar primitive, and the supposedly comprehensive Tasks/Financial/EmailUpdates pages weigh in at 408/342/862 lines respectively — feature-rich but UX-dense.

---

## Heuristic Score Table

Rated 1 (poor) to 5 (excellent), based on source-code evidence only.

| # | Heuristic | Score | Evidence |
|---|-----------|:----:|----------|
| 1 | Visibility of system status | **3** | Good: route-level `Loader2` spinners, drag-drop visual feedback, toast notifications via Sonner. Bad: no skeleton loaders anywhere user-facing (`Skeleton` exists in `src/components/ui/skeleton.tsx` but is never imported outside `ui/sidebar.tsx`); full-page spinners on every dashboard fetch (`DashboardAdmin.tsx:44`, `DashboardCompany.tsx:36`, etc.) feel slow. |
| 2 | Match between system & real world | **4** | Strong PT-BR throughout, domain language is correct ("Titular", "Unidade Consumidora", "Concessionária", "Homologação", "Monofásico/Bifásico/Trifásico", "kWp"). `formatCurrency`, `pt-BR` locale for dates, `dd/mm/yyyy`. Brazilian states list, CPF/CEP/phone masks in `PublicProjectForm.tsx:133-145`. |
| 3 | User control & freedom | **3** | Kanban drag has confirmation modals for rejection (`ProjectsKanban.tsx:826-869`) and protocol-required stages — good. Multi-step form has Back/Next. Dialog `X` close. But: no breadcrumbs on deep pages, no undo for irreversible actions like project deletion, no "save draft" on the long forms. |
| 4 | Consistency & standards | **2** | Worst score. Two parallel design systems: Tailwind tokens vs. 608 inline `style={{}}` blocks. Buttons exist as `<Button variant="cta">`, raw `<button style={{ background: '#F5A800' }}>`, `<button className="sidebar-item">`. Borders alternate between `border-border`, `border-[#E5E5E5]`, `0.5px solid #E0E0E0`, `1px solid rgba(255,255,255,0.1)`. Modal close icon is sometimes Radix's built-in, sometimes a hand-rolled X. |
| 5 | Error prevention | **3** | Public form has client-side validation per step, file MIME/size validation, Turnstile CAPTCHA. Rejection-column drag prompts before committing. But validation is toast-only — no inline error states, no field highlighting (`PublicProjectForm.tsx:160-181`). |
| 6 | Recognition over recall | **4** | Sidebar with icons + labels (lucide-react), pinned filter chips on Kanban, status badges color-coded everywhere via `Badge` variants (`badge.tsx:18-22`), recent projects table on dashboard, global search in topbar with project-code recognition. |
| 7 | Flexibility & efficiency | **3** | Global search debounced 300ms (`Topbar.tsx:113`), keyboard Esc closes search, drag-and-drop kanban, batch "marcar todas como lidas" on notifications, role-aware sidebar. Missing: keyboard shortcuts, no command palette (despite `cmdk` being installed), no bulk select on tables, no saved filters. |
| 8 | Aesthetic & minimalist design | **3** | Login page is genuinely polished. Cards are clean. But Topbar, NotificationBell, ProjectModal, Financial all have 18+ visual properties per element (radii, shadows, borders, gradients, mixed font weights, color literals) — feels homemade. Public form has more visual hierarchy variations than necessary (15px section headers, 11px uppercase labels, 32px hero numbers all on the same screen). |
| 9 | Error recovery | **3** | `PublicProjectForm.tsx:363-374` has a clean "Link inválido" state. Login shows toast on auth errors. Map shows "Chave VITE_GOOGLE_MAPS_API_KEY não configurada" when missing (`ProjectsMap.tsx:104-111`). Missing: error boundaries, 500-class error UI, network-offline state, retry buttons on failed mutations. |
| 10 | Help & documentation | **2** | Zero contextual help: no tooltips on KPIs (what does "Taxa de Aprovação 98%" mean?), no onboarding/empty-state tutorials, no "?" help icons, no inline hints explaining "phase_type" or "Coordenadas do local". Empty states are bare text (`DashboardCompany.tsx:188-200` is the one exception, with FolderOpen icon + CTA). |
| — | **Accessibility** | **2** | 6 `aria-label` instances in app source. Icon-only buttons (kanban `MoreVertical`, notification bell, sidebar collapse) lack labels. `<button>` inside `<button>` antipatterns inside kanban cards. Color contrast on `text-muted-foreground` (`--muted-foreground: 0 0% 40%`) on `--background: 0 0% 94%` is borderline (~4.0:1 — fails WCAG AA for 14px). Focus rings present via shadcn but the inline `<button>`s in Topbar/ProjectModal/CardMenu omit them entirely. |
| — | **Brand identity** | **3** | Has identity: gold + dark + Inter + "All Energy Engenharia" sub-mark. Logo file `/logo.png` used consistently. But brand is barely expressed inside the app shell — every internal page reverts to grey-on-grey corporate dashboard, only the sidebar and a few accents carry the brand. No illustration system, no brand pattern, no signature interaction. |

**Overall heuristic average: 2.9 / 5** — competent but unrefined.

---

## Strengths

1. **Real design tokens exist.** `src/index.css:8-76` defines a proper light theme with semantic HSL variables (`--primary`, `--success`, `--warning`, `--info`, `--destructive`), a dedicated kanban scale (`--kanban-pending` through `--kanban-completed`), and sidebar-specific tokens. The brand palette is named and intentional, not arbitrary.
2. **Login page is a flagship moment.** `src/pages/Login.tsx:69-217` delivers a split-screen with gradient overlay, brand panel with social-proof stats, animated transitions, and a dark glass-card form. This is what the whole product should feel like.
3. **Mobile considered seriously.** `src/index.css:233-280` enforces `font-size: 16px !important` to prevent iOS zoom, `min-height: 48px` tap targets, bottom-sheet dialog repositioning, safe-area-inset support. `MainLayout.tsx:16-58` ships a real `BottomNav`, and `Sidebar.tsx:85-172` has a separate drawer implementation with spring physics.
4. **Status visualization is consistent and meaningful.** Color-coded Badge variants (`badge.tsx:18-22` — `pending`/`analysis`/`progress`/`approved`/`completed` each have hand-tuned bg+fg pairs), kanban column color dots, status-aware map pins (`ProjectsMap.tsx:28-35`), step-progress on ProjectModal and ProjectDetail.
5. **Public intake form is genuinely well-thought.** `src/pages/PublicProjectForm.tsx` has a 3-step wizard with a visible progress bar (lines 414-449), per-step validation, calculated-power preview ("Potência Total" hero on step 2, lines 664-673), camera-vs-gallery split on mobile in `DocumentUploadField.tsx:236-265`, image compression before upload (`DocumentUploadField.tsx:29-63`), Turnstile CAPTCHA, and a "Resumo do Projeto" recap before submit (lines 772-784).
6. **Domain-correct micro-decisions.** Auto-geocoding on form submit, image compression to 1200px @ 0.8 quality, sanitized filenames, drag-drop file upload on desktop, "Sem valor" filter chip with live count on the Kanban (`ProjectsKanban.tsx:607-625`), "X dias parado" stale-project pill with tooltip (`ProjectsKanban.tsx:156-170`).
7. **Drag-and-drop interaction quality.** `@hello-pangea/dnd` with proper `isDraggingOver` ring (`ProjectsKanban.tsx:759-762`), card lifts (`shadow-2xl ring-2 ring-primary` on drag), pre-grouped projects per column for O(N) render perf (`ProjectsKanban.tsx:464-474`), `React.memo` on `KanbanCardContent`.
8. **Mobile parity for the kanban.** Rather than scrolling a 5-column board on a phone, the Kanban switches to a list view with status filter dropdown (`ProjectsKanban.tsx:629-701`) — correct pattern.

---

## Issues (by severity)

### Critical

1. **Fake KPI deltas on the main admin dashboard.**
   - **File:** `src/pages/DashboardAdmin.tsx:37-42`
   - **Problem:** Hardcoded `change: '+12%'`, `+8%`, `-5%`, `+2%` and a hardcoded `'98%'` "Taxa de Aprovação" with arrow icons that make them look real. Same on `Login.tsx:99-112` ("500+ Projetos gerenciados · 50+ Empresas ativas · 98% Taxa de aprovação").
   - **Why critical:** This is fraud-adjacent for a B2B product. The first real prospect who notices loses all trust.
   - **Fix:** Compute deltas from `useProjects` (compare current month vs previous month counts), drop "Taxa de Aprovação" until you can compute it, and either compute or remove the Login stat strip.

2. **Two parallel design systems — Tailwind tokens vs. 608 inline-style blocks.**
   - **Files:** `grep -rn "style={{" src/pages` → 608 hits. Worst offenders: `Topbar.tsx`, `ProjectModal.tsx`, `NewProject.tsx`, `PublicProjectForm.tsx`, `EmailUpdates.tsx`, `admin/Financial.tsx`.
   - **Problem:** Hex literals (`#F5A800`, `#1A1A1A`, `#FEF3D0`, `#E24B4A`, `#E0E0E0`, `#F0F0F0`, `#F8F8F8`, …) repeated dozens of times. CSS variables in `index.css` are bypassed entirely. Future theming (dark mode is already broken — `index.css:78-83` just re-declares the light vars) is structurally impossible.
   - **Fix:** Replace inline styles with Tailwind classes referencing CSS variables. Move all hex literals into `--brand-*` and `--kanban-*` tokens. Audit-script in CI: fail PR if `style={{` appears outside of dynamic-width/transform contexts.

3. **`react-hook-form` + `zod` installed, never used.**
   - **Files:** `package.json:65, 73`; `src/components/ui/form.tsx` exports the wrapper; `grep useForm src/pages` → 0 hits.
   - **Problem:** All forms use raw `useState` and validate via `if (!formData.holderName) { toast.error('Preencha…'); return false }` (e.g., `PublicProjectForm.tsx:160-181`, `NewProject.tsx`). No inline error states. No field-level error messages. No focus-on-error. Users learn an error only after clicking "Continuar" and reading a toast that disappears.
   - **Fix:** Convert at least `PublicProjectForm`, `NewProject`, and `Login` to RHF + zod schemas. Wire `FormMessage` from the existing `ui/form.tsx` wrapper. Highlight invalid fields in red with the message inline.

4. **Icon-only buttons across the app lack accessible labels.**
   - **Files:** `Topbar.tsx:200-216` (notification bell, sidebar collapse), `ProjectsKanban.tsx:294-298` (`MoreVertical` `CardMenu`), `Sidebar.tsx:118-123` (drawer X), `PublicProjectForm.tsx:791-805` (Back/Next), all dialog close buttons re-implemented.
   - **Problem:** Only **6 `aria-label`s in the entire app source**. Screen-reader users hear "button", "button", "button". Compliance risk for a Brazilian SaaS sold to corporate buyers.
   - **Fix:** Add `aria-label` to every icon-only `<button>`; prefer `<Button variant="ghost" size="icon">` from `ui/button.tsx` with a `<span className="sr-only">` child or `aria-label`.

### Major

5. **No skeleton loaders — every page is full-screen spinner.**
   - **Files:** `DashboardAdmin.tsx:44-52`, `DashboardCompany.tsx:36-44`, `DashboardStaff.tsx:36-44`, `ProjectsKanban.tsx:531-539`, `Financial.tsx:81-89`. `<Skeleton>` from `ui/skeleton.tsx` is imported zero times outside `ui/sidebar.tsx`.
   - **Problem:** A `Loader2` on a blank background feels broken/slow. Skeleton-loading the KPI tiles and table rows would feel 2x faster.
   - **Fix:** Build `<DashboardSkeleton/>`, `<KanbanSkeleton/>`, `<TableSkeleton rows={5}/>` and render them while `isLoading`. Keep page shell + sidebar visible.

6. **Notification Bell and Global Search are written in inline-styled vanilla `<div>`s.**
   - **File:** `src/components/layout/Topbar.tsx:39-267`
   - **Problem:** A 230-line file of inline styles re-implementing Popover, Dropdown, focus management, and click-outside logic — all of which `@radix-ui/react-popover` (already installed) gives for free. Doesn't get keyboard nav, doesn't get focus trap, doesn't match the rest of the menus visually.
   - **Fix:** Rewrite both as `<Popover>` + `<Command>` (cmdk is installed) with the shadcn pattern. Will shed ~200 lines and gain ARIA roles + keyboard nav.

7. **`<Card>` (shadcn) used 20 times; custom `.kpi-card` CSS class used 40 times.**
   - **File:** `src/index.css:142-145` defines `.kpi-card { @apply bg-card rounded-xl p-6 shadow-lg; border: 0.5px solid rgba(245, 168, 0, 0.15); }`
   - **Problem:** `.kpi-card` is shaped like `<Card>` but doesn't compose with `<CardHeader>`/`<CardTitle>`/`<CardContent>`. Two parallel container abstractions = inconsistent padding (`p-4`, `p-6`, `padding: '28px 24px'`), inconsistent radii, inconsistent borders. Card semantics (`<article>`-equivalent) lost.
   - **Fix:** Promote `<Card>` to the single container primitive. Add variants (`<Card variant="kpi">`) if you want the gold-tinted border. Delete `.kpi-card`.

8. **Sidebar's "Mapa de Projetos" sits below "Formulários" and "Config. Kanban" — IA suggests it's an admin config tool, but it's actually a daily-use feature.**
   - **File:** `src/components/layout/Sidebar.tsx:38-58`
   - **Problem:** Navigation is one flat unordered list. Daily-use items (Dashboard, Kanban, Tarefas, Email, Mapa, Financeiro) are interleaved with admin config (Empresas, Usuários, Formulários, Config. Kanban). Item 19 items deep is "Configurações" which doesn't even route anywhere.
   - **Fix:** Group with headers: **Trabalho** (Dashboard, Kanban, Tarefas, Mapa, Email), **Gestão** (Financeiro, Relatórios, Concessionárias), **Administração** (Empresas, Usuários, Formulários, Config. Kanban). Use a `<SidebarGroup label>` pattern.

9. **`text-muted-foreground` color contrast is borderline.**
   - **File:** `src/index.css:25-26` — `--muted-foreground: 0 0% 40%` on `--background: 0 0% 94%` ≈ 4.0:1, below WCAG AA 4.5:1 for normal text. The token is used everywhere for secondary text and table headers (`DashboardAdmin.tsx:222-226`, every page subtitle).
   - **Fix:** Darken to `0 0% 32%` (~5.7:1) or use it only for ≥18px / bold (which qualifies as "large text" at 3:1).

10. **Forms have no inline validation, no field grouping for required fields, no "save & continue later".**
    - **Files:** `PublicProjectForm.tsx` (entire), `NewProject.tsx` (entire), `Login.tsx:32-58`
    - **Problem:** A 3-step form with ~25 fields and no progress save. User who closes the tab on step 3 loses everything. No "campo obrigatório" highlight — only red asterisks in labels.
    - **Fix:** Persist form state to `sessionStorage` on every change; restore on remount. Add red border + `aria-invalid` + inline message for invalid fields.

11. **Tables aren't sortable, filterable, or paginated.**
    - **Files:** `DashboardAdmin.tsx:218-264` (Recent Projects table), `DashboardCompany.tsx:147-186` (Seus Projetos table), all `admin/*.tsx` list pages.
    - **Problem:** "Projetos Recentes" `.slice(0, 5)` hardcoded. Companies/Users/Concessionaires presumably scroll forever (their files weren't read but the pattern is consistent). `Pagination` component exists in `ui/pagination.tsx` but isn't used.
    - **Fix:** Adopt `@tanstack/react-table` (or a custom hook) for sort/filter/paginate on all tables of >10 rows. Add column header sorting indicators.

12. **Public form's submit button shows a calculated kWp value of "0 kWp" before the user fills inputs — and renders as a giant hero.**
    - **File:** `src/pages/PublicProjectForm.tsx:664-673`
    - **Problem:** Before any input, "Potência Total do Projeto: **0 kWp**" displays in 32px gold. Looks like an error or a quote of "0".
    - **Fix:** Conditionally render the hero only when `parseFloat(modulePower) > 0 && parseInt(moduleQuantity) > 0`; before that, show a soft placeholder ("Preencha os dados acima para calcular a potência").

13. **`pulse-glow` keyframe and `.glow-primary` class defined but unused. `glass-card` defined but only used once. Dead CSS = visual inconsistency budget.**
    - **File:** `src/index.css:97-109`
    - **Fix:** Audit and remove. Or commit to using them — `pulse-glow` would be perfect on the "Novo Projeto" CTA in `DashboardCompany`.

14. **`ProjectDetail.tsx` is 1,378 lines and `EmailUpdates.tsx` is 862 lines — single-file pages with embedded sub-components.**
    - **Files:** `src/pages/ProjectDetail.tsx`, `src/pages/EmailUpdates.tsx`, `src/pages/NewProject.tsx` (809 lines)
    - **Problem:** Density alone signals UX problems: too many concerns on one screen, hard to maintain visual rhythm, easy for small inconsistencies to creep in.
    - **Fix:** Extract `<ProjectDetailHeader>`, `<ProjectDetailTabs>`, `<ProjectFinancialPanel>` into `src/components/projects/detail/`. Same for email updates (`<EmailUpdateCard>`, `<ScanRunHistory>`, `<EmailFilters>`).

15. **Modals re-implement close-X and overlay manually in `ProjectsKanban.tsx` checklist block dialog and other places.**
    - **Files:** `ProjectModal.tsx:197-207` (manual `position: fixed, inset: 0` overlay), kanban inline menus
    - **Problem:** Bypasses Radix Dialog's focus-trap, scroll-lock, ESC handling.
    - **Fix:** All modals → `<Dialog>` from `ui/dialog.tsx`.

16. **Empty states are inconsistent: some have icon+CTA, most are bare text.**
    - **Good:** `DashboardCompany.tsx:188-200` (FolderOpen icon, heading, CTA button).
    - **Bad:** `DashboardAdmin.tsx:190` ("Nenhum alerta no momento" — text only), `ProjectsKanban.tsx:633-635` ("Nenhum projeto encontrado" — text only), `Topbar.tsx:234` ("Nenhuma notificação" — text only).
    - **Fix:** Create `<EmptyState icon, title, description, action>` component and use everywhere.

### Minor

17. **Dark mode is silently broken.** `src/index.css:78-83` `.dark { … }` block just re-declares the same light values. Either ship dark mode or remove `darkMode: ["class"]` from `tailwind.config.ts:4`.

18. **Sidebar item active state uses pure CSS class (`.sidebar-item.active`) while desktop sidebar uses `cn(isActive && "active")` — works, but the badge logic (`Sidebar.tsx:130, 212`) is duplicated between mobile and desktop branches.** Extract one `<SidebarItem>` component.

19. **Topbar page title is hardcoded per-role ("Painel Administrativo", "Área do Projetista", "Área da Empresa") — `Topbar.tsx:281-283`** — but the user is rarely on the dashboard. On `/projects` it still says "Painel Administrativo". Should reflect actual page or be a breadcrumb.

20. **`ProjectsKanban.tsx:41` hardcodes a 10-item utility company list** (`'CPFL Energia', 'Enel SP', ...`) instead of pulling from `useEnergyConcessionaires` (which is used elsewhere). Will go stale.

21. **The whole codebase opens project details via two paths: `<ProjectModal>` (overlay) and `/project/:id` (full page).** No clear rule when to use which. Confusing for users — clicking a card from Kanban opens modal, clicking from a list opens the page. Pick one canonical pattern (recommend modal for quick view, page for deep edit).

22. **Custom-built `CardMenu` (`ProjectsKanban.tsx:251-356`) and `TaskDropdown` (`Tasks.tsx:65-118`) re-implement DropdownMenu** rather than using `ui/dropdown-menu.tsx`. Different hover colors, different shadows, different submenu behavior. Use the primitive.

---

## 5 High-Impact UI/UX Improvements

Ordered by perceived-quality impact per hour of work.

### 1. Kill inline styles — a 2-week design-system unification

Single biggest credibility win. Replace every `style={{ background: '#F5A800', ... }}` with `className="bg-primary"` and every hex literal with a CSS variable. Then audit the variable set itself: today there are ~6 greys in active use (`#F0F0F0`, `#F8F8F8`, `#E0E0E0`, `#E5E5E5`, `#E5E7EB`, `#F3F4F6`) — collapse to 3 (`--surface-1`, `--surface-2`, `--border`). Outcome: a designer-tweaked color or radius change actually propagates. Visual rhythm tightens immediately.

### 2. Real loading states + real empty states

Build `<DashboardSkeleton>`, `<TableSkeleton>`, `<KanbanSkeleton>` using the existing `<Skeleton>` primitive. Build one `<EmptyState>` with icon/title/body/CTA slots. Replace every `Loader2`-only state and every "Nenhum X" text. Perceived performance jumps; empty states become onboarding moments ("Você ainda não criou projetos. Que tal começar enviando o primeiro?" + CTA).

### 3. Forms refactor: RHF + zod + inline errors

Convert `PublicProjectForm`, `NewProject`, `Login`, `ForgotPassword`, `ResetPassword`, `Profile` to react-hook-form + zod. Use the existing `ui/form.tsx` wrapper. Add red field borders, inline `FormMessage` text, focus-on-error, sessionStorage draft persistence. The public form alone will see a measurable lift in completion rate — it's currently a "make 8 mistakes, see 8 toasts in sequence" experience.

### 4. Brand the app shell, not just the login

Right now only the sidebar+login carry the brand. Inside the app, every page is grey-on-grey. Add: (a) a subtle gold accent line under the topbar; (b) one branded illustration in each major empty state (a flat-style solar panel for "Nenhum projeto", a flat-style sun for "Nenhuma notificação"); (c) the All Energy mark in the bottom corner of the public form. Define a `--brand-pattern` SVG (a sun-ray motif at 4% opacity) for the dashboard hero. Outcome: the product *looks* like a solar SaaS, not a generic admin template.

### 5. Information architecture: group sidebar, add breadcrumbs, fix the topbar title

Group the sidebar into **Trabalho / Gestão / Administração**. Add a `<Breadcrumb>` (already in `ui/breadcrumb.tsx`) under the topbar showing `Projetos › ABC-001 › Financeiro`. Replace the role-based topbar title with the current page name. Add a `<Tabs>` for the three big admin destinations (Empresas / Usuários / Concessionárias) since they're sibling settings. Outcome: navigation feels intentional and the product feels bigger / more capable.

---

## Mockup Ideas

Five concrete redesign concepts. None require new dependencies; all build on what's already installed.

### A. "Mission Control" Admin Dashboard

Replace the current 4-KPI-tile + map + chart layout with a **two-column ops view**:

- **Left column (8/12):** A live "Hoje" stream — a vertical timeline of events from the last 24h (new project from PUBLIC-FORM, status change, payment received, AI-suggested email classification awaiting review, project stalled >7 days). Each event is a card with a 24px status icon, one-line summary, time-ago, and inline action ("Revisar" / "Aprovar" / "Abrir"). This becomes the admin's homepage of the day.
- **Right column (4/12):** Real KPI tiles (computed, not faked) showing *deltas vs last week*: "Novos projetos: 12 (+3 vs sem. passada)", "Em análise: 8", "Aguardando pagamento: R$ 47k", "Projetos parados >7d: 3 ⚠". Each tile drills into a pre-filtered Kanban.
- **Bottom strip:** Mini-map (200px tall) with markers, "Ver mapa completo →" link.

Visual style: dark-on-white cards with a 4px gold left-border on the actionable items. Inter Display 28px for KPI numbers. Replaces "98% taxa de aprovação" fiction with a "Saúde da pipeline" donut (e.g., 60% no prazo / 30% em risco / 10% atrasado, computed from `days_stale`).

### B. "Pipeline Health" Kanban refresh

Keep the column model but apply 4 surgical changes:

1. **Column headers become health pills**: instead of `🟡 Em Análise [12]`, show `Em Análise · 12 cards · 3 parados >7d ⚠` with a thin progress bar underneath showing the average dwell time vs target SLA.
2. **Card density mode toggle** (Compacto / Confortável / Detalhado): in Compacto, cards are 3 lines (code, holder, kWp). In Detalhado (current), they show everything. Persist per-user.
3. **Drag-to-column-edge auto-scroll** + **inline "+ Adicionar projeto" button per column** for admins.
4. **Replace the custom CardMenu (`MoreVertical`) with the shadcn DropdownMenu** for consistency with the topbar.

The "Sem valor" filter chip should be joined by **"Parados >7d"** and **"Pendência da concessionária"** chips — turning the kanban into a fast triage tool.

### C. Public form redesign: "Conversational wizard"

The current 3-step form is solid but feels like filling a PDF. Reframe as a conversation:

- **Top of each step:** a single sentence in 22px gold-tinted serif ("Conte sobre quem vai gerar a energia.") and a 13px subtitle ("Esses dados aparecerão na homologação junto à concessionária."). Below it, only the fields for *that thought*.
- **Step 1 broken into 1a (Titular), 1b (Endereço), 1c (Unidade Consumidora)** — each on its own micro-step with 4-6 fields, so the user is never staring at a wall.
- **Right-rail "Seu progresso"** (desktop only): live-updating summary card showing what's been filled. Removes the need for a separate "Resumo" panel on step 3.
- **Confidence builders**: after step 1 → "✓ Recebemos seus dados básicos. Próximo: equipamentos." After step 3 → animation of the gold sun-ray brand pattern emerging behind the success checkmark.
- **Trust strip below the header**: "🔒 Seus dados ficam na empresa **{company.name}** · 🇧🇷 Servidores no Brasil · ⚡ Resposta em até 48h" — three pills, no claims you can't back.

### D. Project Detail as a "Project Workspace"

Currently `ProjectDetail.tsx` is 1,378 lines of stacked sections. Reimagine as a 3-pane workspace:

- **Left pane (240px, collapsible):** sticky outline — Identificação · Titular · Equipamentos · Documentos · Financeiro · Histórico · Comentários · Tarefas. Click to jump. Active section highlighted in gold.
- **Center pane (flex):** the active section, full-width, edit-in-place. Inline editing replaces the current "editingBlock" modal pattern.
- **Right pane (320px, collapsible):** persistent context — status progress bar, assigned staff avatars, due date, last activity, "Ações rápidas" (Gerar documento · Atribuir projetista · Mudar status · Nova revisão).

Tab navigation goes away (currently `<Tabs>` is doing what an outline should do). User can see status + context + content without scrolling.

### E. "Operações Diárias" mobile shell for staff/projetistas

The current mobile experience is the desktop app crammed into a phone. Build a **task-first mobile shell** for the staff role:

- **Bottom nav, 5 tabs:** Hoje (tasks due today + projects assigned to me), Kanban, Capturar (camera-first quick photo upload to an existing project), Avisos, Eu.
- **Hoje** = a swipeable card stack ("Tinder for tasks"). Swipe right = mark done; swipe left = snooze 1 day; tap = open project modal. Each card shows project code, task, due date with overdue badge, one quick-action button.
- **Capturar** = full-screen camera (use the existing `capture="environment"` input pattern) → after capture, a 2-tap flow: select project (recent first) → select document type → upload. Replaces the entire "navigate to project → tab to documents → upload" path.
- **Quick-add FAB** (gold circle, 56px, lower-right) for new task / new comment / new project.

This isn't a complete app — it's a *companion* surface. A projetista in the field could do 80% of their day from these 5 screens.

---

*End of audit. Findings are based exclusively on source-code inspection; live UX behavior may differ.*
