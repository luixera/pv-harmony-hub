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

Procurado e descartado em 13/09/2026: skills de Playwright/scraping — a
mais instalada tinha 760 instalações e autor desconhecido; não passa no
critério. Reavaliar quando houver uma oficial (`microsoft`).

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
