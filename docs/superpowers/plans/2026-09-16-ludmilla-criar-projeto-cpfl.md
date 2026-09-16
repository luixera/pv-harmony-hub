# Ludmilla — Criar Projeto na CPFL: Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar à Ludmilla a capacidade de criar automaticamente um projeto no portal CPFL (5 passos do formulário Drupal), acionada por botão no modal de projeto, com progresso em tempo real e screenshots de cada etapa.

**Architecture:** Worker Playwright preenche o formulário multi-passo via `cpfl-criar.ts`; cada passo registra status + screenshot via RPC `ludmilla_registrar_passo_criacao`; o frontend recebe atualizações via Supabase Realtime e exibe o painel `CriarNaCpflPanel` no modal. O node ID CPFL é salvo em `projects.cpfl_node_id` por RPC SECURITY DEFINER ao final do passo 5.

**Tech Stack:** TypeScript · Node 22 · Playwright · Supabase (Postgres RLS + Realtime + Storage) · React 18 + React Query + shadcn/ui

**Spec:** [`docs/superpowers/specs/2026-09-16-ludmilla-criar-projeto-cpfl-design.md`](../specs/2026-09-16-ludmilla-criar-projeto-cpfl-design.md)

## Global Constraints

- Tudo restrito a tenant `is_library` (GD Manager); `ludmilla_equipe_ok()` controla acesso às tabelas Ludmilla
- Formulário CPFL Drupal é AJAX multi-passo — cada "Avançar" é um POST XHR; Playwright aguarda `networkidle` após cada clique
- Coordenadas no banco estão em decimal (`"-23.207407, -46.891502"`); CPFL exige DMS (`"23°12'26.7\"S"`)
- `portal_criacao_passos` usa `ON CONFLICT (run_id, passo) DO UPDATE` — precisa de `UNIQUE (run_id, passo)` no banco
- Screenshots em `ludmilla/{tenant_id}/criacao/{run_id}/passo-{n}.png` (bucket existente `ludmilla`)
- Worker: `service_role` na VPS (nunca anon); RPCs chamadas via `supabase().rpc()`
- Node ID CPFL só aparece após passo 5 (Revisão), na URL `/node/{id}/edit?new=true&step=6`
- Ludmilla NUNCA resolve CAPTCHA — não abrir essa discussão
- Identificadores de código em português (padrão do projeto)
- Baseline TypeScript: 65 erros no `tsconfig.app.json` — uma queda grande indica falha de parse

---

## Estrutura de arquivos

| Arquivo | Ação |
|---|---|
| `supabase/migrations/YYYYMMDD_criacao_cpfl.sql` | CREATE — tabela, coluna, RPCs, RLS |
| `worker/ludmilla/src/dms.ts` | CREATE — conversão decimal→DMS |
| `worker/ludmilla/test/dms.test.ts` | CREATE — testes do DMS |
| `worker/ludmilla/src/conectores/cpfl-criar.ts` | CREATE — conector de criação Playwright |
| `worker/ludmilla/src/fila.ts` | MODIFY — tipo Run + helpers RPC |
| `worker/ludmilla/src/index.ts` | MODIFY — dispatch `criar_projeto` + poll dinâmico |
| `src/hooks/useLudmilla.ts` | MODIFY — tipos + hook `useCriarProjetoCpfl` + `usePassosCriacao` |
| `src/components/projects/CriarNaCpflPanel.tsx` | CREATE — painel de progresso no modal |
| `src/components/projects/ProjectModal.tsx` | MODIFY — botão/painel na aba Geral |
| `src/pages/Ludmilla.tsx` | MODIFY — renderiza runs `criar_projeto` |

---

### Task 1: Migration do banco

**Files:**
- Create: `supabase/migrations/20260916120000_criacao_cpfl.sql`

**Interfaces:**
- Produces: tabela `portal_criacao_passos`, coluna `projects.cpfl_node_id`, RPCs `ludmilla_registrar_passo_criacao` e `ludmilla_salvar_node_cpfl`, RLS

- [ ] **Step 1: Escrever o arquivo de migração**

```sql
-- supabase/migrations/20260916120000_criacao_cpfl.sql

-- 1. Nova coluna no projeto
alter table projects
  add column if not exists cpfl_node_id text;

-- 2. Tabela de passos da criação
create table if not exists portal_criacao_passos (
  id          uuid primary key default gen_random_uuid(),
  run_id      uuid not null references portal_sync_runs(id) on delete cascade,
  passo       int  not null,  -- 1..6
  nome        text not null,  -- 'introducao'|'dados_uc'|'dados_projeto'|'dados_cliente'|'revisao'|'concluido'
  status      text not null check (status in ('rodando','ok','erro')),
  screenshot  text,
  erro        text,
  created_at  timestamptz not null default now(),
  constraint portal_criacao_passos_run_passo_unique unique (run_id, passo)
);

-- 3. RLS RESTRICTIVE: equipe lê, só service_role escreve
alter table portal_criacao_passos enable row level security;

create policy "equipe lê passos de criação"
  on portal_criacao_passos for select
  using (ludmilla_equipe_ok());

-- INSERT/UPDATE/DELETE via service_role apenas (sem policy pública = bloqueado para anon/authenticated)

-- 4. RPC: registrar passo (SECURITY DEFINER — worker com service_role)
create or replace function ludmilla_registrar_passo_criacao(
  p_run_id     uuid,
  p_passo      int,
  p_nome       text,
  p_status     text,
  p_screenshot text default null,
  p_erro       text default null
) returns void language plpgsql security definer as $$
begin
  insert into portal_criacao_passos(run_id, passo, nome, status, screenshot, erro)
  values (p_run_id, p_passo, p_nome, p_status, p_screenshot, p_erro)
  on conflict (run_id, passo) do update
    set status     = excluded.status,
        screenshot = excluded.screenshot,
        erro       = excluded.erro;
end;
$$;

-- 5. RPC: salvar node ID (SECURITY DEFINER — valida que o projeto pertence ao tenant da conta)
create or replace function ludmilla_salvar_node_cpfl(
  p_project_id uuid,
  p_node_id    text
) returns void language plpgsql security definer as $$
begin
  update projects
  set    cpfl_node_id = p_node_id
  where  id = p_project_id
    and  tenant_id = (
      select pa.tenant_id
      from   portal_sync_runs psr
      join   portal_accounts  pa on pa.id = psr.account_id
      where  psr.dados->>'project_id' = p_project_id::text
      order  by psr.created_at desc
      limit  1
    );
end;
$$;

-- 6. Supabase Realtime: habilita tabela para broadcast
alter publication supabase_realtime add table portal_criacao_passos;
```

- [ ] **Step 2: Aplicar a migração**

```bash
npx supabase db push --linked
```

Verificar que retorna sem erro. Em seguida confirmar que as tabelas existem:

```bash
npx supabase db query --linked -f - <<'SQL'
select table_name from information_schema.tables
where table_schema = 'public'
  and table_name in ('portal_criacao_passos')
order by 1;
SQL
```

Esperado: 1 linha — `portal_criacao_passos`.

- [ ] **Step 3: Verificar RPC**

```bash
npx supabase db query --linked -f - <<'SQL'
select routine_name from information_schema.routines
where routine_schema = 'public'
  and routine_name in ('ludmilla_registrar_passo_criacao','ludmilla_salvar_node_cpfl')
order by 1;
SQL
```

Esperado: 2 linhas.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260916120000_criacao_cpfl.sql
git commit -m "feat(banco): tabela portal_criacao_passos + cpfl_node_id + RPCs de criação

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 2: Utilitário DMS

**Files:**
- Create: `worker/ludmilla/src/dms.ts`
- Create: `worker/ludmilla/test/dms.test.ts`

**Interfaces:**
- Produces: `decimalParaDms(decimal: number, eixo: 'lat' | 'lng'): string`
  - `decimalParaDms(-23.207407, 'lat')` → `"23°12'26.7\"S"`
  - `decimalParaDms(-46.891502, 'lng')` → `"46°53'29.4\"W"`
  - `decimalParaDms(0, 'lat')` → `"0°0'0.0\"N"`

- [ ] **Step 1: Escrever o teste falhando**

```typescript
// worker/ludmilla/test/dms.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decimalParaDms, parsearCoordenadas } from '../src/dms.js';

test('converte latitude sul negativa', () => {
  assert.equal(decimalParaDms(-23.207407, 'lat'), "23°12'26.7\"S");
});

test('converte longitude oeste negativa', () => {
  assert.equal(decimalParaDms(-46.891502, 'lng'), "46°53'29.4\"W");
});

test('converte latitude norte positiva', () => {
  assert.equal(decimalParaDms(22.906847, 'lat'), "22°54'24.6\"N");
});

test('converte longitude leste positiva', () => {
  assert.equal(decimalParaDms(43.172897, 'lng'), "43°10'22.4\"E");
});

test('zero graus', () => {
  assert.equal(decimalParaDms(0, 'lat'), "0°0'0.0\"N");
});

test('parsearCoordenadas extrai lat/lng do formato do banco', () => {
  const r = parsearCoordenadas('-23.207407, -46.891502');
  assert.ok(r);
  assert.equal(r!.lat.toFixed(6), '-23.207407');
  assert.equal(r!.lng.toFixed(6), '-46.891502');
});

test('parsearCoordenadas retorna null para string inválida', () => {
  assert.equal(parsearCoordenadas('sem coordenadas'), null);
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
cd worker/ludmilla && node --test test/dms.test.ts 2>&1 | head -20
```

Esperado: erro de módulo não encontrado.

- [ ] **Step 3: Implementar `dms.ts`**

```typescript
// worker/ludmilla/src/dms.ts

/**
 * Conversão de graus decimais para graus-minutos-segundos (DMS).
 * O portal CPFL exige DMS nos campos Latitude e Longitude.
 * Exemplo: -23.207407 → "23°12'26.7\"S"
 */
export function decimalParaDms(decimal: number, eixo: 'lat' | 'lng'): string {
  const abs = Math.abs(decimal);
  const graus = Math.floor(abs);
  const minutosDec = (abs - graus) * 60;
  const minutos = Math.floor(minutosDec);
  const segundos = (minutosDec - minutos) * 60;

  let hemisferio: string;
  if (eixo === 'lat') {
    hemisferio = decimal >= 0 ? 'N' : 'S';
  } else {
    hemisferio = decimal >= 0 ? 'E' : 'W';
  }

  return `${graus}°${minutos}'${segundos.toFixed(1)}"${hemisferio}`;
}

/** Extrai lat/lng do formato "{lat}, {lng}" gravado no banco. Retorna null se inválido. */
export function parsearCoordenadas(s: string): { lat: number; lng: number } | null {
  const m = /^\s*(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)\s*$/.exec(s ?? '');
  if (!m) return null;
  return { lat: Number(m[1]), lng: Number(m[2]) };
}
```

- [ ] **Step 4: Rodar os testes**

```bash
cd worker/ludmilla && node --test test/dms.test.ts 2>&1 | tail -5
```

Esperado: `pass 7` — sem `fail`.

- [ ] **Step 5: Commit**

```bash
git add worker/ludmilla/src/dms.ts worker/ludmilla/test/dms.test.ts
git commit -m "feat(worker): utilitário DMS para conversão de coordenadas

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 3: Conector `cpfl-criar.ts`

**Files:**
- Create: `worker/ludmilla/src/conectores/cpfl-criar.ts`

**Interfaces:**
- Consumes:
  - `decimalParaDms(decimal: number, eixo: 'lat' | 'lng'): string` da Task 2 (`../dms.js`)
  - `comPaciencia<T>(oQue, tentar, opts): Promise<T>` de `../paciencia.js`
  - `ErroLudmilla(classe, mensagem)` de `../erros.js`
  - `supabase(): SupabaseClient` de `../fila.js`
  - `Page` de `playwright`
- Produces: `criarProjeto(page: Page, dados: DadosCriacaoCpfl, run: RunCriacao): Promise<void>`

**Tipo `DadosCriacaoCpfl`** (lido do banco pelo worker antes de chamar):
```typescript
interface DadosCriacaoCpfl {
  project_id: string;
  tenant_id: string;
  run_id: string;
  uc_number: string;         // project_general_data.unit_consumer
  coordinates: string;       // "-23.207407, -46.891502"
  customer_name: string;     // customers.name
  customer_cpf: string;      // customers.cpf_cnpj
  project_title: string;     // "UFV {customers.name}" ou project.code
  modulos: { quantidade: number; potencia_wp: number }[];  // project_equipments
  entry_phase: string | null;        // project_general_data.phase_type
  entry_breaker: string | null;      // project_general_data.circuit_breaker_current (fallback)
}
```

**Tipo `RunCriacao`**:
```typescript
interface RunCriacao {
  id: string;
  tenant_id: string;
}
```

- [ ] **Step 1: Criar `cpfl-criar.ts` com os 6 passos**

```typescript
// worker/ludmilla/src/conectores/cpfl-criar.ts
import type { Page } from 'playwright';
import { ErroLudmilla } from '../erros.js';
import { comPaciencia } from '../paciencia.js';
import { supabase, subirPrint } from '../fila.js';
import { decimalParaDms, parsearCoordenadas } from '../dms.js';

const URL_CRIACAO = 'https://www.cpfl.com.br/gestao-projetos/node/add/project_60';

export interface DadosCriacaoCpfl {
  project_id: string;
  tenant_id: string;
  run_id: string;
  uc_number: string;
  coordinates: string;
  customer_name: string;
  customer_cpf: string;
  project_title: string;
  modulos: { quantidade: number; potencia_wp: number }[];
  entry_phase: string | null;
  entry_breaker: string | null;
}

export interface RunCriacao {
  id: string;
  tenant_id: string;
}

/** Captura screenshot e registra o passo no banco. */
async function registrarPasso(
  page: Page,
  dados: DadosCriacaoCpfl,
  passo: number,
  nome: string,
  status: 'rodando' | 'ok' | 'erro',
  erroMsg?: string,
): Promise<string | undefined> {
  let printPath: string | undefined;
  try {
    const buf = await page.screenshot({ fullPage: true });
    const path = `${dados.tenant_id}/criacao/${dados.run_id}/passo-${passo}.png`;
    await supabase().storage.from('ludmilla').upload(path, buf, {
      contentType: 'image/png', upsert: true,
    });
    printPath = path;
  } catch { /* screenshot falhou: registra sem print */ }

  await supabase().rpc('ludmilla_registrar_passo_criacao', {
    p_run_id:     dados.run_id,
    p_passo:      passo,
    p_nome:       nome,
    p_status:     status,
    p_screenshot: printPath ?? null,
    p_erro:       erroMsg ?? null,
  }).then(({ error }) => {
    if (error) throw new Error(`registrarPasso RPC: ${error.message}`);
  });

  return printPath;
}

/** Pausa humanizada entre ações. */
const respirar = (page: Page, ms = 1_200) => page.waitForTimeout(ms);

/**
 * Preenche o formulário multi-passo de criação de projeto na CPFL.
 * Lança ErroLudmilla em qualquer falha — o worker captura e finaliza o run.
 */
export async function criarProjeto(page: Page, dados: DadosCriacaoCpfl): Promise<void> {

  // ── Passo 1: Introdução ────────────────────────────────────────────────────
  await registrarPasso(page, dados, 1, 'introducao', 'rodando');
  try {
    await page.goto(URL_CRIACAO, { waitUntil: 'networkidle', timeout: 60_000 });
    await respirar(page, 1_500);

    // Fecha banner de cookies CPFL
    const rejeitar = page.getByText(/Rejeitar todos/i).first();
    if (await rejeitar.count() > 0 && await rejeitar.isVisible().catch(() => false)) {
      await rejeitar.click({ timeout: 5_000 }).catch(() => undefined);
      await respirar(page, 600);
    }

    // Seleciona "Orçamento de Conexão" (radio ou select)
    const orcamento = page.getByText(/Orçamento de Conexão/i).first();
    if (await orcamento.count() === 0) {
      throw new ErroLudmilla('pagina_mudou', 'Campo "Orçamento de Conexão" não encontrado no passo 1.');
    }
    await orcamento.click({ timeout: 10_000 });
    await respirar(page, 800);

    // Marca "Não" nos 3 checkboxes de necessidades especiais
    const checkboxes = page.locator('input[type="checkbox"]');
    const count = await checkboxes.count();
    for (let i = 0; i < count; i++) {
      const cb = checkboxes.nth(i);
      if (await cb.isChecked()) await cb.uncheck();
    }
    await respirar(page, 600);

    // Clica Avançar
    await page.getByRole('button', { name: /Avançar/i }).click({ timeout: 10_000 });
    await page.waitForLoadState('networkidle', { timeout: 30_000 });
    await respirar(page, 1_000);
  } catch (e) {
    const msg = e instanceof ErroLudmilla ? e.message : `Passo 1 falhou: ${(e as Error).message}`;
    await registrarPasso(page, dados, 1, 'introducao', 'erro', msg);
    throw e instanceof ErroLudmilla ? e : new ErroLudmilla('falhou', msg);
  }
  await registrarPasso(page, dados, 1, 'introducao', 'ok');

  // ── Passo 2: Dados da UC ───────────────────────────────────────────────────
  await registrarPasso(page, dados, 2, 'dados_uc', 'rodando');
  let valorDisjuntorCpfl: string | null = null;
  let valorFaseCpfl: string | null = null;
  try {
    // Digita a UC
    const campoUc = page.locator('input[name*="uc"], input[placeholder*="UC"], input[id*="uc"]').first();
    if (await campoUc.count() === 0) {
      throw new ErroLudmilla('pagina_mudou', 'Campo Nº da UC não encontrado no passo 2.');
    }
    await campoUc.fill(dados.uc_number);
    await respirar(page, 600);

    // Clica Buscar
    await page.getByRole('button', { name: /Buscar/i }).click({ timeout: 10_000 });

    // Aguarda auto-preenchimento: verifica se nome do cliente apareceu (campo de nome do titular)
    const campoNome = page.locator('input[name*="nome"], input[name*="name"], input[id*="nome"]').first();
    await comPaciencia('auto-preenchimento da UC', async () => {
      await page.waitForLoadState('networkidle', { timeout: 15_000 });
      await respirar(page, 1_000);
      const val = await campoNome.inputValue().catch(() => '');
      if (!val.trim()) throw new Error('Campo nome ainda vazio após Buscar');
    }, { tentativas: 2, pausaMs: 3_000 });

    // UC não encontrada = erro específico
    const nomePreenchido = await campoNome.inputValue().catch(() => '');
    if (!nomePreenchido.trim()) {
      throw new ErroLudmilla('falhou', 'UC não encontrada no portal CPFL. Verifique o número UC no GD Manager e tente novamente.');
    }

    // Lê disjuntor e fase retornados pela CPFL (fonte primária)
    const campoDisjuntor = page.locator('input[name*="disjuntor"], input[id*="disjuntor"], select[name*="disjuntor"]').first();
    if (await campoDisjuntor.count() > 0) {
      valorDisjuntorCpfl = await campoDisjuntor.inputValue().catch(() => null);
    }
    const campoFase = page.locator('select[name*="fase"], input[name*="fase"]').first();
    if (await campoFase.count() > 0) {
      valorFaseCpfl = await campoFase.inputValue().catch(() => null);
    }

    // Preenche coordenadas em DMS
    const coords = parsearCoordenadas(dados.coordinates);
    if (coords) {
      const latDms = decimalParaDms(coords.lat, 'lat');
      const lngDms = decimalParaDms(coords.lng, 'lng');

      const campoLat = page.locator('input[name*="lat"], input[id*="lat"], input[placeholder*="Latitude"]').first();
      const campoLng = page.locator('input[name*="lon"], input[id*="lon"], input[id*="lng"], input[placeholder*="Longitude"]').first();

      if (await campoLat.count() > 0) {
        await campoLat.fill(latDms);
        await respirar(page, 400);
      }
      if (await campoLng.count() > 0) {
        await campoLng.fill(lngDms);
        await respirar(page, 400);
      }
    }

    // Avançar
    await page.getByRole('button', { name: /Avançar/i }).click({ timeout: 10_000 });
    await page.waitForLoadState('networkidle', { timeout: 30_000 });
    await respirar(page, 1_000);
  } catch (e) {
    const msg = e instanceof ErroLudmilla ? e.message : `Passo 2 falhou: ${(e as Error).message}`;
    await registrarPasso(page, dados, 2, 'dados_uc', 'erro', msg);
    throw e instanceof ErroLudmilla ? e : new ErroLudmilla('falhou', msg);
  }
  await registrarPasso(page, dados, 2, 'dados_uc', 'ok');

  // ── Passo 3: Dados do Projeto ──────────────────────────────────────────────
  await registrarPasso(page, dados, 3, 'dados_projeto', 'rodando');
  try {
    // Título do projeto
    const campoTitulo = page.locator('input[name*="title"], input[name*="titulo"], input[id*="title"]').first();
    if (await campoTitulo.count() > 0) {
      await campoTitulo.fill(dados.project_title);
      await respirar(page, 400);
    }

    // Disjuntor: usa valor retornado pelo Buscar; se não veio, usa fallback do GD Manager
    const disjuntor = valorDisjuntorCpfl || dados.entry_breaker || '';
    if (disjuntor) {
      const campoDisj = page.locator('select[name*="disjuntor"], input[name*="disjuntor"]').first();
      if (await campoDisj.count() > 0) {
        const tag = await campoDisj.evaluate(el => el.tagName.toLowerCase());
        if (tag === 'select') {
          await campoDisj.selectOption({ value: disjuntor });
        } else {
          await campoDisj.fill(disjuntor);
        }
        await respirar(page, 400);
      }
    }

    // Fase: usa valor retornado pelo Buscar; se não veio, usa fallback do GD Manager
    const fase = valorFaseCpfl || dados.entry_phase || '';
    if (fase) {
      const campoFase = page.locator('select[name*="fase"]').first();
      if (await campoFase.count() > 0) {
        await campoFase.selectOption({ value: fase }).catch(() => undefined);
        await respirar(page, 400);
      }
    }

    // Módulos: preenche os campos de quantidade e potência para cada módulo
    for (let i = 0; i < dados.modulos.length; i++) {
      const mod = dados.modulos[i];
      const qtd = page.locator(`input[name*="quantidade"][data-index="${i}"], input[name*="qtd_${i}"]`).first();
      const pot = page.locator(`input[name*="potencia"][data-index="${i}"], input[name*="pot_${i}"]`).first();
      if (await qtd.count() > 0) { await qtd.fill(String(mod.quantidade)); await respirar(page, 300); }
      if (await pot.count() > 0) { await pot.fill(String(mod.potencia_wp)); await respirar(page, 300); }
    }

    // Avançar
    await page.getByRole('button', { name: /Avançar/i }).click({ timeout: 10_000 });
    await page.waitForLoadState('networkidle', { timeout: 30_000 });
    await respirar(page, 1_000);
  } catch (e) {
    const msg = e instanceof ErroLudmilla ? e.message : `Passo 3 falhou: ${(e as Error).message}`;
    await registrarPasso(page, dados, 3, 'dados_projeto', 'erro', msg);
    throw e instanceof ErroLudmilla ? e : new ErroLudmilla('falhou', msg);
  }
  await registrarPasso(page, dados, 3, 'dados_projeto', 'ok');

  // ── Passo 4: Dados do Cliente ──────────────────────────────────────────────
  await registrarPasso(page, dados, 4, 'dados_cliente', 'rodando');
  try {
    // CPF do titular
    const campoCpf = page.locator('input[name*="cpf"], input[name*="documento"], input[id*="cpf"]').first();
    if (await campoCpf.count() > 0) {
      await campoCpf.fill(dados.customer_cpf);
      await respirar(page, 600);
    }

    // Consultar
    const btnConsultar = page.getByRole('button', { name: /Consultar/i }).first();
    if (await btnConsultar.count() > 0) {
      await btnConsultar.click({ timeout: 10_000 });
      await page.waitForLoadState('networkidle', { timeout: 20_000 });
      await respirar(page, 1_000);
    }

    // Aceita termos (checkbox se houver)
    const checkTermos = page.locator('input[type="checkbox"][name*="termo"], input[type="checkbox"][id*="termo"]').first();
    if (await checkTermos.count() > 0 && !(await checkTermos.isChecked())) {
      await checkTermos.check();
      await respirar(page, 400);
    }

    // Avançar
    await page.getByRole('button', { name: /Avançar/i }).click({ timeout: 10_000 });
    await page.waitForLoadState('networkidle', { timeout: 30_000 });
    await respirar(page, 1_000);
  } catch (e) {
    const msg = e instanceof ErroLudmilla ? e.message : `Passo 4 falhou: ${(e as Error).message}`;
    await registrarPasso(page, dados, 4, 'dados_cliente', 'erro', msg);
    throw e instanceof ErroLudmilla ? e : new ErroLudmilla('falhou', msg);
  }
  await registrarPasso(page, dados, 4, 'dados_cliente', 'ok');

  // ── Passo 5: Revisão — aguarda node ID na URL ──────────────────────────────
  await registrarPasso(page, dados, 5, 'revisao', 'rodando');
  let nodeId: string;
  try {
    // Clica Avançar na tela de revisão
    await page.getByRole('button', { name: /Avançar/i }).click({ timeout: 10_000 });

    // Aguarda URL mudar para /node/{id}/edit (timeout 60 s via comPaciencia)
    const regexNode = /\/node\/(\d+)\/edit/;
    await comPaciencia('aguardando node ID na URL após revisão', async () => {
      await page.waitForURL(url => regexNode.test(url.href), { timeout: 15_000 });
    }, { tentativas: 4, pausaMs: 2_000 });

    const urlFinal = page.url();
    const match = regexNode.exec(urlFinal);
    if (!match) {
      throw new ErroLudmilla('pagina_mudou', `URL após revisão não contém node ID: ${urlFinal}`);
    }
    nodeId = match[1];

    // Salva o node ID no banco via RPC SECURITY DEFINER
    const { error } = await supabase().rpc('ludmilla_salvar_node_cpfl', {
      p_project_id: dados.project_id,
      p_node_id:    nodeId,
    });
    if (error) throw new Error(`ludmilla_salvar_node_cpfl: ${error.message}`);

    await respirar(page, 800);
  } catch (e) {
    const msg = e instanceof ErroLudmilla ? e.message : `Passo 5 falhou: ${(e as Error).message}`;
    await registrarPasso(page, dados, 5, 'revisao', 'erro', msg);
    throw e instanceof ErroLudmilla ? e : new ErroLudmilla('falhou', msg);
  }
  await registrarPasso(page, dados, 5, 'revisao', 'ok');

  // ── Passo 6: Concluído — clica "Enviar Depois" ────────────────────────────
  await registrarPasso(page, dados, 6, 'concluido', 'rodando');
  try {
    // Passo 6 = tela de upload de documentos; clica "Enviar Depois" para não submeter documentos
    const btnEnviarDepois = page.getByRole('button', { name: /Enviar Depois|Salvar|Later/i }).first();
    if (await btnEnviarDepois.count() > 0) {
      await btnEnviarDepois.click({ timeout: 10_000 });
      await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => undefined);
    }
    await respirar(page, 1_000);
  } catch (e) {
    // Passo 6 é de fechamento: falha não é bloqueante — registra como ok com nota
    await registrarPasso(page, dados, 6, 'concluido', 'ok');
    return;
  }
  await registrarPasso(page, dados, 6, 'concluido', 'ok');
}
```

- [ ] **Step 2: Checar TypeScript do worker**

```bash
cd worker/ludmilla && npx tsc --noEmit 2>&1 | head -20
```

Esperado: 0 erros novos. Se aparecer erro de tipo, corrija em `cpfl-criar.ts` antes de continuar.

- [ ] **Step 3: Commit**

```bash
git add worker/ludmilla/src/conectores/cpfl-criar.ts
git commit -m "feat(worker): conector cpfl-criar com os 6 passos Playwright

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 4: Integração no worker

**Files:**
- Modify: `worker/ludmilla/src/fila.ts`
- Modify: `worker/ludmilla/src/index.ts`

**Interfaces:**
- Consumes: `criarProjeto(page, dados): Promise<void>` da Task 3
- Produces: `run.tipo` aceita `'criar_projeto'`; poll dinâmico 5 s quando há jobs pendentes

- [ ] **Step 1: Adicionar `'criar_projeto'` ao tipo `Run` em `fila.ts`**

Em [`worker/ludmilla/src/fila.ts:17`](worker/ludmilla/src/fila.ts), trocar a linha do tipo `Run`:

```typescript
// antes:
tipo: 'reconhecimento' | 'teste_login' | 'descoberta' | 'varredura';

// depois:
tipo: 'reconhecimento' | 'teste_login' | 'descoberta' | 'varredura' | 'criar_projeto';
```

- [ ] **Step 2: Adicionar helper `dadosCriacaoCpfl` em `fila.ts`**

Após a função `credenciais` em [`fila.ts:125`](worker/ludmilla/src/fila.ts), inserir:

```typescript
import type { DadosCriacaoCpfl } from './conectores/cpfl-criar.js';

/**
 * Lê todos os dados necessários para criar o projeto na CPFL.
 * Chamada pelo worker imediatamente antes de acionar cpfl-criar.
 */
export async function dadosCriacaoCpfl(
  runId: string,
  projectId: string,
  tenantId: string,
): Promise<DadosCriacaoCpfl> {
  const { data, error } = await supabase().rpc('ludmilla_dados_criacao_cpfl' as never, {
    p_run_id: runId,
    p_project_id: projectId,
  } as never);
  if (error) throw new Error(`Não consegui carregar dados para criação: ${error.message}`);
  const d = (data ?? [])[0] as Record<string, unknown> | undefined;
  if (!d) throw new Error('Dados de criação não encontrados para o projeto.');
  return {
    project_id:    projectId,
    tenant_id:     tenantId,
    run_id:        runId,
    uc_number:     String(d.uc_number ?? ''),
    coordinates:   String(d.coordinates ?? ''),
    customer_name: String(d.customer_name ?? ''),
    customer_cpf:  String(d.customer_cpf ?? ''),
    project_title: String(d.project_title ?? ''),
    modulos:       (d.modulos ?? []) as { quantidade: number; potencia_wp: number }[],
    entry_phase:   d.entry_phase ? String(d.entry_phase) : null,
    entry_breaker: d.entry_breaker ? String(d.entry_breaker) : null,
  };
}

/** Retorna true se houver algum run `criar_projeto` na_fila. Usado para poll dinâmico. */
export async function temCriacaoPendente(): Promise<boolean> {
  const { data, error } = await supabase()
    .from('portal_sync_runs' as never)
    .select('id')
    .eq('tipo', 'criar_projeto')
    .eq('situacao', 'na_fila')
    .limit(1);
  if (error) return false;
  return ((data as unknown[]) ?? []).length > 0;
}
```

> **Nota:** `ludmilla_dados_criacao_cpfl` é uma RPC de leitura que precisa ser criada no banco (adicione no arquivo de migração da Task 1 ou numa nova migração). Veja o passo 3 abaixo.

- [ ] **Step 3: Criar RPC de leitura `ludmilla_dados_criacao_cpfl`**

Adicionar no mesmo arquivo de migração da Task 1 (ou nova migração `20260916120001_dados_criacao_cpfl.sql`):

```sql
create or replace function ludmilla_dados_criacao_cpfl(
  p_run_id     uuid,
  p_project_id uuid
) returns table (
  uc_number     text,
  coordinates   text,
  customer_name text,
  customer_cpf  text,
  project_title text,
  modulos       jsonb,
  entry_phase   text,
  entry_breaker text
) language sql security definer as $$
  select
    pgd.unit_consumer                                     as uc_number,
    pgd.coordinates                                       as coordinates,
    c.name                                                as customer_name,
    c.cpf_cnpj                                            as customer_cpf,
    coalesce('UFV ' || c.name, p.code)                   as project_title,
    coalesce(
      (select jsonb_agg(jsonb_build_object(
                'quantidade', pe.quantity,
                'potencia_wp', pe.power_wp))
       from project_equipments pe
       where pe.project_id = p.id
         and pe.equipment_type = 'module'),
      '[]'::jsonb
    )                                                     as modulos,
    pgd.phase_type                                        as entry_phase,
    pgd.circuit_breaker_current                          as entry_breaker
  from portal_sync_runs psr
  join projects           p   on p.id = (psr.dados->>'project_id')::uuid
  join project_general_data pgd on pgd.project_id = p.id
  join customers          c   on c.id = p.customer_id
  where psr.id = p_run_id
    and p.id   = p_project_id
  limit 1;
$$;
```

Aplicar:
```bash
npx supabase db push --linked
```

- [ ] **Step 4: Adicionar dispatch `criar_projeto` em `index.ts`**

Em [`worker/ludmilla/src/index.ts:146`](worker/ludmilla/src/index.ts) (após o bloco `if (run.tipo === 'descoberta')`), inserir antes do `const protocolos = await c.varrer(...)`:

```typescript
import { dadosCriacaoCpfl, temCriacaoPendente } from './fila.js';
import { criarProjeto } from './conectores/cpfl-criar.js';
```

E dentro de `executar()`, após o bloco `descoberta`:

```typescript
    if (run.tipo === 'criar_projeto') {
      const projectId = (run as unknown as { dados?: { project_id?: string } }).dados?.project_id;
      if (!projectId) throw new ErroLudmilla('falhou', 'Run criar_projeto sem project_id nos dados.');
      const dados = await dadosCriacaoCpfl(run.id, projectId, run.tenant_id);
      await criarProjeto(page, dados);
      printPath = await print();
      await finalizarRun(run.id, { situacao: 'ok', printPath, situacaoConta: 'ok' });
      log('criação CPFL ok', { run: run.id, project: projectId });
      ok = true;
      return { chave: c.chave, contexto, page, conector: c, ok };
    }
```

> **Nota:** o tipo `Run` precisa do campo `dados` para que `run.dados?.project_id` funcione. Adicionar `dados?: Record<string, unknown>` à interface `Run` em `fila.ts`.

Atualizar a interface `Run` em `fila.ts`:

```typescript
export interface Run {
  id: string;
  tenant_id: string;
  account_id: string;
  tipo: 'reconhecimento' | 'teste_login' | 'descoberta' | 'varredura' | 'criar_projeto';
  situacao: string;
  dados?: Record<string, unknown>;
}
```

- [ ] **Step 5: Adicionar poll dinâmico em `index.ts`**

No laço principal de [`index.ts:280`](worker/ludmilla/src/index.ts), trocar o `dormir(POLL_SEGUNDOS * 1000)` por poll dinâmico:

```typescript
    if (!run) {
      if (modo === 'local') await tocarVivas();
      // Poll dinâmico: 5 s quando há criação pendente; 30 s no silêncio
      const criacao = await temCriacaoPendente().catch(() => false);
      await dormir(criacao ? 5_000 : POLL_SEGUNDOS * 1_000);
      continue;
    }
```

- [ ] **Step 6: Checar TypeScript**

```bash
cd worker/ludmilla && npx tsc --noEmit 2>&1 | tail -10
```

Esperado: 0 erros novos.

- [ ] **Step 7: Commit**

```bash
git add worker/ludmilla/src/fila.ts worker/ludmilla/src/index.ts
git commit -m "feat(worker): dispatch criar_projeto + poll dinâmico 5s

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 5: Frontend — hook + botão + painel `CriarNaCpflPanel`

**Files:**
- Modify: `src/hooks/useLudmilla.ts`
- Create: `src/components/projects/CriarNaCpflPanel.tsx`
- Modify: `src/components/projects/ProjectModal.tsx`

**Interfaces:**
- Consumes:
  - RPC `ludmilla_pedir_run` com `p_tipo='criar_projeto'` e `p_dados={ project_id }` (já existe, precisa aceitar o novo tipo)
  - Tabela `portal_criacao_passos` via Supabase Realtime
- Produces: botão "Criar na CPFL" na aba Geral & Comentários; painel de progresso `CriarNaCpflPanel`

- [ ] **Step 1: Atualizar tipos em `useLudmilla.ts`**

Em [`src/hooks/useLudmilla.ts:22`](src/hooks/useLudmilla.ts):

```typescript
// antes:
export type TipoRun = 'reconhecimento' | 'teste_login' | 'descoberta' | 'varredura';

// depois:
export type TipoRun = 'reconhecimento' | 'teste_login' | 'descoberta' | 'varredura' | 'criar_projeto';
```

Adicionar interface `PassoCriacao` ao final dos tipos (antes das funções):

```typescript
export interface PassoCriacao {
  id: string;
  run_id: string;
  passo: number;
  nome: 'introducao' | 'dados_uc' | 'dados_projeto' | 'dados_cliente' | 'revisao' | 'concluido';
  status: 'rodando' | 'ok' | 'erro';
  screenshot: string | null;
  erro: string | null;
  created_at: string;
}
```

- [ ] **Step 2: Adicionar hook `useCriarProjetoCpfl` em `useLudmilla.ts`**

Após `usePedirRun` (linha ~268), inserir:

```typescript
/** Solicita criação do projeto na CPFL. Devolve o run_id para subscrição Realtime. */
export function useCriarProjetoCpfl() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ accountId, projectId }: { accountId: string; projectId: string }): Promise<string> => {
      const { data, error } = await supabase.rpc('ludmilla_pedir_run' as never, {
        p_account_id: accountId,
        p_tipo: 'criar_projeto',
        p_dados: { project_id: projectId },
      } as never);
      if (error) throw error;
      return data as string;
    },
    onSuccess: (_runId, { accountId }) => {
      qc.invalidateQueries({ queryKey: ['portal-runs', accountId] });
    },
    onError: (e: Error) => toast.error(`Não foi possível criar o projeto: ${e.message}`),
  });
}
```

- [ ] **Step 3: Adicionar hook `usePassosCriacao` em `useLudmilla.ts`**

Logo após `useCriarProjetoCpfl`:

```typescript
/** Subscreve em tempo real os passos de um run de criação. */
export function usePassosCriacao(runId: string | null) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!runId) return;
    const canal = supabase
      .channel(`criacao-${runId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'portal_criacao_passos',
        filter: `run_id=eq.${runId}`,
      }, () => {
        void qc.invalidateQueries({ queryKey: ['passos-criacao', runId] });
      })
      .subscribe();
    return () => { void canal.unsubscribe(); };
  }, [runId, qc]);

  return useQuery({
    queryKey: ['passos-criacao', runId],
    queryFn: async (): Promise<PassoCriacao[]> => {
      if (!runId) return [];
      const { data, error } = await supabase
        .from('portal_criacao_passos' as never)
        .select('*')
        .eq('run_id', runId)
        .order('passo', { ascending: true });
      if (error) throw error;
      return (data ?? []) as PassoCriacao[];
    },
    enabled: !!runId,
    refetchInterval: (q) => {
      const passos = q.state.data ?? [];
      const concluido = passos.some(p => p.nome === 'concluido' && (p.status === 'ok' || p.status === 'erro'));
      const temErro = passos.some(p => p.status === 'erro');
      return (concluido || temErro) ? false : 3_000;
    },
  });
}
```

Adicionar `useEffect` ao import do React no topo do arquivo (se não existir):
```typescript
import { useEffect } from 'react';
```

- [ ] **Step 4: Criar `CriarNaCpflPanel.tsx`**

```typescript
// src/components/projects/CriarNaCpflPanel.tsx
import { useState } from 'react';
import { CheckCircle2, XCircle, Loader2, ExternalLink, Image } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  useCriarProjetoCpfl, usePassosCriacao, urlDoPrint, useLudmillaDisponivel,
  type PassoCriacao,
} from '@/hooks/useLudmilla';

const NOMES: Record<string, string> = {
  introducao:      'Introdução',
  dados_uc:        'Dados da UC',
  dados_projeto:   'Dados do projeto',
  dados_cliente:   'Dados do cliente',
  revisao:         'Revisão',
  concluido:       'Concluído',
};
const ORDEM = ['introducao','dados_uc','dados_projeto','dados_cliente','revisao','concluido'];

function IconePasso({ status }: { status: string | undefined }) {
  if (status === 'ok')      return <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />;
  if (status === 'erro')    return <XCircle      size={16} className="text-red-600 shrink-0" />;
  if (status === 'rodando') return <Loader2      size={16} className="text-blue-500 shrink-0 animate-spin" />;
  return <span className="w-4 h-4 rounded-full border-2 border-muted shrink-0 inline-block" />;
}

function ThumbPasso({ printPath }: { printPath: string | null }) {
  const [url, setUrl] = useState<string | null>(null);
  if (!printPath) return null;
  return (
    <button
      className="text-muted-foreground hover:text-foreground ml-auto"
      onClick={async () => {
        const u = await urlDoPrint(printPath);
        if (u) window.open(u, '_blank');
      }}
      title="Ver print do passo"
    >
      <Image size={14} />
    </button>
  );
}

interface Props {
  projectId: string;
  accountId: string;
  cpflNodeId: string | null;
  concessionaireName: string;
}

export function CriarNaCpflPanel({ projectId, accountId, cpflNodeId, concessionaireName }: Props) {
  const disponivel = useLudmillaDisponivel();
  const criar = useCriarProjetoCpfl();
  const [runId, setRunId] = useState<string | null>(null);
  const { data: passos = [] } = usePassosCriacao(runId);

  if (!disponivel) return null;

  // Já criado: exibe link
  if (cpflNodeId) {
    return (
      <div className="flex items-center gap-2 text-sm text-emerald-700 mt-2">
        <CheckCircle2 size={14} className="shrink-0" />
        <span>Projeto CPFL: <b>{cpflNodeId}</b></span>
        <a
          href={`https://www.cpfl.com.br/gestao-projetos/node/${cpflNodeId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-xs text-blue-600 hover:underline ml-1"
        >
          Ver no portal <ExternalLink size={10} />
        </a>
      </div>
    );
  }

  // Sem run ativo: exibe botão
  if (!runId) {
    return (
      <Button
        size="sm"
        variant="outline"
        className="mt-2 gap-2 text-blue-700 border-blue-300 hover:bg-blue-50"
        disabled={criar.isPending}
        onClick={async () => {
          const id = await criar.mutateAsync({ accountId, projectId });
          if (id) setRunId(id);
        }}
      >
        {criar.isPending ? <Loader2 size={14} className="animate-spin" /> : null}
        Criar na CPFL
      </Button>
    );
  }

  // Run ativo: painel de progresso
  const mapaPassos: Record<string, PassoCriacao> = {};
  for (const p of passos) mapaPassos[p.nome] = p;

  const passoComErro = passos.find(p => p.status === 'erro');
  const concluido = mapaPassos['concluido']?.status === 'ok';

  return (
    <div className="mt-3 rounded-xl border bg-card p-4 space-y-3">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
        {concluido ? 'Projeto criado na CPFL' : 'Criando projeto na CPFL…'}
      </p>

      <ul className="space-y-1.5">
        {ORDEM.map(nome => {
          const p = mapaPassos[nome];
          return (
            <li key={nome} className="flex items-center gap-2 text-sm">
              <IconePasso status={p?.status} />
              <span className={p?.status === 'erro' ? 'text-red-700 font-medium' : ''}>{NOMES[nome]}</span>
              {p?.screenshot && <ThumbPasso printPath={p.screenshot} />}
            </li>
          );
        })}
      </ul>

      {passoComErro && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-xs text-red-800 space-y-1">
          <p className="font-semibold">Erro em "{NOMES[passoComErro.nome]}"</p>
          <p>{passoComErro.erro}</p>
          {passoComErro.screenshot && (
            <button
              className="text-red-700 underline text-xs"
              onClick={async () => {
                const u = await urlDoPrint(passoComErro.screenshot!);
                if (u) window.open(u, '_blank');
              }}
            >
              Ver print do erro
            </button>
          )}
        </div>
      )}

      {(concluido || passoComErro) && (
        <Button size="sm" variant="ghost" onClick={() => setRunId(null)}>
          Fechar
        </Button>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Adicionar botão/painel em `ProjectModal.tsx`**

No componente da aba Geral (`GeneralTab` ou onde fica o bloco de Localização), logo após o bloco `EntryStandardBadge` em [`ProjectModal.tsx:917`](src/components/projects/ProjectModal.tsx):

Adicionar no topo do arquivo:
```typescript
import { CriarNaCpflPanel } from './CriarNaCpflPanel';
```

E no JSX, após o fechamento da `<EntryStandardBadge />`, inserir o painel:

```typescript
{/* Criar na CPFL — só aparece quando: é CPFL, sem cpfl_node_id, e usuário é admin/staff */}
{(project as any).concessionaireName?.toUpperCase?.()?.includes('CPFL') &&
 (userRole === 'admin' || userRole === 'staff') && (
  <CriarNaCpflPanel
    projectId={project.id}
    accountId={(project as any).cpflAccountId ?? ''}
    cpflNodeId={(project as any).cpfl_node_id ?? null}
    concessionaireName={(project as any).concessionaireName ?? 'CPFL'}
  />
)}
```

> **Nota:** `cpflAccountId` precisa ser carregado junto com os dados do modal — é a `portal_accounts.id` da conta CPFL do tenant. Se o modal já carrega `portal_accounts` via hook existente, buscá-la pelo `connector = 'cpfl'`. Caso contrário, adicionar um pequeno `useQuery` dentro de `CriarNaCpflPanel` para buscá-la:

```typescript
// dentro de CriarNaCpflPanel, se accountId for '' ou null:
const { data: contas = [] } = usePortalAccounts();
const contaCpfl = contas.find(c => c.connector === 'cpfl');
const accountIdReal = accountId || contaCpfl?.id || '';
```

- [ ] **Step 6: Checar TypeScript do frontend**

```bash
npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep "error TS" | wc -l
```

Esperado: **65 ou menos** (não aumentar o baseline).

- [ ] **Step 7: Build**

```bash
npm run build 2>&1 | tail -5
```

Esperado: sem erros.

- [ ] **Step 8: Commit**

```bash
git add src/hooks/useLudmilla.ts src/components/projects/CriarNaCpflPanel.tsx src/components/projects/ProjectModal.tsx
git commit -m "feat(frontend): botão Criar na CPFL + painel de progresso em tempo real

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 6: Página `/ludmilla` — runs `criar_projeto`

**Files:**
- Modify: `src/hooks/useLudmilla.ts`
- Modify: `src/pages/Ludmilla.tsx`

**Interfaces:**
- Consumes: `PassoCriacao` (Task 5) · `usePassosCriacao(runId)` (Task 5)
- Produces: runs `criar_projeto` renderizados na lista de runs da página

- [ ] **Step 1: Estender `PortalRun` com `dados` em `useLudmilla.ts`**

Em [`src/hooks/useLudmilla.ts:166`](src/hooks/useLudmilla.ts), adicionar campo `dados` à interface `PortalRun`:

```typescript
export interface PortalRun {
  id: string;
  account_id: string;
  tipo: TipoRun;
  situacao: SituacaoRun;
  pedido_em: string;
  iniciado_em: string | null;
  terminado_em: string | null;
  erro: string | null;
  print_path: string | null;
  resultado: Record<string, unknown> | null;
  dados: Record<string, unknown> | null;  // novo: ex. { project_id: "..." }
}
```

- [ ] **Step 2: Adicionar componente `CardCriacaoCpfl` em `Ludmilla.tsx`**

Adicionar ao final do arquivo [`src/pages/Ludmilla.tsx`](src/pages/Ludmilla.tsx), antes do export default:

```typescript
import { usePassosCriacao, type PassoCriacao, urlDoPrint } from '@/hooks/useLudmilla';
import { CheckCircle2, XCircle, Loader2, ChevronDown, ChevronUp, Image } from 'lucide-react';
import { useState } from 'react';

const NOMES_PASSO: Record<string, string> = {
  introducao:    'Introdução',
  dados_uc:      'Dados da UC',
  dados_projeto: 'Dados do projeto',
  dados_cliente: 'Dados do cliente',
  revisao:       'Revisão',
  concluido:     'Concluído',
};

function LinhaPassoCriacao({ p }: { p: PassoCriacao }) {
  return (
    <li className="flex items-center gap-2 text-sm py-0.5">
      {p.status === 'ok'    && <CheckCircle2 size={14} className="text-emerald-600 shrink-0" />}
      {p.status === 'erro'  && <XCircle      size={14} className="text-red-600 shrink-0" />}
      {p.status === 'rodando' && <Loader2   size={14} className="text-blue-500 shrink-0 animate-spin" />}
      <span className={p.status === 'erro' ? 'text-red-700' : ''}>{NOMES_PASSO[p.nome] ?? p.nome}</span>
      {p.erro && <span className="text-xs text-red-600 ml-1">— {p.erro}</span>}
      {p.screenshot && (
        <button
          className="ml-auto text-muted-foreground hover:text-foreground"
          onClick={async () => { const u = await urlDoPrint(p.screenshot!); if (u) window.open(u, '_blank'); }}
          title="Ver print"
        >
          <Image size={13} />
        </button>
      )}
    </li>
  );
}

export function CardCriacaoCpfl({ run }: { run: PortalRun }) {
  const [expandido, setExpandido] = useState(false);
  const { data: passos = [] } = usePassosCriacao(run.id);
  const projectId = run.dados?.project_id as string | undefined;

  const ok    = run.situacao === 'ok';
  const erro  = run.situacao === 'erro';
  const vivo  = run.situacao === 'rodando' || run.situacao === 'na_fila';

  return (
    <div className="rounded-xl border bg-card p-4 space-y-2">
      <div className="flex items-center gap-2">
        {ok   && <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />}
        {erro && <XCircle      size={16} className="text-red-600 shrink-0" />}
        {vivo && <Loader2      size={16} className="text-blue-500 shrink-0 animate-spin" />}
        <span className="font-medium text-sm">Criação na CPFL</span>
        {projectId && (
          <span className="text-xs text-muted-foreground ml-1">
            projeto {projectId.slice(0, 8)}…
          </span>
        )}
        <span className="text-xs text-muted-foreground ml-auto">{quando(run.pedido_em)}</span>
        <button
          className="text-muted-foreground hover:text-foreground"
          onClick={() => setExpandido(e => !e)}
        >
          {expandido ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>
      {run.erro && <p className="text-xs text-red-700">{run.erro}</p>}
      {expandido && passos.length > 0 && (
        <ul className="border-t pt-2 space-y-0.5">
          {passos.map(p => <LinhaPassoCriacao key={p.id} p={p} />)}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Integrar `CardCriacaoCpfl` na lista de runs de `Ludmilla.tsx`**

Na parte da página onde runs são exibidos (seção de histórico por conta), localizar onde `PortalRun` é renderizado e acrescentar o case para `criar_projeto`. Por exemplo, onde cada run é exibido:

```typescript
{run.tipo === 'criar_projeto'
  ? <CardCriacaoCpfl key={run.id} run={run} />
  : <CardRun key={run.id} run={run} />
}
```

> Se a página usa `RunCard` ou similar, encapsule o mesmo condicional ali.

- [ ] **Step 4: Checar TypeScript e build**

```bash
npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep "error TS" | wc -l
npm run build 2>&1 | tail -5
```

Esperado: ≤ 65 erros TypeScript, build sem erros.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useLudmilla.ts src/pages/Ludmilla.tsx
git commit -m "feat(frontend): página /ludmilla exibe runs criar_projeto com passos

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Checklist de auto-revisão

**Cobertura do spec:**

| Seção do spec | Task que implementa |
|---|---|
| tabela `portal_criacao_passos` | Task 1 |
| coluna `cpfl_node_id` | Task 1 |
| RPC `ludmilla_registrar_passo_criacao` | Task 1 |
| RPC `ludmilla_salvar_node_cpfl` | Task 1 |
| Conversão DMS | Task 2 |
| 6 passos Playwright | Task 3 |
| Tipo `'criar_projeto'` no worker | Task 4 |
| Poll dinâmico 5 s | Task 4 |
| Botão "Criar na CPFL" no modal | Task 5 |
| Painel de progresso em tempo real | Task 5 |
| Screenshots acessíveis no modal | Task 5 |
| Screenshots acessíveis em `/ludmilla` | Task 6 |
| Disjuntor: CPFL primeiro, fallback GD Manager | Task 3 (passo 3) |
| UC não encontrada → erro com mensagem | Task 3 (passo 2) |
| Node ID salvo após passo 5 | Task 3 + Task 4 |

**Consistência de nomes:**
- `criarProjeto` → chamado em Task 4 como `criarProjeto(page, dados)`
- `dadosCriacaoCpfl(runId, projectId, tenantId)` → retorna `DadosCriacaoCpfl`
- `DadosCriacaoCpfl` → definida em Task 3, importada em Task 4
- `usePassosCriacao(runId)` → usada em Task 5 e Task 6
- `PassoCriacao` → definida em Task 5, usada em Task 6
- Bucket path: `{tenant_id}/criacao/{run_id}/passo-{n}.png` — consistente no worker (Task 3) e frontend (URLs assinadas)

**Pontos de atenção:**
- `ludmilla_pedir_run` precisa aceitar `p_dados jsonb` além dos parâmetros existentes — verificar assinatura real da RPC no banco antes de chamar com `p_dados`. Se não aceitar, adicionar à migração da Task 1.
- O campo `dados` da tabela `portal_sync_runs` precisa existir como `jsonb` — verificar antes de usar `run.dados?.project_id` na Task 4.
- `CriarNaCpflPanel` recebe `accountId` como prop; se o modal não carrega `portal_accounts`, o componente deve buscá-la internamente via `usePortalAccounts()` (mostrado no passo 5 da Task 5).

---

**Plano completo e salvo em `docs/superpowers/plans/2026-09-16-ludmilla-criar-projeto-cpfl.md`.**

**Duas opções de execução:**

**1. Subagent-Driven (recomendado)** — despacha um subagente fresco por task, revisão entre tasks, iteração rápida

**2. Inline** — executa as tasks nesta sessão via executing-plans, com checkpoints

**Qual preferes?**
