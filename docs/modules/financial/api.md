# Financeiro — API / Hooks

## Hooks
- `useFinancials` — lançamentos do tenant/empresa.
- `useFinancialDashboard` — agregações para o dashboard.
- `useFinancialReport` / `useReportFilters` — relatórios.
- `usePaymentHistory` — `useAddPaymentHistory`, `useReverseSinglePayment`,
  `useUpdateProjectValue`.
- `useProjectsMonthly` — série mensal.

## RPCs
- `compute_project_value` (via trigger), `fn_set_project_value`,
  `console_finance_stats` (console master).

## Componentes
- Aba financeira do `ProjectModal` (quitar total, estorno por pagamento).
- `src/pages/admin/Financial.tsx` — lote (seleção múltipla, quitação/estorno).
- `src/components/financial/ReceivablesTable.tsx`.
