# Ludmilla — acompanhamento das concessionárias

> Estado: 🟡 Dois meios de acompanhar, e cada conta diz qual usa
> (`portal_accounts.acompanhamento`).
> **CPFL — por portal**, funcionando ponta a ponta (set/2026): robô na VPS lê os
> protocolos, o banco gera recomendações, a página /ludmilla aplica/ignora,
> agendamento 2×/dia.
> **EDP — por e-mail** (out/2026): ela lê a caixa, acha pelo protocolo, anexa o
> parecer no card e recomenda a etapa. Código e banco prontos e revisados; **o
> run ainda não rodou** — o primeiro é manual e acompanhado.
> **Elektro — estação local** (PC do coworking) construída e testada com portal
> de mentira; aguarda o aceite na máquina de verdade.
> Só tenant GD Manager (`is_library`). Ela nunca move card sozinha, nunca
> escreve no portal nem na caixa, e nunca resolve CAPTCHA.
> Specs: [2026-09-14-ludmilla-design.md](../../superpowers/specs/2026-09-14-ludmilla-design.md) ·
> [2026-09-15-ludmilla-elektro-local-design.md](../../superpowers/specs/2026-09-15-ludmilla-elektro-local-design.md) ·
> [2026-10-02-ludmilla-edp-email-design.md](../../superpowers/specs/2026-10-02-ludmilla-edp-email-design.md)

## O que é

Funcionária como o Bidu (usuária `staff`, sem senha, id
`00000000-10d1-4000-8000-000000000002`). Acompanha os projetos nas
concessionárias por um de dois meios — **entrando no portal** ou **lendo a caixa
de e-mail** —, **lê** o status dos protocolos e devolve **recomendações** numa
página de relatório; uma pessoa aplica ou ignora. Nunca escreve no portal nem na
caixa, nunca move card sozinha, nunca resolve CAPTCHA.

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

**Reconstruído do zero em 17/09/2026 sobre a CLI `agent-browser`**
(vercel-labs), depois de o conector Playwright falhar 8× por chute. Fonte do
roteiro: a sessão de mapeamento tela a tela
(`docs/superpowers/specs/2026-09-17-cpfl60-criacao-design.md`, mapas em
`2026-09-17-cpfl60-mapa/`) + o PDF do usuário "Roteiro CPFL: Orçamento de
Conexão MMGD". Validado ponta a ponta: projeto **node 546581** criado à mão
(PRJ-14848) e o roteiro automático repetiu tudo até a revisão em 1 min 15 s.

Código: `worker/ludmilla/src/criacao/` — `agente.ts` (invólucro da CLI, sem
shell, valores só por `eval --stdin`), `sessao-herdada.ts` (entra pelo
Playwright da varredura e passa os cookies para a CLI — ver abaixo),
`roteiro-cpfl60.ts` (as 6 etapas), `js.ts` (trechos que rodam na página),
`util.ts` (puro, testado), `index.ts` (run: dados → login → roteiro → node →
finalizarRun). Validação local sem banco e sem salvar:
`npm run build && LUDMILLA_AB_SESSAO=<sessão logada> node
scripts/validar-criacao-local.mjs`. VPS: `instalar.sh` instala a CLI e o
Chrome no HOME do `ludmilla`, unit libera `~/.agent-browser`,
`LUDMILLA_AB_ARGS` leva `--no-sandbox,--disable-crashpad,…`
(`LUDMILLA_AB_EXEC` aponta outro Chromium se o completo cair).

#### A criação não tem login próprio (12/10/2026)

O login da CLI falhou nas **4 tentativas** entre 18/09 e 12/10/2026, sempre no
passo 0. O print guardado no bucket conta o que acontecia: **"Olá Usuário"** e
**"Você não tem acesso a essa página"** — o B2C autenticava, mas a seleção de
perfil ("Serviços para projetistas" / "Projetos Particulares") não acontecia, e
sem ela o Drupal do `gestao-projetos` nega tudo. Enquanto isso a **varredura
entra no mesmo portal, com a mesma conta, na mesma VPS, 2×/dia, sem falhar**.

Então a criação parou de tentar um segundo login e passou a **herdar a sessão
da varredura**: `sessao-herdada.ts` abre um contexto Playwright, chama o
**mesmo `logarNaCpfl`** do conector, pega `context.cookies()` e injeta na
sessão da CLI (`cookies set --curl <arquivo>`, com fallback cookie a cookie).
Depois **prova** a sessão: tem de estar em `gestao-projetos` **e** passar no
`JS_AUTENTICADO` (menu "GERENCIE SEUS PROJETOS" ou link "Sair") — sem a prova,
o robô seguia com sessão meia-boca e só descobria três telas depois.

Consequências que valem como regra:
- **Nenhuma senha chega à CLI.** O cofre (`auth save/login`) saiu do caminho;
  só restou `auth delete`, como faxina de sobra de run interrompido.
- **Mesmo User-Agent dos dois lados** (`USER_AGENT_LUDMILLA`): cookie herdado
  com navegador "diferente" é convite para o portal derrubar a sessão.
- O arquivo de cookies é **credencial de sessão**: tmp com `0600` e apagado no
  `finally`.
- A CLI **não preserva `httpOnly` nem `expires`** na importação (o cookie entra
  como de sessão). Não atrapalha — a sessão vive o run —, mas não conte com
  esses campos do outro lado.
- Se um dia o portal prender a sessão ao navegador que a criou, o erro já diz o
  que fazer: rodar a criação dentro do mesmo Playwright da varredura.

| Passo | Nome | O que faz | Seletores-chave (mapa de 17/09) |
|---|---|---|---|
| 1 | `introducao` | sessão herdada da varredura → `gestao-projetos/criar-projeto` → link 60 → Introdução → "Conexão de microgeração" e **confere** `flux_type = conexão`. Nunca abre `node/add/project_60` direto (retoma formulário velho) | `a[href$="node/add/project_60"]`, `#edit-next-new-connection`, `#edit-field-flux-type-conexo` |
| 2 | `dados_uc` | **Orçamento de Conexão** (rótulo conferido), 3 × Não (`-0`), UC + Buscar, espera Nome do Cliente, Empresa = CPFL, Lat/Long DMS, 2 × Não (`-1`!), perguntas condicionais, FormData, Avançar | `#edit-field-quotation-options-60-connection`, `#edit-field-consumer-unit-0-consumer-unit-code`, `…-send-uc-code`, `[id^="edit-field-consumer-unit-0-latitude"]`, `#edit-next` |
| 3 | `dados_projeto` | título, Não, ENERGIA SOLAR (2721), data +30 (JS), Geração Local (2771), categoria (regra do front), GED 13 (2761), aéreo (2866), fases (2751), **Cabos = nº de fases**, caixa, carga = Demanda, disjuntor da regra, geração (651, módulos kWp, área, inversores); **FormData dos totais conferido**; Avançar | ids `edit-field-*` e `#edit-field-complementary-generation-0-subform-field-*` |
| 4 | `dados_cliente` | Pessoa Física, Consultar CPF (espera Nome), celular/e-mail só se vazios, endereços = instalação, 2 × Sim (`-1`!) | `[id^="edit-field-physicalperson-0-*"]`, `[id^="edit-field-address-type-mesmo"]`, `…authorize-pay-connec-costs-1`, `…solicitacao-de-vistoria-1` |
| 5 | `revisao` | print da revisão e **Salvar** → URL `/node/<id>/edit?step=6` → `projects.cpfl_node_id`. `run.dados.simular = true` para antes | `#edit-next-save-draft` |
| 6 | `concluido` | **para** em "Envio de documentos" (27 inputs `files[field_*]` mapeados para a fase seguinte) | `#edit-next-send-later` / `#edit-next` — não clica |

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

0. **Primeiro run da EDP por e-mail** — manual e acompanhado, antes de
   qualquer agendamento. O que olhar está em "O que NÃO está provado", no fim
   deste documento. Pendências pequenas que ficaram para depois dele:
   - o `motivo` mostra "o robô começou a tratar esta mensagem" enquanto o
     tratamento corre, e **permanentemente** se o robô morrer no meio — trocar
     por um texto que diga que começou e **não terminou**;
   - guarda em `(p_resultado->>'falhas')::int` dentro de
     `ludmilla_finalizar_run_impl`: valor não numérico levanta exceção e o run
     não fecha (hoje só o nosso worker escreve ali, então é latente);
   - os contadores do cartão são só do **último** run, então um documento
     bloqueado há três runs sai do número (continua no histórico);
   - não há "Ler de novo" em lote: regra errada por uma semana faz clicar
     linha por linha;
   - o grupo "não reconheci" não oferece **criar a regra a partir do assunto**
     daquele e-mail, que é o gesto óbvio ali.
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

## A atualização da Ludmilla encerra a tarefa da etapa (22/09/2026)

`20260922100000_ludmilla_encerra_tarefas.sql`. A regra de automação
"entrou em **Vistoria solicitada** → criar tarefa VERIFICAR VISTORIA (6 dias)"
cumpre o papel enquanto o projeto está lá; quando a Ludmilla traz a
atualização seguinte do portal (vistoria aprovada → Concluído, reprovada →
Vistoria reprovada, indeferido → Pendência) e a equipe clica em **Aplicar**,
a tarefa perdia o sentido mas continuava aberta, vencendo o prazo.

Quem encerra é o MESMO gatilho que cria as tarefas (`trg_task_automations`,
`AFTER UPDATE OF status`), chamando `encerrar_tarefas_da_etapa(projeto,
novo_status, quem, motivo)` — então vale para TODO caminho que muda a etapa:
arrastar no quadro, seletor do modal, aplicação de etapa do /email-updates e
o "Aplicar" da Ludmilla (decisão do usuário, 22/09/2026; a primeira versão
só pegava o Aplicar):

- encerra toda tarefa **de automação de etapa** (`tasks.automation_id`) ainda
  aberta cuja regra aponta para uma etapa **diferente da atual** — ou seja, a
  etapa que a gerou ficou para trás;
- `completed_by` = quem moveu o card (a pessoa é a autora, mesmo quando a
  origem é a Ludmilla); o motivo entra ao fim da descrição da tarefa
  ("✅ Encerrada automaticamente: o projeto saiu de X para Y") sem apagar o
  texto original;
- o responsável recebe um aviso no sino ("✅ Tarefa encerrada automaticamente")
  — menos quando ele mesmo moveu o card;
- o comentário e o histórico do card ganham a linha "✅ N tarefa(s)
  automática(s) encerrada(s)".

**Não são tocadas**: tarefa criada à mão, pedido de vistoria da empresa
(`origin='vistoria_request'`) e a tarefa da etapa NOVA — que o gatilho
`trg_task_automations` cria na mesma transação (a função compara com o status
novo, então ela sobrevive). Nada acontece se a etapa aplicada for igual à
atual. A função é interna (sem GRANT para `authenticated`).

Testado por impersonação (12 checagens, `begin … rollback`), nos quatro
caminhos: arrastar o card encerra com o motivo e avisa o responsável; quem
move sendo o próprio responsável não recebe aviso; o Aplicar da Ludmilla
conta as encerradas no comentário; repetir a mesma etapa não encerra nada;
tarefa manual e tarefa da etapa nova ficam abertas.

## Tarefas vencidas e REGISTRO na aba (23/09/2026)

`20260923100000_ludmilla_tarefas_vencidas_e_registro.sql`, dois pedidos do
usuário:

**1. As tarefas que já estavam abertas.** O encerramento de 22/09 só age na
hora em que o card muda de etapa — as tarefas antigas de projetos que já
haviam saído continuavam vencendo. `ludmilla_encerrar_tarefas_vencidas(tenant,
avisar)` varre todas as tarefas de automação abertas e encerra as que
pertencem a etapa diferente da atual do projeto, assinando como **Ludmilla**
(`completed_by` = usuária Ludmilla) e explicando na descrição. É chamada a
cada **varredura que termina bem** (`ludmilla_finalizar_run_impl`), então a
conferência é rotina, não mutirão. `encerrar_tarefas_da_etapa` ganhou
`p_avisar` para a limpeza de lote não disparar dezenas de sinos.
Limpeza inicial de 23/09: **8 tarefas** encerradas (7 projetos já em
Concluído, 1 em Vistoria reprovada); as outras 21 seguem abertas porque os
projetos ainda estão em Vistoria solicitada.

**2. Registro na aba.** `ludmilla_registro(limite, ator)` — leitura unificada
do que já está gravado, sem tabela de log nova (por isso o histórico inteiro
aparece desde o primeiro dia):

| Fonte | Evento |
|---|---|
| `portal_sync_runs` | visita ao portal (varredura, criação, teste, descoberta) com protocolos/recomendações ou o erro |
| `portal_updates` (detectado) | recomendação levantada: status do portal, protocolo, titular, etapa sugerida, casamento |
| `portal_updates` (aplicada/ignorada) | decisão da equipe, com o nome de quem decidiu |
| `portal_anexos` | anexo da concessionária no card / bloqueado / erro |
| `portal_pareceres` | parecer virando comentário |
| `portal_captchas` | código pedido (ela) e respondido (quem respondeu) |
| `tasks` | tarefa encerrada, com o motivo |

`ator` = `ludmilla` (ela fez) ou `equipe` (feito através dela); a página
filtra por isso ("Tudo · Ela fez · A equipe fez"), mostra 60 e tem "Ver mais"
(até 400). Só equipe do tenant GD Manager — outro tenant e empresa recebem
"Sem acesso à Ludmilla" (testado: 6 checagens de isolamento).

## Acompanhamento por E-MAIL — a EDP (out/2026)

Spec [2026-10-02-ludmilla-edp-email-design.md](../../superpowers/specs/2026-10-02-ludmilla-edp-email-design.md) ·
plano [2026-10-02-ludmilla-edp-email.md](../../superpowers/plans/2026-10-02-ludmilla-edp-email.md)

Até aqui a Ludmilla só sabia **entrar no portal**. A EDP ganhou um segundo meio:
ela **lê a caixa de e-mail** e interpreta as mensagens da concessionária. Pedido
do usuário: "a princípio eu gostaria que ela interpretasse os e-mails para a
gente saber se já foi aprovado ou não" — portal e pedido de vistoria da EDP
ficaram para depois, de propósito.

Cada conta passou a dizer **como** é acompanhada: `portal_accounts.acompanhamento`
é `portal` ou `email`. A CPFL continua `portal`, a EDP é `email`. Não existe
conta com os dois.

### Por que no robô, e não numa edge function

IMAP precisa de `imapflow` + `mailparser`, bibliotecas Node — não rodam em Deno.
Então o acompanhamento por e-mail é um tipo de run novo no worker,
`varredura_email`, desviado antes do laço do Playwright (não abre navegador).
Só na VPS: as RPCs de e-mail não têm variante `_local`, e o run se recusa a
rodar em modo estação, com mensagem clara. Era exatamente o pedido do usuário —
"assim não preciso deixar o computador ligado".

### Parte dos PROJETOS, não dos remetentes

Aqui está a diferença essencial em relação ao Claudinho (`scan-emails`), que
varre por remetente nos últimos dias e nunca toca em anexo:

A Ludmilla parte de **cada protocolo em andamento** e procura **o número** na
caixa. Para a EDP, o protocolo do sistema é a nota com **um zero à esquerda**
(`045006443920` equivale a `45006443920`) — confirmado contra três pares reais
de projeto/e-mail. Toda comparação é por dígitos, com zeros à esquerda removidos
e mínimo de 8 dígitos (`chaveProtocolo` / `casaProtocolo`).

Fluxo de um run: credencial da caixa → protocolos em andamento (até 80) → regras
do banco → para cada protocolo, busca no IMAP → **triagem pelo envelope** (sem
baixar o corpo) → baixa só o que sobrou → confere → anexa → lê o parecer com IA →
recomenda. **Nunca move card e nunca escreve na caixa.**

### A conferência: o que barra e o que só confirma

O protocolo é **chave única**: se ele casa, o documento é daquele projeto. Então:

| Sinal | O que faz |
|---|---|
| protocolo no **assunto** | obrigatório. Sem ele, a mensagem é descartada |
| **titular** do PDF diverge do cadastro | **BARRA** o anexo. É o único bloqueio do fluxo |
| **endereço** do PDF diverge | **não barra** — registra o motivo e segue |

Endereço divergente quase sempre é cadastro nosso desatualizado ou formato
diferente ("RUA X 120 APTO 45" contra "Rua X, 120"); barrar por isso faria o
parecer certo não chegar ao card. Nome de **outra pessoa** num parecer do nosso
protocolo, esse sim é alarme.

Titular e endereço conferem **só contra o que a IA extraiu do PDF**, nunca contra
o corpo do e-mail. Comparar com o corpo inteiro casava por acidente: "JOSÉ …
SANTOS" casa com um e-mail que diga "Av. São José" e "Santos/SP", e saía o selo
mais forte sem nada conferido. Nome de uma palavra só (dos dois lados) é **falta
de dado**, não divergência: cai para o critério seguinte.

### "Já vi" não é "já terminei" — a máquina de retentativa

O defeito mais caro que a revisão pegou: a mensagem era marcada como vista antes
de se saber se algo útil saiu dela. Falha passageira da IA, regra mal
configurada ou anexo que não subiu faziam o documento **desaparecer em
silêncio**, recuperável só com `DELETE` à mão.

`portal_email_mensagens` tem `concluida` e `tentativas`:

- `concluida = true` → terminei, não mexo mais;
- `concluida = false` e `tentativas < 5` → tento de novo no próximo run;
- `concluida = false` e `tentativas >= 5` → desisti; **a tela mostra em destaque**.

`concluida = true` só quando a regra casou **e** o parecer foi lido com `ok:true`
(ou não havia PDF) **e** todo anexo que devia subir subiu. Caso especial:
**nenhuma regra reconheceu → `concluida = true`** de propósito; é configuração,
não falha passageira, e insistir faria a robô rebaixar o mesmo e-mail duas vezes
por dia para sempre. Bloqueio por titular também fecha: é decisão, não falha.
O mesmo vale para o e-mail de vários protocolos sem arquivo que diga de quem é
(próxima seção) e para o arquivo que o bucket não aceita (mais abaixo): descarte
conhecido, nunca falha.

A recomendação de etapa **nunca é rebaixada**: tentativa 1 leu o parecer
favorável e deixou o cartão com `approved`; tentativa 2, com a IA falhando,
chega com recomendação nula e `ludmilla_email_registrar` mantém a que já existia
(`coalesce(p_recomendacao, u.recomendacao)`). Recomendação **nova** (não nula)
substitui a velha. Sem isso, a IA falhando até o teto de 5 deixava o cartão sem
etapa tendo tido uma.

### E-mail que cita VÁRIOS protocolos (rodada 3, 12/10/2026)

O laço do run trata **um protocolo por vez**. Um assunto como
`NOTAS 45006443920 e 45006443921` roda `tratarMensagem` duas vezes para a mesma
mensagem. O código antigo, para cada vez, anexava **todos** os arquivos e lia o
**maior** PDF — de qualquer um dos dois. O parecer de um cliente aparecia no card
do outro (de outra integradora, até) com o comentário "titular conferido", e o
outro projeto era bloqueado por divergir do PDF errado. A premissa "o mesmo anexo
serve os dois projetos" estava escrita num brief e nunca foi verificada.

Agora:

1. **Conta quantos dos NOSSOS protocolos o assunto cita** (`protocolosNoAssunto`,
   por dígitos, sem zero à esquerda, piso de 8). Número de pedido, CEP ou
   protocolo de atendimento no assunto não conta: só os da lista do run.
2. **Com mais de um, só vai para o card o arquivo cujo NOME traz o número daquele
   protocolo** (`PARECER_45006441002.pdf`; `separarPorProtocolo`). Arquivo que
   traz os **dois** números é ambíguo e não vai para nenhum card. A IA lê o PDF
   **desse protocolo**, não o maior do e-mail — então o titular confere contra o
   documento certo.
3. **Se nenhum arquivo casar pelo nome, não anexa nada**: a IA nem é chamada, a
   linha fica `concluida = true` com `motivo` ("o e-mail cita N protocolos e não
   consegui dizer qual documento é de qual … confira à mão"), e cai no grupo
   "Terminei, mas com um porém" da tela. No `resultado` do run vai em
   `sem_dono` — **não** em `bloqueados`, que a tela rotula como "titular
   divergiu".

**Com UM protocolo citado nada muda**: anexa todos os não-imagem e lê o maior PDF.
Regra que não anexa nem lê PDF não depende de arquivo e não é afetada.

### O que o bucket de documentos aceita (rodada 3)

O bucket `project-documents` aceita **pdf, xls, xlsx, docx, jpeg, png e webp, até
10 MiB (10485760 bytes)** — lido de `storage.buckets` em 12/10/2026, e o worker
espelha isso em `util.ts` (`LIMITE_BUCKET_BYTES`, `destinoNoBucket`). Mudar o
bucket sem mudar o worker reabre o defeito abaixo.

O worker mandava tudo o que não era imagem e o storage recusava o resto. Cenário:
`parecer.pdf` + `parecer.p7s` (assinatura digital, comum). O `.p7s` era recusado
→ falha → a mensagem ficava pendente → a cada run a IA **relia o mesmo PDF** (até
5 leituras pagas) antes de a mensagem ser abandonada no teto. Um PDF acima de
10 MB caía no mesmo caminho. Agora o arquivo que o bucket não aceita é
**ignorado, não falhado**: não abre linha em `portal_anexos`, conta em
`anexos_recusados` no `resultado`, e entra no `motivo` com o nome e a razão
(`tipo` ou `tamanho`). O nome vai para o banco, nunca para o log. Cliente de
e-mail que declara `application/octet-stream` para um PDF sobe com o mime da
extensão (o storage confere o mime declarado). Um PDF recusado por tamanho **ainda
é lido** pela IA: a recusa é de anexar.

Anexo **sem nome de arquivo** também deixa rastro: era filtrado em silêncio. Agora
conta em `anexos_sem_nome`, entra no `motivo` e vai para o log (só uid e
quantidade). Imagem sem nome (logo inline de assinatura) não conta.

A tentativa é contada **antes de a IA ser chamada** (`ludmilla_email_tentativa`).
Sem isso, um tratamento que morresse antes do registro não contava — e todo run
seguinte baixava o e-mail **e pagava a IA de novo**, indefinidamente, sem avisar.

### A chave do anexo CARREGA o protocolo

`id_arquivo` é `mensagem#protocolo#arquivo`, montado por uma expressão única nas
duas pontas (`idArquivoDeEmail` no worker, `ludmilla_email_id_arquivo` no banco)
— divergir entre elas faria a robô re-anexar o que já anexou. Dois anexos de
**mesmo nome** na mesma mensagem ganham a ocorrência a partir do segundo
(`…#parecer.pdf#2`); o primeiro mantém a chave de sempre. O índice é contado na
mensagem **inteira**, antes de qualquer filtro, para ser o mesmo em todo run.

Sem o protocolo na chave, um e-mail que cita **dois** protocolos colidia, e num
dos ramos **o documento ia para o card do cliente errado**. Além da chave, o
`ON CONFLICT` exige que a linha existente seja do **mesmo projeto**, e o worker
confere o `projeto_id` devolvido antes de subir arquivo: chave certa **e** guarda.
Linha parada em `pendente` ou `erro` volta para a fila. `ludmilla_email_anexo_novo`
responde **sempre uma linha**, com `abertura` = `aberto` (suba o arquivo),
`ja_resolvido` (`enviado`/`bloqueado` neste projeto) ou `projeto_inexistente` —
eram duas respostas misturadas num conjunto vazio, e o log dizia "já resolvido no
card" até para projeto que nem existia.

A UNIQUE `portal_anexos (account_id, id_arquivo)` **não** foi alterada: com o
protocolo dentro da chave ela já discrimina, e `project_id` é nulável, então
`NULLS DISTINCT` abriria duplicata e mudaria a semântica de conflito do caminho
da CPFL. Provado que a CPFL não re-anexa: `ludmilla_registrar_varredura` grava
`id_arquivo` com o id do arquivo do site e não foi tocada (md5 do corpo
idêntico), a reinserção do `ON CONFLICT` do portal sobre as 79 linhas de produção
criou 0 linhas, e `portal_anexos` tinha **zero** linhas com `#` — o caminho de
e-mail nunca havia gravado nada.

### A leitura do parecer: `ludmilla-parecer`

Edge function Deno que recebe o PDF em base64 e devolve
`{ ok, veredito, resumo, pendencias, titular, endereco }`, com `veredito` em
{`favoravel`, `pendencia`, `inconclusivo`}.

- **Só o robô chama.** Igualdade de string contra `SUPABASE_SERVICE_ROLE_KEY` ou
  `LUDMILLA_WORKER_KEY`, **sem chamada de rede**, negando por omissão, com a
  mesma frase de 401 para todas as causas. A primeira versão sondava uma rota do
  Auth e usava o **404** como sinal de aceite — *fail-open*: se a rota mudasse,
  qualquer token passaria, inclusive a chave publicável do front.
  `LUDMILLA_WORKER_KEY` existe porque, no ambiente das functions,
  `SUPABASE_SERVICE_ROLE_KEY` guarda a chave **nova** (`sb_secret_…`) enquanto o
  worker pode mandar o JWT legado; o `deploy.yml` define o segredo a partir do
  **mesmo** segredo do GitHub que o worker usa, por `--env-file`.
- **Falha de IA não cobra.** A reserva no extrato é desfeita em rede caída, erro
  da Anthropic e tempo esgotado (`AbortController`, `TETO_MS = 110_000`); os
  tokens lançados são os **reais** da resposta. `ai_call_cost_usd` estima
  US$ 0,10 para o `kind` `ludmilla_parecer`. Exige `tenant_id` no corpo, senão o
  gasto fica fora do extrato do console.
- `ok:false` (a IA não respondeu) e `veredito:'inconclusivo'` legítimo (a IA leu
  e não concluiu) chegam **os dois** como HTTP 200; quem separa é o campo `ok`.
  Em `ok:false` o **anexo sobe de todo jeito** e nenhuma recomendação sai.
- O veredito é normalizado (minúsculas, sem acento) antes da lista branca:
  "favorável" com acento cairia em `inconclusivo` e a recomendação não sairia.
  Marcadores que não são nome ("nao consta", "a definir", "ilegivel"…) viram
  `null`, senão bloqueariam o anexo por falsa divergência de titular. Em
  **titular e endereço** o marcador vale em qualquer ponto da frase, como palavra
  inteira ("Não consta.", "Não identificado no documento", "Titular não
  identificado"); errar para o lado de casar demais é seguro (só faz a conferência
  cair para o protocolo). No **resumo** segue igualdade exata: "Não consta
  restrição; conexão aprovada." é um resumo legítimo. O teste
  `parecer-marcadores.test.ts` carrega o arquivo real da função, sem Deno.

### Banco

| Objeto | Para que |
|---|---|
| `portal_accounts.acompanhamento` | `portal` ou `email` |
| `portal_email_regras` | assunto/remetente → tipo de documento, anexar, ler PDF. **Editável na tela** |
| `portal_email_mensagens` | o que foi lido: veredito, resumo, motivo, `concluida`, `tentativas`, `arquivo_lido`, `update_id` |
| `ludmilla_email_credencial` · `_protocolos` · `_regras` | o que o run precisa (só service role) |
| `ludmilla_email_mensagem_pendente` | "preciso tratar?" — chave `(conta, mensagem, protocolo)` |
| `ludmilla_email_tentativa` | conta a tentativa ANTES do gasto de IA |
| `ludmilla_email_anexo_novo` · `ludmilla_email_id_arquivo` | abre o anexo com a chave que carrega o protocolo (e a ocorrência, nos de mesmo nome); responde `aberto` / `ja_resolvido` / `projeto_inexistente` |
| `ludmilla_email_registrar` | fecha a mensagem e levanta a recomendação (nunca a rebaixa para nula) |
| `ludmilla_email_reler` | a tela reabre uma mensagem travada (zera `tentativas`) |
| `ludmilla_anexo_frase` | o comentário no card diz a concessionária **da conta** e o que de fato foi conferido |

RLS: tenant **e** `ludmilla_equipe_ok()`, como as irmãs `portal_*`. Tenant por
`get_user_tenant_id(auth.uid())`, não por claim do JWT — 11 dos 19 usuários
(inclusive o único admin) não têm `tenant_id` em `raw_app_meta_data`, e a
política viraria `tenant_id = NULL`, negando tudo sem erro.

### A tela

`/ludmilla`: cada cartão diz "Acompanho por", e o corpo se bifurca pelo meio. O
cartão de e-mail traz a caixa em uso, os contadores da última leitura, as
**regras editáveis** (escrita só para `admin`, espelhando a RLS) e o histórico.

Três contadores estão ali porque são **rede de segurança**, não enfeite:
`imagens_ignoradas` (a robô não anexa imagem — é quase sempre logo de assinatura;
se uma concessionária mandar documento escaneado, é o único lugar onde aparece),
`a_tentar_de_novo`, e `bloqueados` (parecer recusado por divergência de titular —
o número a olhar antes de confiar no automático). `mudancas`, no cartão de
e-mail, são **documentos anexados**, não recomendações como no portal; por isso o
rótulo é explícito.

As linhas que pedem atenção aparecem **em destaque**, com "Ler de novo" por
linha. Sem isso, corrigir uma regra não serviria para o passado.

### O que NÃO está provado

**O run nunca rodou.** Toda a verificação é de tipo, teste unitário (193 testes,
`fail 0`) e SQL executado à mão (em `begin; … rollback;`). O laço de
`executarVarreduraEmail` não tem teste — a spec §9 manda para o teste manual de
ponta a ponta. O primeiro run é **manual e acompanhado**, e nele vale olhar:
`bloqueados` (o bloqueio por titular nunca rodou contra PDF real),
`imagens_ignoradas`, `sem_dono` (e-mail de vários protocolos sem arquivo que diga
de quem é), `anexos_recusados` (p7s, dwg, zip, acima de 10 MB), `anexos_sem_nome`,
`nao_lidas`, `a_tentar_de_novo`, o tempo do run, e se aparece algum `imap-uid-` no
log (envelope sem `Message-ID`: aí o uid vira o id do dedupe, e se a caixa for
recriada a mensagem é tratada de novo). Só depois disso se fala em agendamento.

A tela **ainda não mostra** `sem_dono`, `anexos_recusados` e `anexos_sem_nome`
como contadores (a rodada 3 não tocou em `src/`): leia-os do `resultado` do run
(SQL no roteiro do primeiro run). As linhas com ressalva já aparecem no grupo
"Terminei, mas com um porém".

**Lacunas conhecidas do E1** (decididas, não esquecidas): se o assunto cita dois
protocolos mas **só um é nosso** (o outro é de projeto concluído, de outra conta,
ou ficou fora do teto de 80), a contagem dá 1 e vale o caso normal — anexa tudo.
E, com um protocolo só no assunto, um arquivo cujo nome traz o número de **outro**
projeto nosso também é anexado: a regra do usuário é "com um protocolo nada
muda". Se o primeiro run mostrar um desses casos, a correção é contar também os
números do nome dos arquivos.

**Dois projetos ativos da EDP estão sem número de protocolo** — não há o que
buscar, e eles ficam fora da automação até ganharem protocolo.

Risco latente conhecido: se uma conta algum dia fizer portal **e** e-mail,
`ludmilla_anexos_pendentes` entregaria uma chave de e-mail ao `baixarAnexo` do
portal. Hoje não ocorre.
