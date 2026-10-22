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

**O que ainda falta para a Elektro recomendar etapa.** A recomendação vem de
`portal_status_map (tenant, connector, status_portal → project_status)`, e a
Elektro **não tem linhas**: "Aprovado" normaliza para `APROVADO`, não acha
mapeamento, e o status é guardado **sem** sugestão. Preencher o vocabulário
exige as palavras exatas do Portal GD — por isso ninguém chutou.

**Fora de escopo, de propósito:** qualquer coisa que leia a página do portal
por programa (bookmarklet, extrator). O trabalho fica do lado de cá.

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
0b. **Primeiro run da ENEL por e-mail** — manual e acompanhado, antes de
   qualquer agendamento, pelo
   [roteiro](../../superpowers/2026-10-20-primeiro-run-enel-email.md). Antes
   dele, nesta ordem: o push da `main` (decisão do usuário, depende da frente
   de assinatura), a `ludmilla-parecer` com o modo ENEL no ar e o **robô da VPS
   atualizado** (`ludmilla-worker.yml`, à mão) — até lá, "Verificar agora" no
   cartão da ENEL roda no modo da EDP (foi o incidente de 14/10). Depende do
   usuário:
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

**Com UM protocolo citado e nomes de arquivo genéricos** (`parecer.pdf`,
`documento.pdf`, `image001.png`) nada muda: anexa todos os não-imagem e lê o
maior PDF. Regra que não anexa nem lê PDF não depende de arquivo e não é afetada.

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
| Busca na caixa | pelo número do protocolo | `SEARCH FROM <remetente> SINCE <hoje − 30 dias>` |
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

1. **Texto, sem IA** (`identificarPorTexto`): protocolo/NT e UC no assunto + corpo.
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
recupera depois que o cadastro for corrigido.

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
senão o próprio nome se bloquearia. O prompt da edge function pede o titular "na
ordem natural, sem vírgula", e a função filtra o eco do exemplo do prompt ("NOME
SOBRENOME"): uma ordem invertida ("SILVA, MARIA") viraria falso bloqueio de documento
legítimo. O bloqueio abre cartão (sem etapa) com o motivo, para a equipe ver; o
documento não sobe.

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
| Troca não executada | texto: "não foi executada", "não sendo executada", "Motivo da rejeição"… | sino, com o motivo |
| Devolução (`postmaster`) | regra | sino "um dos destinatários não recebeu" |
| Resposta automática (`no-reply`) | regra | só anota |

"Aprovada" lida **no corpo** só toca o sino; não move etapa nem abre cartão. O
sistema **não tem** etapa "vídeo aprovado, aguardando relógio" (criar uma mexeria no
Kanban de todos os tenants): o projeto fica em Vistoria solicitada e o histórico
registra o passo. O sino da devolução diz "um dos destinatários", não "a ENEL não
recebeu": a devolução de 30/09 chegou no mesmo minuto da resposta automática da ENEL,
e quem não recebeu foi outro destinatário. Concluído continua **manual**: "troca
feita" não apareceu em nenhuma amostra (a ENEL avisa quando cria a nota de serviço e
quando a tentativa falha), e a frase "a troca … já foi realizada através da nota de
serviço" hoje não é classificada — só anota.

**Quando a IA é chamada** (`precisaLerPdf`; ~US$ 0,10 por PDF, lançado no extrato de
IA do console com `kind = 'ludmilla_parecer'`): a regra tem `ler_pdf`, há PDF, não
houve conflito nem projeto inativo no texto (ler não resolveria), **e** (o texto não
identificou o projeto **ou** a regra espera veredito — `carta_projeto` e
`resultado_vistoria` — e o texto não classificou). As Cartas chegam com o corpo
vazio: tudo está no PDF. A tentativa é contada **antes** da chamada
(`ludmilla_email_tentativa`); a IA fora do ar deixa a mensagem para o próximo run,
até 5 vezes. Lê o maior PDF do e-mail; se o nome dele traz o número de **outro**
projeto, o que ele diz não vale para este (nem etapa, nem troca, nem sino).

### `recomendacaoCabe` — 30 dias de e-mail não sugerem etapa para trás

A primeira leitura traz 30 dias. Uma Carta de aprovação de projeto que já está em
vistoria não pode virar sugestão de voltar para Aprovado. A sugestão só vale se o
projeto **não está já nessa etapa**; Aprovado e Pendência só vêm de etapas anteriores
à aprovação (`pending`, `analysis`, `documentation`, `approval`, `pendencia`);
Vistoria reprovada só de `approved` ou `vistoria_solicitada`. Quando não cabe, a
ressalva diz por quê ("não sugeri … o projeto já está à frente, em …").

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
  mostra o selo.
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

- **Janela de busca FIXA de 30 dias** (`janelaDeBusca`, `JANELA_MAXIMA_DIAS`). A
  primeira versão lia "desde a última varredura, −2 dias": a mensagem pendente (IA
  sem cota por alguns dias) e o "Ler de novo" sumiam da busca sem aviso, e o
  recuperar só funcionava para e-mail com menos de ~3 dias. Custo: cada run relê os
  envelopes dos últimos 30 dias (barato: sem corpo); a pendência filtra o que já
  concluiu, e a IA só roda para as pendentes. `ultima_varredura_em` não muda mais
  nada na ENEL.
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

### Banco da ENEL

| Objeto | Para que |
|---|---|
| `portal_accounts.identificacao` | `protocolo_no_assunto` ou `remetente` |
| `portal_email_regras.tipo_documento` | + `carta_projeto`, `resultado_vistoria`, `troca_relogio`, `resposta_automatica`, `devolucao`, `comunicado` |
| `portal_email_mensagens.aviso_em` | o sino uma vez por mensagem |
| `ludmilla_email_conta` | `identificacao` e `ultima_varredura_em` da conta |
| `ludmilla_email_projetos` | os projetos da concessionária, com `ativo`; só service role |
| `ludmilla_email_avisar` | toca o sino (admin + staff), idempotente por `aviso_em` |
| `ludmilla_email_registrar` | agora com 20 parâmetros (`p_referencia`, `p_casamento`, `p_abrir_cartao`, `p_atualizar_protocolo`); grava `titular_portal` com o titular do **cadastro** (EDP e ENEL) |
| `ludmilla_email_anexo_novo` | agora com 8 parâmetros (`p_chave`) |
| `ludmilla_aplicar_update` | recuperou o ramo de troca de protocolo (`20261016120000`) |

Migrações: `20261013120000` (base), `20261014120000` (regra do `atendimento.edsp`),
`20261016120000` (Aplicar), `20261016130000` e `20261016140000` (titular e troca de
protocolo, com a trava), `20261019120000` (chave do anexo). O `registrar` e o
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
aparece uma vez só. O selo do casamento mostra "protocolo", "CPF/CNPJ", "UC" ou
"nome do titular"; a troca de protocolo tem um selo violeta ("protocolo novo —
casado por …; no cadastro está …"), e o "Atualizar protocolo" sem etapa agora diz
"Protocolo do cadastro atualizado", não "Card movido". Erro na consulta dos cartões
aparece em vermelho, com "Tentar de novo", e não como "Nada pendente".

**Contadores da ENEL** (`MensagensEmail.tsx`, `ContadoresEmail`, quando
`identificacao = 'remetente'`): `lidos`, `por_protocolo`, `por_uc`, `por_titular`,
`nao_identificados` + `conflitos` somados ("levantei a mão"), `bloqueados`, `avisos`,
`anexados`, `imagens_ignoradas`, `a_tentar_de_novo`, `falhas`. **As chaves são as de
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
para conta de e-mail. O run de e-mail (`varredura_email`) hoje só nasce do "Verificar
agora" ou de `INSERT`; **não há agendamento** e não deve haver antes de olhar os
números do primeiro run.

### Incidente de 14/10

Um admin clicou "Verificar agora" no cartão da ENEL com o robô da VPS ainda sem o
código dela: o run rodou **no modo da EDP** (protocolo no assunto). Efeito: 18
mensagens ligadas ao projeto certo, 0 anexo, 0 chamada de IA, mas 18 cartões
pendentes e 18 sinos, e linhas de mensagem com chave = protocolo (a chave da ENEL é
`''`: o código novo as releria e duplicaria o histórico). Limpeza feita em 16/10,
autorizada pelo usuário, com um bloco `DO` que abortaria se não fossem exatamente
18; os sinos não se apagam (só marcar como lido). **Regra: não clicar em "Verificar
agora" no cartão da ENEL antes de o robô da VPS ser atualizado.**

### O que NÃO está provado

**O run nunca rodou.** Tudo é teste unitário (580 testes do robô, `fail 0`, medidos
em 21/10, no commit `13200de`, o da rodada 4 da classificação), SQL em `begin; …
rollback;`, revisão independente de cada tarefa e
mutações. Nunca foi exercido: o IMAP com os remetentes reais, a `ludmilla-parecer`
em modo ENEL contra PDF real, o embed novo da tela contra o PostgREST real (exige
login) e o laço `executarVarreduraEnel` (sem teste, como o da EDP). O roteiro diz o
que olhar. Resíduos conhecidos, aceitos de propósito:

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
- **Troca de protocolo:** o resíduo da Carta de pendência antiga (acima); uma troca
  **ignorada** pode voltar numa 3ª passada pendente; a trava do banco compara a UC
  só por pedaço, então uma UC pontuada ("3.928.129-57") passa; uma recomendação
  ignorada pode reaparecer numa 3ª passada.
- **Run:** a sugestão de etapa **não olha a data do e-mail**: uma "vistoria
  reprovada" de três semanas atrás, com o projeto já reaprovado e de volta em
  Vistoria solicitada, vira cartão "Vistoria reprovada" — confira o `recebido_em`
  antes de Aplicar. PDF barrado de **outro** titular bloqueia o e-mail inteiro (lado
  seguro); o erro "sem remetente" mostra o texto genérico de "sem regras"; a
  retomada do anexo pode rebaixar o texto do comentário de NT para código;
  `comunicado` em `TIPOS_SEM_SINAL` é morto (a regra de comunicado nem é buscada).
- **Banco:** `ludmilla_email_avisar` não filtra `profiles.active`; `LIMIT 2000` em
  `ludmilla_email_projetos`; o UPDATE do `protocol_number` no "Aplicar" não tem
  guarda de `''` nem filtro de tenant (igual ao de etapa, que já é assim).
- **Tela:** o erro de `useMensagensEmail` vira "Nenhum e-mail lido ainda" e o
  contador da Sidebar engole erro; entre o último refetch e o clique em "Aplicar"
  há uma janela curta (a RPC devolve `VOID`).
- **Dados:** 13 dos 30 projetos ativos sem protocolo numérico (a robô os identifica
  pela UC ou pelo nome); 1 ativo com duas UCs na mesma célula, separadas por "/"
  (cada pedaço casa como número) e 1 com UC alfanumérica ("UQM…"), que não casa com
  nada e fica só com o protocolo ou o nome.

**Fase 2 (fora deste plano):** pedir a troca do relógio por e-mail é **enviar** em
nome da empresa — a mesma família de "pedir vistoria", que a regra da casa manda
nunca fazer sem conversar. Esboço na spec §13 (modelo do pedido, aprovação por um
clique, ou rascunho no Gmail).
