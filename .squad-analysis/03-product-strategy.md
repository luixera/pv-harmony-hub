# 03 — Product Strategy: GD Manager Energy

**Analyst stance:** advising founders on the next 6 months.
**Production URL:** homologamanager.com.br
**Stack snapshot:** React + Vite + Supabase + shadcn-ui + Google Maps + Gmail-API agent + Claude (Anthropic) Edge Function.

---

## 1. Positioning

**Category.** Vertical B2B SaaS for **Geração Distribuída (GD) homologation back-office** — the workflow layer that sits between the solar installer and the distribuidora (CEMIG, Enel, CPFL, Equatorial, Neoenergia, Light, etc.). It is **not** a CRM, **not** a sizing tool (no PV*Sol/HelioScope replacement), and **not** a monitoring platform. It is a kanban-centric "protocol manager" with multi-tenancy: a SaaS operator (admin) sells access to integradoras (companies), who in turn track their end-clients' projects through approval stages (`pending → analysis → documentation → approval → vistoria_solicitada → approved → completed`, with `pendencia` as a sideband).

**Who it's for.**
- **Primary ICP:** small-to-mid integradoras (5–80 projects/month) that today juggle protocols in WhatsApp, Excel and Gmail inboxes.
- **Secondary ICP (and the real business model):** **homologation service bureaus** — companies that homologate projects on behalf of dozens of integradoras. The multi-tenant structure with `staff_access_mode` (global / assigned_only) and "view-as-company" is engineered for this exact persona. This is the wedge.
- **Tertiary:** energy retailers / loteamentos with shared self-consumption (autoconsumo remoto / geração compartilhada under Lei 14.300).

**Closest competitors.**
- Brazil: **77Sol** (heavier on marketplace/CRM/financing), **Solfácil OS / Solfácil Pro** (financing-anchored), **Eflux**, **EdgeSol**, **EnerSolutions**, **Solarfy**, **MeuKit** plus the homologation modules baked into **Aldo** and **Energy Source**. None of them is laser-focused on the homologation pipeline as a service-bureau OS.
- Global analogs: **Aurora Solar** (US, design-led), **OpenSolar**, **Scoop Solar** (project ops, closest analog), **Enerflo**, **Solo** (UK).
- **Whitespace:** a "GD-homologation control tower" purpose-built for the Brazilian distribuidora maze. That's where this product can win.

**TAM angle (Brazil).** ANEEL reports ~3M GD connections (Dec 2025) growing at double-digit YoY, with ~25k active integradoras tracked by ABSOLAR. Realistic SAM = **5k–8k integradoras + ~300 homologation bureaus** willing to pay R$ 199–R$ 1.499/month. At a blended R$ 450 ARPU and 5% capture in 24 months → ~R$ 22M ARR opportunity. Add the bureau tier (R$ 2k–8k/mo) and an honest SOM in 18 months is **R$ 3–6M ARR** without leaving GD.

---

## 2. Feature inventory (what's actually built)

| Domain | Implemented |
|---|---|
| **Identity & multi-tenancy** | 3 roles (admin/staff/company), RLS-protected, `staff_access_mode` (global vs assigned_only), profile w/ phone+avatar, Turnstile-protected signup, password reset flow |
| **Project pipeline** | Kanban (drag-drop via @hello-pangea/dnd), configurable kanban models per company (`kanban_models`, `kanban_columns`, `company_kanban_model`), project detail page, multi-stage status enum incl. `pendencia` and `vistoria_solicitada`, protocol number tracking, project history, **project revisions** (versioning of general data + equipment) |
| **Intake** | Public form with token + Turnstile + configurable fields (`form_configs`, `form_fields`, `form_field_rules` with conditional show/hide/require), 3 sources tracked (`company_login`, `public_form`, `admin`) |
| **Documents** | Supabase storage buckets, typed documents (energy bills generator/beneficiaries, holder doc, padrão de entrada, breaker, photos), document preview, docxtemplater + mammoth for template generation, html2pdf/jspdf export |
| **Mapping** | Google Maps integration, project map view, dashboard map, map picker for coords, map filters |
| **Concessionárias** | Registry (`energy_concessionaires`), per-concessionária document templates and required docs |
| **Financial** | Receivables table, project financial cards, summary cards, payment history, monthly aggregation, dual tables (`financials` + `project_financials`) with sync triggers, due dates, partial/paid statuses |
| **Reports** | Bar, donut, funnel, ranking, stage-times, ticket chart, KPI hero/secondary, filter bar — solid analytics surface for admin |
| **Tasks** | Dedicated tasks page, task alerts, FK to profiles |
| **Communication** | Comments (typed, with coordinates — likely doc annotations), notifications, stale-project notifications, project history timeline |
| **Email Agent (differentiator)** | Gmail OAuth integration, Claude-powered email parsing (`scan-emails` Edge Function), cron 2x/day, `email_scan_runs` history, auto-status updates from concessionária replies, attachment processing |
| **Admin tooling** | Companies CRUD, Users CRUD (via Edge Functions `create-user`/`update-user`/`delete-user`), View-as-Company impersonation, kanban config, form config, concessionária config, financial console, reports |

This is a **mature mid-stage product**, not an MVP. Surface area is broad.

---

## 3. Missing table-stakes (the gaps that will cost deals)

| Gap | Why it matters in BR-solar |
|---|---|
| **CRM / lead pipeline** | Integradoras don't separate "lead → proposal → closed deal → homologation"; today the kanban starts post-sale. Losing top-of-funnel ARPU. |
| **e-Signature (procuração + contrato)** | Every GD homologation needs a procuração assinada digitalmente. Integrate **Clicksign**, **D4Sign**, or **ZapSign** (cheapest BR option). Currently a manual export-print-sign-scan loop. |
| **CCEE / ANEEL / distribuidora portal automation (RPA)** | The pain users *actually* feel: re-typing project data into CEMIG GD-Web, Enel E-Cliente, Equatorial portal. Even partial RPA on the 3 biggest distribuidoras would be worth a feature wall by itself. |
| **NF-e / NFS-e issuance + billing** | Service bureaus need to invoice integradoras per project. Integrate **NFE.io**, **eNotas**, or **Migrate**. |
| **WhatsApp Business API** | The end-client (homeowner) wants WhatsApp updates, not email. Send protocol status, request missing docs, collect signatures via WA. **Twilio**, **Z-API**, **Evolution API** are obvious paths. |
| **Inverter monitoring integration** | After homologation, integradoras want one pane of glass. APIs: **Growatt**, **Solis**, **Deye/Sungrow**, **Fronius**, **WEG**, **Canadian/Hoymiles**. Even read-only "plant is online" is a sticky retention feature. |
| **Customer/end-client portal (or PWA)** | The homeowner has zero visibility today. A branded PWA where they see their protocol status reduces support load for the integradora. |
| **AI proposal generator** | Given the credentials already wired to Anthropic, generating a homologation kit (memorial descritivo, ART/TRT, diagrama unifilar PDF from project data) is low-hanging fruit. |
| **O&M / after-sales ticketing** | GD II (Lei 14.300) compliance audits, anniversary inspections, warranty claims — none of this exists today. |
| **SLA & escalation engine** | Distribuidoras have legal SLAs (e.g. CEMIG 15 dias úteis). Auto-escalate to ANEEL ouvidoria if breached — a killer compliance feature. |
| **Mobile app for field teams** | Vistoria técnica fotos are uploaded via desktop today. A simple field PWA with offline + geo-stamped photo capture would close deals. |
| **Audit log / compliance export** | LGPD-mandated. No evidence of an `audit_log` table — `project_history` exists but isn't a full LGPD audit trail. |

---

## 4. Monetization expansions (current pricing assumed flat per-seat)

1. **Usage-based protocol fee.** Charge R$ 4–12 per protocol homologated (on top of the SaaS floor). Aligns price to value, captures upside from high-volume bureaus.
2. **Per-distribuidora portal connector pack.** Each RPA integration (CEMIG, Enel, CPFL…) is a paid add-on at R$ 99–299/mo each. Bundle "Sudeste Pack" / "Sul Pack".
3. **e-Signature passthrough.** Resell ZapSign/D4Sign at a 30–50% markup, bundled into "per assinatura" pricing. Zero engineering after the integration.
4. **WhatsApp Business as a metered add-on.** R$ 0,15 per session message + R$ 99/mo platform fee. Massive perceived value, near-zero marginal cost.
5. **AI Credits (Memorial Descritivo, ART, diagrama unifilar auto-generate).** R$ 9–29 per generated kit; charge per Claude call. Anthropic key is already wired.
6. **Marketplace de homologação.** Integradoras without homologation staff *buy* the service from bureaus inside the platform — take a 8–15% transaction fee. This turns the product into a two-sided market and defends against competitors.
7. **White-label for distribuidora cooperativas / associações estaduais.** Sell the whole platform branded to ABGD, ABSOLAR-state-chapters, or cooperativas like Coopera, Certel — R$ 5k–25k/mo per tenant.
8. **Compliance & reporting subscription.** Premium tier: Lei 14.300 SLA tracker, monthly LGPD report, GD II vs GD I migration advisory dashboard, ANEEL ouvidoria one-click escalation. R$ 299/mo add-on.
9. **Lead-gen monetization.** The public intake form already accepts public leads. Sell qualified leads to integradoras that don't yet own the bureau relationship (R$ 30–120 per qualified lead, Solfácil-style).
10. **Financiamento referral.** Solfácil, Meu Financiamento Solar, BV Financeira pay 0,3–1% referral commission. Surface a "solicitar financiamento" button from inside the project.

---

## 5. Three differentiation bets (where to plant the flag)

**Bet #1 — "Concessionária Connect": deep distribuidora automation.**
Pick the 3 largest BR distribuidoras by GD volume (CEMIG, Enel SP, Equatorial CE/PA). Build, in order: (a) form-filling RPA via Playwright headless on a Supabase Edge worker, (b) protocol-status polling, (c) inbound document parsing (already partly done with the email agent). Position as **"o único sistema que homologa direto, sem retyping."** This is a 2-quarter moat that nobody in BR has cracked.

**Bet #2 — Email Agent → Universal AI Operator.**
The Gmail+Claude infrastructure is already shipped and is genuinely uncommon. Extend it: (a) parse PDFs from distribuidora replies and auto-update fields, (b) draft response emails for the user to approve, (c) chat-with-your-pipeline natural-language assistant ("quantos projetos da CEMIG estão parados em vistoria há mais de 10 dias?"), (d) auto-classify pendências by type and suggest fixes. This becomes the headline screenshot of the marketing site.

**Bet #3 — WhatsApp as the primary client interface.**
End-clients (homeowners + small businesses) do not check email. Build a WhatsApp gateway that (a) notifies on every status change, (b) collects missing documents via WA, (c) lets the client sign procuração via ZapSign-WA flow, (d) lets the integradora's support team reply from inside the project detail page. This single feature changes NPS overnight and dramatically reduces "ele não respondeu o email" pendência loops.

---

## 6. Quick wins (1–3 day builds, visible to daily users)

1. **Bulk actions on the kanban** — multi-select projects, bulk move column, bulk assign staff, bulk export. Today's drag-one-at-a-time is painful at 80+ projects.
2. **"Copiar para WhatsApp" botão no detalhe do projeto** — formats project status + last update + missing docs into a clean WA-ready text. Zero backend work, huge perceived value.
3. **Salvable filter views on kanban + map** — users currently re-apply filters every session. Persist as named views per user.
4. **Aging chips on cards (`5d sem update`)** — `useStaleNotifications` already exists; surface it on the kanban card with a colored dot. Visual triage in 1 second.
5. **Global command palette (Cmd+K)** — `cmdk` is already in package.json. Wire it for "ir para projeto", "criar tarefa", "abrir mapa", "ver pendências". Power-user delight, low risk.

(Honorable mentions for 4–7 day builds: CSV/XLSX export on every table; project clone; comment @-mentions with notification; dark-mode polish via existing `next-themes`.)

---

## 7. Strategic risks

| Risk | Severity | Mitigation |
|---|---|---|
| **Lovable platform lock-in** | High | README, prompts, and `lovable-tagger` dep tie the workflow to Lovable. Migrate the build pipeline off Lovable's wrapper, keep just GitHub Actions + nginx (already in place). Don't let the editing platform become the architecture. |
| **Single-vendor Supabase dependency** | High | Auth, DB, storage, Edge Functions, cron — all Supabase. Acceptable for now, but document an exit-path (Postgres dump + S3 mirror + Cloudflare Workers fallback). At ARR > R$ 1M, run a quarterly DR drill. |
| **Regulatory shift — Lei 14.300 transition (GD I → GD II by 2029)** | High | Tariff B-aware calculations and "fio B" billing will mutate the financial module. Build a flexible tariff engine *now* rather than hardcoding. Opportunity: be the system that helps integradoras migrate clients between regimes. |
| **ANEEL Resolução Normativa changes (e.g. RN 1.000/2021, REN 482 successors)** | Medium | Engage a regulatory advisor on retainer; publish a "regulatory changelog" page that doubles as SEO bait. |
| **Distribuidora portals change layout / break RPA** | Medium (if Bet #1 is taken) | Use Playwright with selector resilience + a paid monitoring layer. Charge users for the connector tier — fund the maintenance with the revenue. |
| **Competitive squeeze from 77Sol / Solfácil bundling homologation for free with financing** | High | The "free homologation for financed projects" risk is real. Defensive moves: (a) own the bureau persona that doesn't want to depend on a financiadora, (b) be the neutral platform that integrates *all* financiadoras as referral options. |
| **Technical debt: dual financial tables (`financials` + `project_financials`)** | Medium | Already flagged in `PRIORIDADES.md` and partially fixed via sync triggers. Schedule a hard consolidation before adding NF-e/billing. |
| **LGPD exposure (CPF/CNPJ/energy bills in storage)** | High | Security report exists and fixes are applied, but no DPA template, no data-retention policy, no data-subject-request flow. Add before scaling. |
| **Email Agent: Gmail OAuth scope + Anthropic cost spiral** | Medium | Add per-tenant token-budget caps; switch high-volume bureaus to dedicated Anthropic keys; consider Haiku for first-pass classification, Sonnet only for ambiguous emails. |
| **Public form abuse without IP-rate-limit** | Medium | Turnstile is in place — good. Add per-IP and per-CPF rate-limits at the Edge Function layer. |
| **Single founder / small team bus factor** | Implicit | Document the email agent and RPA pieces especially well; they're the highest-leverage and most-fragile code. |

---

## 6-month roadmap recommendation (TL;DR)

- **M1–M2:** Quick wins (Section 6) ship in week 1–3. Then start **Bet #3 (WhatsApp)** — fastest revenue lever, lowest tech risk. Add e-signature passthrough (ZapSign) in parallel. Hard-consolidate the financial tables.
- **M3–M4:** Launch **AI Credits** (memorial descritivo + diagrama unifilar generators) — monetizes the Anthropic dependency that's already paid for. Ship a basic customer-portal PWA. Add NF-e issuance for bureau tier.
- **M5–M6:** Begin **Bet #1 (Concessionária Connect)** with CEMIG as pilot — sell as "Pacote Sudeste" add-on at R$ 199/mo. Layer in inverter monitoring read-only (Growatt + Solis first, they cover ~60% of BR residential GD inverters). Start lead-gen marketplace beta with 10 friendly bureaus.

**North-star metric to instrument before any of this:** *protocols homologated per active company per month*. Everything above moves that number.
