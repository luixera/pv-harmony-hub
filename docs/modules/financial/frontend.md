# Financeiro — Frontend

## Telas
- `src/pages/admin/Financial.tsx` — recebíveis do tenant; seleção múltipla e
  quitação/estorno em lote.
- `src/pages/company/Financial.tsx` — visão da empresa.
- Aba financeira do `src/components/projects/ProjectModal.tsx` — valor editável,
  botão "Quitar total", histórico de pagamentos com estorno por linha.

## Componentes
- `src/components/financial/ReceivablesTable.tsx` — tabela de recebíveis.
- `CompanyPricingFields` (admin/empresas) define a regra que gera os valores.

## Dashboards
- Recharts para séries mensais e agregações.
