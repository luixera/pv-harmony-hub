# Módulo: Financeiro

## Objetivo
Controlar o valor de cada projeto e os pagamentos: cálculo automático conforme a
regra da empresa, quitação (total e em lote), estorno e histórico.

## Funcionalidades
- **Cálculo automático** do valor na criação do projeto (trigger).
- Financeiro do projeto no modal (valor editável, histórico de pagamentos).
- **Quitar total** e **estorno por pagamento**.
- **Financeiro em lote** (`/admin/financial`): seleção múltipla, quitação/estorno
  em massa.
- **Recebimento em lote** — a empresa manda um valor redondo e o sistema sugere
  quitar as ARTs mais antigas e abater o resto; a empresa vê o que cada
  pagamento dela quitou. Ver RN-FIN-07 a RN-FIN-12.
- Assinatura mensal por empresa (`company_subscription_charges`).
- Financeiro da empresa (`/company/financial`).
- Dashboards e relatórios financeiros.

## Banco
`project_financials`, `payment_history`, `company_subscription_charges`,
`subscription_payment_history`, `financial_receipts`.
(`financials` e `financial_payments` são legado — ver [database.md](database.md).)

## Hooks
`useFinancials`, `useFinancialDashboard`, `useFinancialReport`,
`usePaymentHistory`, `useProjectValue`, `useSubscriptionCharges`,
`useRecebimentos`.

## Telas
`/admin/financial`, `/company/financial`, aba financeira do `ProjectModal`.

## Regras / API / fluxos
Ver [business-rules.md](business-rules.md) · [database.md](database.md) ·
[flow.md](flow.md).
