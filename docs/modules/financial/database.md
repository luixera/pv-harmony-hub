# Financeiro — Banco de Dados

## Tabelas
- **`project_financials`** (9 col.) — valor do projeto, status de pagamento.
  É **a** tabela do recebível do projeto.
- **`payment_history`** (9 col.) — histórico (quitação/estorno) com autor.
- **`financial_receipts`** — o dinheiro que entrou (ver abaixo).
- **`subscription_payment_history`** — histórico de pagamento da mensalidade.
- ⚠️ **`financials`** (5 linhas) e **`financial_payments`** (0 linhas) são
  **legado**: nada no código novo lê ou escreve nelas (conferido no banco em
  out/2026). Não usar — o recebível vive em `project_financials` +
  `payment_history`.

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

## `financial_receipts` (recebimento em lote)

Migração `20261013100000_recebimento_em_lote.sql`. Uma linha por **dinheiro que
entrou**: a empresa mandou R$ 5.000 no dia tal. O que esse dinheiro abateu são
as parcelas que apontam para ele.

| Coluna | Tipo | Nota |
|---|---|---|
| `tenant_id`, `company_id` | uuid | isolamento + quem pagou |
| `received_date` | date | data do dinheiro (não pode ser futura) |
| `amount` | numeric | valor recebido |
| `credit` | numeric | sobra que não foi aplicada (RN-FIN-09) |
| `notes` | text | PIX, boleto, nº do comprovante |
| `created_by` | uuid | quem lançou |
| `reversed_at` / `reversed_by` / `reversal_reason` | — | estorno (RN-FIN-11) |

**As parcelas** são as tabelas de histórico que já existiam, com um ponteiro
novo — é isso que faz o recebimento conviver com a quitação avulsa sem
duplicar dinheiro:

- `payment_history.receipt_id` → ART abatida por aquele recebimento.
- **`subscription_payment_history`** (tabela nova) — o histórico que a
  mensalidade não tinha: `charge_id`, `amount`, `payment_date`, `notes`,
  `registered_by`, `entry_type` (`payment` / `reversal`),
  `reverses_payment_id`, `receipt_id`.

`receipt_id` nulo = pagamento avulso (a quitação total de sempre). Estorno
entra como linha **negativa**, nunca como `delete`.

RLS: equipe do tenant (`financeiro_equipe_ok()`) lê e escreve; a empresa lê só
as linhas dela (`company_id = get_user_company_id(auth.uid())`) e **não
escreve** — RN-FIN-12. Master vê tudo.
