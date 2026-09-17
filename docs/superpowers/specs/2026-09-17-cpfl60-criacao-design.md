# Ludmilla — Criar projeto na CPFL (60 · Microgeração Distribuída BT · Orçamento de Conexão)

**Data:** 17/09/2026 · **Estado:** roteiro validado ponta a ponta à mão com o agent-browser
(projeto PRJ-14848 → node **546581** criado no portal). Este documento é a fonte para
reconstruir o robô do zero sobre a CLI `agent-browser`; nada aqui é chute — cada
seletor foi lido da tela real (mapas em `2026-09-17-cpfl60-mapa/etapa*.json`).

Fontes: PDF do usuário "Roteiro CPFL: Orçamento de Conexão MMGD" (16/09), skill
`cpfl-orcamento-conexao-mmgd`, e a sessão de mapeamento de 17/09 (este doc).

## 0. Decisões de arquitetura

| Item | Decisão |
|---|---|
| Ferramenta | CLI **agent-browser** (vercel-labs) chamada pelo worker da VPS; sessão nomeada por run (`--session criacao-<run_id>`), headless. Nunca a sessão compartilhada. |
| Login | Cofre do agent-browser alimentado pelo worker com a senha do **Vault do Supabase** via `auth save --password-stdin` (stdin, nunca argumento) → `auth login` → `auth delete` ao fim. A pessoa nunca digita senha; o chat nunca vê senha. |
| Seletores | Por **id** do Drupal (estáveis) — exceto depois de AJAX (Buscar da UC, Consultar do CPF), quando os ids ganham sufixo `--XxYy`: usar prefixo `[id^="…"]`. |
| Escolhas | Radios SEMPRE conferidos pelo texto do rótulo (Sim/Não trocam de código entre perguntas). Selects pelo **value** interno (tabela §5). |
| Números e datas | Por JS (`el.value = …` + eventos `input`, `keyup`, `change`) — o `fill` não dispara o cálculo dos totais e `type=date` ignora `fill`. |
| Antes de cada Avançar | Ler o **FormData** do formulário e conferir os campos-chave (tabela por etapa). O que a tela mostra não é o que o POST manda. |
| Sinal de etapa | Título da aba (`get title`), exceto na etapa 6 (título vem "Introdução" — sinal é a URL `?step=6` e os botões). |
| O que fica | Banco (`portal_criacao_passos`, `cpfl_node_id`, RPCs) e front (modal + /ludmilla). Varredura/recomendações **intocadas**. |
| Parar em | Etapa 6 "Envio de documentos": não clica Enviar Depois nem Avançar. Pessoa decide. |

## 1. Por onde começar (ordem obrigatória)

1. **Login** B2C: `https://www.cpfl.com.br/cpfl-auth/redirect-arame?redirect_uri=/Internet/Projeto`
   → `#signInName`, `#password`, `#next` → esperar URL sair de `b2clogin.com` → tela
   "Selecionar perfil" → clicar "Serviços para projetistas" → deve chegar em
   `gestao-projetos`. (Mesmo fluxo da varredura; não reescrever a varredura.)
2. **Idempotência**: se `projects.cpfl_node_id` já existe → não criar de novo (erro
   claro). Antes de criar, opcional: procurar em Meus Projetos → Orçamentos de
   Conexão um cartão com o mesmo título/UC e avisar.
3. **Formulário novo, sempre pelo menu** — NUNCA abrir `node/add/project_60` direto:
   o Drupal retoma o formulário meio preenchido da sessão anterior.
   `https://www.cpfl.com.br/gestao-projetos/criar-projeto` → link
   `a[href$="/node/add/project_60"]` ("60 - Microgeração Distribuída Baixa Tensão")
   → título `… - Introdução`.
4. **Introdução**: dois `Iniciar`. `#edit-next` = "Ligação nova com microgeração";
   `#edit-next-new-connection` = "Conexão de microgeração" (2º na tela). Clicar o da
   Conexão e **conferir** `#edit-field-flux-type-conexo` marcado; se não, foi o
   outro — voltar e clicar o outro. Título passa a `… - Dados da unidade consumidora`.

## 2. Etapa 1 — Dados da unidade consumidora

| # | Ação | Seletor | Não pode errar |
|---|---|---|---|
| 1 | Opção de orçamento | `#edit-field-quotation-options-60-connection` (Estimado: `…-estimated`) | rótulo começa com "Orçamento de Conexão" (a descrição do Estimado também cita esse texto) |
| 2 | Abrir sanfona "Necessidades do projeto" | botão com esse texto, `aria-expanded` | só clicar se `false` (clicar de novo fecha) |
| 3 | Mais de 1 medidor → Não | `#edit-field-multiple-energy-meter-0` | aqui `-0` = Não, `-1` = Sim |
| 4 | Ramal subterrâneo → Não | `#edit-field-entrance-underground-0` | idem |
| 5 | Medição no poste → Não | `#edit-field-measurement-fix-pole-0` | idem |
| 6 | Abrir sanfona "Insira os dados do local da unidade consumidora" | botão com esse texto | idem 2 |
| 7 | Nº da UC | `#edit-field-consumer-unit-0-consumer-unit-code` | formato `0.000.000.000-00` como no GD Manager |
| 8 | Buscar | `#edit-field-consumer-unit-0-send-uc-code` | AJAX: depois disto todos os ids do bloco ganham sufixo → `[id^=…]` |
| 9 | Esperar UC | `[id^="edit-field-consumer-unit-0-customer-name"]` com valor (≤ 10 s, 2 tentativas) | vazio = UC não encontrada → parar, não avançar |
| 10 | Conferir distribuidora | `[id^="edit-field-consumer-unit-0-uc-company-name"]` contém "CPFL" | outra empresa → parar |
| 11 | Latitude / Longitude | `[id^="edit-field-consumer-unit-0-latitude"]` / `…-longitude` | `20° 52' 45.7"` (módulo, DMS; a máscara completa `S`/`W`) — ficam vazias mesmo com a UC encontrada |
| 12 | Mudança no ponto de entrega → Não | `#edit-field-have-position-change-1` | aqui `-1` = Não, `-0` = Sim (invertido!) |
| 13 | Extensão de fase → Não | `#edit-field-necessitie-extension-fase-1` | idem |
| 14 | Perguntas condicionais | "Já possui projeto aprovado?" (`field_approved_project`), "UC ou Medidor do Vizinho?" (`field_neighbor_install_number`) | escondidas na gravação; se **visíveis** → parar e perguntar (chaves `autonomia.ja_possui_projeto_aprovado`, `uc_medidor_vizinho`) |
| 15 | Avançar | `#edit-next` (POST normal) | título `… - Dados do projeto` |

Guardar no resultado do run (auditoria, sem sair do portal): Classe, Faseamento
(`VAN` = monofásico fase-neutro… conferir com o projeto), Categoria cadastrada, Carga
Atual, Demanda Atual, Empresa.

## 3. Etapa 2 — Dados do projeto (a etapa que mais engana)

Sanfonas: "Dados do projeto" (aberta), "Categorias do projeto" e "Dados complementares
de geração" (fechadas — abrir pelo botão com o texto). Ao carregar, o próprio portal
dispara um XHR "Calcular" (`?ajax_form=1`) — esperar a rede aquietar antes de mexer.

| Campo | Seletor | Valor (PRJ-14848) | Origem no GD Manager |
|---|---|---|---|
| Título do Projeto | `#edit-title-0-value` | IRENE SOARES NAVA | `projects.title` (ou "UFV + titular") |
| Alteração de carga | `#edit-field-consume-alteration-0` (Não) | Não | autonomia |
| Fonte geradora | `#edit-field-generating-source` = `2721` | ENERGIA SOLAR | fixo |
| Data prevista para ligação | `#edit-field-line-connection-date-0-value-date` (type=date) | hoje + 30 | JS `value='AAAA-MM-DD'` + eventos |
| Sistema de Compensação | `#edit-field-compensation-system` = `2771` | Geração Local | autonomia |
| Categoria Existente | `#edit-field-exists-category` = `B1` | B1 | `resolveEntryRule` (RPC v2) |
| Nome da usina | `#edit-field-power-plant-name-0-value` | = título | |
| Outorga ou Registro | `#edit-field-grant-or-registration-0` (Não) | Não | autonomia |
| Padrão de entrada | `#edit-field-input-standard` = `2761` | categoria – GED 13 | autonomia |
| Tipo de atendimento | `#edit-field-service-type` = `2866` | aéreo | autonomia |
| Nº de fases da UC | `#edit-field-phase-number` = `2751` | Bifásico | `phase_type` (2746 Mono, 2751 Bi, 2756 Tri) |
| **Cabos** | `#edit-field-cabless-0-value` | **2** | **quantidade de fases** (regra do usuário 17/09), NÃO bitola |
| Caixa de medição | `#edit-field-cx-electrical-0-value` | TIPO II | regra: `caixa_medicao` |
| Carga instalada (kW) | `#edit-field-load-installed-0-value` | 14 | regra: `extra.Demanda` |
| Disjuntor (A) | `#edit-field-circuit-breaker-a-0-value` | 63 | regra: `disjuntor` |
| Fonte (geração) | `#edit-field-complementary-generation-0-subform-field-generating-source` = `651` | ENERGIA SOLAR | fixo |
| Data entrada em operação | `…-subform-field-generate-installation-date-0-value-date` | hoje + 30 | JS |
| Qtd. módulos | `…-subform-field-modules-0-modules-qt` | 8 | `module_quantity` |
| Fabricante módulos | `…-modules-0-module-manufacturer` | TCL | `module_brand` |
| Modelo módulos | `…-modules-0-module-model` | HSM-ND66-GR620 | `module_model` |
| Potência de pico (kWp) | `…-modules-0-modules-power-peak` | 0.62 | `module_power / 1000`, ponto decimal |
| Área arranjos (m²) | `…-subform-field-generation-arr-occup-area-0-value` | 24 | `módulos × 3` (autonomia `m2_por_modulo`) |
| Qtd. inversores | `…-subform-field-inverters-0-inverter-quantity` | 2 | `inverter_quantity` |
| Fabricante inversores | `…-inverters-0-inverter-manufacturer` | HOYMILES | `inverter_brand` |
| Modelo inversores | `…-inverters-0-inverter-model` | HMS-2250DW-4T | `inverter_model` |
| Conexão do inversor | `…-inverters-0-inverter-connection` = `Bifásico` (value é o texto) | Bifásico | fases |
| Potência nominal (kW) | `…-inverters-0-inverter-rated-power` | 2.25 | `inverter_power` |

**Conferência obrigatória antes do Avançar (FormData, nunca a tela):**
`modules_qt`, `modules_power_peak`, `modules_total_row` (= qt×pico, ex. 4.96),
`field_generation_power_peak`, `inverter_quantity`, `inverter_rated_power`,
`inverter_total_row` (4.5), `field_inverters_rated_power`, `field_total_gene_nominal_power`,
`field_generator_installed_power` (4.500), as duas datas. Qualquer um vazio ou `0` →
re-setar qt/pico/quantidade/potência por JS com eventos e conferir de novo. Foi
exatamente isto que travou o dia 17: a tela dizia 4,96 e o POST mandava `0`.

Validação client-side do Avançar (`Drupal.behaviors.p60_step3`): Categoria ≠ none; se
alteração de carga = Sim, exige equipamentos na tabela. Erros do servidor voltam na
mesma etapa com `Campo obrigatório!` (`.invalid-feedback`) e `aria-invalid` no campo —
ler o HTML da resposta do POST e **nomear o campo** no erro do passo.

Avançar `#edit-next` → título `… - Dados do cliente`.

## 4. Etapa 3 — Dados do cliente

| # | Ação | Seletor | Não pode errar |
|---|---|---|---|
| 1 | Tipo de pessoa | `#edit-field-natural-juridical-person-fisica` já marcado (CPF 11 dígitos) | PJ (CNPJ) usa `field_juridicalperson` — **não mapeado**: parar e perguntar |
| 2 | Consultar CPF | `#edit-field-physicalperson-0-send-physical-person` | AJAX → sufixos; esperar `[id^="edit-field-physicalperson-0-name"]` com valor |
| 3 | Telefone/Celular/E-mail | `[id^="…-telephone"]`, `[id^="…-cell"]`, `[id^="…-email"]` | vêm do **cadastro CPFL** — só preencher se vazio (celular e e-mail obrigatórios); nunca sobrescrever |
| 4 | Endereço p/ correspondências | `[id^="edit-field-address-type-mesmo"]` (Endereço da instalação) | |
| 5 | Endereço do cliente | `[id^="edit-field-customer-address-type-mesmo"]` (aparece depois do 4) | |
| 6 | Autoriza contratos com o orçamento → Sim | `[id^="edit-field-authorize-pay-connec-costs-1"]` | aqui `-1` = **Sim** (o inverso da etapa 1) |
| 7 | Contagem de prazo da vistoria → Sim | `[id^="edit-field-solicitacao-de-vistoria-1"]` | idem |
| 8 | Avançar | `#edit-next` | título `… - Revisão do projeto` |

## 5. Etapa 4 — Revisão → Salvar

Print da revisão (é a prova). `#edit-prev` Voltar, `#edit-send-change--N` Alterar por
seção, **`#edit-next-save-draft` = Salvar**. Depois do Salvar a URL vira
`/gestao-projetos/node/<ID>/edit?new=true&step=6` → gravar `<ID>` em
`projects.cpfl_node_id` (RPC `ludmilla_salvar_node_cpfl`). Salvar **uma vez só**.

## 6. Etapa 5 — Envio de documentos (parar)

Título vem "Introdução" (bug do portal); sinal = URL `step=6` + botões
`#edit-next-send-later` (Enviar Depois) e `#edit-next` (Avançar). 27 inputs de arquivo
(`files[field_*]`), os de GD: `field_tech_responsibility_doc_0` (ART/TRT),
`field_electrical_project_0` (projeto + memorial), `field_single_line_diagram_0`
(unifilar), `field_inverter_certificate_0`, `field_needed_aneel_docs_0` (Anexo F),
`field_itr_or_ccir_0` (IPTU/ITR), `field_rg_rne_0` (RG/CPF). **Fase seguinte**: subir
do GD Manager os documentos do projeto (conversar antes). Hoje: parar e mostrar.

## 7. Como a Ludmilla aprende a cada execução

- Cada passo grava print + `etapa-N.campos.json` (mapa da tela: id/name/rótulo/
  pergunta/visível/opções) na pasta do run no bucket — igual ao `mapa.js` deste doc.
- Antes de cada Avançar, grava o **FormData** dos campos-chave; depois, se a etapa não
  mudou, grava a resposta do POST com os campos `aria-invalid` e as mensagens
  `Campo obrigatório!` → o erro no modal diz **qual campo** e por quê.
- Pergunta nova na tela (grupo visível que não está no roteiro) → passo em erro com
  a pergunta e a chave de `autonomia` para responder.
- Valores lidos da UC/CPF (classe, faseamento, categoria, telefone) entram no
  `resultado` do run para comparação com o GD Manager (divergência = aviso, não erro).

## 8. Checklist "onde não pode estar errado"

1. Começar sempre em `criar-projeto` → 60 → Introdução (formulário limpo).
2. Introdução: `flux_type = conexão` conferido depois do Iniciar.
3. Orçamento de **Conexão**, pelo rótulo.
4. Sim/Não pelo rótulo (código invertido entre perguntas e entre etapas).
5. UC encontrada (Nome do Cliente preenchido) e Empresa = CPFL.
6. Lat/Long em DMS sem sinal; Cabos = nº de fases; Categoria = regra do front.
7. Datas e números por JS + eventos; FormData conferido antes de cada Avançar.
8. Nunca sobrescrever telefone/celular/e-mail vindos do Consultar.
9. Salvar uma vez; node gravado; parar em Envio de documentos.
10. Sessão própria, cofre limpo ao fim, prints sem sair do bucket privado.
