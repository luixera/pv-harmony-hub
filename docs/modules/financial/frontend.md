# Financeiro — Frontend

## Telas
- `src/pages/admin/Financial.tsx` — recebíveis do tenant; seleção múltipla e
  quitação/estorno em lote.
- `src/pages/company/CompanyFinancial.tsx` — "Meu Financeiro" da empresa
  integradora (`/company/financial`). Dois blocos separados: **Assinatura
  mensal** (competência, valor, franquia consumida, vencimento, status) e
  **ARTs por projeto**. Os cards do topo somam os dois e mostram a quebra. Quem
  não tem assinatura só vê o bloco de projetos. Ver
  [business-rules.md](business-rules.md#a-empresa-cliente-vê-a-própria-assinatura).
- Aba financeira do `src/components/projects/ProjectModal.tsx` — valor editável,
  botão "Quitar total", histórico de pagamentos com estorno por linha.

## Componentes
- `src/components/financial/ReceivablesTable.tsx` — tabela de recebíveis.
- `src/components/financial/FinancialReportModal.tsx` — **extrato financeiro**
  (pré-visualização + PDF/impressão). Filtros: empresa, **etapas do projeto
  (multi-seleção)**, status de pagamento e período.
- `CompanyPricingFields` (admin/empresas) define a regra que gera os valores.

## Extrato: filtro de etapas

As etapas são botões liga/desliga, não um `select` de escolha única — um
extrato real junta etapas diferentes (ex.: aprovado + vistoria solicitada +
concluído que ainda não foi pago). **Nenhuma marcada = todas entram**; cada
etapa marcada vira uma tarja no cabeçalho do extrato, pra o recorte usado
ficar explícito no PDF entregue ao cliente.

As opções e os rótulos vêm de `VALID_PROJECT_STATUSES` /
`PROJECT_STATUS_LABELS` (`src/lib/statusMapping.ts`) — **não manter cópia
local**: a que existia aqui estava sem "Pendência" e "Vistoria Solicitada",
então esses projetos não eram filtráveis e saíam com o código cru na coluna
Status.

O predicado do filtro é a função pura `matchesReportFilters` em
`useFinancialReport.ts` (testável fora do React; os filtros se combinam com E
lógico).

## Dashboards
- Recharts para séries mensais e agregações.
