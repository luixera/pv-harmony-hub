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

## `company_subscription_charges` (assinatura mensal)

Uma linha por **empresa × competência** (mês). É o recebível da mensalidade —
os projetos dessa empresa cobram só a RT (ver business-rules).

| Coluna | Tipo | Nota |
|---|---|---|
| `tenant_id`, `company_id` | uuid | isolamento + dono da cobrança |
| `competence` | date | 1º dia do mês cobrado |
| `amount` / `amount_paid` | numeric | valor da mensalidade e quanto foi pago |
| `status` | text | `pending` / `partial` / `paid` |
| `due_date` | date | último dia da competência (padrão do gerador) |
| `projects_included` | int | fotografia da franquia no mês |

`unique (company_id, competence)` — é o que torna o gerador idempotente.
RLS: leitura pelo tenant, escrita por admin/staff do tenant, master vê tudo.

Coluna nova em `tenants`: **`art_value`** — valor da RT por projeto, único do
tenant (escrita só pela RPC `set_tenant_art_value`).
