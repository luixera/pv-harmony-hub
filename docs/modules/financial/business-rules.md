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

### A empresa cliente vê a própria assinatura

A empresa integradora paga **duas coisas diferentes** — a mensalidade e a ART de
cada projeto —, e somar as duas num bloco só confunde. Em `/company/financial`
("Meu Financeiro") a tela tem **um bloco para cada** (decisão do usuário,
jul/2026):

- **Assinatura mensal** — uma linha por competência, com mensalidade, pago, em
  aberto, vencimento, status e o **consumo da franquia** ("7 de 10 projetos"),
  mais o aviso de excedente quando passa. Histórico completo, todos os meses.
- **ARTs por projeto** — a tabela de projetos que já existia (o título só muda
  para quem tem assinatura).

Os três cards do topo somam os dois blocos, com a quebra por baixo
("R$ 3.000 em assinatura · R$ 758,52 em ARTs") — sem isso a empresa não
consegue conferir o que deve. O KPI "Valor pendente" do painel da empresa
(`DashboardCompany`) também passa a incluir a mensalidade em aberto, senão
mostraria menos do que ela realmente deve.

Fonte: RPC `company_subscription_statement(_company_id)` — a tabela guarda em
`projects_included` o **limite** do plano, não o usado, então a contagem de
projetos da competência é calculada na RPC. Sem cobrança gerada, a lista vem
vazia e o bloco não aparece: a tela não inventa mensalidade.
- **RN-FIN-02** — `tiered_flat`: no valor exato do limite (ex.: 5 kWp entre 0–5 e
  5–10), vale a faixa que **termina** nele (a de baixo); ordena por `from` asc.
- **RN-FIN-03** — Quitação total marca o projeto como pago; estorno reverte um
  pagamento específico e registra no histórico.
- **RN-FIN-04** — Quitação/estorno **em lote** operam sobre a seleção múltipla.
- **RN-FIN-05** — Limite de projetos/mês do plano (`pricing_monthly_limit` e o
  plano do tenant) afetam o `monthly` e o bloqueio por plano (RN-G08).
- **RN-FIN-06** — Valores isolados por `tenant_id`; empresa vê só os seus. Isso
  vale **entre empresas do mesmo tenant**: a leitura de
  `company_subscription_charges` liberava qualquer usuário do tenant (uma
  integradora leria a mensalidade das outras) — corrigido em jul/2026, agora
  admin/staff veem todas e a empresa só a linha dela
  (`company_id = get_user_company_id(auth.uid())`). A RPC
  `company_subscription_statement` repete a checagem e recusa `_company_id` de
  outra empresa.

## Recebimento em lote — o valor redondo (out/2026)

O problema real (trazido pelo usuário em out/2026): **a empresa manda um valor
redondo**, tipo R$ 5.000, que não corresponde à soma de projetos nenhum. Com a
quitação total/em lote que já existia não dava para lançar isso: ou sobrava
dinheiro sem destino, ou era preciso inventar um abatimento projeto por
projeto. O que a operação faz na mão é **quitar os mais antigos e abater
parcialmente o que ficar no caminho** — e depois precisa conseguir responder
"o que aquele depósito pagou?".

A resposta é o **recebimento**: um lançamento do dinheiro que entrou (data,
valor, empresa) com as **parcelas** que ele abateu penduradas nele.

- **RN-FIN-07 — o sistema sugere, a pessoa ajusta.** `recebimento_sugerir`
  distribui o valor de forma gulosa e **só calcula** (não grava nada). A tela
  mostra linha por linha com "quita"/"abate" e deixa desmarcar e mudar
  qualquer valor. Quem grava é `recebimento_registrar`, com as linhas que a
  pessoa confirmou — o servidor **nunca redistribui** o que ela ajustou.
  Trocar o valor recebido refaz a sugestão do zero: é dinheiro diferente.
- **RN-FIN-08 — a ordem é ART mais antiga primeiro, mensalidade depois.**
  Decisão do usuário (out/2026): as ARTs vêm antes porque são a dívida do
  projeto que está parado esperando, e dentro delas vence a mais antiga
  (`due_date` com `NULLS LAST`, empate por `created_at`); as mensalidades
  entram por último, por competência. É só a sugestão — a pessoa pode
  inverter.
- **RN-FIN-09 — a sobra fica como crédito da empresa, e com confirmação
  explícita.** Se o valor aplicado for menor que o recebido, a diferença fica
  em `financial_receipts.credit` e **aparece no recebimento seguinte** como
  aviso ("esta empresa tem R$ X de crédito"). O crédito **não entra sozinho**
  na conta: quem lança soma ele ao valor se quiser usar. Para gravar com
  sobra a pessoa clica em confirmar **duas vezes** — dinheiro parado tem de
  ser escolha, não descuido.
- **RN-FIN-10 — nenhuma linha passa do que está em aberto, nem do recebido.**
  `recebimento_registrar` recusa: soma das linhas maior que o valor recebido,
  linha maior que o saldo em aberto do item, alvo que não é da empresa
  informada, data no futuro e valor ≤ 0. A tela bloqueia antes, mas a
  validação que vale é a do banco.
- **RN-FIN-11 — estorno é de admin e é do recebimento inteiro.** Não existe
  "desfazer uma linha": `recebimento_estornar` lança as contrapartidas
  **negativas** de todas as parcelas, recalcula os status e marca o
  recebimento como estornado com motivo e autor. O histórico fica — nada é
  apagado.
- **RN-FIN-12 — a empresa vê, mas não lança.** Em `/company/financial` o bloco
  "Meus pagamentos" mostra os recebimentos dela com o que cada um quitou
  (QUITOU) ou abateu (ABATEU) — é a primeira pergunta que ela faz. Só
  leitura: quem lança e quem estorna é a equipe do tenant
  (`financeiro_equipe_ok()`), e o estorno só o admin.

A mensalidade não tinha histórico de pagamento nenhum antes disso — só
`amount_paid` na cobrança. O recebimento trouxe
`subscription_payment_history`, que é o espelho de `payment_history` para a
assinatura (inclusive as linhas negativas do estorno).
