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

## Componentes
- Aba financeira do `ProjectModal` (quitar total, estorno por pagamento).
- `src/pages/admin/Financial.tsx` — lote (seleção múltipla, quitação/estorno).
- `src/pages/company/CompanyFinancial.tsx` — assinatura + ARTs da empresa.
- `src/components/financial/ReceivablesTable.tsx`.
- `src/components/financial/RecebimentoDialog.tsx` — lançar o valor redondo
  (sugestão editável, resumo Recebido/Aplicado/Sobra).
- `src/components/financial/RecebimentosBloco.tsx` — o bloco "o que foi pago e
  o que isso quitou"; **o mesmo componente** nas duas telas, com
  `podeEstornar` só no admin.
- `src/lib/valorBR.ts` (+ teste) — leitura de valor digitado. Existe porque
  "5.000" tem de dar 5000, não 5.
