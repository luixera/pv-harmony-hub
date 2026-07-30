# Financeiro — API / Hooks

## Hooks
- `useFinancials` — lançamentos do tenant/empresa.
- `useFinancialDashboard` — agregações para o dashboard.
- `useFinancialReport` / `useReportFilters` — relatórios.
- `usePaymentHistory` — `useAddPaymentHistory`, `useReverseSinglePayment`,
  `useUpdateProjectValue`.
- `useProjectsMonthly` — série mensal.
- `useSubscriptionCharges` — assinatura mensal: `useArtValue`/`useSaveArtValue`,
  `useGenerateSubscriptionCharges`, `useSettleSubscriptionCharge`,
  `useRecomputeSubscriptionValues` e `useCompanySubscriptionStatement`
  (extrato da própria empresa, com o consumo da franquia).

## RPCs
- `compute_project_value` (via trigger), `fn_set_project_value`,
  `console_finance_stats` (console master).
- `ensure_subscription_charges(_from, _to)` — gera as mensalidades que faltam
  (idempotente; admin/staff).
- `set_tenant_art_value(_value)` — grava a RT do tenant.
- `recompute_subscription_project_values(_company_id)` — reaplica a RT só nos
  projetos zerados.
- `company_subscription_statement(_company_id)` — extrato da assinatura por
  competência com mensalidade, pago, vencimento, status, limite da franquia,
  projetos usados e excedente. Sem parâmetro, é a empresa do próprio usuário;
  recusa `_company_id` de outra empresa.

## Componentes
- Aba financeira do `ProjectModal` (quitar total, estorno por pagamento).
- `src/pages/admin/Financial.tsx` — lote (seleção múltipla, quitação/estorno).
- `src/pages/company/CompanyFinancial.tsx` — assinatura + ARTs da empresa.
- `src/components/financial/ReceivablesTable.tsx`.
