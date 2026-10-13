# Painel de armazenamento da VPS — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mostrar no console `/painel` quanto disco a VPS tem livre, com série histórica, para que a equipe veja o aperto antes de uma importação grande falhar por falta de espaço.

**Architecture:** O worker da Ludmilla, que já roda na VPS e já fala com o Supabase, mede o disco num batimento periódico e grava por RPC numa tabela nova (`vps_armazenamento`). O console lê por uma RPC `console_*` no mesmo padrão das que a aba Monitoramento já consome. Retenção por `pg_cron`. Nenhuma mudança no fluxo de runs da Ludmilla — a medição é best-effort e nunca derruba o laço.

**Tech Stack:** Postgres/Supabase (RLS, `SECURITY DEFINER`, `pg_cron` 1.6.4) · Node 22 + TypeScript no worker (`node:test`, `node:fs/promises` `statfs`) · React + React Query + Recharts no console.

**Spec:** [docs/superpowers/specs/2026-10-10-capacidade-rede-design.md](../specs/2026-10-10-capacidade-rede-design.md) — §5 (painel de armazenamento) e §8 (permissões). Este plano implementa só a §5; a capacidade de rede em si é outro plano.

## Global Constraints

- **Comunicação e nomes em português** onde o módulo já é assim; `group_key`/`rule_key` e nomes de tabela seguem o padrão existente. Ver `docs/project/naming-conventions.md`.
- **Gate master é `public.is_master(auth.uid())`** — função que já existe (`STABLE SECURITY DEFINER SET search_path TO 'public'`, lê `profiles.is_master`, protegida pelo trigger `fn_protect_master_flag`). **Não** criar helper novo lendo `app_metadata`: `app_metadata` é a confiança de papel/tenant dentro do tenant (ADR 0003), e para master o padrão da casa é `is_master`. A §8 da spec diz "helper lendo app_metadata" e está imprecisa neste ponto — vale o que está aqui.
- **Toda RPC**: `SECURITY DEFINER` + `SET search_path TO 'public', 'pg_temp'`, com a checagem de permissão **dentro** da função, nunca só na tela.
- **Escrita só por service role.** Nenhuma política de INSERT/UPDATE/DELETE para `authenticated`.
- **Banco**: aplicar com `npx -y supabase db query --linked -f arquivo.sql`. Só o último SELECT com linhas volta. RLS testada com impersonação dentro de `begin; … rollback;`.
- **Verificação antes de concluir**: `npx tsc --noEmit -p tsconfig.app.json` contra o baseline de **65 erros** e `npm run build`.
  **ATENÇÃO — armadilha confirmada em 10/10/2026:** se `node_modules` não estiver instalado, `npx` baixa **TypeScript 6.0.2** em vez do `^5.8.3` que o `package.json` pina, e o 6.x trata `baseUrl` como **erro**, abortando antes de checar os arquivos. O resultado é **1 erro em vez de 65**, que parece melhoria e não é. Rode `npm ci` antes, e confirme `npx tsc --version` → `5.8.x`. Uma queda grande no número é falha de parse, não progresso.
- **Cores de status** (validadas para daltonismo, ΔE 12,6 em protanopia): folga `#1F7A3D`, atenção `#F5A800`, risco `#F0523F`, sem dado `#8A8A96`. Status sempre com **ícone + rótulo**, nunca cor sozinha.
- **Gráfico de uma série só não leva legenda** — o título nomeia a série. Linha de 2px, grid recessivo.

---

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/20261010120000_vps_armazenamento.sql` (criar) | Tabela, índice, RLS, RPC de escrita, RPC de leitura, job de retenção |
| `worker/ludmilla/src/disco.ts` (criar) | Leitura de disco e a aritmética pura de bytes/ocupação |
| `worker/ludmilla/test/disco.test.ts` (criar) | Testes da aritmética pura |
| `worker/ludmilla/src/fila.ts` (modificar, perto de `pulsar` na linha 81) | `reportarDisco()` — envia a medição por RPC |
| `worker/ludmilla/src/index.ts` (modificar, linhas 245-275) | Batimento de disco no laço, válido no modo VPS |
| `src/pages/painel/VpsStorageCard.tsx` (criar) | O card: KPIs, barra de ocupação, série |
| `src/pages/painel/MonitoringSection.tsx` (modificar, linha 82) | Monta o card no topo da aba |

---

## Task 1: Tabela, RLS e as duas RPCs

**Files:**
- Create: `supabase/migrations/20261010120000_vps_armazenamento.sql`
- Test: `/tmp/claude-0/.../scratchpad/teste-rls-vps.sql` (script de verificação, não versionado)

**Interfaces:**
- Consumes: `public.is_master(uuid)` (já existe).
- Produces: tabela `public.vps_armazenamento`; `public.vps_armazenamento_registrar(text, text, bigint, bigint, bigint, text, text) returns void`; `public.console_vps_armazenamento(integer) returns jsonb` com a forma `{"atual": {...} | null, "serie": [{"dia","usado_bytes","total_bytes"}]}`.

- [ ] **Step 1: Escrever a migração**

Criar `supabase/migrations/20261010120000_vps_armazenamento.sql`:

```sql
-- Armazenamento da VPS no painel de monitoramento.
--
-- Spec: docs/superpowers/specs/2026-10-10-capacidade-rede-design.md §5
--
-- A SPA é estática e não vê o disco da VPS. Quem vê é o worker da Ludmilla,
-- que já roda lá e já fala com o banco: ele mede num batimento e grava aqui
-- por RPC (service role). O console lê pela console_vps_armazenamento, no
-- mesmo padrão das outras console_*.

CREATE TABLE public.vps_armazenamento (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  host         TEXT        NOT NULL,
  particao     TEXT        NOT NULL DEFAULT '/',
  total_bytes  BIGINT      NOT NULL CHECK (total_bytes > 0),
  usado_bytes  BIGINT      NOT NULL CHECK (usado_bytes >= 0),
  livre_bytes  BIGINT      NOT NULL CHECK (livre_bytes >= 0),
  origem       TEXT        NOT NULL DEFAULT 'worker'
                           CHECK (origem IN ('worker', 'ingestao')),
  etapa        TEXT,
  medido_em    TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.vps_armazenamento IS
  'Medições de disco da VPS. Dado de plataforma: só master lê, só service role escreve.';
COMMENT ON COLUMN public.vps_armazenamento.origem IS
  'worker = batimento periódico; ingestao = medição durante uma importação';
COMMENT ON COLUMN public.vps_armazenamento.etapa IS
  'Etapa da importação quando origem = ingestao; nulo no batimento comum';

-- A consulta é sempre "a última do host" ou "a série recente do host".
CREATE INDEX vps_armazenamento_host_medido_idx
  ON public.vps_armazenamento (host, medido_em DESC);

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Leitura: só master. Escrita: nenhuma política — o service role ignora RLS,
-- e sem política para `authenticated` não existe caminho pela API.
ALTER TABLE public.vps_armazenamento ENABLE ROW LEVEL SECURITY;

CREATE POLICY vps_armazenamento_master_le ON public.vps_armazenamento
  FOR SELECT TO authenticated
  USING ((SELECT public.is_master(auth.uid())));

-- ── Escrita: só o service role, pela RPC ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.vps_armazenamento_registrar(
  p_host     TEXT,
  p_particao TEXT,
  p_total    BIGINT,
  p_usado    BIGINT,
  p_livre    BIGINT,
  p_origem   TEXT DEFAULT 'worker',
  p_etapa    TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Só o service role registra medição de disco';
  END IF;
  INSERT INTO public.vps_armazenamento
    (host, particao, total_bytes, usado_bytes, livre_bytes, origem, etapa)
  VALUES (p_host, p_particao, p_total, p_usado, p_livre, p_origem, p_etapa);
END $$;

REVOKE EXECUTE ON FUNCTION public.vps_armazenamento_registrar(TEXT, TEXT, BIGINT, BIGINT, BIGINT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;

-- ── Leitura: última medição + série diária ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.console_vps_armazenamento(p_dias INTEGER DEFAULT 30)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
  WITH atual AS (
    SELECT host, particao, total_bytes, usado_bytes, livre_bytes, medido_em
      FROM public.vps_armazenamento
     WHERE public.is_master(auth.uid())
     ORDER BY medido_em DESC
     LIMIT 1
  ), serie AS (
    SELECT date_trunc('day', medido_em)::date AS dia,
           MAX(usado_bytes)  AS usado_bytes,
           MAX(total_bytes)  AS total_bytes
      FROM public.vps_armazenamento
     WHERE public.is_master(auth.uid())
       AND medido_em >= now() - make_interval(days => GREATEST(p_dias, 1))
     GROUP BY 1
     ORDER BY 1
  )
  SELECT jsonb_build_object(
    'atual', (SELECT to_jsonb(a) FROM atual a),
    'serie', COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.dia) FROM serie s), '[]'::jsonb)
  );
$$;

REVOKE EXECUTE ON FUNCTION public.console_vps_armazenamento(INTEGER) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.console_vps_armazenamento(INTEGER) TO authenticated;

-- ── Retenção: 90 dias ───────────────────────────────────────────────────────
-- Minuto 17 para não disputar o :00 com os outros jobs.
SELECT cron.schedule(
  'vps_armazenamento_retencao',
  '17 4 * * *',
  $$DELETE FROM public.vps_armazenamento WHERE medido_em < now() - INTERVAL '90 days'$$
);
```

- [ ] **Step 2: Aplicar a migração**

```bash
cd /home/user/pv-harmony-hub
npx -y supabase db query --linked -f supabase/migrations/20261010120000_vps_armazenamento.sql
```

Esperado: sem erro. Se `cron.schedule` reclamar que o job já existe, troque por `cron.unschedule('vps_armazenamento_retencao')` antes — mas na primeira aplicação não existe.

- [ ] **Step 3: Escrever o teste de RLS (impersonação em transação)**

Criar o script no scratchpad (não versionar):

```sql
-- Prova que: master lê, não-master não lê, e authenticated não escreve.
BEGIN;

-- Semeia uma medição como service role (sem RLS).
INSERT INTO public.vps_armazenamento (host, particao, total_bytes, usado_bytes, livre_bytes)
VALUES ('teste-rls', '/', 120000000000, 81600000000, 38400000000);

-- 1) um usuário NÃO master não vê nada
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
SELECT 'nao_master_ve' AS caso, count(*) AS linhas FROM public.vps_armazenamento;
-- esperado: 0

-- 2) escrita pela RPC é recusada fora do service role
DO $$
BEGIN
  PERFORM public.vps_armazenamento_registrar('x', '/', 1, 1, 1);
  RAISE EXCEPTION 'FALHOU: authenticated conseguiu registrar';
EXCEPTION WHEN insufficient_privilege OR raise_exception THEN
  RAISE NOTICE 'OK: escrita recusada para authenticated';
END $$;

RESET ROLE;

-- 3) um master vê — troque o UUID por um profiles.id com is_master = true
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"<UUID-DE-UM-MASTER>","role":"authenticated"}';
SELECT 'master_ve' AS caso, count(*) AS linhas FROM public.vps_armazenamento;
-- esperado: >= 1

ROLLBACK;
```

Antes de rodar, descubra um master real:

```bash
npx -y supabase db query --linked --query "select id from profiles where is_master limit 1"
```

- [ ] **Step 4: Rodar o teste de RLS**

```bash
npx -y supabase db query --linked -f /tmp/.../teste-rls-vps.sql
```

Esperado: `nao_master_ve` = 0, a notice "OK: escrita recusada", `master_ve` >= 1. Se `nao_master_ve` > 0, a política está errada — pare e corrija antes de seguir.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261010120000_vps_armazenamento.sql
git commit -m "feat(banco): armazenamento da VPS — tabela, RLS master, RPCs e retenção"
```

---

## Task 2: Leitura de disco no worker (aritmética pura, com TDD)

**Files:**
- Create: `worker/ludmilla/src/disco.ts`
- Test: `worker/ludmilla/test/disco.test.ts`

**Interfaces:**
- Consumes: nada do projeto; só `node:fs/promises`.
- Produces: `interface MedidaDisco { totalBytes: number; usadoBytes: number; livreBytes: number; ocupacaoPct: number }`; `medidaDe(st: { bsize: number; blocks: number; bavail: number }): MedidaDisco`; `lerDisco(caminho?: string): Promise<MedidaDisco>`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `worker/ludmilla/test/disco.test.ts`:

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { medidaDe } from '../src/disco.js';

/**
 * `statfs` devolve blocos, não bytes: total = bsize × blocks, livre =
 * bsize × bavail (bavail, não bfree — bfree inclui o que só o root usa).
 * A conta é pequena e é exatamente onde um erro passa despercebido, então
 * ela vive separada da leitura do sistema de arquivos, para ser testável.
 */

test('converte blocos em bytes e calcula a ocupação', () => {
  // 4 KiB por bloco, 30M blocos = ~120 GB; 9,6M disponíveis = ~38,4 GB
  const m = medidaDe({ bsize: 4096, blocks: 30_000_000, bavail: 9_600_000 });
  assert.equal(m.totalBytes, 122_880_000_000);
  assert.equal(m.livreBytes, 39_321_600_000);
  assert.equal(m.usadoBytes, 83_558_400_000);
  assert.equal(m.ocupacaoPct, 68);
});

test('arredonda a ocupação em uma casa decimal', () => {
  const m = medidaDe({ bsize: 1000, blocks: 3, bavail: 1 });
  // usado 2000 de 3000 = 66,666…%
  assert.equal(m.ocupacaoPct, 66.7);
});

test('disco cheio dá 100% e livre zero', () => {
  const m = medidaDe({ bsize: 4096, blocks: 1000, bavail: 0 });
  assert.equal(m.livreBytes, 0);
  assert.equal(m.ocupacaoPct, 100);
});

test('total zero não divide por zero', () => {
  const m = medidaDe({ bsize: 4096, blocks: 0, bavail: 0 });
  assert.equal(m.totalBytes, 0);
  assert.equal(m.ocupacaoPct, 0);
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
cd worker/ludmilla && npm test
```

Esperado: FALHA na compilação — `Cannot find module '../src/disco.js'`.

- [ ] **Step 3: Escrever a implementação mínima**

Criar `worker/ludmilla/src/disco.ts`:

```typescript
import { statfs } from 'node:fs/promises';

/**
 * Quanto disco a máquina tem. Serve ao painel de monitoramento e, depois, à
 * checagem de espaço antes de uma importação grande.
 *
 * A aritmética fica em `medidaDe`, separada da leitura do sistema de
 * arquivos, porque é ela que tem como errar — e assim dá para testar sem
 * depender do disco de quem roda o teste.
 */

export interface MedidaDisco {
  totalBytes: number;
  usadoBytes: number;
  livreBytes: number;
  /** Percentual usado, uma casa decimal. */
  ocupacaoPct: number;
}

/** `bavail` e não `bfree`: o espaço reservado ao root não é nosso. */
export function medidaDe(st: { bsize: number; blocks: number; bavail: number }): MedidaDisco {
  const totalBytes = st.bsize * st.blocks;
  const livreBytes = st.bsize * st.bavail;
  const usadoBytes = totalBytes - livreBytes;
  const ocupacaoPct = totalBytes > 0
    ? Math.round((usadoBytes / totalBytes) * 1000) / 10
    : 0;
  return { totalBytes, usadoBytes, livreBytes, ocupacaoPct };
}

export async function lerDisco(caminho = '/'): Promise<MedidaDisco> {
  const st = await statfs(caminho);
  return medidaDe({
    bsize: Number(st.bsize),
    blocks: Number(st.blocks),
    bavail: Number(st.bavail),
  });
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

```bash
cd worker/ludmilla && npm test
```

Esperado: os 4 testes de `disco.test.js` passam, e os testes que já existiam continuam passando.

- [ ] **Step 5: Commit**

```bash
git add worker/ludmilla/src/disco.ts worker/ludmilla/test/disco.test.ts
git commit -m "feat(worker): leitura de disco com a aritmética de bytes testada"
```

---

## Task 3: Enviar a medição e encaixar no laço

**Files:**
- Modify: `worker/ludmilla/src/fila.ts` (acrescentar depois de `pulsar`, que termina na linha 84)
- Modify: `worker/ludmilla/src/index.ts` (no corpo de `principal()`, linhas 245-275)

**Interfaces:**
- Consumes: `lerDisco()` da Task 2; `public.vps_armazenamento_registrar` da Task 1; `modoAtual()` de `./local.js` e `supabase()` do próprio `fila.ts`.
- Produces: `reportarDisco(origem?: 'worker' | 'ingestao', etapa?: string | null): Promise<void>`.

- [ ] **Step 1: Acrescentar `reportarDisco` em `fila.ts`**

Depois da função `pulsar` (linha 84), inserir:

```typescript
/**
 * Medição de disco da VPS — o painel de monitoramento mostra por ela.
 *
 * Espelho de `pulsar`, com o modo invertido: pulsar interessa na estação
 * local (a página mostra online/offline), o disco interessa na VPS, que é
 * onde o app é servido e onde as importações grandes rodam.
 *
 * Best-effort de propósito: se o banco estiver fora, a medição se perde e o
 * laço segue. Nenhuma leitura de disco justifica parar a fila.
 */
export async function reportarDisco(
  origem: 'worker' | 'ingestao' = 'worker',
  etapa: string | null = null,
): Promise<void> {
  if (modoAtual() === 'local') return;
  try {
    const m = await lerDisco('/');
    await supabase().rpc('vps_armazenamento_registrar', {
      p_host: process.env.LUDMILLA_HOST ?? hostname(),
      p_particao: '/',
      p_total: m.totalBytes,
      p_usado: m.usadoBytes,
      p_livre: m.livreBytes,
      p_origem: origem,
      p_etapa: etapa,
    });
  } catch {
    /* medição é best-effort: nunca derruba o laço */
  }
}
```

E, no topo do arquivo, somar aos imports existentes:

```typescript
import { hostname } from 'node:os';
import { lerDisco } from './disco.js';
```

- [ ] **Step 2: Encaixar o batimento no laço de `index.ts`**

Em `principal()`, o batimento atual (`batimento = setInterval(() => { void pulsar(); }, 60_000)`, linha 265) está **dentro** do `if (modo === 'local')`, então o ramo da VPS não tem batimento nenhum. Acrescentar um próprio.

Somar `reportarDisco` ao import de `./fila.js` (que já traz `pulsar`), e depois do `if/else` de modo — antes de `let parar = false;` (linha 276) — inserir:

```typescript
  // Disco da VPS: uma medição ao subir e outra a cada 15 min. `reportarDisco`
  // não faz nada no modo local, então vale deixar fora do if de modo.
  let batimentoDisco: NodeJS.Timeout | null = null;
  await reportarDisco();
  batimentoDisco = setInterval(() => { void reportarDisco(); }, 15 * 60_000);
```

E onde o `batimento` existente é limpo no encerramento, limpar também o novo. Localize a limpeza com:

```bash
grep -n "clearInterval" worker/ludmilla/src/index.ts
```

Se houver `if (batimento) clearInterval(batimento);`, acrescente na mesma linha de raciocínio:

```typescript
  if (batimentoDisco) clearInterval(batimentoDisco);
```

Se **não** houver nenhum `clearInterval` (o processo simplesmente termina), acrescente os dois no fim de `principal()`, depois do `while`:

```typescript
  if (batimento) clearInterval(batimento);
  if (batimentoDisco) clearInterval(batimentoDisco);
```

- [ ] **Step 3: Compilar o worker e rodar os testes**

```bash
cd worker/ludmilla && npm run build && npm test
```

Esperado: build sem erro e todos os testes passando. O build é a verificação aqui — `reportarDisco` fala com o banco e não tem teste unitário próprio; o que tinha como errar (a aritmética) já está coberto na Task 2.

- [ ] **Step 4: Commit**

```bash
git add worker/ludmilla/src/fila.ts worker/ludmilla/src/index.ts
git commit -m "feat(worker): batimento de 15 min reportando o disco da VPS"
```

---

## Task 4: O card no console

**Files:**
- Create: `src/pages/painel/VpsStorageCard.tsx`
- Modify: `src/pages/painel/MonitoringSection.tsx` (import no topo; montar o card depois do `<SectionTitle>` da linha 82)

**Interfaces:**
- Consumes: `console_vps_armazenamento` da Task 1; `card`, `grid`, `GOLD`, `tt`, `dayShort` de `./ConsoleSections` (definidos em `ConsoleSections.tsx` linhas 27, 37, 11, 43, 44).
- Produces: `export function VpsStorageCard(): JSX.Element`.

- [ ] **Step 1: Escrever o componente**

Criar `src/pages/painel/VpsStorageCard.tsx`:

```tsx
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { HardDrive, CheckCircle2, AlertTriangle } from 'lucide-react';
import { card, tt, dayShort } from './ConsoleSections';

/**
 * Armazenamento da VPS. O dado vem do batimento do worker da Ludmilla, que é
 * quem roda lá e vê o disco — a SPA é estática e não vê nada.
 *
 * Uma série só, então sem legenda: o título nomeia. Status com ícone E
 * rótulo, nunca cor sozinha (as cores são as validadas para daltonismo).
 */

const FOLGA = '#1F7A3D';
const ATENCAO = '#F5A800';
const RISCO = '#F0523F';
const LIMIAR_ATENCAO = 80;
const LIMIAR_RISCO = 90;

interface Atual {
  host: string; particao: string;
  total_bytes: number; usado_bytes: number; livre_bytes: number;
  medido_em: string;
}
interface Ponto { dia: string; usado_bytes: number; total_bytes: number }
interface Resposta { atual: Atual | null; serie: Ponto[] }

const gb = (bytes: number) => bytes / 1_000_000_000;
const fmtGB = (bytes: number) =>
  gb(bytes).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function estado(ocupacaoPct: number) {
  if (ocupacaoPct >= LIMIAR_RISCO) return { cor: RISCO, rotulo: 'Disco crítico', Icone: AlertTriangle };
  if (ocupacaoPct >= LIMIAR_ATENCAO) return { cor: ATENCAO, rotulo: 'Disco apertado', Icone: AlertTriangle };
  return { cor: FOLGA, rotulo: 'Espaço suficiente', Icone: CheckCircle2 };
}

export function VpsStorageCard() {
  const q = useQuery({
    queryKey: ['console-vps-armazenamento'],
    queryFn: async (): Promise<Resposta> => {
      const { data, error } = await supabase.rpc('console_vps_armazenamento' as never, { p_dias: 30 } as never);
      if (error) throw error;
      return data as Resposta;
    },
    staleTime: 60_000,
  });

  if (q.isLoading) {
    return <div style={{ ...card, color: '#777', fontSize: 13 }}>Lendo o armazenamento da VPS…</div>;
  }
  if (q.isError) {
    return (
      <div style={{ ...card, color: '#FF7A6B', fontSize: 13 }}>
        Não consegui ler o armazenamento da VPS.{' '}
        <button
          type="button"
          onClick={() => void q.refetch()}
          style={{ background: 'none', border: 'none', color: GOLD_LINK, cursor: 'pointer', fontSize: 13, padding: 0 }}
        >
          Tentar de novo
        </button>
      </div>
    );
  }

  const atual = q.data?.atual ?? null;
  if (!atual) {
    return (
      <div style={{ ...card, color: '#777', fontSize: 13 }}>
        Nenhuma medição ainda. O worker da Ludmilla grava a primeira ao subir na VPS.
      </div>
    );
  }

  const ocupacao = atual.total_bytes > 0
    ? Math.round((atual.usado_bytes / atual.total_bytes) * 1000) / 10
    : 0;
  const { cor, rotulo, Icone } = estado(ocupacao);
  const serie = (q.data?.serie ?? []).map(p => ({ dia: dayShort(p.dia), usado: gb(p.usado_bytes) }));
  const totalGB = gb(atual.total_bytes);

  return (
    <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#888', fontSize: 12 }}>
            <HardDrive size={15} style={{ color: cor }} /> Armazenamento da VPS
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, color: '#fff', marginTop: 8 }}>
            {fmtGB(atual.livre_bytes)} GB livres
          </div>
          <div style={{ fontSize: 11, color: '#777', marginTop: 2 }}>
            de {fmtGB(atual.total_bytes)} GB · {atual.host}{atual.particao} · medido{' '}
            {new Date(atual.medido_em).toLocaleString('pt-BR', {
              day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
            })}
          </div>
        </div>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600,
          color: '#ddd', padding: '4px 9px', borderRadius: 20,
          background: `${cor}2E`, border: `1px solid ${cor}80`, whiteSpace: 'nowrap',
        }}>
          <Icone size={11} style={{ color: cor }} /> {rotulo}
        </span>
      </div>

      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{ fontSize: 11, color: '#777' }}>Ocupação</span>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#ddd' }}>
            {ocupacao.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%
          </span>
        </div>
        <div style={{ position: 'relative', height: 10, background: 'rgba(255,255,255,0.07)', borderRadius: '0 5px 5px 0' }}>
          <div style={{ width: `${Math.min(ocupacao, 100)}%`, height: '100%', background: cor, borderRadius: '0 4px 4px 0' }} />
          <div style={{ position: 'absolute', left: `${LIMIAR_ATENCAO}%`, top: -4, bottom: -4, width: 2, background: ATENCAO }} />
          <div style={{ position: 'absolute', left: `${LIMIAR_RISCO}%`, top: -4, bottom: -4, width: 2, background: RISCO }} />
        </div>
        <div style={{ display: 'flex', gap: 14, marginTop: 8 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5, color: '#888' }}>
            <span style={{ width: 2, height: 10, background: ATENCAO }} /> atenção em {LIMIAR_ATENCAO}%
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5, color: '#888' }}>
            <span style={{ width: 2, height: 10, background: RISCO }} /> crítico em {LIMIAR_RISCO}%
          </span>
        </div>
      </div>

      {serie.length > 1 && (
        <div style={{ height: 150 }}>
          <p style={{ fontSize: 12, color: '#aaa', margin: '0 0 8px' }}>
            Disco usado — últimos 30 dias (GB de {fmtGB(atual.total_bytes)})
          </p>
          <AreaChart width={undefined as never} height={110} data={serie} style={{ width: '100%' }}>
            <CartesianGrid stroke="#222" vertical={false} />
            <XAxis dataKey="dia" stroke="#666" fontSize={11} />
            <YAxis stroke="#666" fontSize={11} domain={[0, Math.ceil(totalGB)]} />
            <Tooltip {...tt} formatter={(v: number) => [`${v.toFixed(1)} GB`, 'usado']} />
            <Area type="monotone" dataKey="usado" stroke="#5B9CF8" strokeWidth={2} fill="#5B9CF8" fillOpacity={0.14} />
          </AreaChart>
        </div>
      )}
    </div>
  );
}
```

**Dois ajustes a fazer ao digitar**, porque o trecho acima tem uma referência solta e um gráfico de largura fixa:

1. `GOLD_LINK` não existe — importe `GOLD` de `./ConsoleSections` (linha 11 de lá) e use `GOLD` no lugar. O import no topo fica: `import { card, tt, dayShort, GOLD } from './ConsoleSections';`
2. O `AreaChart` precisa de largura responsiva. Envolva-o num `ResponsiveContainer` de `recharts` (`import { ResponsiveContainer } from 'recharts'`), com `width="100%" height={110}`, e remova os props `width`/`height`/`style` do `AreaChart`. É o mesmo arranjo que `ChartBox` usa em `ConsoleSections.tsx:41`.

- [ ] **Step 2: Montar o card na aba Monitoramento**

Em `src/pages/painel/MonitoringSection.tsx`, somar ao topo:

```tsx
import { VpsStorageCard } from './VpsStorageCard';
```

E depois do `<SectionTitle>Monitoramento</SectionTitle>` (linha 82), antes do `{s && (`:

```tsx
      <div style={{ marginBottom: 14 }}>
        <VpsStorageCard />
      </div>
```

- [ ] **Step 3: Verificar tipos e build**

```bash
cd /home/user/pv-harmony-hub
npm ci                                   # obrigatório: ver Global Constraints
npx tsc --version                        # precisa ser 5.8.x, não 6.x
npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c "error TS"
npm run build
```

Esperado: a contagem de erros fica em **65** (o baseline) e o build conclui. Se vier 1, você está com TypeScript 6 — releia as Global Constraints. Se vier mais que 65, os erros novos são seus: conserte antes de seguir.

- [ ] **Step 4: Ver na tela**

Abra `/painel` com um usuário master, vá em **Monitoramento** e confirme: o card aparece no topo; sem nenhuma medição ele mostra "Nenhuma medição ainda"; com medição mostra GB livres, a barra com as duas marcas de limiar e, com dois dias ou mais de dado, a série.

Para semear uma medição de teste sem esperar o worker:

```bash
npx -y supabase db query --linked --query "select public.vps_armazenamento_registrar('gdmanager-vps','/',120000000000,81600000000,38400000000)"
```

- [ ] **Step 5: Commit**

```bash
git add src/pages/painel/VpsStorageCard.tsx src/pages/painel/MonitoringSection.tsx
git commit -m "feat(painel): card de armazenamento da VPS na aba Monitoramento"
```

---

## Task 5: Documentação

**Files:**
- Modify: `docs/modules/notifications/overview.md` **ou** o doc do módulo onde o painel de monitoramento é descrito — descubra com o comando abaixo
- Modify: `CLAUDE.md` apenas se uma tabela nova de módulo for necessária (provavelmente não: isso é infraestrutura, não módulo novo)

- [ ] **Step 1: Achar onde o painel de monitoramento está documentado**

```bash
cd /home/user/pv-harmony-hub
grep -rln "monitorament\|console_events" docs/modules/ docs/project/
```

- [ ] **Step 2: Documentar**

No doc encontrado, acrescentar uma subseção curta: a tabela `vps_armazenamento`, quem escreve (worker da Ludmilla, por `vps_armazenamento_registrar`, só service role), quem lê (master, por `console_vps_armazenamento`), a cadência de 15 min, a retenção de 90 dias por `pg_cron`, e os limiares de 80%/90%. Aponte para a spec.

- [ ] **Step 3: Commit**

```bash
git add docs/
git commit -m "docs: armazenamento da VPS no painel de monitoramento"
```

---

## Verificação final

- [ ] `cd worker/ludmilla && npm test` — todos passando
- [ ] `npm ci && npx tsc --version` mostra 5.8.x
- [ ] `npx tsc --noEmit -p tsconfig.app.json` com **65** erros (o baseline — nem mais, nem muito menos)
- [ ] `npm run build` conclui
- [ ] Teste de RLS: não-master lê 0 linhas; escrita recusada para `authenticated`
- [ ] Card visível em `/painel` → Monitoramento, nos três estados (sem dado, com dado, erro)

Só então commit final e push.

---

## Self-review

**Cobertura da §5 da spec:** tabela `vps_armazenamento` → Task 1. Worker reportando por heartbeat → Tasks 2 e 3. Ingestão reportando etapa → o parâmetro `origem`/`etapa` existe desde a Task 1 e `reportarDisco('ingestao', etapa)` já aceita; **quem chama** é a ingestão, que é do outro plano. RPC `console_vps_armazenamento` → Task 1. Card na aba Monitoramento reaproveitando o padrão existente → Task 4. Retenção por `pg_cron` → Task 1. Limiar em configuração → **desvio consciente**: os limiares estão como constantes nomeadas em `VpsStorageCard.tsx`, não em tabela. A spec pedia "configuração, não fixo no código"; `engineering_rules` é do Motor de Engenharia e seria forçar infraestrutura lá dentro. Como não há tabela de configuração de plataforma hoje, criar uma para dois números é pior que duas constantes nomeadas. Fica registrado como dívida: se aparecer uma terceira configuração de plataforma, vale a tabela.

**Tipos:** `MedidaDisco` e `medidaDe` com os mesmos nomes na Task 2 e no uso da Task 3. `reportarDisco(origem, etapa)` com a assinatura igual na definição e na chamada. A forma do JSON de `console_vps_armazenamento` (`atual`/`serie`, com `usado_bytes`/`total_bytes`/`dia`) é a mesma na Task 1 e nas interfaces `Atual`/`Ponto`/`Resposta` da Task 4.

**Placeholders:** os dois pontos onde o código precisa de ajuste ao digitar (o `GOLD_LINK` e o `ResponsiveContainer`) estão explicitados com a correção exata, em vez de deixados como armadilha. O UUID do master no teste de RLS tem o comando que o descobre.
