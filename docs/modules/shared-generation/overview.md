# Módulo: Geração Compartilhada / Autoconsumo Remoto

**Estado: 🟡 Beneficiárias estruturadas (22/10/2026); criação na CPFL em
autoconsumo remoto escrita, aguardando a 1ª simulação no portal.**

Spec: [2026-10-22-beneficiarias-autoconsumo-remoto-design.md](../../superpowers/specs/2026-10-22-beneficiarias-autoconsumo-remoto-design.md).

## Objetivo
Projetos de **autoconsumo remoto**: uma unidade **geradora** manda a sobra dos
créditos para uma ou mais unidades **beneficiárias**, cada uma com um
percentual de rateio. O dado é **genérico** (vale para qualquer
concessionária); só a criação automática no portal é da CPFL.

## Onde vive

- **`project_beneficiaries`** — uma linha por beneficiária: `uc_number` (só
  dígitos), `percent` (numeric 7,4), `holder_name`/`holder_doc`/`address`
  (lidos da conta pelo Claudinho ou confirmados pelo portal), `document_id`
  (a foto da conta, opcional), `origin` (`digitado` · `lido_da_conta` ·
  `confirmado_no_portal`), `holder_mismatch`, `position`.
- `project_general_data.has_beneficiaries` **continua existindo** e passou a
  ser **derivado** por gatilho (true se há ≥ 1 linha) — dez lugares o leem.
- Documento `energy_bill_beneficiaries` é a foto da conta, ligada à linha.
  O upload múltiplo antigo saiu dos formulários; as 31 contas anteriores a
  22/10 continuam como documento solto (decisão do usuário: sem backfill).

## Regras de negócio

- **RN-SG-01** — A geradora **não é linha**: fica com 100 − soma. A soma das
  beneficiárias nunca passa de 100 (gatilho no banco).
- **RN-SG-02** — A mesma UC não entra duas vezes no projeto.
- **RN-SG-03** — Formato da UC por concessionária (`src/lib/beneficiarias.ts`):
  **CPFL = 12 dígitos**; demais, só dígitos até o formato ser confirmado.
- **RN-SG-04** — Quem edita: a **empresa** até o projeto entrar em análise
  (`status = pending`); a **equipe** até a criação na CPFL
  (`projects.cpfl_node_id`); depois, **ninguém**. É política RLS, não regra de
  tela. O formulário público (anon) só insere, em projeto `public_form` pendente.
- **RN-SG-05** — Quando a foto da conta vem, o Claudinho (`claudinho-verifica`)
  lê UC e titular; titular diferente do da geradora marca `holder_mismatch`,
  que **bloqueia a Ludmilla** (a RPC recusa com a UC na mensagem). Sem foto,
  o titular só é conferido pelo portal.
- **RN-SG-06** — Com ≥ 1 beneficiária, o sistema de compensação da CPFL é
  **Autoconsumo Remoto**; sem, **Geração Local**. Derivado no banco
  (`ludmilla_dados_criacao_cpfl.sistema_compensacao`), nunca fixo no worker.

## Telas
- Envio (`NewProject`, `PublicProjectForm`): `BeneficiariasForm` — linhas
  UC + % + foto, painel "fica com a geradora".
- Modal (aba de dados, abaixo da UC da geradora): `BeneficiariasBloco` —
  tabela editável, origem por linha, aviso do que a Ludmilla recusaria,
  travado após a CPFL.
- Painel "Criar na CPFL": mostra a modalidade e **desabilita** o botão com o
  motivo quando há titular diferente ou soma > 100.

## Ludmilla (CPFL)
Ver [ludmilla.md](../integrations/ludmilla.md) — seção "Autoconsumo remoto".

## Fora do escopo / futuro
- Sugerir o rateio pelas médias de consumo (pedido futuro do usuário).
- Titular PJ (o roteiro já recusa PJ).
- Beneficiária de **outro titular** (consórcio/cooperativa): o portal da CPFL
  recusa nesta modalidade; o dado comporta, o fluxo não.
- Confirmar o formato da UC das outras concessionárias (COPEL, Elektro,
  Coelba, Enel) e preencher `DIGITOS_POR_CONCESSIONARIA`.
