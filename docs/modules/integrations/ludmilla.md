# Ludmilla — acompanhamento dos portais das concessionárias

> Estado: 🟡 CPFL funcionando ponta a ponta (set/2026): robô na VPS lê os
> protocolos, o banco gera recomendações, a página /ludmilla aplica/ignora.
> Elektro bloqueada (Akamai). Só tenant GD Manager (`is_library`).
> Spec: [docs/superpowers/specs/2026-09-14-ludmilla-design.md](../../superpowers/specs/2026-09-14-ludmilla-design.md)

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

**Reprovado reenviado sob protocolo novo**: protocolo sem par é casado por
CPF/CNPJ, UC ou título igual ao de outro protocolo já casado da conta;
vira recomendação com `atualizar_protocolo` — Aplicar grava o número novo.

**Armadilhas**: a API só responde depois de clicar em "Projetos
Particulares" (é o que abre a sessão do app); a tela do projeto não renderiza
no headless shell e o Chromium completo cai (SIGTRAP no crashpad sob o
systemd) — por isso API; `getUserData` devolve um token de sessão → corpos
capturados são limpos de `token` antes do bucket; a data dos anexos vem
d/m/aaaa e a da lista m/d/aaaa.

## Próximos

2. Agendamento 2×/dia (pg_cron → `ludmilla_pedir_run`); mostrar
   `portal_anexos` (enviados/bloqueados) na página /ludmilla; 3 projetos em
   andamento sem par no portal; os 4 cartões que a lista não devolve (199 de
   203 — 5 "Incompleto" sem atividade).
3. Solicitar vistoria automática quando a empresa pede pelo painel — a
   conversar (exige a mesma conferência de titular/UC e é a única escrita).
4. Elektro: decidir entre e-mail (Claudinho) e sessão do navegador do usuário.
