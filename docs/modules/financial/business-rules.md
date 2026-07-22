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
| `monthly` | R$0 dentro do limite mensal; excedente = `pricing_excess_value`. |

- **RN-FIN-01** — O valor é preenchido por trigger (`fn_set_project_value`) na
  criação e **continua editável** no financeiro.
- **RN-FIN-02** — `tiered_flat`: no valor exato do limite (ex.: 5 kWp entre 0–5 e
  5–10), vale a faixa que **termina** nele (a de baixo); ordena por `from` asc.
- **RN-FIN-03** — Quitação total marca o projeto como pago; estorno reverte um
  pagamento específico e registra no histórico.
- **RN-FIN-04** — Quitação/estorno **em lote** operam sobre a seleção múltipla.
- **RN-FIN-05** — Limite de projetos/mês do plano (`pricing_monthly_limit` e o
  plano do tenant) afetam o `monthly` e o bloqueio por plano (RN-G08).
- **RN-FIN-06** — Valores isolados por `tenant_id`; empresa vê só os seus.
