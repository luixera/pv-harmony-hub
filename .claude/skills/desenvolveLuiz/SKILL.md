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
