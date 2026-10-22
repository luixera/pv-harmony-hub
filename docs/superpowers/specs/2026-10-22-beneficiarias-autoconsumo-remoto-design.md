# Unidades beneficiárias e criação na CPFL em autoconsumo remoto

> Decidido com o usuário em 21–22/10/2026, a partir das telas do portal CPFL
> (Gestão de Projetos, projeto 60) que ele mostrou. Beneficiária vira **dado
> estruturado** do projeto (tabela própria), editável no envio e no modal, com
> as **mesmas regras que o portal aplica** conferidas antes de a Ludmilla
> começar. A regra é **genérica** — "não vale apenas para a CPFL; estamos
> deixando preparado para automações futuras em outras concessionárias" —
> e só a pré-checagem e o roteiro são da CPFL.
>
> Decisões do usuário nesta ordem: (a) eu faço tudo, inclusive o roteiro do
> worker; (b) os 28 projetos que já têm beneficiárias **ficam como estão**
> (sem ler o acervo de contas); (c) a **empresa integradora edita** as
> beneficiárias no modal até o projeto entrar em análise; depois, só a
> equipe; depois da criação na CPFL, ninguém.

## Por que

Hoje a Ludmilla cria o projeto na CPFL apenas em "Microgeração Distribuída
Com Geração Local" — o `sistema_compensacao` é fixo (`2771`) nas respostas
autônomas do roteiro. O usuário precisa criar em **"Microgeração Distribuída
Caracterizada Como Autoconsumo Remoto"**: a geradora manda a sobra dos
créditos para unidades **beneficiárias**, e o portal exige, por beneficiária,
o **número da UC** e o **percentual** de rateio.

No GD Manager, beneficiária é só um booleano (`has_beneficiaries`) e um
upload múltiplo de contas de energia. Não há UC nem percentual como dado —
então não há como preencher o formulário sem alguém reler as fotos na hora, e
é aí que "corre o risco de preencher errado ou dar erro". A doc do módulo de
geração compartilhada já listava a entidade estruturada como melhoria futura.

Medido no banco em 22/10/2026: **28 projetos** com beneficiárias (CPFL 13,
COPEL 5, Elektro 4, Coelba 2, Enel 1), 31 contas anexadas, 2 projetos já
criados na CPFL.

## 1. O princípio: a regra do portal vale antes de a Ludmilla começar

Tudo o que o portal recusa deve ser recusado antes, no GD Manager, onde dá
para corrigir com calma. O que o portal CPFL faz (telas de 21/10/2026):

| Regra do portal | Onde o GD Manager aplica |
|---|---|
| A UC tem 12 dígitos (aceita "1.260.283.036-50", mostra `126028303650`) | formulário e modal, **só para CPFL** (§7) |
| Soma dos percentuais de geradora + beneficiárias = 100% | soma das beneficiárias ≤ 100 (gatilho); o **resto é da geradora** e aparece sempre |
| A UC tem de pertencer ao cliente (mesmo titular) | quando o titular é conhecido (conta lida), bloqueia a Ludmilla; quando não, o portal confere e o erro volta com a UC |
| Percentual com 4 casas ("70,0000%") | `numeric(7,4)`, exibido à brasileira |
| "Percentual da sua microgeradora" é calculado pelo portal | o roteiro **confere** esse número contra o resto calculado antes de avançar |

A geradora "também beneficiária" **não é uma linha**: é o percentual que
sobra. Nunca criar linha da geradora na lista.

## 2. O dado — `project_beneficiaries`

| Coluna | Tipo | Nota |
|---|---|---|
| `id` | uuid | |
| `project_id`, `tenant_id` | uuid | isolamento; `tenant_id` copiado do projeto por gatilho |
| `uc_number` | text | **normalizado: só dígitos**; a tela mostra formatado |
| `percent` | numeric(7,4) | `> 0 and <= 100` |
| `holder_name`, `holder_doc`, `address` | text, nulos | preenchidos pelo Claudinho (§6) ou pelo portal (§8); nunca obrigatórios |
| `document_id` | uuid, nulo | FK em `documents` (tipo `energy_bill_beneficiaries`) — a foto, opcional |
| `origin` | text | `digitado` · `lido_da_conta` · `confirmado_no_portal` |
| `holder_mismatch` | boolean | o titular lido difere do da geradora (§6) |
| `position` | smallint | ordem de cadastro — é a ordem em que a Ludmilla digita |
| `created_by`, `created_at`, `updated_at` | | |

Restrições: `unique (project_id, uc_number)` (a mesma UC não entra duas
vezes); gatilho `BEFORE INSERT/UPDATE` que recusa quando a **soma do projeto
passa de 100**; `check (uc_number ~ '^\d+$')`.

`project_general_data.has_beneficiaries` **continua existindo** — dez lugares
o leem (checklists, pacote do instalador, formulários). Passa a ser mantido
por gatilho: `true` se o projeto tem ≥ 1 linha, `false` se não. Ninguém mais
o escreve diretamente.

O upload múltiplo "Contas de energia das unidades beneficiárias" **sai dos
formulários**: a foto por linha o substitui, gravada com o **mesmo**
`document_type`, agora ligada à linha por `document_id`. Documentos antigos
desse tipo (31) continuam onde estão, sem linha — decisão (b).

## 3. Quem edita — RLS

Isolamento por tenant (RESTRICTIVE, como as tabelas vizinhas). Depois:

| Quem | Lê | Escreve |
|---|---|---|
| admin / staff do tenant | sim | sim, **até** o projeto ter `cpfl_node_id` |
| usuário de empresa (dono do projeto) | sim | sim, **enquanto** `projects.status = 'pending'` (antes da análise) **e** sem `cpfl_node_id` |
| projeto vindo do formulário público (`source = public_form`) | — | não há usuário de empresa; só a equipe edita |
| **anônimo, no envio público** | não | **INSERT apenas**, na mesma transação do envio — espelho da política "Anonymous can insert project data" que `project_general_data` já tem; sem ela o formulário público quebra |
| master | tudo | tudo |

A trava do `cpfl_node_id` é **do banco** (política de escrita), não da tela.
Depois da criação na CPFL, alterar beneficiária aqui não altera lá — então
não altera aqui.

## 4. Formulário de envio

Um componente só, **`BeneficiariasForm`**, usado em `NewProject` e
`PublicProjectForm` (hoje o checkbox e o upload estão duplicados nos dois).

- O checkbox "Existem unidades beneficiárias?" abre o bloco.
- Cada linha: **nº da UC** · **percentual** · **conta de energia (opcional)** ·
  remover. Botão "Adicionar beneficiária".
- Validação na hora, por linha e no conjunto: formato da UC (§7), percentual
  entre 0 e 100 com até 4 casas (digitado à brasileira — reaproveita a
  lógica de `valorBR`), **soma ≤ 100**.
- Painel sempre visível: "Beneficiárias somam X% · **Fica com a geradora:
  Y%**", com barra. É a forma de a geradora "também ser beneficiária".
- Com o checkbox marcado, **pelo menos uma linha válida** é obrigatória para
  enviar. Linha inválida bloqueia o envio com a mensagem apontando qual.
- Na gravação: o projeto nasce, as linhas entram com `origin = 'digitado'`,
  e cada foto sobe como documento ligado à linha. Se a foto veio, o Claudinho
  lê (§6) depois do envio, sem segurar o formulário.

## 5. Modal do projeto

Bloco **Beneficiárias** dentro da aba de dados do projeto, logo abaixo da UC
e do titular da geradora — é ao lado deles que faz sentido, e evita cirurgia
na estrutura de abas do modal (o mockup mostrou uma aba só para ilustrar;
o conteúdo é o mesmo): tabela com UC, titular/endereço,
percentual editável, **origem** (`digitado` / `lida da conta` / `confirmada
no portal` / `titular diferente`), remover, "Adicionar"; o mesmo painel de
soma e resto; e, quando há problema que impede a Ludmilla, um aviso que diz
**qual UC** e **o quê**.

Depois da criação na CPFL: tudo somente leitura, com o aviso "criado na CPFL
em <data> (nº <node>) em autoconsumo remoto; as beneficiárias abaixo são as
que o portal aceitou" e a linha-resumo "Geradora (resto): Y%".

Quem vê o bloco: as três telas (empresa, equipe, master) — a regra de quem
edita é a do §3.

## 6. O Claudinho lê a conta da beneficiária

Quando uma foto entra numa linha (no envio ou no modal), a função
`claudinho-verifica` — que já extrai `uc_number` e titular de conta de
energia, com a regra de "atenção máxima" à UC — lê a conta e:

- preenche `holder_name` e `holder_doc` (e `address` quando vier) na linha,
  `origin = 'lido_da_conta'`;
- se a **UC lida** difere da digitada, a tela avisa e deixa a pessoa escolher
  (não sobrescreve sozinho — a UC é a chave);
- se o **documento do titular lido** difere do `holder_cpf_cnpj` da geradora,
  marca `holder_mismatch = true`. É o erro que o portal recusa, descoberto
  antes.

Sem foto, a linha fica `digitado` e o titular só será conferido pelo portal.
Isso é aceito: foto é opcional por decisão do usuário.

## 7. Formato da UC por concessionária

O dado é genérico; o **formato** não. Cada concessionária numera a UC do seu
jeito, e travar "12 dígitos" para todas impediria o envio de um projeto da
COPEL.

| Concessionária | Formato validado | Fonte |
|---|---|---|
| CPFL | **12 dígitos** | telas de 21/10/2026 |
| as demais | **só dígitos**, sem tamanho fixo | formato não confirmado — não inventar |

A regra mora num ponto único (`src/lib/ucBeneficiaria.ts`, com teste) que
recebe a concessionária do projeto e devolve "válida / inválida + motivo".
Quando o usuário confirmar o formato de outra concessionária, entra ali.

## 8. RPC e roteiro da Ludmilla (só CPFL)

**`ludmilla_dados_criacao_cpfl`** passa a devolver:

- `sistema_compensacao`: `'autoconsumo_remoto'` se o projeto tem ≥ 1
  beneficiária, `'geracao_local'` se não. **Deixa de ser o `2771` fixo** em
  `AUTONOMIA_PADRAO`; o código do select é lido do portal pelo rótulo.
- `beneficiarias jsonb`: `[{ "uc": "126028303650", "percentual": 30.0000 }]`
  na ordem de `position`.
- **Recusa** (exceção com a UC no texto) se alguma linha tem
  `holder_mismatch` ou se a soma passa de 100 — a Ludmilla nem começa.

**Roteiro `roteiro-cpfl60.ts`:**

- Passo 3 `dados_projeto`: escolher o sistema de compensação **pelo texto do
  rótulo** ("…Autoconsumo Remoto" / "…Com Geração Local") — regra aprendida
  a ferro em 16/09: nunca pelo código numérico.
- Passo 4 `dados_cliente`, depois dos dois "Sim": se autoconsumo remoto,
  marcar **Percentual**; para cada beneficiária: digitar a UC → **Buscar** →
  esperar a **linha com aquela UC** aparecer → preencher o percentual →
  próxima. Se o portal recusar a UC (não é do cliente), o passo falha com
  `ErroLudmilla('falhou', 'A CPFL recusou a UC <n>: não pertence ao
  titular')`. Ao fim, ler "Percentual da sua microgeradora" e **conferir**
  que é igual a `100 − soma`; se não for, falha **antes** do Avançar.
- Com cada linha confirmada, a Ludmilla **escreve de volta** na
  `project_beneficiaries`: `address`, `holder_name`, `holder_doc` como o
  portal devolveu, `origin = 'confirmado_no_portal'`. O modal passa a mostrar
  o que a CPFL reconheceu.
- Passo 5 em diante: igual.

**Primeira tarefa da implementação é mapear os seletores do bloco** (rádio
Percentual, campo da UC, Buscar, as linhas e seus campos de %, a lixeira, o
texto do percentual da geradora) numa rodada **simulada** (`simular = true`,
para antes do Salvar) num projeto real do usuário. Os ids não são conhecidos
hoje e **não serão inventados** — o roteiro de setembro só funcionou depois
do mapa de 17/09, e o bloco de beneficiárias não está nele.

## 9. Fora do escopo

- Ler o acervo das 31 contas para preencher os 28 projetos (decisão (b)).
- Sugerir o rateio pelas médias de consumo (futuro declarado pelo usuário).
- Titular **PJ**: o roteiro já recusa PJ no passo 4; continua.
- Roteiros de outras concessionárias: o dado fica pronto, o consumo não.
- Criar projeto em geração compartilhada com **titulares diferentes**
  (consórcio/cooperativa): a regra desta rodada é "mesmo titular", como o
  portal da CPFL exige na modalidade autoconsumo remoto.

## 10. Como se prova

- **vitest**: `ucBeneficiaria` (formato por concessionária), soma/resto
  (arredondamento em 4 casas, soma exatamente 100, soma > 100), leitura do
  percentual à brasileira ("30", "30,5", "30,0000%", "30.5" → 30.5).
- **SQL em `begin/rollback`** com impersonação: empresa escreve em `pending`
  e não em `analysis`; staff escreve até `cpfl_node_id` e não depois; o
  gatilho recusa soma > 100 e UC duplicada; `has_beneficiaries` acompanha as
  linhas; `ludmilla_dados_criacao_cpfl` devolve `autoconsumo_remoto` com
  linhas e `geracao_local` sem, e recusa com `holder_mismatch`.
- **Ludmilla simulada** até antes do Salvar num projeto com 2 beneficiárias
  do mesmo titular, com o usuário conferindo o print da revisão (a geradora
  com o resto certo) na estação.
- `tsc` no baseline de 65, build, e os 170 testes existentes.

## 11. Riscos e o que ainda não sei

- **Seletores do portal** para o bloco de beneficiárias: desconhecidos (§8).
- **Formato da UC das outras concessionárias**: desconhecido; a validação
  fica permissiva até ser confirmado (§7).
- O portal pode devolver o titular com **grafia diferente** da conta (ex.
  abreviado). O write-back guarda o que o portal devolveu; a comparação de
  titular (§6) é pelo **documento**, não pelo nome.
- **Ordem** em que o portal lista as linhas pode não ser a de digitação; por
  isso o roteiro procura a linha **pela UC**, não pela posição.
