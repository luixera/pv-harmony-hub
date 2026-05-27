# 🎯 GD Manager Energy — Squad Consolidated Roadmap

**Date:** 2026-05-26
**Orchestrator:** Orion (AIOX Master) + 4 specialist agents
**Source reports:** [`01-architecture.md`](01-architecture.md) · [`02-ui-ux.md`](02-ui-ux.md) · [`03-product-strategy.md`](03-product-strategy.md) · [`04-devops-security.md`](04-devops-security.md)

---

## TL;DR

**The product is real, in production, and structurally sound — but it is being held back by three things:**

1. **Trust-killing UI artifacts** (hardcoded fake KPIs `+12%`, fake "500+ projetos" social proof, 608 inline-style overrides bypassing the design system).
2. **Three latent security/operational landmines** that can each become a public incident: a public `test-gmail` endpoint that probes IMAP for anyone, a `verify-turnstile` that fail-opens silently, and a client-forgeable `project_history` audit log.
3. **The most valuable IP — the Email Agent + Gmail-OAuth + Claude pipeline — is invisible in the product narrative.** That is the wedge against 77Sol/Solfácil, not "another solar project manager."

The codebase is well-organized for a Lovable-generated app; the issues are about *what got built around it* over the last 60 days, not foundational rot.

---

## 🔥 Fix-This-Week (P0 — 5 items, ~3 days total)

| # | What | Why | Where |
|---|---|---|---|
| **P0-1** | Lock down `test-gmail` and `scan-emails` edge functions (require JWT + admin role check) | Public IMAP-probe oracle + Anthropic budget burn risk | `supabase/functions/test-gmail/index.ts`, `supabase/functions/scan-emails/index.ts`, `.github/workflows/deploy.yml` (`--no-verify-jwt` flag) |
| **P0-2** | Fix `verify-turnstile` to fail-CLOSED if `TURNSTILE_SECRET_KEY` missing | Silent dev-mode in production | `supabase/functions/verify-turnstile/index.ts` |
| **P0-3** | Remove hardcoded KPIs and "500+ projetos · 50+ empresas · 98%" social-proof strip | Single biggest trust-killer for sales demos | `src/pages/DashboardAdmin.tsx:37-42`, `src/pages/Login.tsx:99-112` |
| **P0-4** | Move `project_history` inserts from client to a Postgres trigger/RPC | Audit log is currently forgeable from the browser console | `src/hooks/useProjects.ts:153-165, 270-277` |
| **P0-5** | Regenerate `supabase/types.ts` and delete every `as any` cast | Two tables (`project_protocols`, `stale_projects`) bypass type system; one wrong column rename causes silent prod break | `src/hooks/useProjectProtocol.ts:23,72`, `src/hooks/useKanbanConfig.ts:509` |

**Why these five together:** P0-1, P0-2, P0-4 close real attack surface. P0-3 is free credibility. P0-5 prevents the next outage. None require a roadmap discussion — they are all small, scoped, and reversible.

---

## ⚡ Next Two Weeks (P1 — 10 items)

### Code-quality foundation
- **P1-A1** Turn on TypeScript strict mode (`strict: true`, `noImplicitAny: true`, `strictNullChecks: true`) and fix the resulting ~33 `any` usages — `tsconfig.app.json:18-22`.
- **P1-A2** Add CI lint + typecheck gate before deploy — `.github/workflows/deploy.yml`.
- **P1-A3** Route-level `React.lazy` + `Suspense` for the 6 heaviest pages (Reports, ProjectsMap, EmailUpdates, ProjectDetail, KanbanConfig, Financial). Expected bundle reduction: 35–50%.
- **P1-A4** Centralize `statusLabels`, `documentTypeLabels`, `roleLabels` from the 10+ files that redeclare them into `src/lib/statusMapping.ts`.
- **P1-A5** Unify the three competing `<LoadScript>` Google Maps loaders into one provider mounted at the App root.

### UI/UX foundation
- **P1-U1** Replace 608 inline `style={{}}` blocks (worst: `Topbar.tsx`, `ProjectModal.tsx`, `NewProject.tsx`, `EmailUpdates.tsx`) with Tailwind tokens already defined in `src/index.css`.
- **P1-U2** Migrate at least 3 forms (NewProject, FormConfig, Profile) from raw `useState` to `react-hook-form` + `zod` (already installed, never used) — gain inline errors, field highlighting, draft persistence.
- **P1-U3** Adopt `<Skeleton>` loaders on Dashboard, Kanban, ProjectsMap, Reports — replaces full-screen `<Loader2>` spinners.
- **P1-U4** Accessibility pass: add `aria-label` to every icon-only button (NotificationBell, kanban CardMenu, sidebar collapse, Topbar X). Raise `text-muted-foreground` contrast to WCAG AA.
- **P1-U5** Empty states with illustrations + primary action on every list page (Projects, Tasks, Email Updates, Reports).

### Ops hardening
- **P1-O1** Sentry (frontend + edge functions) — 1 hour to wire, immediate visibility.
- **P1-O2** Nginx security headers in production (CSP, HSTS, X-Frame-Options) mirroring the Vite dev config.
- **P1-O3** Force 2FA (TOTP) for accounts with `role = 'admin'` via Supabase Auth.
- **P1-O4** Backup restore drill — confirm Supabase tier supports PITR and run a verified restore to a staging project.

---

## 🚀 Strategic Bets (P2 — 30–90 day horizon)

These come from the product agent and align with the actual differentiation opportunity.

### Bet 1 — Position as the **Service Bureau OS**, not "solar SaaS"
The `staff_access_mode` + "view-as-company" architecture already in the codebase is engineered for **homologation bureaus** serving dozens of integradoras, not solo installers. That is the wedge. 77Sol and Solfácil cannot follow because they bundle homologation with financing — bureaus are explicitly neutral.
**Build:** White-label theming per bureau client; per-integradora protocol counters/billing; consolidated bureau dashboard.

### Bet 2 — Expand the **Email Agent** into the headline feature
Gmail OAuth + Claude pipeline is the most unusual piece of IP in the codebase and is buried in `/email-updates`. Repackage as "AI Operator" — natural-language chat across pipeline ("quais projetos da CEMIG estão parados há mais de 5 dias?"), automatic status detection from incoming distribuidora emails, weekly summary digest. **Defensible because nobody else has it.**

### Bet 3 — **Concessionária Connect**
Pilot RPA/portal integration with one distribuidora (CEMIG is the largest GD market — start there) for protocol submission + status polling. Even partial automation (status polling first, submission later) is a 10x time-saver per protocol and a hard moat.

### Table-stakes gaps to close in this window
| Gap | Why now |
|---|---|
| **E-signature** (Clicksign / D4Sign / ZapSign API) | Every solar contract needs it; passthrough revenue |
| **WhatsApp Business** as end-client channel | Brazilian B2C SMB reality; replaces ~40% of email |
| **NF-e issuance** | Required to bill protocols, unlocks per-protocol monetization |
| **Customer portal PWA** | Currently no end-customer surface — bureaus' clients have nothing to log into |
| **AI proposal generator** | Uses existing Anthropic plumbing; high willingness-to-pay |
| **Inverter monitoring API** (Growatt, Fronius, Goodwe) | After-sales lock-in |
| **Audit log table** for sensitive actions | LGPD requirement |

---

## 💰 Monetization Surface Currently Left on the Table

Flat-fee SaaS leaves money on the table. Layer on:
- **Per-protocol fee** (R$ 5–15 per submitted protocol after a free tier)
- **Per-distribuidora RPA add-on** (R$ 99–299/mo per integrated portal)
- **E-sign passthrough** (cost + 30%)
- **WhatsApp Business** metered conversations
- **AI Credits** for proposal/email-agent features (per-tenant cap protects Anthropic spend)
- **Marketplace** — kit recommendations from distributors, financing referrals
- **White-label** tier for bureaus
- **Lead-gen** — distribute integrador-quality leads from public form traffic

---

## ⚠️ Strategic Risks Worth Watching

1. **Lovable platform lock-in** — `lovable-tagger` still in deps; project URL placeholder in README. Schedule a "decouple from Lovable" milestone.
2. **Single-vendor Supabase dependency** — fine for now, but no exit plan documented.
3. **Lei 14.300 GD I → II transition (2029)** — tariff signaling changes will reshape ROI calculators and proposals.
4. **77Sol/Solfácil bundling homologation free with financing** — competitive squeeze; defensive play is the bureau positioning above.
5. **Anthropic cost spiral** without per-tenant AI credit caps.
6. **LGPD exposure** — energy bills stored; no privacy policy, no DPO contact, no export/delete flow.

---

## 🛣️ Suggested Sequencing

```
┌──────────────────────────────────────────────────────────────┐
│ Week 1     ──► P0 (5 items, ~3 days)                          │
│ Week 2-3   ──► P1 code + UX foundation (10 items)             │
│ Month 2    ──► Bet 1 (bureau positioning) + WhatsApp + e-sign │
│ Month 3    ──► Bet 2 (AI Operator) + NF-e + customer PWA      │
│ Month 4-6  ──► Bet 3 (Concessionária Connect pilot)           │
└──────────────────────────────────────────────────────────────┘
```

### North-star metric to instrument first
**Protocols homologated per active company per month.** Everything else is vanity.

---

## 📂 Where to find the detail

- **Architecture & code quality** — `.squad-analysis/01-architecture.md` (168 lines, file:line refs)
- **UI/UX heuristics + mockup ideas** — `.squad-analysis/02-ui-ux.md` (239 lines, 22 issues + 5 redesign concepts)
- **Product strategy** — `.squad-analysis/03-product-strategy.md` (131 lines, 1,700 words)
- **DevOps / Security / LGPD** — `.squad-analysis/04-devops-security.md` (228 lines, 15 findings + 30/60/90 plan)
