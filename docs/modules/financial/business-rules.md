# Financeiro — Regras de Negócio

## Cálculo do valor (`compute_project_value`)
Conforme `companies.pricing_type`:

| Tipo | Cálculo |
|---|---|
| `manual` | Sem valor automático (digitado no projeto). |
| `fixed` | `pricing_fixed_value` para todo projeto. |
| `per_kwp` | `kWp × pricing_kwp_rate`. |
| `tiered_kwp` | Menor faixa (`up_to`) que comporta a potência → `kWp × rate`. Última faixa com `up_to` vazio = "acima de tudo". |
| `tiered_flat` | Faixa `[from, to]` que contém a potência → **preço fixo**. Última com `to` vazio = sem teto. |
| `monthly` | **RT** (`tenants.art_value`) em todo projeto; passando da franquia do mês, RT + `pricing_excess_value`. A mensalidade é cobrada à parte (abaixo). |

- **RN-FIN-01** — O valor é preenchido por trigger (`fn_set_project_value`) na
  criação e **continua editável** no financeiro.

## Assinatura mensal (`pricing_type = 'monthly'`)

Regra definida com o usuário (jul/2026), a partir do contrato real da
AF ENERGY SOLAR 360 (R$ 3.000/mês, franquia de 10 projetos, R$ 290 de
excedente):

1. **A mensalidade é cobrada uma vez por mês**, por empresa — vira um
   lançamento em `company_subscription_charges` (competência = 1º dia do mês,
   valor, vencimento no último dia do mês, status de pagamento). É recebível
   de verdade: entra nos KPIs, no "por empresa" e no extrato, e pode ser
   quitada/estornada.
2. **Cada projeto cobra só a RT.** O valor da RT é **único do tenant**
   (`tenants.art_value`), gravado pela RPC `set_tenant_art_value` — a tabela
   `tenants` só é editável pelo master, então o admin passa por ela. Continua
   editável caso a caso no projeto.
3. **Passando da franquia do mês, o projeto vale RT + excedente** — o
   excedente é adicional, não substitui a RT. `compute_project_value` conta os
   projetos da empresa criados **antes** deste no mesmo mês; do (limite+1)º em
   diante soma `pricing_excess_value`.

Geração: RPC idempotente `ensure_subscription_charges` (botão "Gerar mês" no
Financeiro) cria o que falta de cada empresa com assinatura, do mês do
primeiro projeto até o mês corrente, sem duplicar (`unique (company_id,
competence)`).

Projetos criados **antes** de a RT existir ficaram zerados;
`recompute_subscription_project_values` reaplica a regra só nos que estão em
0 (nunca mexe em valor já digitado) e roda sozinha ao salvar a RT.
- **RN-FIN-02** — `tiered_flat`: no valor exato do limite (ex.: 5 kWp entre 0–5 e
  5–10), vale a faixa que **termina** nele (a de baixo); ordena por `from` asc.
- **RN-FIN-03** — Quitação total marca o projeto como pago; estorno reverte um
  pagamento específico e registra no histórico.
- **RN-FIN-04** — Quitação/estorno **em lote** operam sobre a seleção múltipla.
- **RN-FIN-05** — Limite de projetos/mês do plano (`pricing_monthly_limit` e o
  plano do tenant) afetam o `monthly` e o bloqueio por plano (RN-G08).
- **RN-FIN-06** — Valores isolados por `tenant_id`; empresa vê só os seus.
