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
- Financeiro da empresa (`/company/financial`).
- Dashboards e relatórios financeiros.

## Banco
`project_financials`, `financials`, `financial_payments`, `payment_history`.

## Hooks
`useFinancials`, `useFinancialDashboard`, `useFinancialReport`,
`usePaymentHistory`, `useProjectValue`.

## Telas
`/admin/financial`, `/company/financial`, aba financeira do `ProjectModal`.

## Regras / API / fluxos
Ver [business-rules.md](business-rules.md) · [database.md](database.md) ·
[flow.md](flow.md).
