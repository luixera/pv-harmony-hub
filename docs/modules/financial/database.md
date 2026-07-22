# Financeiro — Banco de Dados

## Tabelas
- **`project_financials`** (9 col.) — valor do projeto, status de pagamento.
- **`financials`** (9 col.) — lançamentos financeiros.
- **`financial_payments`** (6 col.) — pagamentos.
- **`payment_history`** (9 col.) — histórico (quitação/estorno) com autor.

## Funções / triggers
- `compute_project_value(_project_id)` — cálculo por regra da empresa
  (`SECURITY DEFINER`, `STABLE`).
- `fn_set_project_value()` — trigger que preenche `project_value` se vazio/zero.
- `fn_enforce_project_limit()`, `fn_enforce_user_limit()` — limites do plano.

## Precificação (colunas em `companies`)
`pricing_type`, `pricing_fixed_value`, `pricing_kwp_rate`, `pricing_tiers`
(jsonb), `pricing_monthly_value`, `pricing_monthly_limit`,
`pricing_excess_value`. Formato de `pricing_tiers` depende do tipo
(`tiered_kwp`: `{up_to, rate}`; `tiered_flat`: `{from, to, price}`).

## RLS
Isolamento por `tenant_id`; empresa acessa os próprios lançamentos.
