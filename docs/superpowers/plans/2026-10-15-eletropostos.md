# Eletropostos no console — plano de implementação (entrega 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Levar o monitor de eletropostos para o Supabase e para a seção "Eletropostos" do console `/painel` (só master), com o coletor da Tupi rodando na VPS.

**Architecture:** Tabelas `eletroposto_*` no tenant biblioteca com RLS RESTRICTIVE + SELECT master; toda escrita por RPC `SECURITY DEFINER`. Métricas calculadas em SQL (porta fiel de `servidor.py`). Coletor da Tupi é um `setInterval` de 5 min no worker da Ludmilla (VPS). Tela em React no visual do console, Google Maps.

**Tech Stack:** Postgres/Supabase (plpgsql, pg_cron não usado), Node 22 + TS no worker, React 18 + React Query + `@react-google-maps/api` + lucide no console, vitest / node:test.

**Spec:** `docs/superpowers/specs/2026-10-15-eletropostos-design.md`

## Global Constraints

- Nenhuma tabela nova sem `tenant_id`; isolamento RESTRICTIVE por `public.get_user_tenant_id((select auth.uid()))`; leitura só `(select public.is_master(auth.uid()))`.
- Nenhuma política de INSERT/UPDATE/DELETE para `authenticated`; escrita só via RPC.
- Nenhum dado de motorista é gravado (descartar `startedUserID`, `reservedUserID` e qualquer campo de usuário).
- Regras de cálculo da spec §1 intocáveis (janela 5 min = 5 min; sem leitura e `fora` fora do denominador; faixa min–max; TZ America/Sao_Paulo).
- Visual do console (`card`, `GOLD`, fundo `#0E0E14`); Google Maps, não Leaflet.
- Banco aplicado com `npx -y supabase db query --linked -f <arquivo>` (só o último SELECT com linhas volta).
- Verificação: `npx tsc --noEmit -p tsconfig.app.json` com **65** erros, `npm run build`, `npm test`, `npm test` em `worker/ludmilla`.

---

### Task 1: Migração — tabelas, RLS, seed e RPCs

**Files:**
- Create: `supabase/migrations/20261015200000_eletropostos.sql`
- Create: `supabase/eletropostos-validacao.sql` (leituras sintéticas + conferência; roda e faz rollback)

**Produces:** tabelas da spec §4; RPCs
`eletropostos_gravar(p_fonte text, p_linhas jsonb, p_erro text default null) returns int`,
`eletropostos_gravar_local(...)` idem, `eletropostos_estacao_pulsa() returns void`,
`eletropostos_resumo(p_de date, p_ate date) returns jsonb`,
`eletropostos_detalhe(p_local uuid, p_de date, p_ate date) returns jsonb`,
`eletropostos_coleta() returns jsonb`, `eletropostos_local_salvar(p_local jsonb) returns uuid`,
`eletropostos_vincular(p_fonte text, p_local_fonte text, p_local uuid) returns void`,
`eletropostos_premissas_salvar(p_valores jsonb) returns jsonb`.

Formato de `p_linhas`: `[{local_fonte, local_nome, lat, lng, conector, potencia_kw, status_bruto, status, upstream_ts}]`.
Formato do JSON de `resumo`/`detalhe`/`coleta`: o mesmo do `servidor.py` (chaves em português, snake_case), ver `src/pages/painel/eletropostos/tipos.ts` (Task 3).

- [ ] Escrever a migração: tabelas + índices + `tenant_id DEFAULT (select id from tenants where is_library limit 1)` via função `eletropostos_tenant()`; RLS; seed dos 72 locais do `inventario.csv` e das premissas padrão.
- [ ] Escrever as RPCs de escrita com as guardas (`auth.role() = 'service_role'`; `operador` de estação ativa).
- [ ] Escrever as RPCs de leitura: `eletropostos_resumo` com CTEs `janelas_esperadas`, `por_conector` (contagens por status, sessões via `lag(status)`/`lag(slot)`), `por_local`; `eletropostos_detalhe` com `diario`, `perfil` 7×24, `linha_do_tempo` 48 h; `eletropostos_coleta`.
- [ ] Aplicar com `db query --linked`. Rodar `eletropostos-validacao.sql`: 3 conectores sintéticos × 2 dias, esperado calculado à mão (ex.: 12 janelas ocupado = 1 h; 24 observadas → ocupação 50 %; 2 blocos contíguos → 2 sessões).
- [ ] RLS por impersonação: master lê `eletroposto_local`; admin de outro tenant lê 0 linhas; `authenticated` não insere; `eletropostos_gravar` recusa sem service role.
- [ ] Commit: `feat(eletropostos): banco, RLS, seed e RPCs`.

### Task 2: Worker — tique da Tupi na VPS

> **Executado diferente (16/10/2026):** por decisão do usuário o coletor virou
> agente próprio em `worker/eletropostos/` (src/status.ts, src/tupi.ts,
> src/index.ts, test/status.test.ts, deploy/instalar.sh,
> deploy/gdm-eletropostos.service) + `.github/workflows/eletropostos-worker.yml`.
> Nada ficou no worker da Ludmilla.

**Files:**
- Create: `worker/ludmilla/src/eletropostos/status.ts` — `MAPA_STATUS`, `normalizar(s)`, `dentroDaCaixa(lat,lng)`, `linhasDaTupi(json): Linha[]` (puro; descarta campos de usuário).
- Create: `worker/ludmilla/src/eletropostos/tupi.ts` — `coletarTupi(): Promise<number>` (fetch + RPC `eletropostos_gravar` com service role; em erro grava `p_erro`).
- Create: `worker/ludmilla/test/eletropostos-status.test.ts`
- Modify: `worker/ludmilla/src/index.ts` — `setInterval` de 5 min, só em modo `vps` e sem `ELETROPOSTOS_DESLIGADO=true`; chamada inicial ao subir.

- [ ] Teste vermelho: `normalizar('Charging') === 'ocupado'`, `normalizar('xpto') === 'desconhecido'`; `linhasDaTupi` filtra fora da caixa, gera uma linha por `connectedPlugs[]`, não contém `startedUserID`.
- [ ] Implementar `status.ts`; verde.
- [ ] Implementar `tupi.ts` e o tique; `npm run build && npm test` em `worker/ludmilla`.
- [ ] Commit: `feat(eletropostos): coletor da Tupi como tique do worker`.

### Task 3: Console — seção Eletropostos

**Files:**
- Create: `src/pages/painel/eletropostos/tipos.ts` (Resumo, Local, Detalhe, Coleta, Premissas)
- Create: `src/pages/painel/eletropostos/calculo.ts` + `calculo.test.ts` — `faixa(a,b,fmt)`, `perfilMedio(perfil)`, `relativo(iso, agora)`, `atrasada(iso, agora)`, `ordenar(locais, col, dir)`, `filtrar(locais, filtro)`, `csvDoResumo(resumo)`.
- Create: `src/pages/painel/eletropostos/consultas.ts` — hooks `useResumo(de, ate)`, `useDetalhe(id, de, ate)`, `useColeta()`, mutações `salvarLocal`, `vincular`, `salvarPremissas`.
- Create: `src/pages/painel/eletropostos/{VisaoGeral,Carregadores,Mapa,Coleta,Premissas,PainelLateral,Graficos}.tsx`
- Create: `src/pages/painel/EletropostosSection.tsx` — abas + período (Hoje/7/30/datas) + exportar CSV.
- Modify: `src/pages/painel/PainelConsole.tsx` — `Section` ganha `'eletropostos'`, NAV ganha `{ key: 'eletropostos', label: 'Eletropostos', icon: PlugZap }` antes de `monitoring`.

- [ ] Teste vermelho de `calculo.test.ts` (faixa igual/diferente, perfil médio ignora null, relativo "há 12 min", atrasada > 15 min, ordenação com null no fim).
- [ ] Implementar `calculo.ts`; verde (`npx vitest run src/pages/painel/eletropostos`).
- [ ] Implementar tipos, consultas, componentes e a seção. Fitas/heatmap/barras/linha do tempo em SVG inline (`Graficos.tsx`).
- [ ] `npx tsc --noEmit -p tsconfig.app.json` = 65; `npm run build`.
- [ ] Conferir no navegador (`/painel` → Eletropostos): 5 abas sem erro no console, seed visível, Coleta mostra a fonte `tupi`.
- [ ] Commit: `feat(eletropostos): seção no console do master`.

### Task 4: Documentação e memória

**Files:**
- Create: `docs/modules/eletropostos/overview.md`, `database.md`, `business-rules.md`
- Modify: `CLAUDE.md` (linha na tabela), `docs/project/roadmap.md`, memória `eletropostos.md`

- [ ] Escrever/atualizar; commit `docs(eletropostos): módulo documentado`; push.

### Fora desta entrega (entrega 2)
Estação local em Python (`comum.py` → RPC `_local`, `estacao.py`, `instalar.ps1` enxuto, `adb connect` no BlueStacks, calibração de ATM EVs e Cury).
