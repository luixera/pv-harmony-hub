-- ══════════════════════════════════════════════════════════
-- Add due_date column to project_financials
-- Date: 2026-05-27
-- Reason: useFinancialDashboard already SELECTs `due_date` from
--         project_financials, but the column was only present in
--         the legacy `financials` table. The missing column made
--         the entire query fail silently, returning {} kpis and
--         the Financial dashboard showing R$ 0,00 regardless of
--         actual data. Adding the column matches the field the
--         frontend already expects.
-- ══════════════════════════════════════════════════════════

ALTER TABLE public.project_financials
  ADD COLUMN IF NOT EXISTS due_date date;

-- Backfill from legacy `financials` if present, so existing
-- environments with rows in both tables stay in sync.
UPDATE public.project_financials pf
SET due_date = f.due_date
FROM public.financials f
WHERE f.project_id = pf.project_id
  AND f.due_date IS NOT NULL
  AND pf.due_date IS NULL;
