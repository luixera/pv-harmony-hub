---
name: desenvolveLuiz
description: Pacote de método do GD Manager — OBRIGATÓRIO em todo prompt. Junta obra/superpowers (processo) com vercel-labs find-skills (descoberta de ferramentas) e as regras da casa deste repositório. Invocar antes de qualquer resposta ou ação.
---

# desenvolveLuiz — o método de trabalho neste repositório

Este é o ponto de entrada. Toda interação começa aqui, e daqui se puxam
as skills certas. Regra do usuário (set/2026): **roda em todo prompt.**

## 1. Sempre, antes de responder

1. Ler `using-superpowers` (`.claude/skills/using-superpowers/SKILL.md`) e
   obedecer: se há 1% de chance de uma skill se aplicar, invocar. Anunciar
   "Using <skill> para <fim>".
2. Consultar a memória do projeto (`MEMORY.md`) ANTES do histórico da
   conversa e da documentação extensa — regra da casa, economiza contexto.
3. Ler o `CLAUDE.md` e só a doc do módulo que será tocado.

## 2. Roteamento por tipo de pedido

| O usuário diz | Skill de processo | Depois |
|---|---|---|
| "vamos criar / construir / novo funcionário / nova função" | `brainstorming` (classificar: spike / bounded / arquitetural, dizer em voz alta) | arquitetural → spec em `docs/superpowers/specs/` → `writing-plans` → `executing-plans` |
| "corrija / está errado / lento / não funciona" | `systematic-debugging` (causa-raiz antes de mexer) | correção com teste que reproduz o defeito ANTES |
| implementação de qualquer coisa | `test-driven-development` | teste vermelho → código → verde |
| "terminei?" / antes de dizer pronto | `verification-before-completion` | prova (saída de comando), não promessa |
| pedido de revisão | `requesting-code-review` / `receiving-code-review` | — |
| trabalho paralelo em várias frentes | `dispatching-parallel-agents` / `using-git-worktrees` | só se o usuário pedir agentes |
| "crie uma skill / melhore essa skill / a skill não dispara" | `skill-creator` (oficial anthropics) — captar intenção, entrevistar, rascunhar, testar com evals, otimizar a descrição | `writing-skills` (TDD do texto da skill) → `quick_validate.py` → instalar em `.claude/skills/` → registrar aqui na §3 |
| mexer em auth, RLS/política, edge function, segredo, upload/Storage, endpoint novo, pagamento, dado sensível, CORS/CSP, dependência | `security-review` (checklist OWASP, **só quando necessário** — não roda em todo prompt) | passar o checklist adaptado (§3) antes de `verification-before-completion`; achado grave → memória `security-posture` |
| "abra o portal / preencha / clique / veja a tela / automatize no navegador / a Ludmilla precisa fazer X no portal" | `agent-browser` (vercel-labs) — explorar a tela real com `snapshot -i` antes de codificar | roteiro escrito sobre o que a exploração mostrou; worker chama a CLI |
| "a tela está feia / genérica / cara de IA / deixa bonito" numa página PÚBLICA (landing, portfólio, one-pager) | `design-taste-frontend` (tasteskill, 610K) — direção de arte com inspetor no navegador | **não** usar em tela de app/dashboard (ver a linha abaixo) |
| "redesenhar / padronizar o visual" de tela INTERNA (painel, modal, dashboard do GD Manager) | **nenhuma skill de estilo** — seguir o visual que o GD Manager já tem, olhando telas vizinhas | o usuário desinstalou `awesome-design-md` em 14/10/2026: estilo de big tech não entra no produto. Auditoria: `web-design-guidelines` |
| "revise minha UI / acessibilidade / UX" | `web-design-guidelines` (vercel-labs, 736K) — audita contra as Web Interface Guidelines | achado vira correção, não só lista |
| teste de navegador, E2E, "testa essa tela" | `playwright-cli` (microsoft, 183K) | o projeto usa vitest para unidade; Playwright é do worker da Ludmilla — ver §4 antes de criar suíte nova |

## 3. find-skills — antes de construir do zero

Em **todo trabalho de desenvolvimento**, antes de implementar uma capacidade
nova (automação de navegador, integração, geração de documento, testes de um
framework, deploy…), rodar `find-skills`:

```bash
npx skills find <termo>
```

Critério de aceite (da própria skill): 1K+ instalações ou fonte oficial
(`vercel-labs`, `anthropics`, `microsoft`, `supabase`), repositório com
estrelas. Instalar com `npx skills add <owner/repo@skill> -a claude-code
--copy -y` — **sempre com `-a claude-code`**: sem isso o instalador cai na
pasta temporária do Codex e o Claude Code não lê (aconteceu em 13/09/2026).
Reportar ao usuário o que foi encontrado, mesmo quando nada serve.

### Skills de domínio já instaladas (usar quando o tema aparece)

- `supabase` (oficial) — qualquer tarefa com Supabase: Auth, RLS, Edge
  Functions, Storage, Vault, cron, logs.
- `supabase-postgres-best-practices` (oficial) — **antes** de escrever
  migração, tabela, índice, política, função ou job no Postgres.
- `skill-creator` (oficial `anthropics/skills`, instalada em 16/09/2026) —
  criar, editar, medir e otimizar skills. Rotina da casa ao criar uma skill:
  1. `find-skills` primeiro — só criar do zero se não houver oficial/1K+;
  2. `skill-creator` → captar intenção, entrevistar, escrever `SKILL.md`,
     casos de teste e evals (`scripts/run_eval.py`, viewer);
  3. `writing-skills` — teste vermelho (Claude sem a skill) → verde (com);
  4. `python .claude/skills/skill-creator/scripts/quick_validate.py <pasta>`
     antes de dar por pronta (scripts são Python — instalar se faltar);
  5. `scripts/improve_description.py` quando a skill não dispara;
  6. skill do repositório fica em `.claude/skills/<nome>/` (commit), entra
     na §3 desta tabela e ganha memória do módulo.
- `security-review` (`affaan-m/ecc`, instalada em 17/09/2026; **fora do
  critério oficial/1K+ — aceita por decisão do usuário**) — checklist de
  segurança **sob demanda**: só entra quando a tarefa toca auth, RLS,
  edge function, segredo, upload, endpoint, pagamento, dado sensível ou
  dependência. Não é rotina de todo prompt. Adaptação à casa (a skill é
  genérica, com exemplos Next.js/Solana — ignorar o que não se aplica):
  - "RLS habilitada" aqui significa **política RESTRICTIVE por `tenant_id`**
    e papel lido de `app_metadata`; ver `docs/project/security.md`.
  - Segredos: Supabase Vault / secrets da edge function / GitHub Secrets do
    deploy — nunca em `src/`, nunca em migração, nunca em `.env` commitado.
  - Edge function: validar tenant do alvo, usar service role só no servidor,
    CORS restrito ao domínio da VPS.
  - Storage: buckets fechados (auditoria jul/2026), acesso por URL assinada.
  - Rate limit e CSRF: cobertos por Supabase Auth + Turnstile; conferir só
    em endpoint público novo.
  - Ao final, `npm audit` e registrar pendências na memória
    `security-posture`.

- **Visual e testes de tela (instaladas em 14/10/2026, a pedido do usuário)** —
  usar **só quando o tema aparece**, nunca por padrão:
  - `design-taste-frontend` (`leonxlnx/taste-skill`, 610K) — página **pública**
    com cara de template. Traz direção de arte e um laço de "olhar e corrigir"
    por captura de tela. **Não** serve para dashboard/app.
  - `web-design-guidelines` (oficial `vercel-labs`, 736K) — auditoria de UI e
    **acessibilidade**. Boa antes de entregar tela nova.
  - `playwright-cli` (oficial `microsoft`, 183K) — Playwright pela CLI. Atenção:
    o Playwright desta casa vive no **worker da Ludmilla** (varredura e criação
    na CPFL); não criar suíte paralela sem conversar. O front é testado por
    **vitest** (`npm test`), e a verificação de tela foi feita até aqui pelo
    navegador do Claude. Lembrete da casa: **automação não disfarça navegador**
    — portal que bloqueia robô (Elektro/Akamai) continua fora.

- **Repaginação de tela interna (instaladas em 07/11/2026, a pedido do usuário,
  para a nova página da Ludmilla)** — passam no critério (oficiais):
  - `frontend-design` (oficial `anthropics/skills`, 1,1M) — processo de desenho:
    plano curto de cores/tipo/layout, revisão contra o pedido, uma só ousadia,
    escrita de interface na voz de quem usa. **Na casa:** a identidade do GD
    Manager vence (Inter, fundo `#F0F0F0`, barra lateral preta, dourado
    `#F5A800`); a skill guia a escolha *dentro* dela, não traz estilo de fora.
  - `shadcn` (oficial `shadcn-ui/ui`, 411K) — componentes shadcn/ui pela CLI
    (`npx shadcn@latest info|search|docs|view`). **Na casa:** os componentes de
    `src/components/ui/` são do projeto e podem ter ajustes próprios, então NUNCA `init`, `apply`
    (preset) nem `add --overwrite` sem conversar; para atualizar, `add --dry-run
    --diff` primeiro.
  - `impeccable` (`pbakaus/impeccable`, 105K estrelas; instalada em 08/11/2026
    quando o usuário reprovou a organização do 1º mockup) — método de redesenho
    e crítica de tela: diagnóstico de hierarquia (teste de olhar desfocado,
    agrupamento, ritmo, densidade), modo *Operate* para tela de trabalho, e
    estruturas diferentes comparadas antes de pintar. **Na casa:** o lançador
    (`scripts/impeccable`) baixa um executável do GitHub na primeira vez — NÃO
    rodar sem o usuário autorizar no chat; usar o modo sem lançador que a própria
    skill prevê (ler `reference/shape.md`, `layout.md`, `operate.md`,
    `new-work.md`, `critique.md` e seguir à mão).
  - **Processo de tela combinado com o usuário (nov/2026):** primeiro as
    perguntas, depois o mockup; escolha de estrutura se faz com versões
    **desenhadas** (não rascunho em texto); só depois spec, plano e código.

- `agent-browser` (oficial `vercel-labs`, instalada em 17/09/2026 a pedido
  do usuário) — **toda automação ou exploração de navegador**: portais das
  concessionárias (Ludmilla), preencher formulário, testar tela, QA. Usar
  ANTES de escrever um roteiro Playwright "no escuro". Rotina:
  1. `agent-browser skills get core` (o guia vive na CLI, sempre na versão
     instalada; `npm i -g agent-browser && agent-browser install` se faltar);
  2. sessão nomeada sempre (`--session`), nunca a compartilhada; login por
     `--headed` com a pessoa digitando a senha na janela, `--profile <pasta>`
     para a sessão sobreviver, ou cofre `auth save --password-stdin` —
     senha NUNCA em argumento nem no chat;
  3. explorar com `snapshot -i` (refs `@eN`), `find label/text/role`, `get
     title`, `wait --text/--url`; só depois codificar o roteiro;
  4. em produção (VPS Linux) roda como CLI chamada pelo worker: `install
     --with-deps`, `--headed` usa Xvfb sozinho em servidor sem tela.

- `reverse-api-engineer` (`kalil0321/reverse-api-engineer`, 3,3K estrelas, MIT,
  instalada em 10/11/2026 a pedido do usuário) — descobrir a **API interna** de
  um portal que não tem API pública e gerar um cliente tipado a partir do
  tráfego real (CLI `rae`, Python 3.11+; o CLI NÃO vem com a skill — instalar
  só com o OK do usuário). Serve para conector novo de portal **sem bloqueio
  anti-robô** (CEMIG, COPEL, Energisa…), na linha "preferir a API interna do
  portal à tela". Regras da casa:
  1. **Elektro está fora**: Akamai + CAPTCHA. Cliente gerado que precise passar
     por eles é burlar detecção de robô — não fazer (a própria skill manda não
     contornar CAPTCHA/2FA/bot detection).
  2. Captura (HAR) tem cookie e token: nunca em commit, chat ou issue; fica fora
     do repositório.
  3. O cliente gerado é código escrito por modelo: ler antes de rodar; credencial
     vem do cofre/ambiente, nunca copiada da captura.

Procurado e descartado em 13/09/2026: skills de Playwright/scraping — a
mais instalada tinha 760 instalações e autor desconhecido; não passava no
critério. Superado em 17/09/2026 pela `agent-browser` (vercel-labs).

## 4. Regras da casa (vencem as skills)

- **Verificação antes de concluir**: `npx tsc --noEmit -p tsconfig.app.json`
  contra o baseline de **65 erros** (uma QUEDA grande no número = falha de
  parse, não melhoria) e `npm run build`. Só então commit + push em `main`.
- **Banco**: `npx -y supabase db query --linked -f arquivo.sql`; só o último
  SELECT com linhas volta; RLS testada com impersonação dentro de
  `begin; … rollback;`.
- **Documentação**: ao alterar módulo, atualizar a doc dele em `docs/` e a
  memória do módulo. Decisão arquitetural → ADR.
- **Isolamento de tenant é inegociável.** Confiança vem de `app_metadata`.
- **Antes de fazer, dizer o que vai fazer** quando a mudança é grande — o
  usuário prefere aprovar o escopo a desfazer trabalho.
- Comunicação em português; identificadores de código em português quando o
  módulo já é assim (ver `docs/project/naming-conventions.md`).

## 5. Ordem de precedência

Instrução direta do usuário > `CLAUDE.md` > este pacote > skills individuais
> comportamento padrão.
