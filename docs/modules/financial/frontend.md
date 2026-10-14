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

## Extrato: geração do PDF e impressão

O PDF é uma **foto** da pré-visualização (`html2canvas` → `jsPDF`), não um
PDF desenhado. Duas regras vieram de um bug real (set/2026 — a coluna
"Saldo" saía cortada e uma linha era partida ao meio na troca de página):

- **A foto é tirada de um clone em folha de largura fixa** (`LARGURA_FOLHA_PX`
  = 794 px, A4 a 96 dpi), montado fora do modal (`position: fixed`, atrás do
  overlay) e removido no `finally`. Fotografar a pré-visualização no lugar
  dependia do tamanho da tela: o painel tem ~550 px, a tabela pede 560 e o
  invólucro `overflowX: auto` rola na tela mas **corta na foto**. O clone é
  preparado por `prepararFolhaDoExtrato` — tabela sem rolagem
  (`data-pdf="rolagem"`), cards do resumo sempre em 3 colunas
  (`data-pdf="resumo"`), sem cantos/sombra de cartão. A impressão usa o mesmo
  clone. **Não tirar os marcadores `data-pdf`**: é por eles que o clone é
  normalizado.
- **A quebra de página cai entre linhas da tabela** (ou logo antes dela),
  nunca no meio de uma linha. `calcularCortesDePagina`
  (`src/utils/pdfPaginacao.ts`, com teste) recebe o fim de cada `<tr>` em mm e
  devolve o topo de cada página; a foto inteira é desenhada em cada página com
  deslocamento negativo e o que passa do corte é coberto com um retângulo
  branco. Linha mais alta que a página (não acontece na prática) cai no corte
  cego, pra não travar.

## Dashboards
- Recharts para séries mensais e agregações.
