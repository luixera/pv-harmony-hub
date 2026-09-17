# Ludmilla — acompanhamento dos portais das concessionárias

> Estado: 🟡 CPFL funcionando ponta a ponta (set/2026): robô na VPS lê os
> protocolos, o banco gera recomendações, a página /ludmilla aplica/ignora,
> agendamento 2×/dia. Elektro: **estação local** (PC do coworking) construída
> e testada com portal de mentira — aguarda o aceite na máquina de verdade.
> Só tenant GD Manager (`is_library`).
> Specs: [2026-09-14-ludmilla-design.md](../../superpowers/specs/2026-09-14-ludmilla-design.md) ·
> [2026-09-15-ludmilla-elektro-local-design.md](../../superpowers/specs/2026-09-15-ludmilla-elektro-local-design.md)

## O que é

Funcionária como o Bidu (usuária `staff`, sem senha, id
`00000000-10d1-4000-8000-000000000002`). Entra nos portais de projetos das
concessionárias, **lê** o status dos protocolos e devolve **recomendações**
numa página de relatório; uma pessoa aplica ou ignora. Nunca escreve no
portal, nunca move card sozinha, nunca resolve CAPTCHA.

## Banco (`20260914120000_ludmilla.sql`)

| Objeto | Papel |
|---|---|
| `portal_accounts` | login por concessionária; **senha no Vault** (`secret_id`) |
| `portal_sync_runs` | fila + histórico (`na_fila → rodando → ok/erro`), erro em português, print |
| `portal_updates` | linhas do relatório (sub-projeto 2 preenche) |
| `portal_status_map` | status do portal → etapa do Kanban |
| bucket `ludmilla` | prints, pasta = `tenant_id` |
| `set_portal_credentials(concessionaire_id, login, senha)` | só admin; grava no Vault, nunca devolve |
| `ludmilla_portal_credentials(account_id)` | **só `service_role`** — único caminho de leitura da senha |
| `ludmilla_pedir_run(account_id, tipo)` | equipe; não empilha pedido igual |
| `ludmilla_claim_run()` / `ludmilla_finalizar_run(...)` | só `service_role`; `FOR UPDATE SKIP LOCKED` |

RLS: RESTRICTIVE por tenant + `ludmilla_equipe_ok()` (admin/staff de tenant
`is_library`). Provado por impersonação (9 checagens) e o caminho do Vault
(grava, tabela não expõe, robô lê a senha atualizada).

## Robô (`worker/ludmilla/`)

Node 22 + Playwright. `index.ts` faz o laço: `ludmilla_claim_run` a cada 30 s
→ contexto NOVO de navegador por run → conector → `ludmilla_finalizar_run`
com resultado e print. `erros.ts` classifica toda falha (`login_recusado`,
`sessao_expirada`, `captcha_exigido`, `pagina_mudou`, `bloqueado_por_waf`,
`falhou`) em frase para a tela + efeito na conta. `reconhecer.ts` descreve a
tela de login sem credencial (CAPTCHA por assinatura de iframe/script, campos
visíveis, WAF por status/título). Conectores em `conectores/` — interface
`{ chave, loginUrl, reconhecer, varrer }`.

Testes: `npm test` (node:test; o de reconhecimento serve HTML em localhost e
**bloqueia a rede** — assinaturas do Google/Cloudflare são só texto).

Deploy: workflow manual `.github/workflows/ludmilla-worker.yml` → rsync para
`/opt/ludmilla` + `deploy/instalar.sh` (Node 22, usuário `ludmilla`, Chromium,
`/etc/ludmilla/env` 600, unit systemd `ludmilla-worker`). Segredos: os da VPS
+ `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`.

## Tela "Acesso ao portal" e teste de acesso (14/09/2026)

Na aba Concessionárias, o ícone de chave (só equipe GD Manager) abre
`PortalAcessoDialog`: login + senha (só admin grava; a senha vai ao Vault e não
volta), situação da conta, e os botões **Testar acesso** e **Só reconhecer a
tela**. O run `teste_login` entra com a credencial, PARA depois da senha e
devolve um veredito (`worker/ludmilla/src/veredito.ts`): `entrou`,
`pediu_codigo_email`, `pediu_codigo_sms`, `senha_recusada` (vira erro da
conta) ou `desconhecido` — sempre com print. É a descoberta do segundo fator
feita pelo próprio robô, sem a sessão do navegador do usuário. A tela lista
as últimas visitas e mostra o print por URL assinada do bucket.

## O que o reconhecimento mostrou (14/09/2026, da máquina de dev)

- **CPFL**: login em **Azure AD B2C** (`cpflb2cprd.b2clogin.com`), política
  `B2C_1A_SIGNUP_SIGNIN_MFA_FRONT`. Sem CAPTCHA. Campos `signInName`
  (e-mail) e `password`. O "MFA" no nome indica segundo fator — só a
  descoberta logada diz se é em todo login ou só em dispositivo novo.
- **Elektro (Portal GD Neoenergia)**: **403 Access Denied (Akamai)** com
  Chromium headless, com Chrome real e com `navigator.webdriver=false`. O
  bloqueio é na borda, por impressão digital do cliente; de uma VPS seria
  igual ou pior. **Robô na VPS não serve para a Elektro.** Alternativas: o
  portal envia e-mail por etapa (o Claudinho dos e-mails já lê), ou a sessão
  do próprio navegador do usuário.

## Varredura → recomendações → relatório (14/09/2026)

- **`varrer` da CPFL** (`worker/ludmilla/src/conectores/cpfl.ts` +
  `cpfl-lista.ts`): login B2C → cartão "Projetos Particulares" → abas
  *Orçamentos de conexão* e *Análise prévia* → 200 por página → lê os
  `AccordionItem[data-status]` (nome, nota de serviço/**atividade** =
  protocolo, serviço, datas do painel, link "Ver projeto"). Primeira varredura
  real: 199 protocolos em 51 s, 47 casando com `projects.protocol_number`.
  Teste sobre fixture real (`test/fixtures/cpfl-lista.html`).
- **`ludmilla_registrar_varredura`** (chamada por `ludmilla_finalizar_run`):
  guarda o último estado por protocolo em `portal_protocol_state`, casa pelo
  número, traduz por `portal_status_map` (semeado: Aprovado→approved,
  Reprovado→pendencia) e cria `portal_updates` quando (a) o status mudou
  desde a última varredura ou (b) na primeira vez, a tradução aponta etapa
  **à frente** da atual (`ludmilla_recomendacao_vale` — sem isso a primeira
  leitura gerou 17 linhas de ruído em 23: projetos concluídos com "Aprovado").
- **Sino**: trigger em `portal_updates` notifica o projetista atribuído (ou
  os admins) com `type='ludmilla'`.
- **Página /ludmilla** (`src/pages/Ludmilla.tsx`): contas com "Verificar
  agora", relatório com filtros, **Aplicar** (etapa recomendada ou outra;
  `ludmilla_aplicar_update` move o card e grava comentário + histórico com a
  pessoa como autora e a Ludmilla como origem) e **Ignorar**. Item "Ludmilla"
  na sidebar com contador de pendentes.

## CPFL pela API interna, ciclo de vistoria, anexos e casamento (15/09/2026)

A descoberta capturou a **API JSON** que o app React da CPFL consome
(`/gestao-projetos/api/drupalApi/ServerSide?...&endpoint=<rota>`, mesma
sessão logada). A varredura deixou de ler a tela (`cpfl-api.ts`):

| Rota | Uso |
|---|---|
| `/api/external/getprojetosorcamentoconexao` (200/página) | lista com **status detalhado** (`status`, partes por `\|`) e `codigoProjeto` |
| `/api/internal/getdetalhesparecer/{codigoProjeto}` | pareceres (texto da CPFL) |
| `/api/internal/detalhesprojeto?params[numeroProtocolo]=` | `numeroInstalacao` / `numeroInstalacaoNova` = **UC** |
| `/api/internal/detalhesprojeto/cliente/{codigoProjeto}` | titular: `numeroDocumento` (CPF/CNPJ), nome |
| `/api/internal/detalhesprojeto/anexos/{codigoProjeto}` | anexos; os da CPFL têm `tipoProjeto = "ANEXOS CPFL"` |
| `/api/arquivos/baixararquivo/{idArquivo}` | conteúdo em base64 (`conteudoArquivo`) |

Só GET. `encerrarprojeto` (PUT) e "solicitar vistoria" **nunca** são chamados
(a vistoria automática está combinada para conversa futura).

**Ciclo da CPFL** (regras do usuário): "Aprovado" no selo ≠ concluído. O
status detalhado diz onde está: `PROJETO ENCERRADO` = vistoria concluída →
`completed`; `DOCUMENTOS APROVADOS | SOLICITAR VISTORIA` = aprovado
(o selo mostra "Pendente"!) → `approved`; `ORÇAMENTO DE CONEXÃO EMITIDO E
AGUARDANDO APROVAÇÃO DO CLIENTE` / `AGUARDAR EXECUÇÃO DE OBRA` = aprovado com
adequação (inversão de fluxo) → `approved`; `VISTORIA E CONEXÃO EM EXECUÇÃO`
→ `vistoria_solicitada`; `VISTORIA REPROVADA…` → `vistoria_reprovada`;
`DOCUMENTOS INDEFERIDOS` → `pendencia`. Mapa em `portal_status_map`
(normalizado por `ludmilla_normalizar_status`). "Etapa à frente" segue a
**ordem do Kanban** do tenant (`ludmilla_ordem_etapa`). Escopo:
`portal_accounts.etapas_acompanhadas` (padrão analysis, approved,
vistoria_solicitada — concluídos fora).

**Anexos no card**: para projeto casado pelo número e com **titular (CPF/CNPJ)
ou UC conferidos** contra `project_general_data`, o banco enfileira em
`portal_anexos`; o robô baixa na mesma sessão, sobe em `project-documents`
(`{empresa}/{projeto}/other_photos/…`, o caminho dos anexos de comentário),
registra em `documents` e comenta no card como Ludmilla. Sem conferência →
`bloqueado` com motivo. Primeira execução: 28 autorizados, 20 enviados
(limite por visita), 0 bloqueados.

**Concluído só com vistoria aprovada** (15/09): `PROJETO ENCERRADO` não basta
(existe o botão "Encerrar projeto"). O robô lê os pareceres
(`lerPareceresCpfl`, ligados às análises ORÇAMENTO/VISTORIA/CONEXÃO por
`codigoInboxGrupo`) e grava `raw.vistoriaAprovada` = último parecer de
vistoria/ligação aprovado. `completed` só com `sim`; sem a prova, a linha
entra sem recomendação e ganha "concluído" quando o parecer confirmar. Quais
protocolos detalhar: os que mexeram em 45 dias ∪
`ludmilla_protocolos_de_interesse` (projetos acompanhados pela conta).

**Pareceres no card**: cada "Mostrar parecer" vira um comentário da Ludmilla
("📡 Parecer da CPFL — data · análise · status" + texto), uma vez só
(`portal_pareceres`, chave = `codigoInboxUsuario`), com a mesma conferência
de titular/UC dos anexos. Primeira execução: 56 pareceres.

**Reprovado reenviado sob protocolo novo**: protocolo sem par é casado por
CPF/CNPJ, UC ou título igual ao de outro protocolo já casado da conta;
vira recomendação com `atualizar_protocolo` — Aplicar grava o número novo.

**Armadilhas**: a API só responde depois de clicar em "Projetos
Particulares" (é o que abre a sessão do app); a tela do projeto não renderiza
no headless shell e o Chromium completo cai (SIGTRAP no crashpad sob o
systemd) — por isso API; `getUserData` devolve um token de sessão → corpos
capturados são limpos de `token` antes do bucket; a data dos anexos vem
d/m/aaaa e a da lista m/d/aaaa.

## Estação local e Elektro (15/09/2026)

**Por quê.** O Portal GD da Elektro (`gdneoenergiaelektro.neoenergia.com`)
devolve 403 (Akamai) a qualquer cliente que não seja um Chrome de verdade em
IP de pessoa, e o login (JSF/PrimeFaces) tem CAPTCHA de imagem. A Ludmilla
não resolve CAPTCHA (decisão firme, pedida duas vezes e recusada). Saída
combinada com o usuário: o **mesmo robô** roda num PC Windows do coworking
("estação local"), a Ludmilla preenche e-mail e senha do cofre e **uma pessoa
digita o código**.

**Banco (`20260915170000_ludmilla_estacao_local.sql`).** `portal_accounts`:
`modo` (`vps`|`local`), `operador_local` (uuid do staff com quem a estação
entra no GD Manager), `estacao_vista_em` (batimento). A estação **não tem
service role**: usa RPCs `_local` (`ludmilla_claim_run_local`,
`ludmilla_finalizar_run_local`, `ludmilla_portal_credentials_local`,
`ludmilla_anexos_pendentes_local`, `ludmilla_anexo_enviado_local`,
`ludmilla_anexo_erro_local`, `ludmilla_protocolos_de_interesse_local`,
`ludmilla_estacao_pulsa`) que só passam quando `operador_local = auth.uid()`
e a conta é `local`; `ludmilla_registrar_varredura` aceita service role OU o
operador. Storage: políticas de INSERT para o operador em `ludmilla` (pasta do
tenant) e `project-documents`. Conta local que fecha `sessao_expirada`
(ninguém digitou) → sino para os admins. `ludmilla_agendar_varreduras()` +
cron `ludmilla-08h` (`0 11 * * *` UTC) e `ludmilla-17h` (`0 20 * * *` UTC)
enfileiram uma varredura por conta configurada, sem empilhar. Testado por
impersonação (11/11).

**Robô — modo local (`LUDMILLA_MODO=local`, `src/local.ts`).** Cliente
supabase com a chave pública + sessão do usuário operador guardada em
`%LOCALAPPDATA%\Ludmilla\sessao.json` (criada por `node dist/index.js
--login`, senha sem eco, nunca gravada; refresh automático regrava o
arquivo); `nomeRpc()` troca para as RPCs `_local`; env da estação em
`%LOCALAPPDATA%\Ludmilla\env` (só URL + anon key); batimento
`ludmilla_estacao_pulsa` a cada 60 s; Chrome **instalado** (`channel:
'chrome'`, com janela, `launchPersistentContext` em `chrome-<portal>`, fechado
ao fim de cada run — a janela só existe enquanto há trabalho); `avisar()` =
balão do Windows via PowerShell. Sessão inválida → balão "Ludmilla parada".

**Conector Elektro (`src/conectores/elektro.ts`) — login assistido.**
`entrarElektro`: abre o portal (403/429 → `bloqueado_por_waf`); sem CAPTCHA e
sem senha na tela → `sessao_mantida` (o perfil ainda está logado); senão
preenche e-mail/senha (seletores por sufixo: `[id$=":captchaCode"]`, `form
input[type=password]`, primeiro texto do form que tem senha), foca o código,
avisa, e **olha a tela a cada 2 s por até 5 min**: formulário sumiu (confirmado
depois do `load`) → `entrou`; erro visível falando de senha/usuário →
`login_recusado`; JSF redesenhou o formulário vazio (código errado) →
preenche de novo e avisa de novo com o texto do portal; prazo → `sessao_expirada`.
Leituras com prazo curto (o auto-wait de 30 s do Playwright travava o laço).
`descobrir`: `01-inicio`, `00-menu` (links/botões com texto e destino),
`02-lista` (primeiro item de menu que fala de solicitações/projetos e NÃO é
ação — nunca "Nova solicitação"), `03-detalhe` (primeiro link da tabela).
`varrer`: ainda não — é escrito sobre as telas da descoberta real. Na VPS a
Elektro lança `captcha_exigido` explicando que a conta precisa do modo
estação. `reconhecerPagina` passou a identificar CAPTCHA `imagem` (campo
`captcha*`). 8 testes com portal JSF de mentira, suíte completa 10× sem falha.

**Instalador (`deploy/windows/`).** O workflow `ludmilla-worker.yml` publica
o artefato `ludmilla-local` (zip: `app/dist`, manifestos, `instalar.ps1`,
`Ludmilla.cmd`, `LEIA-ME.txt`, `env.padrao` com os valores públicos vindos
dos segredos do site — a service role NÃO entra). `instalar.ps1`: Node 22 via
winget se faltar, exige Chrome, para a instância anterior, copia para
`%LOCALAPPDATA%\Ludmilla\app`, `npm ci --omit=dev`, grava `env`, `--login`
(uma vez), atalho minimizado na pasta Inicializar, inicia. Atualizar = rodar
de novo. `Ludmilla.cmd` reinicia o robô 30 s depois de qualquer queda.

**Front.** Diálogo "Acesso ao portal": bloco "Onde a Ludmilla roda" (modo +
operador, `useAtualizarContaPortal`, RLS só admin) e estado da estação
(`estadoDaEstacao`: online = pulsou há ≤ 3 min); página /ludmilla mostra
online/offline e "aguardando login" quando a última visita fechou
`sessao_expirada`.

**Paciência com portal lento (CPFL, 15/09).** A varredura das 15:50 caiu com
`apiRequestContext.get: Timeout 30000ms` (a das 17:00 passou). Agora
`comPaciencia()` (`src/paciencia.ts`): lista 90 s × 3 tentativas, detalhes
60 s × 2, anexos 90 s × 2, erro em português dizendo o que estava lendo; erros
da Ludmilla não se repetem. Antes de ler a API o robô clica na aba
**Orçamentos de conexão** (regra do usuário) e a varredura ok guarda um
print da tela final.

## CAPTCHA remoto pela equipe e sessão viva (15/09/2026, noite)

Pedido do usuário: "descubra um jeito do preenchimento do CAPTCHA acontecer"
sem pessoa no coworking. **A Ludmilla não resolve CAPTCHA** (nem OCR, nem
IA, nem serviço de terceiros — terceira vez pedido, terceira recusa). Não há
API da Neoenergia (só o Portal GD e o 0800). O que foi construído tira a
exigência de estar *naquele PC* e reduz a frequência:

**CAPTCHA remoto** (`20260915220000_ludmilla_captcha_remoto.sql`,
`portal_captchas`). A estação fotografa o código (`fotoDoCaptcha`: a `<img>`
que se diz captcha ou a imagem mais próxima antes do campo — **antes** de
preencher a senha, para a foto não ser interrompida por quem está no PC),
sobe em `ludmilla/{tenant}/captcha/…png` e chama `ludmilla_captcha_pedir`
(sino "📡 Ludmilla precisa do código da ELEKTRO" para admin+staff do tenant,
só na 1ª foto). A página `/ludmilla` mostra o cartão "Digite o código da
imagem" (foto, campo, Enviar, contagem de 5 min) → `ludmilla_captcha_responder`
(equipe do tenant; 2–12 caracteres; só `aguardando` dentro do prazo). A
estação lê a cada 2 s (`ludmilla_captcha_ler`), preenche, envia (botão do
form ou Enter) e fecha `usado` (`ludmilla_captcha_fechar`, foto apagada).
Portal recusou → o JSF redesenha o form → pedido `recusado` com a mensagem
do portal, nova foto, `tentativa` 2 (até 3). Pessoa no PC digitou antes →
pedido `usado`/`cancelado`. Ninguém em 5 min → `expirado` + run
`sessao_expirada` como antes. O canal falhar não impede o balão local. As
RPCs aceitam service role OU operador (`ludmilla_robo_ok`) — o mesmo nome
nos dois modos. Testes: 5 cenários com canal de mentira + impersonação
15/15.

**Sessão viva.** `Conector.manterViva(page)` (Elektro: GET na URL base —
nunca `reload` de um POST do JSF — e confere que o formulário não voltou).
Na estação, depois de um run que entrou, o Chrome **não fecha**: o contexto
fica em `vivas` por portal, é reaproveitado pelo próximo run, tocado a cada
10 min (`LUDMILLA_SESSAO_VIVA_MIN`) no laço ocioso e fechado quando o portal
pede login (log com `durou_min`). `ludmilla_sessao_viva(account, viva)` →
`portal_accounts.sessao_viva_desde` → a página mostra "sessão no portal viva
desde …". Quanto tempo a Elektro mantém a sessão é a medida que o aceite
vai dar.

## Criar projeto na CPFL — "60 - Microgeração Distribuída BT" (16/09/2026)

A primeira ESCRITA da Ludmilla num portal, pedida pelo botão **Criar na
CPFL** no modal do projeto (só projetos cuja concessionária contém "CPFL",
só equipe GD Manager). Run `criar_projeto` em `portal_sync_runs`, com
`dados = { project_id, autonomia? }`; cada etapa vira uma linha em
`portal_criacao_passos` (print no bucket, Realtime no modal e na /ludmilla).

Fonte do roteiro: **"Roteiro CPFL: Orçamento de Conexão MMGD"** (PDF do
usuário, feito de duas gravações no Chrome) — seletores reais do Drupal.
O conector é `worker/ludmilla/src/conectores/cpfl-criar.ts`.

| Passo | Nome | O que faz | Seletores-chave |
|---|---|---|---|
| 1 | `introducao` | login B2C (`logarNaCpfl`) → abre `node/add/project_60` direto; se cair na Introdução, "Conexão de microgeração → Iniciar" (índice 1) | título da aba termina em "Dados da unidade consumidora"; `#edit-field-flux-type-conexo` |
| 2 | `dados_uc` | radio **Orçamento de Conexão** (pelo rótulo — a descrição do Estimado cita o outro), 3 × Não em "Necessidades", UC + **Buscar**, espera os campos cinza, confere Empresa = CPFL, Lat/Long em DMS `20° 52' 45.7"`, 2 × Não, Avançar | `#edit-field-quotation-options-60-connection`, `#edit-field-consumer-unit-0-consumer-unit-code`, `#edit-field-consumer-unit-0-send-uc-code`, `[id^="edit-field-consumer-unit-0-latitude"]`, `#edit-next` |
| 3 | `dados_projeto` | título, alteração de carga = Não, data (hoje + 30), compensação "Geração Local", categoria (B1… **resolvida como no front**), padrão de entrada GED 13, aéreo, fases, cabos/caixa/carga/disjuntor da regra, geração (ENERGIA SOLAR, módulos em kWp, área = módulos × 3 m², inversores) | `title[0][value]`, `field_*`, `[name$="[modules_qt]"]`… |
| 4 | `dados_cliente` | CPF (Consultar se vazio), celular/e-mail se faltarem, endereços = "Endereço da Instalação", 2 × Sim (documentos com o orçamento; contagem de prazo REN 1.000) | radios pelo rótulo dentro do bloco da pergunta |
| 5 | `revisao` | print da revisão e **Salvar** → URL `/node/<id>/edit` → `projects.cpfl_node_id` | `#edit-submit` |
| 6 | `concluido` | **para** em "Envio de documentos": arquivos ou "Enviar Depois" é decisão da pessoa | — |

**Autonomia** (`DadosCriacaoCpfl.autonomia`, padrões em `AUTONOMIA_PADRAO`):
respostas que a Ludmilla dá sozinha num projeto de GD comum
(`opcao_orcamento`, `mais_de_um_medidor`, `ramal_subterraneo`,
`medicao_no_poste`, `mudanca_ponto_entrega`, `extensao_fase`,
`alteracao_carga`, `sistema_compensacao`, `outorga_registro`,
`padrao_entrada`, `tipo_atendimento`, `fonte_geradora`, endereços,
`autoriza_documentos`, `contagem_prazo_vistoria`, `dias_para_ligacao`,
`m2_por_modulo`, e opcionais `carga_instalada_kw`, `disjuntor_a`,
`area_arranjos_m2`). O front pode sobrescrever em `run.dados.autonomia`.
Pergunta que não está no roteiro ("Já possui projeto aprovado?", "Medidor
do Vizinho?") → o passo falha com a pergunta e a chave a responder
(`ja_possui_projeto_aprovado`, `uc_medidor_vizinho`); o modal mostra.

**Regras aprendidas a ferro (16/09):** escolher SEMPRE pelo texto do rótulo
(Sim/Não têm código invertido entre perguntas: `-0` é Não em "mais de 1
medidor", `-1` é Não em "ponto de entrega"); preencher só a cópia VISÍVEL
do campo (o Drupal guarda cópias escondidas por opção condicional);
campos cinza não se digitam; cada Avançar recarrega e a etapa aparece só
no título. Em erro de passo o robô sobe `criacao-passo-N.html` e
`.campos.json` (mapa name/id/rótulo/visível) na pasta do run — é por aí que
o roteiro se corrige. Erro de criação **não** mexe em
`portal_accounts.ultimo_erro` (`20260916200000`): a varredura é outra coisa.

Dados: RPC `ludmilla_dados_criacao_cpfl` v2 (`20260916210000`) — UC,
titular com e-mail/telefone, módulos e inversores de `project_equipment`,
padrão de entrada de `concessionaire_entry_rules` (regra escolhida à mão >
menor disjuntor da classe que comporta o do projeto > maior da classe).

## Próximos

1. **Aceite da estação** no PC do coworking: instalar, "Verificar agora" na
   Elektro (descoberta), responder o código pela /ludmilla (celular) ou no
   PC, telas no bucket, e observar por quanto tempo a sessão fica viva. Risco
   a observar: o Chrome do Playwright carrega `navigator.webdriver=true` — se
   a Akamai bloquear mesmo com gente, conversar antes de qualquer mudança.
2. Roteiro `varrer` da Elektro sobre as telas da descoberta (plano próprio).
3. Mostrar `portal_anexos` (enviados/bloqueados) na página /ludmilla; 3
   projetos em andamento sem par no portal; os 4 cartões que a lista não
   devolve (199 de 203 — 5 "Incompleto" sem atividade).
4. Solicitar vistoria automática quando a empresa pede pelo painel — a
   conversar (exige a mesma conferência de titular/UC e é a única escrita).
