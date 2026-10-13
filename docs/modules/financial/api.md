# Financeiro — API / Hooks

## Hooks
- `useFinancials` — lançamentos do tenant/empresa.
- `useFinancialDashboard` — agregações para o dashboard.
- `useFinancialReport` / `useReportFilters` — relatórios.
- `usePaymentHistory` — `useAddPaymentHistory`, `useReverseSinglePayment`,
  `useUpdateProjectValue`.
- `useProjectsMonthly` — série mensal.
- `useSubscriptionCharges` — assinatura mensal: `useArtValue`/`useSaveArtValue`,
  `useGenerateSubscriptionCharges`, `useSettleSubscriptionCharge`,
  `useRecomputeSubscriptionValues` e `useCompanySubscriptionStatement`
  (extrato da própria empresa, com o consumo da franquia).
- `useRecebimentos` (`src/hooks/useRecebimentos.ts`) — recebimento em lote:
  `useSugestaoRecebimento(companyId, valor)`, `useCreditoDaEmpresa`,
  `useRecebimentos(companyId)`, `useRegistrarRecebimento`,
  `useEstornarRecebimento`.
- `useDossieFinanceiro` (`src/hooks/useDossieFinanceiro.ts`) —
  `useEmpresasResumo()` e `useEmpresaPainel(companyId)`, mais o reexport de
  `prazoMedioGlobal`.

## RPCs
- `compute_project_value` (via trigger), `fn_set_project_value`,
  `console_finance_stats` (console master).
- `ensure_subscription_charges(_from, _to)` — gera as mensalidades que faltam
  (idempotente; admin/staff).
- `set_tenant_art_value(_value)` — grava a RT do tenant.
- `recompute_subscription_project_values(_company_id)` — reaplica a RT só nos
  projetos zerados.
- `company_subscription_statement(_company_id)` — extrato da assinatura por
  competência com mensalidade, pago, vencimento, status, limite da franquia,
  projetos usados e excedente. Sem parâmetro, é a empresa do próprio usuário;
  recusa `_company_id` de outra empresa.

### Recebimento em lote

Todas `SECURITY DEFINER` com `search_path = ''`; escrita exige
`financeiro_equipe_ok()` (admin/staff do tenant ou master).

- `recebimento_abertos(_company_id)` — o que a empresa deve, na ordem da
  sugestão: ARTs (grupo 0) por `due_date NULLS LAST`, `created_at`; depois
  mensalidades (grupo 1) por competência. Devolve `tipo`, `alvo_id`,
  `rotulo`, `detalhe`, `total`, `aberto`, `vencimento`.
- `recebimento_credito(_company_id)` — soma das sobras de recebimentos não
  estornados.
- `recebimento_sugerir(_company_id, _valor)` — distribuição gulosa sobre
  `recebimento_abertos`. **Só calcula, não grava** (RN-FIN-07); devolve as
  linhas com `sugerido`.
- `recebimento_registrar(_company_id, _data, _valor, _linhas jsonb, _notes)` —
  grava o `financial_receipts` + as parcelas e recalcula os status.
  `_linhas` = `[{tipo, alvo_id, valor}]`. Valida RN-FIN-10 e devolve o
  `receipt_id`.
- `recebimento_estornar(_receipt_id, _motivo)` — **só admin**; contrapartidas
  negativas de todas as parcelas (RN-FIN-11).
- `recebimento_extrato(_company_id, _limite)` — uma linha por recebimento com
  as parcelas em `linhas` jsonb, cada uma com `quitou` (boolean) para a tela
  mostrar QUITOU/ABATEU. É o que a empresa lê.
- `financeiro_equipe_ok()` — helper de permissão usado pelas RPCs e pelas
  políticas RLS.

### Reconstrução do histórico

- `recebimento_reconstruir_historico(_simular boolean default true)` — **só
  admin**. Agrupa `payment_history` por empresa + data e cria os recebimentos
  com `origin = 'reconstruido'`. Com `_simular = true` **não grava**, só conta.
  Idempotente: só enxerga pagamento com `receipt_id IS NULL`. Devolve
  `recebimentos, pagamentos, valor, simulado`.
- `recebimento_reconstrucao_desfazer()` — **só admin**. Solta os pagamentos e
  apaga os recebimentos reconstruídos do tenant; nunca toca num lançado. É o
  ponto de restauração dos dados dessa operação.
- `fn_barra_estorno_reconstruido()` — gatilho que recusa o estorno de um
  recebimento reconstruído (RN-FIN-17).

### Dossiê da empresa

- `financeiro_empresas_resumo()` — uma linha por empresa com `projetos`,
  `faturado`, `recebido`, `aberto`, `pagamentos`, `prazo_medio_dias` (nulo =
  nunca pagou) e `ultimo_pagamento`. Equipe vê todas as empresas do tenant; o
  usuário de empresa vê só a dele.
- `financeiro_empresa_painel(_company_id)` — o dossiê: os campos acima mais
  `cliente_desde`, `abertos_qtd`, `ultimo_valor`, `valores_distintos`,
  `valor_min`, `valor_max`, `ticket_medio` e `serie` (jsonb com um objeto por
  mês: `mes`, `projetos`, `faturado`, `recebido`, `ticket`). A série cobre só
  os meses que existem (2 a 6 por empresa no banco).
- `financeiro_empresa_visivel(_company_id)` — helper da régua de acesso,
  igual à de `recebimento_extrato`.

## Componentes
- Aba financeira do `ProjectModal` (quitar total, estorno por pagamento).
- `src/pages/admin/Financial.tsx` — lote (seleção múltipla, quitação/estorno).
- `src/pages/company/CompanyFinancial.tsx` — assinatura + ARTs da empresa.
- `src/components/financial/ReceivablesTable.tsx`.
- `src/components/financial/RecebimentoDialog.tsx` — lançar o valor redondo
  (sugestão editável, resumo Recebido/Aplicado/Sobra).
- `src/components/financial/RecebimentosBloco.tsx` — o bloco "o que foi pago e
  o que isso quitou"; **o mesmo componente** nas duas telas, com
  `podeEstornar` só no admin e `compacto` no panorama (só os últimos).
- `src/components/financial/DossieEmpresa.tsx` — o modo dossiê: cabeçalho da
  empresa, indicadores, gráfico (Recharts `ComposedChart`: barras de projetos +
  linhas de faturado e recebido) e o histórico completo.
- `src/lib/prazoMedio.ts` (+ teste) — média ponderada do prazo. Mora em `lib`
  porque o módulo do hook importa o client do Supabase, que não roda no vitest.
- `src/lib/valorBR.ts` (+ teste) — leitura de valor digitado. Existe porque
  "5.000" tem de dar 5000, não 5.
