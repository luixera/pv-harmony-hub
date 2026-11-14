# Ludmilla — acompanhamento das concessionárias

> Estado: 🟡 Dois meios de acompanhar, e cada conta diz qual usa
> (`portal_accounts.acompanhamento`).
> **CPFL — por portal**, funcionando ponta a ponta (set/2026): robô na VPS lê os
> protocolos, o banco gera recomendações, a página /ludmilla aplica/ignora,
> agendamento 2×/dia.
> **EDP — por e-mail** (out/2026): ela lê a caixa, acha pelo protocolo, anexa o
> parecer no card e recomenda a etapa. Código e banco prontos e revisados; **o
> run ainda não rodou** — o primeiro é manual e acompanhado.
> **ENEL — por e-mail, pelos remetentes** (out/2026): o contrário da EDP. Ela
> lê a caixa pelos remetentes da ENEL, descobre de qual projeto é cada e-mail
> (pelo protocolo/NT, pela UC ou pelo nome do titular), anexa o documento no card,
> sugere a etapa (ou gravar a NT da Carta como protocolo) e toca o sino nos
> momentos que pedem ação. Banco e código prontos e revisados; **o robô da VPS
> ainda não tem o código da ENEL e o run nunca rodou** — o primeiro é manual e
> acompanhado, no [roteiro](../../superpowers/2026-10-20-primeiro-run-enel-email.md).
> **Elektro — estação local** (PC do coworking) construída e testada com portal
> de mentira; aguarda o aceite na máquina de verdade.
> Só tenant GD Manager (`is_library`). Ela nunca move card sozinha, nunca
> escreve no portal nem na caixa, e nunca resolve CAPTCHA.
> Specs: [2026-09-14-ludmilla-design.md](../../superpowers/specs/2026-09-14-ludmilla-design.md) ·
> [2026-09-15-ludmilla-elektro-local-design.md](../../superpowers/specs/2026-09-15-ludmilla-elektro-local-design.md) ·
> [2026-10-02-ludmilla-edp-email-design.md](../../superpowers/specs/2026-10-02-ludmilla-edp-email-design.md) ·
> [2026-10-13-ludmilla-enel-email-design.md](../../superpowers/specs/2026-10-13-ludmilla-enel-email-design.md)

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
  na sidebar com contador de pendentes. *(Assim foi até 22/10/2026; hoje a
  página é a caixa de decisões — ver
  [A página como caixa de decisões](#a-página-como-caixa-de-decisões-22102026), no fim.)*

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
shell, valores só por `eval --stdin`), `navegador.ts` (interface `Navegador` + `AgentePlaywright`, o navegador da
varredura vestido para o roteiro),
`roteiro-cpfl60.ts` (as 6 etapas), `js.ts` (trechos que rodam na página),
`util.ts` (puro, testado), `index.ts` (run: dados → login → roteiro → node →
finalizarRun). Validação local sem banco e sem salvar:
`npm run build && LUDMILLA_AB_SESSAO=<sessão logada> node
scripts/validar-criacao-local.mjs`. VPS: `instalar.sh` instala a CLI e o
Chrome no HOME do `ludmilla`, unit libera `~/.agent-browser`,
`LUDMILLA_AB_ARGS` leva `--no-sandbox,--disable-crashpad,…`
(`LUDMILLA_AB_EXEC` aponta outro Chromium se o completo cair).

### API de status (13/10/2026) — a porta nossa

**Por que existe.** O Portal GD da Elektro (Neoenergia) bloqueia navegador
automatizado pela Akamai **antes da tela de login** — provado na estação local,
no PC de pessoa, em 13/10/2026 (`Access Denied / errors.edgesuite.net`, 319
bytes). Não é IP, é detecção de automação, e a casa não disfarça automação.
Então a pessoa entra (é o que a distribuidora exige), lê a lista de
solicitações e entrega aqui o que viu. Daí em diante é o **mesmo trilho da
varredura**: `ludmilla_registrar_varredura` casa com o projeto, sugere a etapa
e o cartão aparece na /ludmilla para confirmar. Ninguém move card sem confirmar.

**Endpoint.** `POST {SUPABASE_URL}/functions/v1/ludmilla-status`, deployada com
`--no-verify-jwt`: a credencial é a **chave da API**, não o JWT.

- `Authorization: Bearer gdm_<40 hex>` (ou `x-api-key`).
- Corpo: `{ "concessionaria": "ELEKTRO", "protocolos": [ { "protocolo", "status",
  "titular"?, "observacao"? } ] }` — até 500 itens; o mesmo protocolo repetido,
  a última linha vence. `connector` (`cpfl|elektro|edp`) vale no lugar de
  `concessionaria`.
- Resposta: `{ ok, run_id, protocolos, recomendacoes }`. Erros: 401
  `chave_ausente|chave_invalida|chave_revogada`, 404 `conta_nao_encontrada`,
  400 `corpo_invalido|concessionaria_invalida|protocolos_invalidos` (sempre com
  `detalhe` dizendo qual item).

**Chaves.** `ludmilla_api_keys`: `gdm_` + 40 hex, guardada **só como SHA-256**;
a chave em claro aparece uma vez, na criação. Criar/revogar = RPCs
`ludmilla_api_key_criar`/`_revogar`, só admin do tenant; a tela fica no
diálogo de acesso ao portal da concessionária (`ChavesDaApi`). A RPC
`ludmilla_api_status_registrar` só aceita `service_role` (quem a chama é a
edge function) e grava o run com `dados.origem = 'api'` e `pedido_por` = quem
criou a chave — no Registro aparece como visita da API.

**Mapa de status da Elektro (13/11/2026).** A recomendação vem de
`portal_status_map (tenant, connector, status_portal → project_status)`. O
casamento **normaliza** o status do portal com `ludmilla_normalizar_status()`
(MAIÚSCULAS, espaços colapsados, divide por `|` e ordena) **antes** de comparar
— a comparação é por texto exato, mas contra a forma NORMALIZADA. O usuário leu
as quatro frases do Portal GD e a migração `20261113120000_ludmilla_elektro_status.sql`
as semeou; a `20261113130000_ludmilla_elektro_status_mapa_normalizado.sql` as
regravou já na forma do normalizador
(`UPDATE … SET status_portal = ludmilla_normalizar_status(status_portal)`),
porque a primeira seed em caixa mista **não casava**: no 1º envio real, 0 de 50
status traduziram etapa (falha silenciosa). Traduções: "AGUARDANDO SOLICITAÇÃO
DE VISTORIA E CONEXÃO" → `approved`; "REALIZANDO VISTORIA E CONEXÃO" →
`vistoria_solicitada`; "EM ANÁLISE TÉCNICA" → `analysis`; "SOLICITAÇÃO
CONCLUÍDA" → `completed` (esta só vira cartão com vistoria aprovada dentro do
projeto). Os outros status do stepper ("Aguardando Documentação", "Ponto de
Conexão Aprovado", "Solicitação Cancelada") ficam **sem tradução** de propósito
— aparecem como novidade, sem sugerir etapa (mesmo critério da CPFL). **Regra
ao semear qualquer conector: o texto do mapa deve ser
`ludmilla_normalizar_status(texto)`, nunca o texto cru da tela.** Migrações
aplicadas à mão com `--yes`; o CI não roda migração.

**Extensão do Chrome (13/11/2026) — a leitura pela sessão da pessoa.**
`extensoes/ludmilla-elektro/`: Manifest V3 restrito a
`gdneoenergiaelektro.neoenergia.com`. A pessoa entra e abre a lista; a extensão
**só LÊ** a tabela que está na tela (não faz login, não clica em "Solicitar
Vistoria", não baixa nada) e manda `{ protocolo, status, titular }` para a API
acima. O leitor é JS puro em `leitura.js` (teste no vitest, `leitura.test.js`,
no `include` do `vitest.config.ts`); `content.js` lê a página sob pedido do
popup, `background.js` faz o POST com a chave `gdm_`, `popup`/`options` são o
botão e a tela da chave. Lê a **página aberta** da lista (ela é paginada).
Isto **substitui** o "fora de escopo" anterior: a leitura acontece na sessão
real da pessoa, sem disfarçar automação nem burlar a Akamai.

**1º envio real e o casamento pelo projeto mais novo (13/11/2026).** No primeiro
envio (50 solicitações) 39 casaram com projeto; os dois cartões de etapa reais
(PRJ-98694 `approved`→`vistoria_solicitada`, PRJ-54710 `analysis`→`vistoria_solicitada`)
só apareceram depois da correção do mapa acima. Atendendo à regra do usuário "o
projeto válido é o mais novo", a migração
`20261113131000_ludmilla_casamento_projeto_mais_novo.sql` faz a
`ludmilla_registrar_varredura` sempre escolher o projeto mais recente: o
casamento por **protocolo** ganhou `ORDER BY created_at DESC` e o por **titular**
passou de `s.visto_em DESC` para `p.created_at DESC` (CPF e UC já ordenavam por
`created_at DESC`). Reproduz a função viva (`pg_get_functiondef`) mudando só essas
duas linhas; vale para todos os conectores.

**Casar pelo nome do titular no cadastro do projeto (13/11/2026, noite).** O usuário
enviou a lista com um projeto novo **sem protocolo gravado** (PRJ-69492, ADRIANO MENDIETA
MACHADO, protocolo 2611135260) e ele não casou. Causa: o casamento "por titular" só
procurava **outro protocolo** do mesmo titular já ligado a um projeto em
`portal_protocol_state` (é o caso do reenvio com protocolo novo); nunca olhava o nome no
cadastro. E a lista da Elektro só traz protocolo, status e nome — sem CPF nem UC, as outras
chaves. A migração `20261113230000_ludmilla_casamento_pelo_nome_do_projeto.sql` (corpo do
`prosrc` vivo, md5 conferido antes de aplicar) muda duas coisas:

- **nome do titular do projeto** (`project_general_data.holder_name`, ou `projects.title` se
  vazio), só quando o portal **não mandou CPF nem UC** (a CPFL manda; para ela nada muda):
  projeto da **mesma concessionária** da conta, **sem protocolo**, fora de concluído, nome
  inteiro igual sem acento, caixa e espaço repetido, e **candidato único** — dois projetos com
  o mesmo nome e sem protocolo = nenhum casamento. Entra como `casamento = 'titular'`;
- o cartão de **gravar o protocolo** sai também para protocolo **já visto sem projeto**
  (antes, só para o nunca visto: quem passou uma vez sem casar nunca ganhava o cartão). Sai
  uma vez só: o estado passa a guardar o projeto.

Nada é aplicado sozinho: é o cartão de sempre na /ludmilla, para a pessoa confirmar. Prova
em transação desfeita com o envio das 19h39 (50 linhas, 12 sem projeto): função antiga 0
cartões; nova 5 — PRJ-69492 (com sugestão "Em análise"), PRJ-58601, PRJ-84489, PRJ-57938,
PRJ-57098; reenvio 0. As outras 7 não têm projeto ativo com o mesmo nome. **Limite:** nome
digitado diferente no cadastro (abreviação, erro de grafia) não casa — o cartão não aparece,
e o protocolo se grava à mão como antes.

Validador puro em `supabase/functions/_shared/ludmillaStatus.ts` (9 testes no
vitest); a RPC foi testada em transação com rollback (criação de chave, registro
ok, chave inválida, lista vazia).

#### A criação roda no navegador da varredura (13/10/2026)

Três tentativas, nesta ordem, e o que cada uma ensinou:

1. **Login próprio na CLI `agent-browser`** (17/09 a 12/10): falhou 4×, sempre
   no passo 0. O print guardado conta: **"Olá Usuário"** + **"Você não tem
   acesso a essa página"** — o B2C autenticava, mas a seleção de perfil
   ("Serviços para projetistas") não acontecia, e sem ela o Drupal nega tudo.
2. **Herdar a sessão da varredura por cookies** (12/10): o Playwright logava, os
   **21 cookies** iam para a CLI e eram **confirmados lá dentro** — e o portal
   recusou assim mesmo, com a navegação voltando **vazia**
   (`ERR_HTTP_RESPONSE_CODE_FAILURE`). Medição que fechou o diagnóstico: fora da
   VPS, a mesma CLI **sem sessão nenhuma** abre `meus-projetos` normalmente e
   recebe a página "Access denied". Resposta vazia só acontece na VPS → é
   **bloqueio no caminho contra aquele navegador naquele IP**, não falta de
   credencial.
3. **Rodar no navegador da varredura** (13/10, atual, PROVADO: simulacao do
   PRJ-05626 passou inteira em 72 s, todos os passos ok): o que o portal aceita, no
   mesmo IP, duas vezes por dia, há um mês.

O roteiro das 6 etapas **não foi reescrito**. Ele passou a falar com a interface
`Navegador` (`criacao/navegador.ts`) — `abrir`, `clicar`, `js`, `titulo`,
`url`, `esperar`, `esperarCarga`, `screenshot`, `limparRede`,
`ultimoPostHtml`, `definirCabecalhos`, `fechar`. Quem a cumpre agora é o
`AgentePlaywright`, que abre uma **aba** no contexto da varredura; a CLI
(`Agente`) continua cumprindo a mesma interface e um teste trava as duas lado a
lado, para nenhuma ficar para trás.

Consequências:
- **O login é o `logarNaCpfl` do conector** — o mesmo da varredura. Quebrou?
  Quebra para os dois, e conserta num lugar só.
- Depois do login, a criação **prova** a sessão (`JS_AUTENTICADO`: menu
  "GERENCIE SEUS PROJETOS" ou link "Sair") antes de começar o formulário.
- Nenhuma senha passa por CLI nenhuma; o cofre do agent-browser saiu do caminho.
- O **contexto é do laço**: na estação reaproveita a sessão viva; na VPS é do
  run e o laço fecha ao fim, como `destino()` faz com a varredura. A criação
  fecha só a **aba**.
- `ultimoPostHtml` virou escuta de respostas de documento POST — é o que diz
  **qual campo** o servidor recusou quando o Avançar não avança.

| Passo | Nome | O que faz | Seletores-chave (mapa de 17/09) |
|---|---|---|---|
| 1 | `introducao` | login da varredura na mesma aba → `gestao-projetos/criar-projeto` → link 60 → Introdução → "Conexão de microgeração" e **confere** `flux_type = conexão`. Nunca abre `node/add/project_60` direto (retoma formulário velho) | `a[href$="node/add/project_60"]`, `#edit-next-new-connection`, `#edit-field-flux-type-conexo` |
| 2 | `dados_uc` | **Orçamento de Conexão** (rótulo conferido), 3 × Não (`-0`), UC + Buscar, espera Nome do Cliente, Empresa = CPFL, Lat/Long DMS, 2 × Não (`-1`!), perguntas condicionais, FormData, Avançar | `#edit-field-quotation-options-60-connection`, `#edit-field-consumer-unit-0-consumer-unit-code`, `…-send-uc-code`, `[id^="edit-field-consumer-unit-0-latitude"]`, `#edit-next` |
| 3 | `dados_projeto` | título, Não, ENERGIA SOLAR (2721), data +30 (JS), Geração Local (2771), categoria (regra do front), GED 13 (2761), aéreo (2866), fases (2751), **Cabos = nº de fases**, caixa, carga = Demanda, disjuntor da regra, geração (651, módulos kWp, área, inversores); **FormData dos totais conferido**; Avançar | ids `edit-field-*` e `#edit-field-complementary-generation-0-subform-field-*` |
| 4 | `dados_cliente` | Pessoa Física, Consultar CPF (espera Nome), celular/e-mail só se vazios, endereços = instalação, 2 × Sim (`-1`!); em autoconsumo remoto, o bloco de beneficiárias (abaixo) | `[id^="edit-field-physicalperson-0-*"]`, `[id^="edit-field-address-type-mesmo"]`, `…authorize-pay-connec-costs-1`, `…solicitacao-de-vistoria-1`, `[id^="edit-field-uc-list-percent-0-send-uc-code"]` |
| 5 | `revisao` | print da revisão e **Salvar** → URL `/node/<id>/edit?step=6` → `projects.cpfl_node_id`. `run.dados.simular = true` para antes — **sem botão desde 02/11/2026** (o envio de verdade foi validado em geração local: 11 envios concluídos até 04/11; o autoconsumo remoto ainda não concluiu nenhum, ver abaixo); fica só para testar uma mudança do portal, pedido à mão | `#edit-next-save-draft` |
| 6 | `concluido` | **para** em "Envio de documentos" (27 inputs `files[field_*]` mapeados para a fase seguinte) | `#edit-next-send-later` / `#edit-next` — não clica |

**O print de cada passo é a etapa preenchida (05/11/2026).** Cada passo termina
clicando em Avançar, e o print era tirado depois: o painel mostrava a etapa
SEGUINTE, vazia (o passo "Dados da UC" mostrava "Dados do projeto" em branco).
Agora `passo()` entrega ao corpo a função `foto`, que abre as sanfonas fechadas
(`JS_ABRIR_SANFONAS`, só `button[type=button]` visíveis) e grava
`passo-N-preenchido.png`; `avancar()` a chama antes do clique. Introdução e
Revisão também fotografam antes de clicar. Se o passo falhar, o print é o da tela
da falha; `passo-N-inicio.png` continua no bucket. Envios antigos seguem com os
prints antigos. **Não confiar em `aria-expanded`:** a primeira sanfona de cada tela
vem aberta dizendo `false`, e clicar a fecharia. Fechada é a sanfona com altura só
do título.

**Latitude e longitude com 2 dígitos (05/11/2026).** A máscara do campo só olha os
dígitos e os encaixa em `GG° MM' SS.SS"`. O robô digitava `23° 6' 59.0"`, e o portal
guardava `23° 65' 90.00" S` sem erro nenhum na tela (visto na Revisão do PRJ-15238).
Qualquer minuto ou segundo abaixo de 10 sofria esse deslocamento. `decimalParaDms`
agora completa com zero, e `definirCoordenada` relê o campo e **para o envio** se
grau, minuto ou segundo mudarem. Dos 9 projetos enviados antes da correção, 4 têm
coordenada nessa condição (PRJ-08969, PRJ-36600, PRJ-56268, PRJ-81683). Os prints
antigos não mostram a latitude, então o valor deles ainda precisa ser conferido no
portal.

**Bloco de beneficiárias (`preencherBeneficiarias`, corrigido em 05/11/2026).** O
primeiro envio real em autoconsumo remoto (PRJ-15238, 04/11) parou em "Busquei a
UC… e a linha dela não apareceu". O mapa da falha mostrou "Percentual" marcado, o
campo da UC vazio e a lista sem linhas. Três regras saíram daí:
- **Buscar é clique de verdade** (`ag.clicar`), como os outros Buscar/Consultar:
  o AJAX do Drupal em botão escuta `mousedown` e cancela o `click`, então
  `el.click()` por JS não faz nada;
- **esperar o AJAX** (`esperarAjax`, `jQuery.active`) depois de marcar "Percentual"
  e de preencher cada %: a resposta redesenha o bloco e apaga o que foi digitado
  antes dela. Sem retorno em 12 s, digita e busca de novo (mais 25 s);
- **as linhas são uma tabela com um cabeçalho só** (o botão "Hide lower priority
  columns" é do `tableresponsive` do Drupal): o rótulo não fica ao lado do valor,
  e `JS_BENEF_LINHAS` lê a `<tr>` pela ordem: UC, endereço, titular, documento.

Em erro de passo com o bloco na tela, o robô sobe também
`criacao-passo-N.beneficiarias.html`. O teste
(`test/criacao-beneficiarias.test.ts`) reproduz o comportamento descrito, com o
mesmo erro antes da correção. Simulação real em `a9405aa` (PRJ-15238, 05/11): 70%,
30%, geradora 0,0000% e latitude 23° 06' 59.00" S, com as sanfonas abertas nos
prints. A simulação para antes do Salvar: o 1º envio real ainda precisa concluir.

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

### Novo envio e a lista de envios (03/11/2026)

Quando a CPFL **reprova**, a equipe refaz o envio — e "o reenvio nada mais é do
que criar o projeto novamente" (usuário, 03/11/2026). **Um clique só**: o botão
**Novo envio** já manda a Ludmilla criar de novo, sem etapa intermediária.

- **Painel no modal** (`CriarNaCpflPanel`, só equipe GD Manager):
  - sem número: como antes — **Criar na CPFL** / **Tentar novamente** (quando o
    último envio deu erro), modalidade e o bloqueio das beneficiárias;
  - com número e nada rodando: faixa verde "Projeto registrado na CPFL — nº X" +
    **Novo envio** (desabilitado, com o motivo em vermelho, quando há bloqueio
    das beneficiárias). Confirmação: "A Ludmilla vai criar outro projeto na CPFL
    com os dados de hoje. Use quando a CPFL reprovou. O nº X fica guardado no
    histórico.";
  - **Envios**: um item por run `criar_projeto` do projeto ("Envio 2 ·
    03/11/2026 14:02 · criado, nº 613100"), clicável, que abre os passos com os
    prints **daquele** envio. Os passos só são consultados quando o envio está
    aberto ou ativo. Abre sozinho o envio ativo, ou o último se terminou há até
    1 h (o comportamento do antigo "run recente", que saiu). O número de cada
    envio é só o `resultado.node` do próprio run, nunca o do cadastro.
  - Lista e rótulos: `src/lib/criacaoCpfl.ts` (`listarEnvios`, puro, testado);
    hooks `useEnviosCpfl` (5 s enquanto há envio ativo; quando ele termina, relê
    o projeto para o número novo aparecer) e `useNovoEnvioCpfl`.
- **RPC** `ludmilla_cpfl_novo_envio(p_account_id, p_project_id, p_node_atual)`
  (`20261103120000`, `SECURITY DEFINER`, `authenticated`/`service_role`, sem
  `anon`): só a equipe da Ludmilla; projeto e conta CPFL do tenant de quem pede;
  trava a linha do projeto; recusa envio em andamento (é o que o segundo clique
  recebe — conferido antes do número), projeto sem número ("use Criar na CPFL")
  e número diferente do que a tela mostrava (tela velha). Grava `project_history` "Novo envio à CPFL" com o número
  anterior e o autor, **limpa `projects.cpfl_node_id`** e enfileira por
  `ludmilla_pedir_run` um `criar_projeto` com `dados.reenvio_de` = número
  anterior. O robô **não mudou**: ele continua recusando criar quando há número,
  e é a RPC que o limpa; ao salvar, `ludmilla_salvar_node_cpfl` grava o número
  novo. Gatilhos de `projects` conferidos: só `updated_at` muda (tarefas
  automáticas são `UPDATE OF status`).
- **Prints**: cada envio é um run, e os prints já ficam por run
  (`portal_criacao_passos` + `ludmilla/{tenant}/criacao/{run_id}/`) — nada apaga.
- O acompanhamento já casava "reprovado reenviado sob protocolo novo" por
  CPF/UC/título (ver "CPFL pela API interna…"): nada mudou lá.
- **Ponto aberto:** as beneficiárias travam para a equipe enquanto há número, e
  o Novo envio limpa o número e já enfileira — então uma beneficiária errada
  não tem como ser corrigida **antes** do novo envio. Os demais dados do projeto
  (UC, titular, equipamento) se corrigem antes de clicar.

## Próximos

0. ~~**Primeiro run da EDP por e-mail**~~ — **feito em 10/11/2026, 22h27**, pelo
   "Ler agora" do usuário: 8 projetos conferidos, 8 documentos anexados, 0 bloqueados
   por titular, 2 imagens descartadas, 2 e-mails não reconhecidos, 0 falhas. **Desde
   13/11/2026 a EDP é lida de hora em hora no expediente** (ver "A cobrança da troca
   do relógio e a leitura de hora em hora"). Pendências pequenas que ficaram para depois dele:
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
0b. **Primeiro run da ENEL por e-mail** — manual e acompanhado, antes de
   qualquer agendamento, pelo
   [roteiro](../../superpowers/2026-10-20-primeiro-run-enel-email.md). Antes
   dele, nesta ordem: o **push do worker do fechamento A** (o `origin/main` ainda
   não o tem) e, depois, **atualizar o robô da VPS** (`ludmilla-worker.yml`, à
   mão; ver o roteiro, passo 1.3, com a trava de que o GitHub tenha o código). O
   primeiro push e a `ludmilla-parecer` (v108, com o modo ENEL) já estão no ar
   desde 22/10. Até o robô novo subir, "Verificar agora" no cartão da ENEL roda
   no modo da EDP (foi o incidente de 14/10). Depende do usuário:
   - "a troca … já foi realizada através da nota de serviço" existe em e-mail da
     ENEL e hoje **só anota** (a robô não a classifica): vira sino ou sugestão
     de Concluído?
   - os cartões do portal CPFL em que o "Aplicar" deixou de gravar o protocolo
     (22/09 a 16/10, três cartões em dois projetos): pelos históricos, o
     PRJ-36467 deve ficar com 2233593787 e o PRJ-89660 com 2250770386. A função
     já foi consertada; os projetos **não** foram mexidos, falta o OK do
     usuário.

   Pendências pequenas (resíduos aceitos, com o motivo) estão em "O que NÃO está
   provado" da seção da ENEL. **Fase 2** — pedir a troca do relógio por e-mail —
   é enviar e-mail em nome da empresa: só depois de conversar (spec §13).
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
5. **Conferir a titularidade na CPFL antes de criar** (pedido do usuário em
   09/11/2026, para depois). A Ludmilla percorre o começo do caminho da criação,
   cola a UC e lê o nome do titular que o portal mostra, **sem salvar nada**.
   Vale para a geradora e para cada beneficiária. Acha antes da criação o que
   hoje só aparece no meio dela ("Normalmente é UC de outro titular") ou como
   falso alarme (PRJ-09896, 09/11). O roteiro de criação (`roteiro-cpfl60.ts`)
   já tem quase tudo pronto:
   - **o caminho até o campo:** login da varredura → Criar Projeto pelo menu →
     projeto 60 → "Conexão de microgeração" → passo 2, "Dados da unidade
     consumidora". São duas telas, antes de qualquer Avançar;
   - **a leitura:** `Nº da UC` → Buscar (clique de verdade, com 2ª tentativa) →
     espera `customer_name` ganhar valor. O mesmo Buscar devolve distribuidora,
     classe, tensão e se a UC já tem GD. Hoje esses dados vão para `leituras`,
     mas o nome não;
   - **o write-back:** `ludmilla_beneficiarias_confirmar` casa pela UC e aceita
     qualquer run cujo `dados.project_id` seja o projeto.

   Falta decidir ou provar antes do plano:
   - se a UC pode ser trocada no mesmo campo e buscada de novo (depois do 1º
     Buscar os ids ganham sufixo) ou se cada UC pede um formulário novo;
   - o passo 2 traz o **nome**, não o CPF. Comparar nome exige tolerância
     (abreviação, acento) e, na dúvida, mostrar os dois nomes para uma pessoa
     decidir. O CPF só vem no Buscar das beneficiárias, no passo 4, depois de
     preencher o projeto inteiro;
   - a RPC de write-back sempre **desmarca** `holder_mismatch`, e a
     conferência precisa conseguir marcar "diferente": outra RPC ou um
     parâmetro;
   - se roda por clique (no bloco de beneficiárias ou no painel "Criar na
     CPFL") ou sozinha quando a UC é cadastrada, com tipo de run próprio em
     `portal_sync_runs`;
   - **nunca** Avançar nem Salvar. Também é preciso confirmar que o formulário
     largado no passo 2 não vira rascunho na CPFL. A criação sempre entra pelo
     menu, então não retoma um formulário largado.

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
é `portal` ou `email`. A CPFL continua `portal`, a EDP e a ENEL são `email`. Não
existe conta com os dois. Entre as de e-mail, `portal_accounts.identificacao`
diz como o projeto é descoberto: `protocolo_no_assunto` (a EDP, esta seção) ou
`remetente` (a ENEL, seção "Acompanhamento por E-MAIL — a ENEL", mais abaixo).

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
(`045000000001` equivale a `45000000001`) — confirmado contra três pares reais
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
`NOTAS 45000000001 e 45000000002` roda `tratarMensagem` duas vezes para a mesma
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
   protocolo** (`PARECER_45000000001.pdf`; `separarPorProtocolo`). Arquivo que
   traz os **dois** números é ambíguo e não vai para nenhum card. A IA lê o PDF
   **desse protocolo**, não o maior do e-mail — então o titular confere contra o
   documento certo.
3. **Se nenhum arquivo casar pelo nome, não anexa nada**: a IA nem é chamada, a
   linha fica `concluida = true` com `motivo` ("o e-mail cita N protocolos e não
   consegui dizer qual documento é de qual … confira à mão"), e cai no grupo
   "Terminei, mas com um porém" da tela. No `resultado` do run vai em
   `sem_dono` — **não** em `bloqueados`, que a tela rotula como "titular
   divergiu".

**Com UM protocolo citado e nomes de arquivo genéricos** (`parecer.pdf`,
`documento.pdf`, `image001.png`) nada muda: anexa todos os não-imagem e lê o
maior PDF. Regra que não anexa nem lê PDF não depende de arquivo e não é afetada.

### O PDF que a IA lê: o que traz o NÚMERO no nome (02/11/2026)

`pdfDoParecer` escolhia sempre o **maior** PDF. O e-mail `NOTA - 40008312722`
(PRJ-92427, protocolo `040008312722`) traz dois: o `Termo Operativo…` e a carta
`040008312722….pdf`. A carta é a que tem o número no nome, e o maior pode ser o Termo.

Regra nova (`pdfDoParecer(anexos, protocolo)`, `util.ts`), para as duas
concessionárias: entre os PDFs, os que trazem no **nome** o número do protocolo do
projeto — dígitos sem zero à esquerda, como número inteiro contíguo
(`nomeCitaProtocolo`: `4000831272299` não é `40008312722`) — são os candidatos, e
entre eles vale o maior. Sem nenhum assim, continua o maior de todos. Empate fica com o
primeiro. Número de **outro** protocolo no nome não ganha nada. Os dois arquivos
continuam indo para o card: só a **leitura** é de um. A EDP passa `p.protocolo`; a ENEL
passa o número do projeto que o **texto** já achou (ver a seção da ENEL).

**Vale também para a regra `ENVIO DE PARECER`** (a mesma chamada em `email/index.ts`). Conferido
em 03/11 (só leitura) se em algum e-mail dela, com mais de um PDF, o PDF com o número no nome
**não** seria o parecer: **não deu para conferir com dado** — a EDP nunca rodou (0 mensagens, 0
anexos em `portal_anexos`), o Claudinho guardou os 3 "ENVIO DE PARECER" (08–09/2026) sem nenhum
anexo, e nenhum documento de projeto traz número de nota da EDP no nome. O que se sabe é o padrão
da EDP descrito no E1 (`PARECER_<nota>.pdf`), que a regra favorece. Se um dia vier um segundo PDF
com o número que não seja o parecer, a escolha é o maior **entre os que têm o número**, e a trava
do titular continua conferindo o que foi lido. Olhar no primeiro run da EDP (`arquivo_lido`).

### Nome de arquivo com o número de OUTRO protocolo (E1b, 12/10/2026)

A rodada 3 só olhava o nome do arquivo quando o assunto citava **vários**
protocolos **nossos**. Sobravam duas lacunas, que levavam ao mesmo resultado do
E1 (documento de um cliente no card de outro): (1) o assunto cita dois protocolos
e só um é nosso — o outro é de projeto concluído, de outra conta ou fora do teto
de 80 —, então a contagem dá 1 e anexava tudo; (2) com um protocolo só, um
arquivo com o número de **outro projeto nosso** no nome também era anexado.

A regra agora vale **sempre** (com um protocolo ou vários), para regra que anexa
ou lê PDF: **arquivo cujo nome carrega um número de protocolo DIFERENTE do que
está sendo tratado não vai para este projeto** (`tirarDeOutroProtocolo`). Não se
compara com a lista de projetos: "é diferente do que estou tratando" vale mesmo
que o outro número não seja de projeto nenhum nosso.

| Nome do arquivo | Resultado |
|---|---|
| sem número de protocolo reconhecível | como sempre: não é sinal, não barra |
| traz o número do protocolo em tratamento (com ou sem zero à esquerda) | anexa |
| traz um número de protocolo **diferente** | não anexa a este projeto |
| traz o deste **e** o de outro (ambíguo) | não anexa |

**"Número de protocolo reconhecível" no nome** = sequência **contígua** de **11 ou
12 dígitos**, contados depois de tirar os zeros à esquerda
(`DIGITOS_DE_PROTOCOLO_NO_NOME` em `util.ts`); compara-se como `casaProtocolo`:
por dígitos. É estreita de propósito, porque a regra **barra** arquivo e o erro
caro é o falso positivo (documento legítimo que não chega ao card). Ficam de
fora, por forma: data (8 dígitos), UC e telefone com DDD (10), epoch em ms (13),
carimbo `AAAAMMDDhhmmss` e CNPJ (14), linha digitável de boleto (44+) e CPF/CNPJ
pontuado. O custo do outro lado: protocolo de outra concessionária fora de 11–12
dígitos não é visto (e o nome sem número reconhecível segue valendo como antes).
Limite conhecido: CPF **sem pontuação** (11 dígitos) é indistinguível de
protocolo pela forma.

Quando barra, o arquivo **não abre linha** em `portal_anexos`, a IA **não lê** o
PDF dele, e o `motivo` diz `N arquivo(s) não anexado(s): o nome traz o número de
outro protocolo, diferente do deste projeto (nomes…)`. Os nomes vão para o banco,
nunca para o log (que leva só a contagem). Se **todos** os arquivos forem de
outro, a mensagem vira `sem_dono` (concluída, IA fora, "confira à mão"); se sobra
algum arquivo, segue `tratado` com a ressalva.

**Dois contadores, duas unidades.** `sem_dono` conta **mensagens** (o
tratamento em que nada ficou seguramente deste protocolo). `anexos_de_outro_protocolo`
conta **arquivos** barrados por esta regra, e pode ser > 0 sem `sem_dono` (o
genérico do mesmo e-mail foi anexado). **Não conta a divisão normal** de um e-mail
com dois protocolos **nossos**: ao tratar o A, o arquivo do B é barrado, mas é o
fluxo do E1 funcionando — contar subiria o aviso justamente quando está tudo certo.
Só conta o arquivo cujo nome traz um número que o e-mail **não serve**.

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

### As regras da conta EDP (dado, não código — 02/11/2026)

Decisão do usuário (02/11/2026, "NOTA e CARTA DE OBRAS"). Gravado pela seção 2 da
migração `20261102120000`, só nas regras que ainda estavam como antes (edição feita
pela tela vence):

| Regra | Antes | Agora |
|---|---|---|
| `NOTA -` (qualquer remetente) | `tipo_documento='nota'`, `ler_pdf=false` | `tipo_documento='parecer'`, `ler_pdf=true` |
| `CARTA DE OBRAS` (`edpdocumentoporemail`) | `carta_obras`, `ler_pdf=false` | `carta_obras`, `ler_pdf=true` |
| `ENVIO DE PARECER` (`relacionamento.edp`) | `parecer`, `ler_pdf=true` | sem mudança |

- **A NOTA vira `parecer`** porque é a única forma de `recomendacaoDoVeredito` sugerir
  etapa (`favoravel → approved`, `pendencia → pendencia`): a carta da NOTA vem às vezes
  aprovada, às vezes reprovada. Com `ler_pdf`, ela passa também pela trava do titular
  (`conferir`) e paga a leitura (~US$ 0,10 por PDF).
- **A CARTA DE OBRAS é lida** (veredito e resumo no cartão), mas **sem sugestão de
  etapa**: `recomendacaoDoVeredito` só sugere para `parecer`, e o usuário não definiu o
  que ela significa.

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

**O run nunca rodou.** Toda a verificação é de tipo, teste unitário (225 testes
num build limpo, `fail 0`) e SQL executado à mão (em `begin; … rollback;`). O laço
de `executarVarreduraEmail` não tem teste — a spec §9 manda para o teste manual de
ponta a ponta; só a soma dos contadores e o `resultado` do run (`somarTratamento`,
`resultadoDoRun`) foram extraídos e têm teste. O primeiro run é **manual e acompanhado**, e nele vale olhar:
`bloqueados` (o bloqueio por titular nunca rodou contra PDF real),
`imagens_ignoradas`, `sem_dono` (e-mail em que nenhum arquivo é seguramente deste
protocolo — mensagens), `anexos_de_outro_protocolo` (arquivos cujo nome traz o
número de outro protocolo — arquivos), `anexos_recusados` (p7s, dwg, zip, acima de
10 MB), `anexos_sem_nome`,
`nao_lidas`, `a_tentar_de_novo`, o tempo do run, e se aparece algum `imap-uid-` no
log (envelope sem `Message-ID`: aí o uid vira o id do dedupe, e se a caixa for
recriada a mensagem é tratada de novo). Só depois disso se fala em agendamento.

A tela **ainda não mostra** `sem_dono`, `anexos_de_outro_protocolo`,
`anexos_recusados` e `anexos_sem_nome` como contadores (a rodada 3 não tocou em `src/`): leia-os do `resultado` do run
(SQL no roteiro do primeiro run). As linhas com ressalva já aparecem no grupo
"Terminei, mas com um porém".

**Lacunas do E1 — fechadas pelo E1b** (12/10/2026): o assunto com dois
protocolos de que só um é nosso, e o arquivo com o número de outro projeto nosso
no nome com um protocolo só. Ver "Nome de arquivo com o número de OUTRO
protocolo". **O que ainda sobra desta família**: arquivo de nome **genérico**
(`parecer.pdf`, `documento.pdf`) num e-mail cujo assunto cita um protocolo nosso e
outro que não é nosso — o nome não diz de quem é, e vale "nome sem número não é
sinal". O que protege é o titular do PDF, conferido pela IA contra o do projeto;
sem IA (fora do ar), o protocolo é a única barreira. Também não é visto: número de
protocolo no nome com menos de 11 ou mais de 12 dígitos, ou com pontuação.

**Dois projetos ativos da EDP estão sem número de protocolo** — não há o que
buscar, e eles ficam fora da automação até ganharem protocolo.

Risco latente conhecido: se uma conta algum dia fizer portal **e** e-mail,
`ludmilla_anexos_pendentes` entregaria uma chave de e-mail ao `baixarAnexo` do
portal. Hoje não ocorre.

## Acompanhamento por E-MAIL — a ENEL (out/2026)

Spec [2026-10-13-ludmilla-enel-email-design.md](../../superpowers/specs/2026-10-13-ludmilla-enel-email-design.md)
(com a seção "O que mudou na implementação") ·
plano [2026-10-13-ludmilla-enel-email.md](../../superpowers/plans/2026-10-13-ludmilla-enel-email.md) ·
roteiro do primeiro run [2026-10-20-primeiro-run-enel-email.md](../../superpowers/2026-10-20-primeiro-run-enel-email.md)

Pedido do usuário (13/10): "toda tratativa e atualização é por email… no corpo do
email e/ou dentro do anexo sempre tem alguma referência do projeto, seja
protocolo, seja nome do titular, número da UC". O Claudinho (`scan-emails`) já
recolhia os e-mails da ENEL, mas só olha o corpo: dos 305 recolhidos ele ligou 29
(≈10%) a um projeto, e **0 das 31 Cartas** do `nao.responda` — a referência mora
no anexo. A Ludmilla lê a caixa **pelos remetentes da ENEL**, descobre de qual
projeto é cada e-mail, anexa o documento no card e **sugere** a etapa. Os dois
rodam: o Claudinho segue como está, e o mesmo e-mail pode gerar sugestão no
`/email-updates` e na `/ludmilla`. Ela nunca move card e nunca envia nada.

### A direção é invertida

| | EDP | ENEL |
|---|---|---|
| Ponto de partida | o **projeto** (cada protocolo em andamento) | o **e-mail** (cada remetente das regras) |
| Busca na caixa | pelo número do protocolo | `SEARCH FROM <remetente> SINCE <hoje − 120 dias>` (sino só para e-mail de até 30 dias) |
| Identificação | protocolo **no assunto**, chave única | protocolo/NT, UC ou nome, no assunto, no corpo **ou no PDF** |
| Chave da linha da mensagem | o protocolo | **fixa, `''`** (`CHAVE_DA_MENSAGEM_ENEL`) |
| Run | `executarVarreduraEmail` (não foi alterado) | `executarVarreduraEnel` (`worker/ludmilla/src/email/enel/run.ts`) |

Quem escolhe é a **conta**: `portal_accounts.identificacao` (`protocolo_no_assunto`
ou `remetente`, com CHECK no banco). `worker/ludmilla/src/email/rotear.ts` lê a conta
(`ludmilla_email_conta`) e despacha; na estação local o caminho é o de sempre (que
recusa o run de e-mail com uma explicação). O caminho da EDP não foi tocado: os
testes dela seguem sem edição, e a edge function foi comparada com a de antes para a
EDP (54 entradas do revisor, 0 diferença).

### A conta e as 8 regras

A conta (`connector = 'enel'`, `acompanhamento = 'email'`, `identificacao =
'remetente'`) foi semeada no tenant de biblioteca **sem `login` e sem
`secret_id`**. As regras são editáveis na tela, como as da EDP. Assunto `''` =
qualquer assunto daquele remetente; o `tipo_documento` é só uma **dica** — o que o
e-mail É sai do texto e do PDF.

| Remetente | Tipo | Anexa | Lê o PDF |
|---|---|---|---|
| `nao.responda@enel.com` | `carta_projeto` | sim | sim |
| `tecnico.abc@enel.com` · `.norte` · `.oeste` | `resultado_vistoria` | sim | sim |
| `canalgd.sp@br.enel.com` | `troca_relogio` | sim | sim |
| `no-reply@enel.com` | `resposta_automatica` | não | não |
| `postmaster@enel.com` | `devolucao` | não | não |
| `atendimento.edsp@enel.com` | `resultado_vistoria` | sim | **não** (o status está no assunto) |

**O `atendimento.edsp` não é comunicado em massa.** A spec e a primeira semente
disseram que era, e o ignoravam. Os 21 e-mails dele são **avisos por projeto**, com
a NT e o resultado no assunto ("Comunicado técnico sobre a nota: <NT> - Vistoria
aprovada", 16 vezes, e "… reprovada", 5). A consulta que descreveu o padrão cortava
o assunto em 4 palavras e perdia o status. Como `comunicado` nem é buscado
(`remetentesParaBuscar` o exclui), a robô perderia o sinal de vistoria mais
estruturado que a ENEL manda. Corrigido pela `20261014120000`, que só mexe na regra
se ninguém a tinha editado pela tela.

### Os números da ENEL e o princípio "nossos números"

As respostas da ENEL são cheias de números de naturezas diferentes:

| Número | Tamanho | É do projeto? |
|---|---|---|
| **NT** (nota técnica) | 9 dígitos | sim — na ENEL o protocolo do projeto **é** a NT |
| **UC / instalação** | 10 caracteres no cadastro; às vezes **8 dígitos**, sem os zeros ("0088101266" × "Instalação: 88101266") | sim |
| Nota de serviço | 12 dígitos | da troca do relógio, não do projeto |
| Protocolo de contato | 10 dígitos | **não** (atendimento) |
| Atendimento SF | "SF" + dígitos | **não** |

O protocolo de contato tem o **mesmo tamanho da UC**. Por isso o princípio
(`identificar.ts`): **a robô procura os NOSSOS números dentro do e-mail; nunca
trata um número qualquer do e-mail como protocolo.** Um número que não é de nenhum
projeto nosso simplesmente não casa com nada. A comparação é por **número inteiro**,
sem zeros à esquerda, e os mínimos são diferentes de propósito: NT e protocolo com
**9+** dígitos (`MIN_DIGITOS`), UC com **7+** (`MIN_DIGITOS_UC`). Com 9 para tudo,
a UC curta nunca casava: em 21/10, 17 dos 30 projetos ativos têm UC de 8 dígitos
sem os zeros (eram 17 dos 34 em 13/10) — metade da identificação por UC, o sinal
presente em todos os projetos. A mesma regra vale na edge function
(`MIN_DIGITOS_UC = 7`, `MIN_DIGITOS_NT = 9`) e em `nomeTrazOutroProjeto`. O risco
de 7–8 dígitos é um número aleatório do e-mail ser **exatamente** a UC de um
cliente; o conflito número × nome e a trava de titular do documento ainda pegam o
resto.

### A escada de identificação

`ludmilla_email_projetos` entrega **todos** os projetos da concessionária da conta
(inclusive concluídos e arquivados; `ativo = false`): o número de um projeto
concluído **reconhece** o e-mail ("é de um projeto já concluído") e barra arquivo de
outro projeto, mas nada vai para o card dele.

1. **Texto, sem IA** (`identificarPorTexto`): protocolo/NT e UC no assunto + corpo. O
   "protocolo" é o do cadastro **ou** uma NT que ela já aprendeu (`ProjetoEnel.nts`, ver
   "A NT que ela já aprendeu").
2. **Documento, com IA** (`identificarPorDocumento`): a `ludmilla-parecer` devolve
   NT, UC e titular do PDF, e a robô casa com os projetos do mesmo jeito. A IA às
   vezes troca NT e UC de campo, então os dois números valem contra os dois
   identificadores do projeto.
3. `combinar` junta os dois: discordando é conflito; concordando fica o sinal mais
   forte (protocolo > UC > nome).

| Sinais encontrados | O que a robô faz |
|---|---|
| NT/protocolo **ou** UC de exatamente um projeto | anexa; selo `protocolo` ou `uc` |
| só o nome, e é **único entre os ativos** | anexa; selo `titular` (decisão do usuário, 13/10) |
| só o nome, e casa mais de um ativo | **não anexa**; levanta a mão |
| número de um projeto, nome de outro | **não anexa**; levanta a mão |
| números de mais de um projeto; ou texto e PDF apontando para projetos diferentes | **não anexa**; levanta a mão |
| o número é de projeto concluído/arquivado | **não anexa**; anota (`inativo`) |
| nada casou | anota "não reconheci"; aparece no grupo da tela |

"Levanta a mão" = linha no grupo de atenção da `/ludmilla` com o motivo e
`concluida = true` (não é falha passageira; insistir não resolve). "Ler de novo"
recupera depois que o cadastro for corrigido. **Se a nova leitura achar OUTRO
projeto** (o cadastro foi corrigido, ou a segunda leitura leu o PDF e a primeira só o
texto), o banco **abre um cartão novo para o projeto novo — quando a leitura pede
cartão** (`p_abrir_cartao`: há etapa sugerida, troca de protocolo ou bloqueio; sem
nada disso só a mensagem é gravada e nenhum cartão nasce) — e o cartão pendente do
primeiro fica intacto (C-1 da revisão final, migração `20261022120000`, aplicada). Antes
disso, a chave da mensagem da ENEL é fixa (`''`), então a 2ª leitura corrigia o
cartão pendente da 1ª: ele passava a levar a recomendação, o protocolo e a troca do
projeto B, e o "Aplicar" gravava etapa e protocolo **no projeto A**. Hoje o
`_upd` (cartão da mensagem) só é reaproveitado se for do mesmo `project_id`; se não
for, é descartado e nasce um cartão novo (a mensagem, uma só por chave, passa a
apontar para ele).

### O nome do titular — por que é um trecho inteiro

O nome vale **só no assunto**: o corpo traz a assinatura de funcionário da ENEL, e
um cliente homônimo casaria com ela. E só quando um **trecho inteiro** do assunto,
separado por ` - ` (hífen, meia-risca ou travessão, com espaços) ou por `:`, é o
nome (`trechoConforma`); "RE:" e "Undeliverable:" viram trechos próprios. Os
assuntos da equipe isolam o nome ("TROCA DE RELÓGIO - <NOME> - NT …"); nome sem
separador em volta ("PROJETO GD JOSE SANTOS 5KWP") **não** identifica, e a robô
fica com os números ou levanta a mão.

Por que tão estrito: **quatro rodadas** fecharam um homônimo e abriram outro, porque
a regra era por substring ("o primeiro e o último nome numa janela"): "JOSE MARIA
SANTOS" casava "JOSE CARLOS SANTOS"; "ALFA 2" casava "ALFA"; "MARIA JOSE SANTOS"
casava "JOSE SANTOS". Trocar a regra por "o nome ocupa um trecho inteiro" fechou a
família. As regras são as mesmas para o assunto e para o documento:

- primeiro e último nome nas pontas, na ordem do cadastro; nada livre antes nem depois;
- no meio, cada palavra é a do cadastro (inclusive as curtas, como LU), um
  **conector** solto (DA, DE, DO, DAS, DOS, E), ou a **inicial** de um nome do meio
  alfabético que não seja conector ("MARIA A. SILVA"; o "D" não é "DE"); o nome do
  meio pode faltar, mas **nunca** vir diferente;
- **todo token com dígito é obrigatório** e inteiro: "POSTO 1" não casa "POSTO 17",
  "2B" não casa "2A";
- **sufixo de empresa** (LTDA, EPP, EIRELI, MEI, ME, "S/A", "S.A.") pode faltar de
  um lado; "SA" sozinho é sobrenome (Sá) e não entra;
- **sufixo de geração** (JUNIOR/JR, FILHO, NETO, SOBRINHO, II, III, IV, SEGUNDO,
  TERCEIRO) tem de ser o mesmo dos dois lados, ou faltar nos dois — pai e filho com
  o mesmo nome é comum, e o filho concluído mandaria o e-mail para o card do pai.
  "BAR DO NETO" e "ANTONIO NETO" continuam sendo nome, não sufixo.

E o nome sozinho só identifica quando é **único entre os ATIVOS**. Custo do rigor: um
assunto com o nome grafado diferente do cadastro deixa de identificar e cai nos
números ou levanta a mão — o lado seguro. O nome é sinal de **reserva**: os 18
e-mails reais examinados em 14/10 traziam todos a NT no assunto.

### A trava de titular do documento

Depois de achar o projeto por número, a robô compara o titular que a IA leu no PDF
com o do cadastro. Divergindo, **não anexa** — é o único bloqueio do fluxo, como na
EDP (`titularDeOutraPessoa`, `decidir.ts`). Usa `mesmoTitular` nos **dois
sentidos**: o projeto já foi achado por **número**, então a trava existe para pegar
**uma pessoa diferente**. "CELINA MOURAO" × "CELINA DE FARIAS PRUDENTE MOURAO" é a
mesma pessoa de qualquer um dos lados e passa; o mesmo primeiro e último nome com o
nome do meio trocado bloqueia (era o que o `casaTitular`, da EDP, deixava entrar no
card errado). Um nome que **não bate nem consigo mesmo** ("LU SANTOS NETO", "ANA ME
LTDA": sem dois nomes de 3+ letras) conta como **falta de dado**, nunca divergência —
senão o próprio nome se bloquearia.

**Razão social cortada no documento não bloqueia** (decisão do usuário, 24/10/2026, caso
real do PRJ-51472: o PDF dizia "Comercial Renova Recuperadora De Pecas" e o cadastro
trazia a razão social inteira, "… ACESSÓRIOS PARA VEÍCULOS E AUTOMOTORES LTDA"; duas
mensagens do `tecnico.oeste` achadas pela UC foram bloqueadas à toa). Os dois nomes
contam como a mesma empresa quando **todas** as condições valem
(`mesmaEmpresaAbreviada`, `identificar.ts`): (1) o projeto foi achado por **número**
(`protocolo` ou `uc`) — achado pelo nome, o nome é a única prova e a trava segue inteira;
(2) um dos nomes é de **PJ** (termina em LTDA, EPP, EIRELI, ME, MEI ou S/A) — pai × filho
("JOSE CARLOS SANTOS" × "… FILHO") continua bloqueando, porque nenhum é empresa; (3) sem
acento, pontuação, sufixo e conectores, as palavras de um nome são o **começo** das do
outro, nos dois sentidos; (4) esse começo tem **3 ou mais palavras** significativas (DA,
DE, DO, DAS, DOS e E não contam) — "ALFA BETA" não identifica empresa nenhuma. O prompt da edge function pede o titular "na
ordem natural, sem vírgula", e a função filtra o eco do exemplo do prompt ("NOME
SOBRENOME"): uma ordem invertida ("SILVA, MARIA") viraria falso bloqueio de documento
legítimo. O bloqueio abre cartão (sem etapa) **com o motivo** (`não anexei · o
documento é de <titular do PDF> e o projeto é de <titular do cadastro>`), para a
equipe ver; o documento não sobe.
Isso só é verdade desde a rodada de fechamento de 22/10 (revisão final, I-1): antes,
o cartão saía como uma recomendação comum, porque a tela não lia `raw.motivo`, e o
robô mandava junto o **veredito do documento de outra pessoa** ("CARTA_PROJETO ·
FAVORAVEL" no cartão e no sino, num projeto que nem era dele). Agora o robô manda
`veredito: null` e `resumo: null` no bloqueio, e a tela desenha a faixa vermelha
"Documento não anexado" com o motivo (ver "A tela").

**Sem a leitura da IA, a ENEL não anexa o PDF que precisa da trava (I-2, decisão de
22/10).** Antes, com a `ludmilla-parecer` fora do ar (falha passageira), a trava não
tinha como rodar e o PDF subia para o projeto achado **só pelo texto**; na tentativa
seguinte o anexo já estava `enviado`, e se o titular do documento fosse outro a
trava chegava tarde. Agora o anexo exige `regra.anexar && !passageira`: a ressalva
diz "não anexei ainda: preciso ler o documento para conferir o titular", a mensagem
fica `concluida = false` e **espera a próxima tentativa** (até 5). **Só espera quem
precisa ler** (`precisaLerPdf`, `decidir.ts`): a regra tem `ler_pdf` **e** (o texto não
achou o projeto, **ou** a regra é Carta/resultado de vistoria e o texto não classificou
o e-mail). Então, sem a IA, esperam os e-mails que o texto **não identificou** e as
Cartas e resultados de vistoria que o texto achou mas **não classificou**. **Não
esperam:** o e-mail que o texto **achou e classificou** (protocolo, UC ou nome no
assunto, mais um assunto que o classificador reconhece), e o achado pelo texto numa
regra que não espera veredito (troca do relógio) — esses não chamam a IA e anexam sem
leitura e **sem a trava de titular**, como antes; e a regra com `ler_pdf = false`
segue como antes (não há trava a esperar). A EDP não muda.

### O que o e-mail diz: classificação e etapas

Por texto, sem IA (`classificar.ts`): **primeiro o assunto** (`classificarAssunto`),
**depois o corpo** (`classificarCorpo`). O assunto vale primeiro porque o
`atendimento.edsp` manda o resultado nele, com corpo genérico. O texto chega
**achatado** (`caixa.ts:113` troca todo `\s+` por um espaço): nada ali pode depender
de quebra de linha, e a citação ("Em … escreveu:", "De: … Enviado:", "Mensagem
original") é cortada sobre texto de uma linha só. Entidades HTML (`&ccedil;`, e até
`&amp;ccedil;`, de codificação dupla) são decodificadas em **até 2 passadas**: 4 das
5 falhas de troca reais chegavam assim. **Na dúvida o resultado é `null`**, e `null`
só anota: dizer "aprovada" de uma vistoria que não foi aprovada faria o sino mandar
pedir a troca do relógio, o erro caro. **Resposta automática, devolução e comunicado
não são classificados** (`TIPOS_SEM_SINAL`): repetem o **nosso** assunto e o nosso
texto ("TROCA … NÃO CONCLUÍDA"), e classificar isso tocaria um sino falso.

| E-mail | Como a robô sabe | Resultado |
|---|---|---|
| Carta favorável | IA no PDF: `carta_projeto` + `favoravel` | sugere **Aprovado**. "Aprovado, porém solicitamos observar os itens abaixo" **também** é favorável, com os itens no cartão ("aprovado com observações: …", até 3) |
| Carta com pendência | IA: `carta_projeto` + `pendencia` | sugere **Pendência**, com os itens no cartão ("pendências da Carta: …") |
| Vistoria reprovada | texto/assunto, ou IA `resultado_vistoria` + `pendencia` | sugere **Vistoria reprovada** |
| Vistoria aprovada | texto/assunto, ou IA `resultado_vistoria` + `favoravel` | **sem etapa**; sino "é hora de pedir a troca do relógio" |
| Troca agendada | texto: "nota de serviço … troca do medidor" | só anota (com o prazo, "até N dias úteis") |
| Troca realizada | texto: "a troca do medidor … já foi realizada", "nota de serviço … troca (ou reprogramação) do medidor, que se encontra executada" ou "já houve a reprogramação do medidor" | sugere **Concluído**, sem sino |
| Troca não executada | texto: "não foi executada", "não sendo executada", "Motivo da rejeição"… | sino, com o motivo |
| Devolução (`postmaster`) | regra | sino "um dos destinatários não recebeu" |
| Resposta automática (`no-reply`) | regra | só anota |

"Aprovada" lida **no corpo** só toca o sino; não move etapa nem abre cartão. O
sistema **não tem** etapa "vídeo aprovado, aguardando relógio" (criar uma mexeria no
Kanban de todos os tenants): o projeto fica em Vistoria solicitada e o histórico
registra o passo. O sino da devolução diz "um dos destinatários", não "a ENEL não
recebeu": a devolução de 30/09 chegou no mesmo minuto da resposta automática da ENEL,
e quem não recebeu foi outro destinatário.

**"A troca do relógio já foi realizada" sugere Concluído** (decisão do usuário,
24/10/2026; `estado: 'realizada'` em `classificar.ts`, `completed` em
`recomendacaoEnel`). Antes só anotava, porque "troca feita" não tinha aparecido nas
primeiras amostras. No corpus real de 340 e-mails da ENEL há três redações, e só elas
valem: "a troca do medidor referente à nota GD …, já foi realizada através da nota de
serviço …" (1 e-mail); "nota de serviço … para a troca do medidor bidirecional, que se
encontra executada em …" (3, que até então viravam "agendada" — a mensagem diz o
contrário); e a **reprogramação**: a ENEL abre a nota de troca *ou* de reprogramação, e
com o medidor já bidirecional reprogramar é o fim do serviço — "… para a reprogramação do
medidor bidirecional, que se encontra executada em …" (4, às vezes com "não foi
necessária a troca, pois o medidor já estava instalado", que explica por que só
reprogramaram e **não é falha**) e "já houve a reprogramação do medidor em …" (1; o "caso
não esteja reprogramado" que vem depois não anula). O verbo precisa ser **da troca ou da
reprogramação do medidor**: "a troca do titular foi realizada" e um "Foi realizada apenas a
reprogramação" solto não contam, e nota **aberta** para reprogramação com prazo não existe
no corpus (não tem classe: só a troca tem "agendada"). **A negação vence**: "não foi realizada" é a
falha (`FALHA_DA_TROCA`, avaliada primeiro), e "se", "ainda", pergunta ou citação deixam
`null`, que só anota — Concluído sugerido por engano é o erro caro. É só **sugestão**
(cartão), **sem sino**: quem decide é a equipe. O histórico diz "a ENEL informa que a
troca do relógio foi realizada".

**Quando a IA é chamada** (`precisaLerPdf`; ~US$ 0,10 por PDF, lançado no extrato de
IA do console com `kind = 'ludmilla_parecer'`): a regra tem `ler_pdf`, há PDF, não
houve conflito nem projeto inativo no texto (ler não resolveria), **e** (o texto não
identificou o projeto **ou** a regra espera veredito — `carta_projeto` e
`resultado_vistoria` — e o texto não classificou). As Cartas chegam com o corpo
vazio: tudo está no PDF. A tentativa é contada **antes** da chamada
(`ludmilla_email_tentativa`); a IA fora do ar deixa a mensagem para o próximo run,
até 5 vezes. Lê **um** PDF: desde 02/11/2026, o que traz no nome o número do projeto que o
**texto** já achou (a NT aprendida pela qual foi achado; senão o protocolo numérico do
cadastro; senão a primeira NT aprendida — `numeroDoProjeto`, `run.ts`); sem nenhum assim, ou
sem projeto achado pelo texto, o maior (`pdfDoParecer`, ver a seção da EDP "O PDF que a IA
lê"). Na Carta, que vem com um PDF só, nada muda. Se o nome do PDF lido traz o número de
**outro** projeto, o que ele diz não vale para este (nem etapa, nem troca, nem sino).

### `recomendacaoCabe` — 120 dias de e-mail não sugerem etapa para trás

A primeira leitura traz 120 dias (eram 30 até 24/10/2026). Uma Carta de aprovação de projeto que já está em
vistoria não pode virar sugestão de voltar para Aprovado. A sugestão só vale se o
projeto **não está já nessa etapa**; Aprovado e Pendência só vêm de etapas anteriores
à aprovação (`pending`, `analysis`, `documentation`, `approval`, `pendencia`);
Vistoria reprovada só de `approved` ou `vistoria_solicitada`. **Concluído cabe em
qualquer etapa, menos em Concluído**: é a última, então nunca é "para trás". Quando não
cabe, a ressalva diz por quê ("não sugeri … o projeto já está à frente, em …").

### Troca de protocolo pela NT da Carta

Na ENEL o protocolo do projeto é a NT, e a Carta traz a NT. 14 dos 34 ativos de
13/10 (13 dos 30 de 21/10) não têm protocolo numérico — o cadastro tem vazio ou um
texto como "Sem protocolo". Pedido do usuário (16/10, depois do PRJ-67567: Carta de
13/10 com a NT 392812955 num projeto sem protocolo, que só se identifica pelo PDF):
o cartão sugere **gravar a NT** (o mecanismo `atualizar_protocolo` +
`protocolo_anterior` que já existia no portal), e todo e-mail seguinte do projeto
passa a casar pelo número.

O robô só **pede** (`trocaDeProtocolo`, `decidir.ts`), e só com a NT que a **IA leu
numa Carta** — nunca número do assunto ou do corpo (spec §6.1). Condições:

1. exatamente **9 dígitos** (a leitura cola os dígitos de "NT … (SF …)" e viraria 14);
2. diferente da **UC** do projeto, por pedaço (a IA às vezes troca os campos);
3. diferente do protocolo que o cadastro já tem;
4. **não pede** se o projeto já tem protocolo numérico de 9 dígitos **e** (a etapa
   lida foi barrada por `recomendacaoCabe` **ou** o projeto já passou da fase da
   Carta): a Carta é antiga e a NT dela é a velha — fica só a ressalva "confira".
   Projeto **sem** protocolo numérico pede mesmo à frente (é o caso do PRJ-67567).

**Resíduo conhecido:** Carta de pendência **antiga** com o projeto ainda em
`analysis` e a NT nova já no cadastro pede a troca para a NT velha; separar exigiria
a data da Carta contra a do protocolo, que a robô não tem.

O **banco trava** (`ludmilla_email_registrar`, `p_atualizar_protocolo`, DEFAULT
FALSE): só liga se o número do cartão tem só dígitos (9+), o projeto existe, os
dígitos diferem dos do cadastro (sem zeros) e **não são a UC do próprio projeto**
(por pedaço — em 16/10, 4 projetos da ENEL traziam duas UCs na mesma célula) **nem o
CPF/CNPJ do titular**. Falhando a trava, o cartão sai como sempre, sem erro. Só vale
com `p_abrir_cartao = TRUE`. A troca **não é rebaixada** na repetição (a tentativa 1
sem a NT e a 2 com ela liga; repetição sem pedido nunca desliga) e **sobrevive a uma
decisão** da equipe (linha nova só de troca, mesmo sem recomendação), exceto se a
linha decidida já era de troca. O "Aplicar" grava `portal_updates.protocolo` em
`projects.protocol_number` (ver "A lição do Aplicar").

### A NT que ela já aprendeu (02/11/2026)

**O caso** (dados de produção de 02/11): a vistoria aprovada do PRJ-67567 chegou do
`tecnico.abc` em 31/10 com o assunto `VISTORIA GD 392812955 - <endereço>` e foi registrada
como "não reconheci de qual projeto…". O projeto estava com `protocol_number` NULL: o cartão
da Carta que manda gravar a NT estava pendente desde 24/10. Mas a Ludmilla **já conhecia** a
NT — a IA a leu na Carta, e dois e-mails já ligados ao projeto traziam `NT 392812955` no
assunto. O mesmo com 3 resultados de vistoria do `atendimento.edsp` ("Comunicado técnico
sobre a nota: <NT> - Vistoria aprovada|reprovada"): PRJ-52440, PRJ-61098 e PRJ-75158.

**O banco** — `ludmilla_email_nts_conhecidas(p_account_id)` → `(project_id, nt, fonte)`
(migração `20261102120000`; `SECURITY DEFINER`, `search_path=''`, guarda
`auth.role() = 'service_role'` no `WHERE` como a irmã, `EXECUTE` só para `service_role`).
Escopo: o de `ludmilla_email_projetos` (mesmo tenant e mesma concessionária da conta, sem os
apagados). `ludmilla_email_projetos` **não mudou** (a EDP também a usa). Duas fontes:

| `fonte` | De onde |
|---|---|
| `carta` | `portal_updates` da conta com `atualizar_protocolo = true` e `situacao = 'pendente'` (o cartão que espera o "Aplicar"), com exatamente 9 dígitos |
| `email` | o número logo depois do **token** `NT` no **assunto** de um e-mail da conta já ligado a um projeto (`project_id` não nulo): `(?<![0-9A-Z])NT[^0-9A-Z]{0,3}([0-9]{9})(?![0-9])`, sem diferenciar maiúsculas — exatamente 9 dígitos, sem dígito antes nem depois, e "NT" sem letra colada antes ("DOCUMENT 391…" não conta). É o padrão dos assuntos que a NOSSA equipe escreve (`… - NOME - NT 391747683`). Número solto não conta. Desde 03/11 (`20261103130000`): **só de mensagem com UMA NT distinta** no assunto, e **nunca** a NT que já é o protocolo do cadastro de **outro** projeto do escopo (por pedaço de dígitos ou pelos dígitos colados) ou a NT da Carta pendente de **outro** projeto |

**Por que só uma NT (revisão de 03/11).** A primeira versão aprendia **todas** as NTs do
assunto. Um e-mail "RE: TROCA DE RELÓGIO - NT 391000010 / NT 391000020" que casasse no projeto
A (protocolo 391000010) ensinaria a A a NT 391000020 — de B, ainda sem a NT no cadastro —, e a
vistoria aprovada de B, só com 391000020, cairia em A. Agora uma mensagem com duas NTs não ensina
nada, e a NT que já é de outro projeto (protocolo ou Carta pendente) nunca vira NT aprendida de
outro. A NT do **próprio** projeto continua (inofensiva). Provado em `begin … rollback` com o caso
da revisão (vermelho na função de antes, verde na nova); na conta ENEL em 03/11 **nenhum par
sumiu** (13 → 13): nenhuma mensagem ligada tinha duas NTs, e nenhuma NT aprendida era de outro.

Uma linha por par projeto/NT (a mesma NT nas duas fontes sai uma vez, como `carta`). Em
02/11 e de novo em 03/11, contra a conta ENEL: 13 pares (3 `carta`, 10 `email`), 13 NTs
distintas, **nenhuma NT em dois projetos**; entre eles PRJ-67567 → 392812955 (`carta`),
PRJ-52440 → 391747683, PRJ-61098 → 391826601 e PRJ-75158 → 391704128 (`email`).

**As contagens do diagnóstico × as da função.** O diagnóstico de 02/11 contou "4 em cartões
de Carta e 13 em assuntos"; a função devolve 3 e 10. Os cartões com `atualizar_protocolo` são 4
pares projeto/NT, mas um (PRJ-51472 → 392755018) já foi **aplicado** — a NT está em
`protocol_number` — e a função só conta o `pendente`. Os "13 em assuntos" eram pares projeto/número
de 9 dígitos no assunto **com ou sem** o token `NT`; com o token são 11 pares, um deles igual à
Carta pendente do mesmo projeto (PRJ-67567, que sai como `carta`) → 10 `email`. Dos 11, 6 são o
próprio protocolo do cadastro (inofensivos: já casavam).

**O robô** — `ProjetoEnel` ganhou `nts: string[]`. `projetosDaEnel` (`fila.ts`) junta as duas
RPCs; **só a varredura da ENEL** pede as NTs (a EDP segue com `protocolosDoEmail`). Falha de
qualquer das duas **lança** (o run vira erro e tenta de novo): rodar achando que não conhece NT
nenhuma marcaria como "não reconheci" — e concluído — o e-mail que ela reconheceria.

- Em `identificarPorTexto` e `identificarPorDocumento`, o "por protocolo" casa com
  **protocolo ∪ NTs aprendidas**. A mesma NT aprendida em dois projetos (ou a NT aprendida de um
  e o protocolo do cadastro de outro) cai no `conflito` de sempre: levanta a mão.
- `nomeTrazOutroProjeto` também considera as NTs aprendidas dos **outros** projetos.
- O selo continua `protocolo` (o banco tem CHECK em `casamento`). Quando o casamento veio **só**
  pela NT aprendida (não pelo protocolo do cadastro), o `motivo` ganha a ressalva
  `reconheci pela NT <n>, que já tinha visto neste projeto` (`Identificacao.ntAprendida`).
- **Proteção**: NT aprendida só conta com **exatamente 9 dígitos** (`DIGITOS_DA_NT`, agora em
  `identificar.ts`; `ntsAprendidas`): texto, 8 ou 10 dígitos, ou zero à esquerda que a deixa com
  8, não contam.

**Limites conhecidos.** A NT do assunto de e-mail é aprendida de um e-mail que já foi ligado
(por número, UC ou nome) — se esse ligamento estivesse errado, a NT errada passaria a contar;
as travas contra isso: só mensagem de uma NT, nunca a NT que já é de outro projeto (03/11), NT em
dois projetos = conflito, e o titular do documento. O que sobra: uma mensagem de UMA NT ligada ao
projeto errado, com a NT de um projeto que ainda não tem nem protocolo nem Carta pendente.
A NT da Carta pendente conta **antes** de a equipe aplicar o cartão; se a equipe **ignora** o
cartão, a NT deixa de contar (só `pendente`), mas pode continuar valendo pela fonte `email`.

### Chaves: `''`, `referencia` e a chave do anexo

- **Chave da mensagem `''`.** Antes de identificar não se sabe o projeto, e a
  tentativa tem de ser contada antes do gasto de IA. Com chave fixa, `tentativas`
  sobe na **mesma** linha a cada retentativa e o teto de 5 vale; com o protocolo
  como chave, cada tentativa abriria uma linha. O projeto vai em `project_id`; a
  tentativa, a pendência, o registro e o aviso usam a mesma chave.
- **`p_referencia` / `referencia`.** O número do projeto identificado vira o
  `protocolo` do **cartão** (`portal_updates`), não o da mensagem
  (`referenciaDoProjeto`: o protocolo numérico; sem ele, "UC <n>" quando a UC tem 9+
  dígitos, senão o código do projeto). Quando o cartão sugere a troca, a referência
  do cartão é a **NT** — é o que o "Aplicar" grava. O prefixo "UC " e o código
  impedem que a referência dispare uma troca no banco (`_ref ~ ^[0-9]{9,}$`). Efeito
  cosmético aceito: projeto sem protocolo e com UC de 8 dígitos sai com o código
  (`PRJ-…`) no cartão e no comentário.
- **`p_casamento`**: como o projeto foi achado (`protocolo`, `uc`, `titular`); a tela
  diz sempre "achado pelo protocolo / pela UC / pelo nome do titular" (ver "A tela").
- **`p_abrir_cartao`.** Cartão só quando há o que decidir: uma etapa **ou** gravar a
  NT (`recomendacao !== null || atualizarProtocolo`), mais o bloqueio por titular.
  99 respostas automáticas não viram 99 cartões. A mensagem é gravada sempre.
- **Chave do anexo da ENEL = `project_id`** (`p_chave`, `20261019120000`); o
  **texto** do comentário ("Anexo emitido pela ENEL para o protocolo <referência do
  cartão>") continua vindo de `p_protocolo`. Por quê: depois que a equipe aplica a
  troca, a referência do projeto muda, e com a chave presa a ela o "Ler de novo"
  subiria o documento **de novo**. A unicidade é a `UNIQUE (account_id, id_arquivo)`
  de sempre. A EDP não manda `p_chave`: a chave dela é a de sempre, byte a byte. Na
  retomada de um anexo pendente o protocolo passa a ser o da chamada nova.

### Janela fixa, aviso antes do registro, sino uma vez

- **Janela de busca FIXA de 120 dias** (`janelaDeBusca`, `JANELA_MAXIMA_DIAS`; eram
  30 até 24/10/2026). A primeira versão lia "desde a última varredura, −2 dias": a
  mensagem pendente (IA sem cota por alguns dias) e o "Ler de novo" sumiam da busca
  sem aviso, e o recuperar só funcionava para e-mail com menos de ~3 dias. Custo:
  cada run relê os envelopes dos últimos 120 dias (barato: sem corpo); a pendência
  filtra o que já concluiu, e a IA só roda para as pendentes. `ultima_varredura_em`
  não muda mais nada na ENEL.
- **A ENEL lê "Todos os e-mails" (`\All`), não só a Caixa de entrada** (25/10/2026).
  Medido: na INBOX os e-mails da ENEL começavam em 09/10, mas a conta os tem desde
  maio (provavelmente arquivados), então a janela de 120 dias não achava nada novo.
  A pasta se acha pelo `specialUse`, nunca pelo nome; sem ela lê a INBOX e o log
  avisa; o `resultado` ganhou `pasta_lida` e `email_mais_antigo`. A dedup é pelo
  Message-ID (a mensagem que está nas duas pastas é pulada); risco: mensagem sem
  Message-ID (`imap-uid-N`) muda de uid entre pastas e seria tratada uma vez a mais.
  A EDP segue só na INBOX.
- **O sino só toca para e-mail de até 30 dias** (`deveAvisar`, `DIAS_PARA_AVISAR`).
  Decisão do usuário em 24/10/2026: ler mais histórico (anexar os documentos, abrir
  cartão de etapa ou de troca de protocolo) **sem inundar o sino** com coisas que a
  equipe já resolveu. Vale para todos os avisos (vistoria virtual aprovada, troca do
  relógio não executada, e-mail nosso devolvido e, desde 02/11/2026, o aviso sem projeto —
  ver "Resultado sem projeto vira aviso"), nos **dois** caminhos do run (com e
  sem projeto). Mais de 30 dias (30 dias e 1 minuto já é mais; exatamente 30 ainda
  avisa) não chama `avisar`; sem data no e-mail, na dúvida, avisa. Todo o resto é
  igual: a mensagem é tratada, anexada e registrada, e o cartão abre se houver etapa
  ou troca de protocolo. Quando havia aviso a tocar e ele calou, o `motivo` ganha
  a ressalva **"aviso não tocado: e-mail de mais de 30 dias"**, para a equipe ver no
  histórico que houve aviso e por que não tocou (e-mail sem aviso a tocar não ganha a
  ressalva). A ordem não mudou: o aviso, quando toca, continua **antes** do registro.
- **Aviso ANTES de registrar como concluída.** O sino é tocado antes de
  `ludmilla_email_registrar`: se o aviso falhasse depois do registro concluído, a
  mensagem não voltaria e o sino sumiria para sempre. Com o aviso antes, a exceção
  sobe com a linha ainda `concluida = false`, e a retentativa toca.
- **`aviso_em`** (`portal_email_mensagens`): o sino toca **uma vez por mensagem**.
  `ludmilla_email_avisar` marca e avisa no mesmo passo; "Ler de novo" não zera
  `aviso_em`. Destinatários: `admin` e `staff` do tenant da conta (tipo `ludmilla`
  em `notifications`).
- **Há um segundo sino, que não é da robô: o do cartão.** Todo `INSERT` em
  `portal_updates` dispara `trg_ludmilla_notificar` (`fn_ludmilla_notificar`, herdado
  do portal): avisa os responsáveis do projeto (`project_assignments`) ou, se não
  há responsável, os `admin`, com o título "📡 Ludmilla: PRJ-… mudou no portal" — o
  texto diz "portal" mesmo vindo de e-mail. É isto que o `p_abrir_cartao = false`
  evita (sem cartão, sem sino), e é por isso que, na primeira leitura, o número de
  sinos é a soma dos dois tipos.

### Resultado sem projeto vira aviso (02/11/2026)

Até aqui, sem projeto (`nenhum` ou `conflito`), `tratarMensagemEnel` chamava
`avisosEnel(tipo, null, null, null)`: só a **devolução** tocava o sino, e a vistoria aprovada
do PRJ-67567 ficou em silêncio. Agora (`avisoSemProjeto`, `decidir.ts`) também avisam, quando a
**classificação do texto** tem sinal de:

| Sinal | Título | Tipo do A fazer (o banco deduz do título) |
|---|---|---|
| vistoria aprovada | `📡 Vistoria aprovada num e-mail que não reconheci` | `vistoria_aprovada` |
| vistoria reprovada | `📡 Vistoria reprovada num e-mail que não reconheci` | `aviso` |
| troca não executada | `📡 Troca do relógio não executada num e-mail que não reconheci` | `troca_falhou` |
| troca ou reprogramação executada | `📡 Troca ou reprogramação do medidor feita num e-mail que não reconheci` | `aviso` |

A troca **feita** fala em "medidor", nunca em "relógio": `ludmilla_email_avisar` deduz o tipo
por `ILIKE '%rel_gio%'`, e "relógio" a faria `troca_falhou` (um teste lê o `CASE` da migração e
trava isso). A mensagem leva o **assunto** limpo (`assuntoSeguro`: sem CR/LF nem controle, até
200 caracteres, cortado por caractere), o **motivo** (`nenhum projeto nosso tem os números deste
e-mail`, ou o do conflito) e a **saída**: `Se for de um projeto nosso, grave a NT nele (ou aplique
o cartão da Carta) e use "Ler de novo". Este A fazer continua valendo depois de gravar a NT e
reler: o sino não toca de novo para este e-mail.` (a última frase entrou na revisão de 03/11; ver o
"Limite" abaixo).

Regras: só e-mail de até 30 dias (`deveAvisar`; mais velho ganha a ressalva "aviso não tocado"),
o sino **antes** do registro (a retentativa depende disso), e só quando a identificação é
**definitiva** — com a IA fora do ar enquanto procurava o projeto (`passageira`) não avisa,
porque o sino é **um por mensagem** (`aviso_em`) e tocar "não reconheci" calaria o sino com
projeto que a próxima tentativa tocaria. Projeto concluído (`inativo`), troca só agendada e
e-mail sem classificação (resposta automática, devolução e comunicado nunca são classificados)
não avisam. A devolução continua igual.

A RPC aceita `p_project_id` nulo e é idempotente por mensagem (`prosrc` vivo conferido, md5
`ddf2aa83…`, sem mudança). O A fazer sem projeto entra na aba Decidir pelo caminho que a
devolução sem projeto já usava (`itensDaCaixa`: código e projeto nulos; só "Marcar como feito";
coberto pelos testes da tela com `project_id: null`). **A empresa (papel `company`) não vê**:
`portal_afazeres` e `portal_email_mensagens` exigem `ludmilla_equipe_ok()` (admin/staff do
tenant de biblioteca), e o sino só vai para admin e staff — provado em `begin … rollback` com uma
empresa real do tenant (0 linhas) e o admin como controle (4). O assunto traz endereço de cliente.

Limite: se a equipe grava a NT e usa "Ler de novo", a releitura acha o projeto, mas o sino com
projeto não toca de novo (`aviso_em` já marcado) e o A fazer continua **sem projeto** — é o
registro do aviso, e o próprio texto dele diz isso (decisão da revisão de 03/11: não mexer no banco
por isso).

### Banco da ENEL

| Objeto | Para que |
|---|---|
| `portal_accounts.identificacao` | `protocolo_no_assunto` ou `remetente` |
| `portal_email_regras.tipo_documento` | + `carta_projeto`, `resultado_vistoria`, `troca_relogio`, `resposta_automatica`, `devolucao`, `comunicado` |
| `portal_email_mensagens.aviso_em` | o sino uma vez por mensagem |
| `ludmilla_email_conta` | `identificacao` e `ultima_varredura_em` da conta |
| `ludmilla_email_projetos` | os projetos da concessionária, com `ativo`; só service role |
| `ludmilla_email_nts_conhecidas` | as NTs já vistas em cada projeto (Carta pendente, `NT` no assunto de e-mail ligado com uma NT só, nunca a de outro projeto); só service role (`20261102120000`, `20261103130000`) |
| `ludmilla_email_avisar` | toca o sino (admin + staff), idempotente por `aviso_em`; aceita `p_project_id` nulo (aviso sem projeto) |
| `ludmilla_email_registrar` | agora com 20 parâmetros (`p_referencia`, `p_casamento`, `p_abrir_cartao`, `p_atualizar_protocolo`); grava `titular_portal` com o titular do **cadastro** (EDP e ENEL) |
| `ludmilla_email_anexo_novo` | agora com 8 parâmetros (`p_chave`) |
| `ludmilla_aplicar_update` | recuperou o ramo de troca de protocolo (`20261016120000`) |

Migrações: `20261013120000` (base), `20261014120000` (regra do `atendimento.edsp`),
`20261016120000` (Aplicar), `20261016130000` e `20261016140000` (titular e troca de
protocolo, com a trava), `20261019120000` (chave do anexo), `20261022120000`
(fechamento da revisão final: o cartão pendente só é corrigido se for do mesmo
projeto — C-1; a trava compara também a UC pontuada — M2; `recebido_em` no `raw` do
cartão), `20261102120000` (as NTs aprendidas, função nova, e as regras da EDP; aplicada em
02/11/2026 pelo CLI, sem `db push`, com os md5 das funções da Ludmilla iguais antes e
depois), `20261103130000` (revisão: a NT do assunto só de mensagem com uma NT e nunca a de
outro projeto; aplicada em 03/11/2026 do mesmo jeito, só a função mudou: md5 `d2da533a…` →
`b5906ed1…`). O `registrar` e o
`anexo_novo` mudaram de assinatura: `CREATE OR REPLACE` sozinho criaria uma segunda
função ao lado, então a antiga sai (`DROP FUNCTION` da assinatura anterior). Os
parâmetros novos têm DEFAULT, e a chamada da EDP resolve para a nova sem mudança.

### A edge function: o modo ENEL

`ludmilla-parecer` ganha o modo ENEL só com `concessionaria: 'enel'` (valor exato).
A resposta acrescenta `tipo` (`carta_projeto` | `resultado_vistoria` |
`troca_relogio` | `outro`), `nt` (9+ dígitos) e `uc` (7+); a EDP segue com os seis
campos de sempre, e o `tipo` só é lido no modo ENEL (o caminho da EDP não ganha um
ponto de falha novo). O prompt manda "aprovado, porém solicitamos observar os itens
abaixo" para `favoravel`, com os itens em `pendencias`. **Publicar** é um passo do
primeiro run (o roteiro diz o que já foi com o `deploy.yml` e o que falta).

### A tela

Todo cartão, em qualquer meio (CPFL, EDP, ENEL), mostra **titular** e **empresa**
(pedido do usuário, 16/10, "falha gravíssima"): `src/lib/ludmillaCartao.ts`
(`identidadeDoCartao`) decide o nome; a consulta de `useLudmilla.ts` junta
`project:projects(id, code, status, title, companies:company_id(name),
project_general_data(holder_name))`. O titular é o do **cadastro**; o nome do portal
(CPFL) aparece à parte como "no portal: …" quando difere. O banco grava
`titular_portal` com o titular do cadastro nos cartões de e-mail, então o nome
aparece uma vez só.

**O cartão de e-mail (EDP e ENEL) diz o porquê** (revisão final, I-1; a lógica é a
função pura `detalheDoCartaoDeEmail` em `ludmillaCartao.ts`, com teste; o cartão da
CPFL não muda). Antes, o "casamento" só aparecia **dentro do selo violeta da troca**,
e o `raw.motivo` não aparecia em lugar nenhum: um cartão achado só pelo nome não se
distinguia de um achado pela NT, e o bloqueio parecia uma recomendação comum. Agora
**sempre** aparecem:

- **como o projeto foi achado**, a partir de `casamento`: "achado pelo protocolo",
  "achado pela UC", "achado pelo nome do titular" (ou "pelo CPF/CNPJ");
- **o dia do e-mail**: `raw.recebido_em` ("e-mail recebido em …"), que o banco grava
  nos cartões novos (migração `20261022120000`). Nos cartões antigos o campo não
  existe e a tela usa `detectado_em` com outro rótulo, **"lido pela Ludmilla em …"**,
  para não fingir que é a data do e-mail;
- **o motivo** (`raw.motivo`: as ressalvas do robô — a NT que a Carta traz, o aprovado
  com observações, o arquivo barrado…), em âmbar.

**O bloqueio fica visivelmente diferente**: faixa vermelha "Documento não anexado"
no alto do cartão, com o motivo dentro dela, e a borda vermelha. A tela reconhece o
bloqueio pelo motivo que **abre** com "não anexei" seguido de "·" (ou do fim); o
"não anexei ainda: preciso ler o documento…" da espera da IA (I-2) e o "N arquivo(s)
não anexado(s)" das ressalvas comuns **não** são bloqueio. A tela sabe que o cartão é
de e-mail porque `ludmilla_email_registrar` grava sempre `assunto` e `remetente` no
`raw`; o `raw` do portal traz as colunas da CPFL ("Última atualização"…).

O selo do casamento (`rotuloCasamento`) continua dentro do selo violeta da troca de
protocolo ("protocolo novo — casado por …; no cadastro está …"), e o "Atualizar
protocolo" sem etapa diz "Protocolo do cadastro atualizado", não "Card movido". Erro
na consulta dos cartões aparece em vermelho, com "Tentar de novo", e não como "Nada
pendente".

**Contadores da ENEL** (`MensagensEmail.tsx`, `ContadoresEmail`, quando
`identificacao = 'remetente'`): `lidos`, `por_protocolo`, `por_uc`, `por_titular`,
`nao_identificados` + `conflitos` somados ("levantei a mão"), `bloqueados`,
`avisos_mensagens`, `anexados`, `imagens_ignoradas`, `a_tentar_de_novo`, `falhas`.
**O quadro de avisos:** o `avisos` do robô soma **sinos tocados** (a RPC devolve o
`ROW_COUNT`: admin + staff do tenant, cerca de **6 por aviso**), e não é o número de
avisos. O fechamento A cria `avisos_mensagens` (quantas **mensagens** geraram aviso) e
a tela mostra essa chave como "avisos (mensagens)"; num run **sem** a chave mas
**com** `avisos` mostra `avisos` como **"sinos tocados"** (`quadroDosAvisos`, com
teste). **O run de 14/10 não tem nenhum dos dois** (as chaves reais dele são
`lidos`, `tratados`, `anexados`, `bloqueados`, `imagens_ignoradas`, `a_tentar_de_novo`,
`falhas` e outras, sem `avisos`): nele o quadro de avisos simplesmente **some**.
**As chaves são as de
`resultadoEnel`** (`worker/ludmilla/src/email/enel/run.ts`): `contadorDoRun`
devolve `null` para uma chave que não existe e o quadro some **sem erro**, então
renomear lá zera aqui em silêncio — há um comentário nos dois lugares. Só no
`resultado` do run (SQL do roteiro): `tratados`, `inativos`, `ignorados`,
`anexos_de_outro_projeto`, `anexos_recusados`, `anexos_sem_nome`, `pulados`,
`nao_lidas`, `falhas_busca`, `falhas_tratamento`, `remetentes`, `projetos_ativos`. Na
linha do `portal_sync_runs`, `protocolos_lidos` é o nº de projetos **ativos** e
`mudancas`, os documentos anexados.

### A lição do Aplicar (22/09 a 16/10)

`ludmilla_aplicar_update` **perdeu o ramo de troca de protocolo** na reescrita de
22/09 (`20260922100000`, que partiu do corpo de 14/09, anterior ao ramo de
`20260915130000`). De 22/09 a 16/10 o "Aplicar" movia a etapa e **não gravava o
protocolo**, e o botão "Atualizar protocolo" (cartão sem etapa) dava "Escolha a
etapa". Medido: 4 cartões com troca, 4 aplicados, 3 depois de 22/09 — nos 3 o
protocolo não foi gravado. A `20261016120000` repôs só o ramo; sem etapa, não conta
tarefa nem move o card, e o histórico diz "Protocolo atualizado pelo portal".
**Lição: copiar sempre do `prosrc` vivo do banco (`select prosrc from pg_proc …`),
nunca de uma migração que "parece" ser a última.** As migrações da ENEL registram o
md5 do corpo conferido antes de copiar.

### A proteção acidental do agendador

`ludmilla_agendar_varreduras` só enfileira contas com `enabled` **e** `login` **e**
`secret_id`, e só runs do tipo `varredura` (portal). A EDP e a ENEL não têm login nem
`secret_id`, e por isso o cron nunca manda varredura de portal para conta de e-mail.
É uma proteção **acidental**: ninguém a desenhou para isso. Mudar o agendador (ou
dar login a uma conta de e-mail) sem cuidado faria o cron mandar varredura de portal
para conta de e-mail. A ENEL ganhou agendamento PRÓPRIO em 06/11/2026
(`ludmilla_agendar_email`, cron `ludmilla-enel-email`, de hora em hora no expediente), sem
tocar neste agendador; a EDP entrou nesse mesmo agendamento de e-mail em 13/11/2026.

### Incidente de 14/10

Um admin clicou "Verificar agora" no cartão da ENEL com o robô da VPS ainda sem o
código dela: o run rodou **no modo da EDP** (protocolo no assunto). Efeito: 18
mensagens ligadas ao projeto certo, 0 anexo, 0 chamada de IA, mas 18 cartões
pendentes e 18 sinos, e linhas de mensagem com chave = protocolo (a chave da ENEL é
`''`: o código novo as releria e duplicaria o histórico). Limpeza feita em 16/10,
autorizada pelo usuário, com um bloco `DO` que abortaria se não fossem exatamente
18; os sinos não se apagam (só marcar como lido). **Regra: não clicar em "Verificar
agora" no cartão da ENEL antes de o robô da VPS ser atualizado.**

### A cobrança da troca do relógio e a leitura de hora em hora (ligadas em 06/11/2026)

Spec [2026-10-24-ludmilla-enel-cobranca-troca-design.md](../../superpowers/specs/2026-10-24-ludmilla-enel-cobranca-troca-design.md) ·
plano [2026-10-24-ludmilla-enel-cobranca-troca.md](../../superpowers/plans/2026-10-24-ludmilla-enel-cobranca-troca.md) ·
ADR [0012](../../adr/0012-ludmilla-envia-com-clique.md).

**A primeira escrita da Ludmilla para fora por e-mail, e só com clique.** Quando a ENEL
abre a nota de serviço de troca do relógio (a troca `agendada` do classificador, ou o
"Reenviamos a nota de serviço …" de uma troca que falhou), o run grava uma linha em
`portal_cobrancas` (`ludmilla_cobranca_agendar`): o número da nota (12 dígitos junto de
"nota de serviço" ou "ordem", só na parte nova do e-mail; sem número, a linha nasce sem ele),
a data do e-mail, o prazo, o remetente (vira o Para), o assunto com "RE:" e o
`In-Reply-To`/`References` para responder **na conversa da nota**. Vence 7 dias depois.

No dia, `ludmilla_cobrancas_abrir_vencidas` (cron `ludmilla-cobrancas`, seg–sex às :05 das
8h às 18h) põe a cobrança em `aguardando_envio` e abre um **A fazer `cobrar_troca`** na aba
Decidir: Para, Assunto e o texto do modelo aprovado (`src/lib/ludmillaCobranca.ts`; assinatura
"Equipe GD Manager"), editável. **Enviar** passa pela fila do Desfazer (8 s) e chama
`ludmilla_cobranca_aprovar`, que confere tudo de novo e cria o run `enviar_cobranca`;
**Dispensar** (`ludmilla_cobranca_dispensar`) encerra a nota.

O worker (`email/enel/enviar.ts`) pega a cobrança (`ludmilla_cobranca_iniciar_envio`, que a
deixa `enviando`), confere as travas DE NOVO (`podeEnviar`) e manda por SMTP
(`email/smtp.ts`, nodemailer 10.1.4, `smtp.gmail.com` 465 com recaída na 587 só se nem
conectar) pela MESMA conta e senha de app do IMAP. Saiu: `ludmilla_cobranca_enviada` grava o
histórico do projeto (autora: quem aprovou), o comentário no card (assinado pela Ludmilla) e
agenda a próxima para 7 dias. O servidor recusou: `ludmilla_cobranca_falhou` devolve à equipe
com a razão curta e um A fazer novo, sem nova tentativa.

**Queda no meio do envio (decisão do usuário, 27/10/2026).** Quando não dá para saber se o
e-mail saiu, o robô confere a pasta `\Sent` em só leitura (`email/enviados.ts`): espera 30 s e
faz até 4 buscas. "Saiu" é achar o Message-ID do envio OU o mesmo destinatário, assunto e hora.
- **Achou:** registra como enviada.
- **Conferiu e não achou:** reenvia UMA vez, o mesmo e-mail com o mesmo Message-ID. Nunca há uma 3ª.
- **Não deu para conferir:** não reenvia. `ludmilla_cobranca_sem_confirmacao` trata como
  possivelmente enviada e abre um A fazer para conferir no Gmail.

A regra é que e-mail para a ENEL nunca sai em dobro: o erro aceitável é deixar de cobrar.

**Travas, no worker E no banco:** destinatário `^[a-z0-9][a-z0-9._%+-]*@(br\.)?enel\.com$`
sobre o endereço normalizado (CHECK da tabela, `ludmilla_endereco_da_enel`, e
`REGEX_DESTINATARIO_ENEL` no worker; um teste confere que são a mesma); no máximo 1 envio por
nota a cada 7 dias; só cobrança `aguardando_envio` aprovada por uma pessoa e ligada ao run pelo
`run_id` (run criado por `ludmilla_pedir_run` é recusado); lacuna (`[UC]`, `[NT]`, `[TITULAR]`,
`[NÚMERO DA NOTA]`) no texto barra. Envelope SMTP explícito, sem Cc/Bcc, só texto.

**Param:** "troca realizada" do mesmo projeto (`ludmilla_cobranca_encerrar_por_troca`), nota
nova do mesmo projeto ("substituída"), Dispensar, projeto concluído/arquivado (o cron encerra).

**A leitura da ENEL ficou automática:** `ludmilla_agendar_email()` (cron
`ludmilla-enel-email`, `0 11-21 * * 1-5` UTC, ou seja, seg–sex das 8h às 18h) enfileira
`varredura_email` para conta de e-mail por remetente, ligada, fora da estação, sem run aberto.
O agendador da CPFL não mudou (md5 `3d0d2d0f1e7455ec701230bc925e1bde` antes e depois).
**Desde 13/11/2026 vale para TODA conta de e-mail, também a EDP** (protocolo no assunto),
a pedido do usuário depois da 1ª leitura manual dela (10/11). Migração
`20261113124500_ludmilla_edp_leitura_agendada.sql`: corpo copiado do `prosrc` vivo, muda só o
filtro (sai `identificacao = 'remetente'`); provada em transação desfeita (enfileirou `edp` e
`enel`) e aplicada; o nome do cron continua `ludmilla-enel-email`. A IA só é chamada para
e-mail novo (o que já foi concluído não volta), então ler de hora em hora não repete custo.

Teste do SMTP na VPS: `gh workflow run ludmilla-worker.yml -f smtp=verificar` (conecta e
autentica, não envia) ou `-f smtp=enviar_para_a_propria_caixa` (de = para = a caixa da
Ludmilla; depois confere a pasta Enviados por dois caminhos separados). Esse workflow sempre
republica o robô. Desligar tudo:
`select cron.unschedule('ludmilla-cobrancas'); select cron.unschedule('ludmilla-enel-email');`.

### O pedido da troca do relógio (06/11/2026)

Spec [2026-11-06-ludmilla-pedido-troca-design.md](../../superpowers/specs/2026-11-06-ludmilla-pedido-troca-design.md) ·
plano [2026-11-06-ludmilla-pedido-troca.md](../../superpowers/plans/2026-11-06-ludmilla-pedido-troca.md) ·
ADR [0012](../../adr/0012-ludmilla-envia-com-clique.md).

Assim que a vistoria é aprovada, o A fazer `vistoria_aprovada` mostra o e-mail pronto, se o pedido ainda não foi feito:
para `canalgd.sp@br.enel.com`, assunto `TROCA DE RELÓGIO - <TITULAR> - NT <n>` e texto editável. **Enviar** passa pela
fila do Desfazer (8 s). **Marcar como feito** continua lá, para o pedido feito por fora.

**Quem decide é o banco**, em `ludmilla_pedido_troca_avaliar`, usada pela tela (`ludmilla_pedido_troca_rascunho`) e de
novo no clique (`ludmilla_pedido_troca_enviar`, sob trava do A fazer):
- **Já pedido** é haver, DEPOIS da data do e-mail de aprovação, mensagem `troca_relogio` ou `resposta_automatica` com
  "troca" no assunto, ligada ao projeto ou com a NT no assunto. E-mail de troca de antes da aprovação não conta, nem
  `devolucao`.
- **A NT** vem do protocolo do cadastro, da Carta pendente ou do assunto de e-mail ligado ao projeto. Vale só com UMA
  candidata e nunca a de outro projeto. Não usa `ludmilla_email_nts_conhecidas`, que só responde a `service_role`.
- Um pedido por A fazer (`UNIQUE`), e o texto tem de citar a NT.

**O envio é o da cobrança:** run `enviar_pedido_troca`, `email/enel/pedido-troca.ts` reaproveita `enviar.ts` trocando as
RPCs e o e-mail (novo, sem `RE:` e sem conversa), mais uma trava própria do robô sobre o assunto e a NT.
- **Saiu:** pedido `enviado`, comentário comum no card (a empresa vê, sem o endereço) e histórico com quem aprovou.
- **Nada saiu:** pedido `falhou`, e o A fazer reabre com o motivo e o texto da tentativa.
- **Não deu para saber:** pedido `sem_confirmacao`, A fazer `aviso` para conferir no Gmail, sem botão Enviar.
- **Preso:** o cron `ludmilla-pedidos-troca` (seg–sex, :10, 8h–18h) trata `enviando` há mais de 30 min como sem
  confirmação, e o que não saiu há mais de 2 h como falha.

A tabela é `portal_pedidos_troca`, separada de propósito de `portal_cobrancas`: nenhuma função da cobrança foi tocada. Se
a ENEL abrir a nota, a cobrança nasce sozinha pelo caminho de sempre.

### O que NÃO está provado

**O pedido da troca (06/11/2026):** testado com dublês no robô (15 testes), em transação desfeita no banco, com os
projetos reais (40 casos), e clicado na tela com dados fictícios.

**Primeiro envio real (07/11/2026, 21h48, PRJ-27803, NT 391761805):** clique do usuário, run `enviar_pedido_troca`
`ok` em 5 s numa tentativa, pedido `enviado` com o Message-ID do Gmail, A fazer fechado, comentário no card e linha no
histórico com quem aprovou. Saiu "Boa tarde" às 21h48 porque o modelo só tem "Bom dia" e "Boa tarde", como a cobrança.
**Ainda falta ver:** o e-mail uma vez só em Enviados do Gmail, e a resposta automática da ENEL sendo lida e
reconhecida como sinal de pedido feito. A leitura agendada só roda em dia útil; a primeira é segunda, 09/11, às 8h.

**Medido em 06/11/2026 (cobrança e leitura agendada):**
- **SMTP da VPS:** conectou e autenticou na porta 465 (execução 42318667768).
- **E-mail de teste para a própria caixa** (execução 42318930227): as duas buscas na pasta
  Enviados acharam (`pelo_message_id` e `pelo_destinatario`). O Gmail mantém o nosso
  Message-ID, e a conferência funciona pelos dois caminhos.
- **Crons:** os dois aplicados, e os quatro jobs da Ludmilla ativos. A função da CPFL ficou com
  o md5 esperado.
- **Leitura:** `ludmilla_agendar_email()` disparada uma vez à mão: run `ok`, 5 lidos, 0 falhas,
  e uma cobrança nova nasceu sozinha (PRJ-75158).

**Ainda não exercido:** o cron disparando sozinho (o primeiro é segunda, 09/11, às 8h); a
1ª cobrança de verdade e se ela entra na conversa da nota no Gmail; a 2ª cobrança de uma nota;
a troca realizada encerrando de verdade; a recaída para a porta 587; a conferência numa queda real.

**O corte das cobranças (decisão do usuário de 25/10/2026, "só daqui para frente"):**
`ludmilla_cobranca_agendar` ignora nota de e-mail anterior a 25/10/2026 e devolve
`anterior_ao_inicio`, inclusive por "Ler de novo". É o único lugar do corte. Efeito em 06/11/2026:
- **PRJ-21875 e PRJ-52440** (notas de 26/10 e 27/10) foram relidas e viraram cobrança, já vencidas:
  o A fazer abre na primeira passada de `ludmilla-cobrancas` em dia útil (segunda, 09/11, às 8h05).
- **PRJ-05469 e PRJ-30495** (notas de 16/10 e 20/10) ficam fora por causa do corte. Reler não adianta.

**O alcance do Gmail:** com "Não limitar" na pasta IMAP (posto pelo usuário em 06/11/2026), a busca
alcança os 120 dias: `email_mais_antigo` foi de 22/10 para 10/07. A primeira leitura ampla tratou 227
e-mails, com 0 falhas, 15 PDFs lidos pela IA, nenhum sino (e-mail de mais de 30 dias só anota) e 8
cartões novos para gravar a NT como protocolo. Se o limite voltar, mensagem fora do alcance fica
presa ao ser reaberta: confira o `email_mais_antigo` no `resultado` do último run antes de reabrir.

**Escrito em 21/10, antes do 1º run (24/10):** tudo era teste unitário (580 testes do robô, `fail 0`, medidos
em 21/10, no commit `13200de`, o da rodada 4 da classificação), SQL em `begin; …
rollback;`, revisão independente de cada tarefa e
mutações. Nunca foi exercido: o IMAP com os remetentes reais, a `ludmilla-parecer`
em modo ENEL contra PDF real e o laço `executarVarreduraEnel` (sem teste, como o da
EDP). O embed novo da tela **foi provado no PostgREST real** pela revisão final (sonda
anônima: `200 []`, e o controle com coluna inexistente deu `400 42703`, então a
consulta chega a ser planejada), mas com linhas de verdade só se prova abrindo
`/ludmilla` depois do deploy. O roteiro diz o que olhar. Resíduos conhecidos, aceitos
de propósito:

- **Nome:** romano/ordinal e letra de bloco no **meio** do cadastro são omissíveis
  ("CONDOMINIO SOLAR" × "CONDOMINIO II SOLAR" com o irmão concluído); cadastro com
  " - " dentro do nome é cortado pelos separadores ("CASAS ALFA - FILIAL 2" casa a
  matriz); "CARLOS EDUARD" × "CARLOS EDUARDO" não casa (falha segura); nome do meio
  omitido com irmão concluído; PF × PJ de mesmo nome (o sufixo de empresa é
  opcional); "MEI" no fim de um sobrenome é tratado como sufixo de empresa.
- **Classificação:** famílias de "quem foi aprovado" ainda com resíduo (a 1ª
  ocorrência decide e pode calar uma reprovada posterior; "sem"/"não atendimento"
  antes de reprovada vira `null`; "Duvidamos que…"). Todas caem em `null` (só
  anota). A rodada 4 (`13200de`) só corrigiu data, hora e número no caminho da
  vistoria, que viravam "outro sujeito".
- **Troca de protocolo:** o resíduo da Carta de pendência antiga (acima); uma
  recomendação ignorada pode reaparecer numa 3ª passada (M3 da Task 5).
- **RISCO CONHECIDO, aceito (M1 da Task 5): uma troca de protocolo IGNORADA pode voltar
  numa 3ª passada pendente.** O cabeçalho da migração `20261016140000` diz "nunca
  repete uma troca ignorada", e isso é forte demais. O que de fato acontece: o UPDATE
  do cartão **pendente** faz `atualizar_protocolo = u.atualizar_protocolo OR _pedir`, e
  a decisão de ignorar vive no cartão antigo, que o UPDATE não olha. Um caminho: passada
  1 abre o cartão com a troca e a equipe **ignora**; a passada 2 abre um cartão novo só
  de etapa (a troca não vai, porque a linha decidida já era de troca); a passada 3 — a
  mensagem ainda pendente — corrige esse cartão novo, e o pedido válido **religa a
  troca nele**. Dano: um cartão a mais para ignorar de novo; nada é aplicado sem a
  equipe. A migração `20261022120000` descreve o comportamento real; a antiga não foi
  editada. Corrigir exigiria lembrar a decisão por mensagem, e não vale o custo antes
  de ver o primeiro run.
- **UC pontuada na trava (M2 da Task 5) — fechada.** A trava do banco comparava a UC
  só por pedaço, então "3.928.129-57" passava; a `20261022120000` compara também os
  dígitos colados (`regexp_replace(uc_number,'\D','','g')`, sem zeros à esquerda). Sem
  exposição real na ENEL até aqui.
- **Run:** a sugestão de etapa **não olha a data do e-mail**: uma "vistoria
  reprovada" de três semanas atrás, com o projeto já reaprovado e de volta em
  Vistoria solicitada, vira cartão "Vistoria reprovada" — confira a data do e-mail
  (`recebido_em`, que o cartão novo mostra) antes de Aplicar. PDF barrado de **outro** titular bloqueia o e-mail inteiro (lado
  seguro); o erro "sem remetente" mostra o texto genérico de "sem regras"; a
  retomada do anexo pode rebaixar o texto do comentário de NT para código;
  `comunicado` em `TIPOS_SEM_SINAL` é morto (a regra de comunicado nem é buscada).
- **Banco:** `ludmilla_email_avisar` não filtra `profiles.active`; `LIMIT 2000` em
  `ludmilla_email_projetos`; o UPDATE do `protocol_number` no "Aplicar" não tem
  guarda de `''` nem filtro de tenant (igual ao de etapa, que já é assim).
- **Tela:** o erro de `useMensagensEmail` vira "Nenhum e-mail lido ainda"; entre o
  último refetch e o clique em "Aplicar" há uma janela curta (a RPC devolve
  `VOID`). (O contador da Sidebar já não engole erro: desde a página nova, com a
  consulta falhando o item mostra um "!" no lugar do número, nos dois menus — ver
  [A página como caixa de decisões](#a-página-como-caixa-de-decisões-22102026).)
- **Dados:** 13 dos 30 projetos ativos sem protocolo numérico (a robô os identifica
  pela UC ou pelo nome); 1 ativo com duas UCs na mesma célula, separadas por "/"
  (cada pedaço casa como número) e 1 com UC alfanumérica ("UQM…"), que não casa com
  nada e fica só com o protocolo ou o nome.

**Fase 2 (fora deste plano):** pedir a troca do relógio por e-mail é **enviar** em
nome da empresa — a mesma família de "pedir vistoria", que a regra da casa manda
nunca fazer sem conversar. Esboço na spec §13 (modelo do pedido, aprovação por um
clique, ou rascunho no Gmail).

## A página como caixa de decisões (22/10/2026)

> **Substituída em nov/2026 pela página nova** (entrega 2 da repaginação, seção "A página nova" no fim
> deste documento). Ficam valendo daqui: o Desfazer de 8 s, o Aplicar silencioso, o contador da barra
> lateral, a caixa de e-mail `null` enquanto carrega e a altura das colunas (`decidir/altura.ts`). As abas,
> a faixa de saúde, a busca e os filtros saíram.

Spec: `docs/superpowers/specs/2026-10-22-ludmilla-pagina-decidir-design.md` · plano:
`docs/superpowers/plans/2026-10-22-ludmilla-pagina-decidir.md`.

**O que mudou na tela.** A `/ludmilla` deixou de ser uma pilha (cartões das contas →
criações → recomendações → registro), em que as decisões ficavam embaixo de
configuração e histórico. `src/pages/Ludmilla.tsx` virou uma casca: topo + abas. No
topo, valendo para todas as abas: o **código da imagem** da Elektro (acima de tudo:
expira em 5 min), os **alertas das contas** (erro, sessão expirada — com a estação
offline o texto manda ligar o computador —, caixa de e-mail não configurada), só
quando existem, e a **faixa de saúde** — um chip por concessionária (ponto de saúde,
meio, "lida há", pendentes; clicar filtra a aba Decidir, o botão ao lado faz
"Verificar agora"). Abas: **Decidir** (a de abertura, com o número de pendentes),
**Concessionárias** (os cartões de antes, movidos sem mudar o que fazem: "Verificar
agora", contadores da última leitura, "O que ela leu na caixa"; as regras de e-mail
agora **recolhidas** num `<details>` e o botão "Acesso ao portal" nos cartões de
portal), **Criações na CPFL** (agora com o código do projeto e o número da CPFL —
`resultado.node`, senão `projects.cpfl_node_id`) e **Registro** (igual). "Acessos aos
portais" continua no cabeçalho. A página continua só para `useLudmillaDisponivel()`.
Componentes em `src/components/ludmilla/{decidir,topo,abas}/`.

**No celular** (< 640 px) as abas viram uma barra **no topo**, logo abaixo da barra
do app, e grudam ali ao rolar (`sticky top-14`; decisão do usuário: embaixo já está a
barra de atalhos). A ordem é: abas → código da imagem → alertas → faixa → conteúdo.
A barra é filha direta do `<Tabs>` (o contêiner da página): sticky só gruda dentro
do pai. O detalhe abre por cima (folha não modal) com os botões fixos embaixo; lado
a lado só a partir de 1024 px.

**Decidir.** Uma lista só com recomendações (`portal_updates`) e **A fazer**
(`portal_afazeres`), mais antigas primeiro, com busca (projeto, titular, empresa,
protocolo — sem acento; protocolo sem zeros à esquerda), situação e tipo (Mudar
etapa · Gravar protocolo · Bloqueados · A fazer). "Bloqueado" segue
`detalheDoCartaoDeEmail().bloqueio` (`raw.motivo` abrindo com "não anexei ·"): sem
Aplicar nem seletor, só "Dispensar" (= Ignorar). O detalhe mostra Quem (com "achado
pelo protocolo/pela UC/pelo nome do titular" — no e-mail sempre, no portal só quando
não foi pelo protocolo), O que chegou (a faixa "Documento não anexado", a data do
e-mail), Documentos do projeto, A sugestão (com a ressalva) e "Este projeto na
Ludmilla" (`ludmilla_linha_do_tempo`). O filtro mora na página: trocar de aba não
apaga a busca.

**Desfazer.** Depois de decidir, o painel vai para a próxima pendente e o aviso (no
alto da tela) oferece **Desfazer**: a decisão ESPERA 8 s antes de chamar a RPC de
sempre (`ludmilla_aplicar_update` / `ludmilla_ignorar_update` /
`ludmilla_afazer_feito`) — desfazer é não mandar. Sair da página grava na hora;
fechar a aba com decisão esperando faz o navegador perguntar. O "Aplicar" da caixa é
**silencioso** (`useAplicarUpdate({ silencioso: true })`): o aviso com Desfazer já
disse o que vai acontecer, e o "Card movido…" chegaria 8 s depois cobrindo o rodapé
no celular. Quem chama `useAplicarUpdate()` sem a opção continua com o aviso de
sempre; o aviso de erro vale nos dois casos.

**Altura da caixa (computador).** Lista e detalhe rolam por dentro; a caixa vai de
onde ela começa até o fim da janela (`decidir/altura.ts`, medida pela soma dos
`offsetTop`, refeita quando a janela ou o conteúdo de cima muda), com mínimo de
280 px. Em 1280 × 800, com um alerta e a faixa em duas linhas, os botões do detalhe
ficam à vista sem rolar; com o código da imagem na tela, a página rola até eles.

**A caixa de e-mail ainda carregando** (ou com a consulta falhando sem nenhuma
resposta antes) é `null`, não `false`: nem alerta "caixa não configurada", nem chip
parado. Carregando, o cartão diz "Conferindo a caixa…"; na falha, "Não deu para
conferir a caixa de e-mail agora" e por que o "Verificar agora" está desligado. Uma
resposta já recebida vale mesmo se a atualização seguinte falhar. O alerta da sessão
expirada recebe o estado da estação
(`alertasDasContas(..., c => estadoDaEstacao(c, agora))`).

**Contador da barra lateral** (decisão do usuário, 22/10/2026): recomendações
pendentes + A fazer abertos — o mesmo número da aba Decidir —, por
`useContadorDaLudmilla()` (`contagemDaLudmilla`), no menu fixo do computador e no
menu em gaveta do celular (`99+` acima de 99). Enquanto carrega mostra 0; se uma das
consultas falha, o selo vira um **"!"** visível (o `title` sozinho não aparece no
toque), com `aria-label` e `title` "Não foi possível atualizar o número de pendências
da Ludmilla", em vez de engolir o erro.

**Banco (migração `20261022200000_ludmilla_afazeres`).** `portal_afazeres (id,
tenant_id, account_id, project_id, mensagem_id → portal_email_mensagens, tipo,
titulo, mensagem, criado_em, feito_por, feito_em)`: RESTRICTIVE por tenant, leitura
só da equipe (`ludmilla_equipe_ok`), sem política de escrita. `ludmilla_email_avisar`
(corpo do prosrc vivo) grava o A fazer junto com o sino, uma vez por mensagem
(UNIQUE `mensagem_id`); `tipo` sai do título (`vistoria_aprovada`, `troca_falhou`,
`devolucao`; o resto é `aviso`). `ludmilla_afazer_feito(id)` → `true` marcou,
`false` já estava feito — vale para a equipe toda. `ludmilla_linha_do_tempo(projeto,
limite)` = os ramos de `ludmilla_registro` com projeto + e-mails lidos + A fazer.
`ludmilla_aplicar_update` (md5 `6183edef6c3f93810282039bdd565a26`, conferido em
25/10/2026), `ludmilla_registro`, a varredura e o worker não mudaram. O sino continua
igual.

**Prova.** Lógica pura com vitest (`ludmillaCaixa.ts`, `ludmillaPainel.ts`,
`ludmillaFilaDeDecisoes.ts`, `ludmillaContador.ts`, `decidir/altura.ts`). A página
inteira foi provada em harness com dublês e dados inventados, em 1280 × 800 e
390 × 812, cobrindo CPFL, EDP e ENEL (48 checagens; prints em
`.superpowers/sdd/2026-10-22-ludmilla-pagina-decidir/task-8-prints/`, fora do git).
Com linhas de verdade só se prova abrindo `/ludmilla` depois do deploy.

## Medir: etapas, tempo normal e carteira (entrega 1 da repaginação, nov/2026)

Spec: `docs/superpowers/specs/2026-11-08-ludmilla-repaginacao-design.md`; plano
`docs/superpowers/plans/2026-11-08-ludmilla-e1-medir.md`. Migração
`20261108200000_ludmilla_medir.sql`, **aplicada em 09/11/2026**; prova
`supabase/provas/ludmilla_medir.sql` (roda dentro de `BEGIN … ROLLBACK`; 19 casos).
Ainda sem tela: a página nova (entrega 2) é quem vai ler isto.

- **`project_stage_log`**: cada troca de etapa. Origens:
  - `gatilho` — `trg_registrar_etapa` em `projects.status`, desde a aplicação. Nunca
    bloqueia a troca: erro vira `WARNING` no log do banco.
  - `historico` — lido do texto de `project_history`: "Etapa alterada de "X" para "Y""
    (grava o **rótulo** da coluna, desde 19/07/2026), "Status alterado para "code"" (jan) e
    "… moveu para code." (Aplicar da Ludmilla). 1.160 linhas na carga, nenhuma sem etapa.
  - `criacao` — a entrada na primeira etapa, só para projeto com histórico (276).
  - `atual` — a etapa atual quando o histórico não chega nela, a partir de
    `last_status_change` (42).
- **`projects.status` é o enum `project_status`**: comparar e gravar com `::text`.
- **`ludmilla_passagens(tenant)`** (interna, sem `EXECUTE` para usuário): uma estada por
  etapa, com dias e se é confiável (entrou a partir de 19/07/2026).
- **`ludmilla_normais()`**: o normal de cada concessionária × etapa. Mediana de 12 meses
  com no mínimo 5 passagens fechadas (`medido`); senão a mediana da etapa em todas as
  concessionárias (`geral`); senão o `stale_days` da coluna do Kanban ativo (`coluna`);
  senão nenhum. Nunca menos de 1 dia. Na aplicação: 32 medidos, 31 gerais, 9 pela coluna,
  18 sem normal. ENEL: Aprovado 32 d, Vistoria Solicitada 23 d, Em Análise 2 d.
- **`ludmilla_carteira()`**: os 95 projetos ativos (60–75 ms) com tempo na etapa, normal,
  atraso, com quem está (`nos`, `concessionaria`, `cliente`; regra da spec 6.4), os
  projetistas ligados à empresa (`staff_companies`) e o histórico. Mais atrasado primeiro.
  Outro tenant recebe "Sem acesso à Ludmilla." e não lê o registro.

**O que os números já mostram.** Quase todos os atrasados estão em **Aprovado** (o maior:
157 dias além do normal de 7).
- **Viés de quem termina primeiro.** O normal só conta passagens fechadas desde 19/07, e
  as rápidas fecham primeiro. Por isso normais como "Aprovado em 7 dias" estão baixos
  agora e devem subir conforme os dados acumulam.
- **Com quem está em Aprovado (decidido em 09/11/2026).** O usuário: "Para pedir vistoria
  somos nós, para instalar é com a empresa cliente". Migração
  `20261109120000_ludmilla_carteira_aprovado.sql` (só troca `ludmilla_carteira`): Aprovado
  fica `cliente` (na tela, "Com a empresa") até a empresa pedir a vistoria pelo painel
  (`solicitar_vistoria` → tarefas `origin = 'vistoria_request'` criadas depois de
  `last_status_change`); daí `nos`. Item aberto na fila continua pondo "com a gente". Na
  aplicação, 45 de 48 Aprovados ficaram com a empresa (os outros 3 têm item na fila); os
  12 pedidos de vistoria do tenant eram de projetos que já tinham saído de Aprovado.
  Limite: instalação avisada por telefone ou WhatsApp não muda nada até alguém registrar o
  pedido no sistema. Prova: casos D1–D3 (22 no total, todos verdes).

**O que NÃO está provado:** o gatilho com uma troca de etapa real (até o fim da rodada de
09/11 ninguém tinha mudado etapa depois da aplicação). Conferir com
`SELECT origem, count(*), max(em) FROM public.project_stage_log GROUP BY 1` — deve
aparecer `gatilho`.

## A página nova: estrutura A no mundo "Conta de luz" (entrega 2 da repaginação, nov/2026)

Spec: `docs/superpowers/specs/2026-11-08-ludmilla-repaginacao-design.md` (mockup aprovado em 08/11,
"v3 — Estrutura A completa"); plano: `docs/superpowers/plans/2026-11-09-ludmilla-e2-pagina.md`. Sem
mudança no banco: a página lê `ludmilla_carteira()` e `ludmilla_normais()` (entrega 1) e o que já lia.

**O mundo.** Só a `/ludmilla` (o menu do GD e o resto do app não mudam). Cores `lm-*` no Tailwind e a
classe `.ludmilla-mundo` (`src/index.css`), que redefine as variáveis do shadcn só dentro da página — os
cartões reaproveitados (contas, regras de e-mail, o detalhe) entram no mundo sem reescrita. Public Sans
carregada só ao abrir a página (`mundo/useFonteDaLudmilla.ts`). Texto em alerta sobre a caixa é `#8F2F09`
(o `#C2410C` da spec dá 4,41:1 ali); foco petróleo, branco na faixa. Avatar provisório (`mundo/AvatarDaLudmilla.tsx`).

**A tela.** Faixa petróleo (avatar, "Ludmilla", "Analista de homologação", Ajustes). Coluna da esquerda,
a única navegação: o recado do dia (montado dos números, sem IA — `ludmillaRecado.ts`), Para decidir
(Agora / Esta semana / Quando puder, com "Fila de"), Carteira (Parados além do normal, Com a gente, Com
a concessionária, Com a empresa, Todos), Comigo (Fiz sozinha, Diário) e Leituras (clicar leva aos
Ajustes). No meio, os cartões completos da fila (prazo, responsável, a ação como título, o porquê em
primeira pessoa, o histórico pequeno, o botão principal), as linhas da carteira, Fiz sozinha, Diário ou
Ajustes. À direita, o detalhe de decisão de sempre (`DetalheDaDecisao`, títulos em primeira pessoa, com
`topo` e `historico`), a ficha do projeto (histórico grande, "O que eu li por último", próximo passo,
"Ver na fila", "Abrir o projeto"), "O que eu faço sozinha hoje", o recado inteiro ou "Onde eu leio" (os
cartões das contas, agora com "Ler agora", as criações na CPFL e "Ainda não acompanho …").
**"Ler agora" no topo do cartão (13/11/2026):** o botão (e a linha de erro) ficam logo abaixo da última
leitura. No fim do cartão ele sumia nas contas por e-mail, porque a lista "O que eu li na caixa" vem antes e é
longa: medido no ar, a 2.190 px do topo do cartão na EDP e a 30.488 px na ENEL, num painel de 793 px. Teste:
`CartaoDaConta.test.tsx` (a ordem no HTML renderizado).
Três colunas a partir de 1280 px; de 960 a 1279, esquerda + lista e o detalhe numa folha; abaixo de 960,
uma coluna por vez (faixa com menu e engrenagem, recado em uma linha, grupos no topo, detalhe e menu em
tela cheia). Componentes em `src/components/ludmilla/{pagina,mundo}/`.

**As regras** (todas puras, com vitest):
- **Grupo** (`ludmillaFila.ts`, spec §6.1): Agora = cobrança da troca, troca que falhou, e-mail que voltou,
  recomendação de etapa de hoje (dia de Brasília), vistoria aprovada com 7 dias ou mais; Esta semana =
  recomendação de dias anteriores, vistoria aprovada com menos de 7 dias; Quando puder = documento
  travado, só gravar protocolo, sem sugestão, aviso. Mais antigo primeiro. O CAPTCHA continua só como o
  alerta acima de tudo.
- **Dono** (§6.2): `donos` da carteira pelo projeto do item; sem projeto ou fora da carteira = Sem dono.
  O projetista abre na própria fila; o gestor em Todos.
- **Recado:** "desde" = a última visita (localStorage `ludmilla:ultima-visita:<id>`, em try/catch) ou
  18:00 do último dia útil; no máximo 7 dias. E-mails = linhas novas em `portal_email_mensagens`;
  protocolos = o maior `protocolos_lidos` de uma varredura `ok`; "Fiz sozinha" = anexo conferido e
  parecer no card (registro); "Separei" = a fila de todos.
- **Barras** (`ludmillaBarras.ts`): as colunas do Kanban, passadas, a atual e as que ainda vêm; desvios
  só se visitados; a atual conta só a estada de agora; traço no normal da concessionária; a atual em sol
  ou, além do normal (dias inteiros > normal), sol até o traço e alerta acima.
- **Carteira** (`ludmillaCarteira.ts`): a ordem da spec §4.3 (além do normal primeiro, do maior atraso
  para o menor; depois todos pelo tempo na etapa); "parado" = dias inteiros > normal; o normal em
  palavras por fonte (`medido`, `geral` = estimado, `coluna` = prazo do Kanban).
- **Botão do cartão:** decide direto só Aplicar habilitado e "Marcar como feito"; cobrança e pedido da
  troca ("Revisar e enviar"), documento travado e sem projeto abrem o detalhe.

**Ficou de fora** (entregas seguintes): as chaves e o Desfazer do "Fiz sozinha" (4), o resumo da manhã
(5), o item `parado` (3), "Passar para outra pessoa" (coluna nova), a barra da troca do medidor da ENEL
(consulta nova) e a certeza da sugestão (não há dado). Saíram da página: as abas, a faixa de saúde, a
busca e os filtros da aba Decidir.

**Prova.** Funções puras com vitest (`ludmillaTempo`, `ludmillaCarteira`, `ludmillaBarras`,
`ludmillaFila`, `ludmillaRecado`, `ludmillaLeituras`, `pagina/modo`). A página foi provada em harness
com dados inventados em 1440 × 900, 1100 × 800, 800 × 800 e 375 × 812 e auditada com `web-design-guidelines`
(prints fora do git). **O que NÃO está provado:** a página com os dados reais — abrir `/ludmilla` depois
do deploy, como gestor e como projetista, e conferir o recado, as contagens da carteira contra
`ludmilla_carteira()` e o Desfazer numa decisão de verdade.
