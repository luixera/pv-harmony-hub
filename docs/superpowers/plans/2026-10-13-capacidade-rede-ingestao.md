# Ingestão da BDGD — Implementation Plan (Plano 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Carregar a BDGD da CPFL (Paulista e Piratininga) nas tabelas `rede_*` que a Fase A criou, na VPS, com a data-base registrada e o disco vigiado.

**Architecture:** O trabalho pesado fica **fora do banco** (opção B da spec): `ogr2ogr` lê o `.gdb` e já devolve CSV agregado por transformador; o worker só empurra ~54 mil linhas para tabelas de *staging* via `supabase-js` e chama **uma** RPC que promove tudo numa transação. Não há `COPY` nem conexão Postgres direta — ver "Decisões medidas" abaixo.

**Tech Stack:** Node 22 + TypeScript (worker existente) · `@supabase/supabase-js` ^2.45 · GDAL/`ogr2ogr` 3.8 com dialeto SQLite · Postgres/PostGIS no Supabase · `node:test`.

**Spec:** [docs/superpowers/specs/2026-10-10-capacidade-rede-design.md](../specs/2026-10-10-capacidade-rede-design.md) — §4 (ingestão) e §9 (as medições que sustentam este plano).

## Global Constraints

- **`npm ci` antes de qualquer `tsc`.** Sem `node_modules`, o `npx` baixa TypeScript 6, que aborta no `baseUrl` depreciado e reporta **1** erro em vez de 65. Confirme `npx tsc --version` = **5.8.x**.
- **Baseline de tipos: exatamente 65 erros** em `tsconfig.app.json`. Mais que isso é regressão sua.
- **Baseline do worker: 80 testes, 56 passando, 24 falhando.** Os 24 são pré-existentes. Rode `rm -rf dist-test` antes de comparar, senão a contagem mente.
- **`supabase-js` é lazy:** um query builder sem `await` nunca envia a requisição. Todo insert que precisa persistir é aguardado.
- **Segredo nenhum no repositório.** `SUPABASE_SERVICE_ROLE_KEY` já existe no ambiente do worker; nada de `.env` comitado, nada em `src/`, nada em migração.
- **GDAL precisa de `apt-get update` antes do install.** Sem isso o `apt-get install gdal-bin` falha com 404 em `libminizip1t64` e `libmysqlclient21`. Verificado em 13/10/2026.
- **`ativo = false`, nunca `DELETE`.** O que desapareceu da BDGD é marcado, nunca apagado em silêncio (comentário de coluna em `rede_transformador.ativo`).
- As tabelas `rede_*` **não têm `tenant_id`** (ADR 0008) e **não cruzam com projetos do GD Manager** (decisão de escopo de 10/10/2026).
- **Só para verificar daqui de dentro:** o `fetch` do Node não lê `HTTPS_PROXY`, então no container de desenvolvimento qualquer teste que chame a ANEEL precisa de `NODE_USE_ENV_PROXY=1` (Node ≥ 22.21) e `NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt`. **Na VPS não é preciso nada disso** — ela tem saída direta. Sem a variável o erro é um `fetch failed`/`ENOTFOUND` que não parece ser de proxy.

## Decisões medidas (não as reabra sem medir de novo)

Tudo abaixo foi medido na BDGD real `CPFL_Piratininga_2937_2025-12-31_V11` em 13/10/2026. Os números estão na §9 da spec.

| Decisão | Por quê | Número |
|---|---|---|
| **Sem `COPY`, sem driver Postgres** | Com a opção B só sobem **agregados**: ~53 mil trafos, 553 alimentadores, 139 subestações. Os 2 milhões de UCs nunca entram no banco. `COPY` resolveria um problema que não temos, ao custo de uma conexão direta e um segredo novo. | ~54 mil linhas, ~6 MB |
| **`JOIN` entre camadas no dialeto SQLite está proibido** | O `JOIN UCBT_tab × CRVCRG` não usa índice e vira laço aninhado de 2 milhões × 68 com 120 colunas de aritmética por linha. Abortado depois de **11 minutos sem uma linha de saída**. A alternativa — pré-calcular 68 fatores de forma e gerar um `CASE` — dá o **mesmo resultado** em **12,5 s**. | 11 min+ → 12,5 s |
| **Geometria de alimentador fica fora** | `NetworkSection.tsx` desenha só `Marker` e `Rectangle`; `rede_no_mapa` devolve o alimentador apenas como **código**, para o rótulo. Ninguém consome o traçado. Ingeri-lo custaria 18,9 MB de WKT na Piratininga (~90 MB na Paulista) para nada. `rede_alimentador.geom` fica nulo; a linha do alimentador continua carregando carga, GD e risco. | 18,9 MB evitados |
| **Subestação entra por `ST_PointOnSurface`** | A camada `SUB` é **MultiPolygon** e `rede_subestacao.geom` é `geometry(Point,4326)`. A tela só usa o ponto. | 139 pontos |
| **`CTMT.TEN_NOM` é código, não kV — fica nulo** | A coluna tem só quatro valores na Piratininga (46, 63, 49, 37): são códigos de domínio da BDGD, e o `.gdb` não traz a tabela que os traduz (só a camada `BASE`, que é o período da data-base). Gravar `63` em `tensao_kv` seria inventar uma subestação de 63 kV onde há um alimentador de distribuição. Como `rede_no_mapa` devolve o alimentador apenas como **código**, ninguém usa essa tensão: fica nula até alguém precisar e trazer a tabela do Manual de Instruções da BDGD. | 4 códigos distintos |
| **Fator de forma, não valor absoluto** | A carga mínima diurna sai de `(energia média mensal → kW médio) × (mínimo na janela ÷ média diária)`. Usar a **forma** da curva torna o resultado independente de como a ANEEL normaliza `POT_xx`. | fator de 0,000 a 1,573 |
| **Mínimo diurno zero é dado correto** | `IP-Tipo1` (iluminação pública) e `SP-Tipo10` têm mínimo zero ao meio-dia — fisicamente certo. São 0,14% das UCs. Um trafo que só alimente iluminação pública cai em `carga <= 0` e a regra já o manda para `sem_dado`, nunca `folga`. | 2 de 68 tipologias |

**Volume de disco:** zip 0,41 GB → extraído 2,2 GB (**5,3×**) na Piratininga. A Paulista tem 1,22 GB de zip, logo ~6,5 GB extraídos. Rodando o próprio `cabeNoDisco` contra os tamanhos reais da ANEEL (13/10/2026): a Piratininga exige **3,4 GB livres** e a Paulista **10,0 GB** — não os ~8 GB que a estimativa a olho dava.

**Camadas e campos:** tabela completa na §9.1 da spec. Não os deduza; leia de lá.

---

## Task 1: Staging e a RPC que promove numa transação

**Files:**
- Create: `supabase/migrations/20261013120000_rede_staging.sql`

**Interfaces:**
- Consumes: `rede_distribuidora`, `rede_subestacao`, `rede_alimentador`, `rede_transformador`, `rede_importacao` (Fase A); `engineering_rules` grupo `grid_capacity`.
- Produces: tabelas `rede_stg_subestacao`, `rede_stg_alimentador`, `rede_stg_transformador`; RPCs `public.rede_importacao_promover(p_importacao_id bigint) → jsonb` e `public.rede_janela_geracao() → table(inicio int, fim int)`.

- [ ] **Step 1: Escrever a migração**

```sql
-- Staging da ingestão da BDGD e a promoção transacional.
--
-- Por que staging: o worker empurra ~54 mil linhas em lotes por PostgREST, e
-- cada lote é uma requisição independente. Se a promoção fosse lote a lote, um
-- erro no meio deixaria o mapa meio-carregado. Aqui os lotes caem em staging
-- (que ninguém lê) e UMA função promove tudo — função é transação.

CREATE TABLE public.rede_stg_subestacao (
  importacao_id BIGINT NOT NULL REFERENCES public.rede_importacao(id) ON DELETE CASCADE,
  codigo        TEXT NOT NULL,
  nome          TEXT,
  lng           DOUBLE PRECISION,
  lat           DOUBLE PRECISION
);

CREATE TABLE public.rede_stg_alimentador (
  importacao_id       BIGINT NOT NULL REFERENCES public.rede_importacao(id) ON DELETE CASCADE,
  codigo              TEXT NOT NULL,
  subestacao_codigo   TEXT,
  tensao_kv           NUMERIC(8,2),
  carga_min_diurna_kw NUMERIC(12,2),
  gd_conectada_kw     NUMERIC(12,2)
);

CREATE TABLE public.rede_stg_transformador (
  importacao_id        BIGINT NOT NULL REFERENCES public.rede_importacao(id) ON DELETE CASCADE,
  codigo               TEXT NOT NULL,
  alimentador_codigo   TEXT,
  potencia_nominal_kva NUMERIC(10,2),
  fases                SMALLINT,
  tensao_secundaria_v  NUMERIC(8,1),
  carga_min_diurna_kw  NUMERIC(12,2),
  gd_conectada_kw      NUMERIC(12,2),
  lng                  DOUBLE PRECISION,
  lat                  DOUBLE PRECISION
);

CREATE INDEX rede_stg_sub_imp_idx   ON public.rede_stg_subestacao   (importacao_id);
CREATE INDEX rede_stg_alim_imp_idx  ON public.rede_stg_alimentador   (importacao_id);
CREATE INDEX rede_stg_trafo_imp_idx ON public.rede_stg_transformador (importacao_id);

-- RLS: staging é interno da ingestão. Nenhuma política, nem de leitura.
-- Só service role (que não passa por RLS) escreve aqui.
ALTER TABLE public.rede_stg_subestacao   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rede_stg_alimentador  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rede_stg_transformador ENABLE ROW LEVEL SECURITY;

-- A janela de geração vem das regras, não de constante no código (ADR 0007).
-- `rede_regras()` já devolve fator e limiares; faltava a janela.
CREATE OR REPLACE FUNCTION public.rede_janela_geracao()
RETURNS TABLE(inicio INTEGER, fim INTEGER)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $fn$
  SELECT COALESCE(MAX(value_default) FILTER (WHERE rule_key='generation_window_start' AND enabled),  9)::INT,
         COALESCE(MAX(value_default) FILTER (WHERE rule_key='generation_window_end'   AND enabled), 15)::INT
    FROM public.engineering_rules e
    JOIN public.tenants t ON t.id = e.tenant_id AND t.is_library
   WHERE e.group_key = 'grid_capacity';
$fn$;

-- Promoção. Uma função, logo uma transação: o mapa nunca fica meio-carregado.
CREATE OR REPLACE FUNCTION public.rede_importacao_promover(p_importacao_id BIGINT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','pg_temp' AS $fn$
DECLARE d BIGINT; n_sub INT; n_alim INT; n_trafo INT; n_inativo INT;
BEGIN
  IF auth.role() <> 'service_role' AND NOT public.is_master(auth.uid()) THEN
    RAISE EXCEPTION 'So master ou service role promove uma importacao';
  END IF;

  SELECT distribuidora_id INTO d FROM public.rede_importacao WHERE id = p_importacao_id;
  IF d IS NULL THEN
    RAISE EXCEPTION 'Importacao % nao existe', p_importacao_id;
  END IF;

  INSERT INTO public.rede_subestacao (distribuidora_id, codigo, nome, geom, ativo, atualizado_em)
  SELECT d, s.codigo, s.nome, ST_SetSRID(ST_MakePoint(s.lng, s.lat), 4326), TRUE, now()
    FROM public.rede_stg_subestacao s WHERE s.importacao_id = p_importacao_id
  ON CONFLICT (distribuidora_id, codigo) DO UPDATE
    SET nome = EXCLUDED.nome, geom = EXCLUDED.geom,
        ativo = TRUE, atualizado_em = now();
  GET DIAGNOSTICS n_sub = ROW_COUNT;

  INSERT INTO public.rede_alimentador
    (distribuidora_id, subestacao_id, codigo, tensao_kv,
     carga_min_diurna_kw, gd_conectada_kw, ativo, atualizado_em)
  SELECT d, se.id, a.codigo, a.tensao_kv,
         a.carga_min_diurna_kw, a.gd_conectada_kw, TRUE, now()
    FROM public.rede_stg_alimentador a
    LEFT JOIN public.rede_subestacao se
           ON se.distribuidora_id = d AND se.codigo = a.subestacao_codigo
   WHERE a.importacao_id = p_importacao_id
  ON CONFLICT (distribuidora_id, codigo) DO UPDATE
    SET subestacao_id = EXCLUDED.subestacao_id, tensao_kv = EXCLUDED.tensao_kv,
        carga_min_diurna_kw = EXCLUDED.carga_min_diurna_kw,
        gd_conectada_kw = EXCLUDED.gd_conectada_kw,
        ativo = TRUE, atualizado_em = now();
  GET DIAGNOSTICS n_alim = ROW_COUNT;

  INSERT INTO public.rede_transformador
    (distribuidora_id, alimentador_id, codigo, potencia_nominal_kva, fases,
     tensao_secundaria_v, carga_min_diurna_kw, gd_conectada_kw, geom, ativo, atualizado_em)
  SELECT d, al.id, t.codigo, t.potencia_nominal_kva, t.fases,
         t.tensao_secundaria_v, t.carga_min_diurna_kw, t.gd_conectada_kw,
         ST_SetSRID(ST_MakePoint(t.lng, t.lat), 4326), TRUE, now()
    FROM public.rede_stg_transformador t
    LEFT JOIN public.rede_alimentador al
           ON al.distribuidora_id = d AND al.codigo = t.alimentador_codigo
   WHERE t.importacao_id = p_importacao_id
  ON CONFLICT (distribuidora_id, codigo) DO UPDATE
    SET alimentador_id = EXCLUDED.alimentador_id,
        potencia_nominal_kva = EXCLUDED.potencia_nominal_kva,
        fases = EXCLUDED.fases, tensao_secundaria_v = EXCLUDED.tensao_secundaria_v,
        carga_min_diurna_kw = EXCLUDED.carga_min_diurna_kw,
        gd_conectada_kw = EXCLUDED.gd_conectada_kw,
        geom = EXCLUDED.geom, ativo = TRUE, atualizado_em = now();
  GET DIAGNOSTICS n_trafo = ROW_COUNT;

  -- O que nao veio nesta importacao sai do ar, mas NAO e apagado.
  UPDATE public.rede_transformador t SET ativo = FALSE, atualizado_em = now()
   WHERE t.distribuidora_id = d AND t.ativo
     AND NOT EXISTS (SELECT 1 FROM public.rede_stg_transformador s
                      WHERE s.importacao_id = p_importacao_id AND s.codigo = t.codigo);
  GET DIAGNOSTICS n_inativo = ROW_COUNT;

  DELETE FROM public.rede_stg_transformador WHERE importacao_id = p_importacao_id;
  DELETE FROM public.rede_stg_alimentador   WHERE importacao_id = p_importacao_id;
  DELETE FROM public.rede_stg_subestacao    WHERE importacao_id = p_importacao_id;

  UPDATE public.rede_importacao
     SET situacao = 'concluida', concluido_em = now(), etapa = 'promovida',
         linhas_por_camada = jsonb_build_object(
           'subestacao', n_sub, 'alimentador', n_alim, 'transformador', n_trafo)
   WHERE id = p_importacao_id;

  RETURN jsonb_build_object('subestacao', n_sub, 'alimentador', n_alim,
                            'transformador', n_trafo, 'inativados', n_inativo);
END $fn$;

-- Permissões: varra TODO objeto novo, não só os que você lembra (lição de
-- 13/10/2026 — ver §9 da spec). O Supabase concede EXECUTE a anon/authenticated
-- NOMINALMENTE, então revogar do PUBLIC não basta.
REVOKE ALL ON FUNCTION public.rede_janela_geracao()                   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rede_importacao_promover(BIGINT)        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.rede_stg_subestacao, public.rede_stg_alimentador,
              public.rede_stg_transformador FROM anon, authenticated;
```

> **Desvio aplicado em 13/10/2026, durante a execução.** A promoção estava
> escrita como UMA função monolítica que terminava apagando o staging. Duas
> mudanças, pelo mesmo motivo que moldou o cálculo da Fase A:
>
> 1. **Decomposta** em `rede_promover_sub`, `rede_promover_alim`,
>    `rede_promover_trafo`, `rede_promover_inativar` e o orquestrador
>    `rede_importacao_promover` — cada peça verificável sozinha, e o servidor
>    MCP engasga com statement longo.
> 2. **A faxina do staging saiu da função.** O servidor MCP barra `DELETE` em
>    corpo de função (timeout de 60 s, duas tentativas, função não criada), e
>    contornar o portão não era opção. Mas a mudança é boa por si: a invariante
>    é "o mapa nunca meio-carregado", garantida pelo upsert. Apagar staging é
>    faxina — vai no worker, depois da promoção, pelo PostgREST. Se o worker
>    morrer antes, as linhas ficam órfãs e inofensivas, e o
>    `ON DELETE CASCADE` as leva quando a importação for removida.
>
> O arquivo `supabase/migrations/20261013120000_rede_staging.sql` tem a versão
> aplicada; o bloco acima ficou como estava escrito, para o desvio ficar
> visível em vez de reescrito por cima.

- [ ] **Step 2: Aplicar**

O servidor MCP do Supabase engasga com statement longo e **barra statement destrutivo** (todo `DROP` dá timeout de 60 s). Aplique em pedaços pequenos: as três tabelas, depois os índices e RLS, depois cada função, depois as permissões.

- [ ] **Step 3: Verificar que a porta está fechada**

```sql
select c.relname,
       has_table_privilege('anon', c.oid, 'SELECT') as anon_sel,
       has_table_privilege('authenticated', c.oid, 'SELECT') as auth_sel
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relname like 'rede\_stg\_%';

select p.proname,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_exec
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('rede_janela_geracao', 'rede_importacao_promover');
```

Esperado: **`false` nas quatro colunas, em todas as linhas.** Qualquer `true` é a mesma brecha de 13/10/2026 reaberta.

- [ ] **Step 4: Verificar a janela**

```sql
select * from public.rede_janela_geracao();
```

Esperado: `inicio = 9`, `fim = 15` (os defaults do grupo 13).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261013120000_rede_staging.sql
git commit -m "feat(banco): staging da BDGD e promocao transacional"
```

---

## Task 2: O fator de forma da curva de carga

**Files:**
- Create: `worker/ludmilla/src/bdgd/curvas.ts`
- Test: `worker/ludmilla/test/curvas.test.ts`

**Interfaces:**
- Consumes: nada (função pura).
- Produces: `export interface Curva { codId: string; tipDia: string; pot: number[] }`; `export function fatorDeForma(pot: number[], horaInicio: number, horaFim: number): number | null`; `export function gerarCaseSql(curvas: Curva[], horaInicio: number, horaFim: number): string`.

Esta é a peça que substituiu o `JOIN` proibido. É pura, então é onde o TDD paga.

- [ ] **Step 1: Escrever os testes que falham**

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fatorDeForma, gerarCaseSql } from '../src/bdgd/curvas.js';

/** 96 quartos de hora, todos iguais: mínimo diurno = média, fator 1. */
const PLANA = Array.from({ length: 96 }, () => 4);

test('curva plana tem fator 1', () => {
  assert.equal(fatorDeForma(PLANA, 9, 15), 1);
});

test('a janela e [inicio, fim) em quartos de hora', () => {
  // POT_01 = 00:00-00:15, logo a hora h comeca no indice h*4. Afirmamos a
  // FRONTEIRA, nao um numero: baixar um quarto de hora tambem baixa a media,
  // entao a constante exata nao e o que este teste quer provar.
  const dentro = [...PLANA];
  dentro[36] = 1;         // 09:00 — o primeiro quarto DA janela
  const f = fatorDeForma(dentro, 9, 15);
  assert.ok(f !== null && f < 0.3, `09:00 tem de contar; veio ${f}`);

  const fora = [...PLANA];
  fora[60] = 1;           // 15:00 — o primeiro quarto FORA da janela
  // Nao puxa o fator para baixo. (Fica um fio ACIMA de 1, porque o vale das
  // 15:00 baixa a media sem baixar o minimo da janela — e exatamente o que
  // "fora da janela" significa.)
  assert.ok((fatorDeForma(fora, 9, 15) ?? 0) >= 1, '15:00 nao pode contar');

  const ultimo = [...PLANA];
  ultimo[59] = 1;         // 14:45 — ainda dentro
  assert.ok((fatorDeForma(ultimo, 9, 15) ?? 1) < 0.3, '14:45 tem de contar');
});

test('minimo diurno zero devolve zero, nao nulo', () => {
  // Iluminacao publica: zero ao meio-dia e dado correto, nao defeito.
  const v = [...PLANA];
  v[40] = 0;
  assert.equal(fatorDeForma(v, 9, 15), 0);
});

test('curva sem energia nenhuma devolve null', () => {
  assert.equal(fatorDeForma(Array.from({ length: 96 }, () => 0), 9, 15), null);
});

test('curva com tamanho errado devolve null', () => {
  assert.equal(fatorDeForma([1, 2, 3], 9, 15), null);
});

test('fator pode passar de 1 em carga comercial', () => {
  // Noite muito baixa puxa a media para baixo: o minimo diurno a supera.
  const v = Array.from({ length: 96 }, (_, i) => (i >= 36 && i < 60 ? 10 : 1));
  const f = fatorDeForma(v, 9, 15);
  assert.ok(f !== null && f > 1, `esperava > 1, veio ${f}`);
});

test('o CASE sai com um ramo por tipologia e so do dia util', () => {
  const sql = gerarCaseSql([
    { codId: 'RES-Tipo2', tipDia: 'DU', pot: PLANA },
    { codId: 'RES-Tipo2', tipDia: 'SA', pot: PLANA },
    { codId: 'IP-Tipo1',  tipDia: 'DU', pot: PLANA },
  ], 9, 15);
  assert.equal((sql.match(/WHEN/g) ?? []).length, 2);
  assert.ok(sql.includes("WHEN 'RES-Tipo2' THEN"));
  assert.ok(sql.startsWith('CASE u.TIP_CC '));
  assert.ok(sql.endsWith(' ELSE NULL END'));
});

test('o CASE escapa apostrofo no codigo da tipologia', () => {
  const sql = gerarCaseSql([{ codId: "O'REILLY", tipDia: 'DU', pot: PLANA }], 9, 15);
  assert.ok(sql.includes("WHEN 'O''REILLY' THEN"), sql);
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
cd worker/ludmilla && rm -rf dist-test && npm test 2>&1 | tail -6
```

Esperado: falha de compilação — `Cannot find module '../src/bdgd/curvas.js'`.

- [ ] **Step 3: Implementar**

```typescript
/**
 * O fator de forma da curva de carga, e o `CASE` que ele gera.
 *
 * POR QUE EXISTE: a BDGD liga cada unidade consumidora a uma das 68 tipologias
 * de `CRVCRG`, que traz 96 valores de quarto de hora por tipo de dia. O jeito
 * óbvio de usar isso seria `JOIN UCBT_tab × CRVCRG` no dialeto SQLite do
 * ogr2ogr — e ele é inviável: laço aninhado de 2 milhões × 68 com 120 colunas
 * de aritmética por linha, abortado depois de 11 minutos sem uma linha de
 * saída. Pré-calcular os 68 fatores aqui e gerar um `CASE` dá o MESMO
 * resultado em 12,5 s (medido em 13/10/2026, CPFL Piratininga).
 *
 * POR QUE A *FORMA* E NÃO O VALOR: devolvemos `mínimo na janela ÷ média
 * diária`, não o mínimo em si. Assim o resultado não depende de como a ANEEL
 * normaliza `POT_xx` — a razão é adimensional.
 */

export interface Curva {
  codId: string;
  tipDia: string;
  pot: number[];
}

/**
 * `null` quando a curva não serve (tamanho errado, ou soma não positiva).
 * `0` é resposta legítima: iluminação pública é zero ao meio-dia de verdade.
 * A janela é `[horaInicio, horaFim)` — 15h fica FORA, porque POT_01 cobre
 * 00:00-00:15 e a hora `h` começa no índice `h * 4`.
 */
export function fatorDeForma(pot: number[], horaInicio: number, horaFim: number): number | null {
  if (pot.length !== 96 || pot.some(v => !Number.isFinite(v))) return null;
  const soma = pot.reduce((a, b) => a + b, 0);
  if (soma <= 0) return null;
  const janela = pot.slice(horaInicio * 4, horaFim * 4);
  if (janela.length === 0) return null;
  return Math.min(...janela) / (soma / 96);
}

/** Dia útil é o que interessa: é o pior caso de carga baixa com sol. */
export function gerarCaseSql(curvas: Curva[], horaInicio: number, horaFim: number): string {
  const ramos: string[] = [];
  for (const c of curvas) {
    if (c.tipDia !== 'DU') continue;
    const f = fatorDeForma(c.pot, horaInicio, horaFim);
    if (f === null) continue;
    ramos.push(`WHEN '${c.codId.replace(/'/g, "''")}' THEN ${f.toFixed(6)}`);
  }
  return `CASE u.TIP_CC ${ramos.join(' ')} ELSE NULL END`;
}
```

- [ ] **Step 4: Rodar e ver passar**

```bash
cd worker/ludmilla && rm -rf dist-test && npm test 2>&1 | tail -6
```

Esperado: **88 testes, 64 passando, 24 falhando** (os 8 novos passam; os 24 pré-existentes seguem falhando).

- [ ] **Step 5: Commit**

```bash
git add worker/ludmilla/src/bdgd/curvas.ts worker/ludmilla/test/curvas.test.ts
git commit -m "feat(bdgd): fator de forma da curva de carga e o CASE gerado"
```

---

## Task 3: Catálogo e download com guard-rail de disco

**Files:**
- Create: `worker/ludmilla/src/bdgd/catalogo.ts`
- Test: `worker/ludmilla/test/catalogo.test.ts`

**Interfaces:**
- Consumes: `lerDisco` de `../disco.js` (`{ totalBytes, usadoBytes, livreBytes, ocupacaoPct }`).
- Produces: `export interface ItemBdgd { id: string; titulo: string; sigla: string; codigoAneel: string; dataBase: string; bytesZip: number }`; `export function interpretarTitulo(titulo: string): Omit<ItemBdgd,'id'|'bytesZip'> | null`; `export function cabeNoDisco(livreBytes: number, bytesZip: number): { cabe: boolean; precisaBytes: number }`; `export async function acharItem(sigla: string): Promise<ItemBdgd>`; `export async function baixarEExtrair(item: ItemBdgd, dir: string): Promise<string>`.

- [ ] **Step 1: Escrever os testes que falham**

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { interpretarTitulo, cabeNoDisco } from '../src/bdgd/catalogo.js';

const GB = 1024 ** 3;

test('o titulo do item da ANEEL carrega sigla, codigo e data-base', () => {
  const r = interpretarTitulo('CPFL_Piratininga_2937_2025-12-31_V11_20260823-1826');
  assert.deepEqual(r, {
    titulo: 'CPFL_Piratininga_2937_2025-12-31_V11_20260823-1826',
    sigla: 'CPFL_Piratininga',
    codigoAneel: '2937',
    dataBase: '2025-12-31',
  });
});

test('nome com mais partes ainda e lido', () => {
  const r = interpretarTitulo('Energisa_Minas_Rio_6585_2025-12-31_V11_20260824-0939');
  assert.equal(r?.sigla, 'Energisa_Minas_Rio');
  assert.equal(r?.codigoAneel, '6585');
  assert.equal(r?.dataBase, '2025-12-31');
});

test('titulo que nao e BDGD devolve null', () => {
  assert.equal(interpretarTitulo('Manual de Instruções da BDGD Rev5'), null);
});

test('o guard-rail pede 5,3x o zip mais 30% de folga', () => {
  // Medido em 13/10/2026: 0,41 GB de zip viraram 2,2 GB extraidos.
  const r = cabeNoDisco(20 * GB, 1 * GB);
  assert.equal(r.cabe, true);
  // 1 GB zip + 5,3 GB extraido = 6,3 GB, x1,3 = 8,19 GB
  assert.ok(r.precisaBytes > 8 * GB && r.precisaBytes < 8.3 * GB,
    `precisaBytes = ${r.precisaBytes / GB} GB`);
});

test('disco apertado reprova antes de baixar', () => {
  const r = cabeNoDisco(4 * GB, 1 * GB);
  assert.equal(r.cabe, false);
});

test('a Paulista nao cabe em 8 GB livres', () => {
  // 1,22 GB de zip -> ~6,5 GB extraido -> precisa ~10 GB
  assert.equal(cabeNoDisco(8 * GB, 1.22 * GB).cabe, false);
  assert.equal(cabeNoDisco(12 * GB, 1.22 * GB).cabe, true);
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
cd worker/ludmilla && rm -rf dist-test && npm test 2>&1 | tail -6
```

Esperado: `Cannot find module '../src/bdgd/catalogo.js'`.

- [ ] **Step 3: Implementar**

```typescript
import { createWriteStream } from 'node:fs';
import { mkdir, rm, readdir } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { lerDisco } from '../disco.js';

const exec = promisify(execFile);

/** A ANEEL publica a BDGD como item "File Geodatabase" no ArcGIS. */
const BUSCA = 'https://www.arcgis.com/sharing/rest/search';
const DADOS = (id: string) => `https://www.arcgis.com/sharing/rest/content/items/${id}/data`;

/** Medido em 13/10/2026: 0,41 GB de zip viraram 2,2 GB extraídos. */
const INFLACAO = 5.3;
const FOLGA = 1.3;

export interface ItemBdgd {
  id: string;
  titulo: string;
  sigla: string;
  codigoAneel: string;
  dataBase: string;
  bytesZip: number;
}

/**
 * `CPFL_Piratininga_2937_2025-12-31_V11_20260823-1826` →
 * sigla `CPFL_Piratininga`, código ANEEL `2937`, data-base `2025-12-31`.
 * A sigla pode ter underscore no meio (`Energisa_Minas_Rio`), então ancoramos
 * no código numérico seguido da data, não na contagem de partes.
 */
export function interpretarTitulo(titulo: string): Omit<ItemBdgd, 'id' | 'bytesZip'> | null {
  const m = /^(.+)_(\d+)_(\d{4}-\d{2}-\d{2})_V\d+_/.exec(titulo);
  if (!m) return null;
  return { titulo, sigla: m[1], codigoAneel: m[2], dataBase: m[3] };
}

/**
 * Zip e extraído coexistem em disco, então o guard-rail soma os dois.
 * Reprovar ANTES de baixar é o ponto: um "no space left on device" no meio da
 * extração deixa lixo de gigabytes e nenhum diagnóstico.
 */
export function cabeNoDisco(livreBytes: number, bytesZip: number): { cabe: boolean; precisaBytes: number } {
  const precisaBytes = Math.ceil((bytesZip + bytesZip * INFLACAO) * FOLGA);
  return { cabe: livreBytes >= precisaBytes, precisaBytes };
}

export async function acharItem(sigla: string): Promise<ItemBdgd> {
  const url = new URL(BUSCA);
  url.searchParams.set('q', `${sigla} BDGD`);
  url.searchParams.set('f', 'json');
  url.searchParams.set('num', '50');
  url.searchParams.set('sortField', 'modified');
  url.searchParams.set('sortOrder', 'desc');

  const r = await fetch(url);
  if (!r.ok) throw new Error(`Busca no ArcGIS falhou: HTTP ${r.status}`);
  const corpo = await r.json() as { results?: { id: string; title: string; type: string }[] };

  const candidatos = (corpo.results ?? [])
    .filter(x => x.type === 'File Geodatabase')
    .map(x => ({ item: x, meta: interpretarTitulo(x.title) }))
    .filter((x): x is { item: { id: string; title: string; type: string }; meta: NonNullable<ReturnType<typeof interpretarTitulo>> } =>
      x.meta !== null && x.meta.sigla.toLowerCase() === sigla.toLowerCase());

  if (candidatos.length === 0) throw new Error(`Nenhuma BDGD encontrada para "${sigla}".`);
  // A mais recente por data-base; o ArcGIS já devolveu ordenado por modified.
  candidatos.sort((a, b) => b.meta.dataBase.localeCompare(a.meta.dataBase));
  const { item, meta } = candidatos[0];

  // O tamanho não vem na busca; o HEAD do download traz.
  const h = await fetch(DADOS(item.id), { method: 'HEAD', redirect: 'follow' });
  const bytesZip = Number(h.headers.get('content-length') ?? 0);
  if (!bytesZip) throw new Error(`Nao consegui medir o zip de ${item.title} antes de baixar.`);

  return { id: item.id, bytesZip, ...meta };
}

/** Devolve o caminho do `.gdb` extraído. Derruba o zip depois de extrair. */
export async function baixarEExtrair(item: ItemBdgd, dir: string): Promise<string> {
  const disco = await lerDisco('/');
  const g = cabeNoDisco(disco.livreBytes, item.bytesZip);
  if (!g.cabe) {
    throw new Error(
      `Disco insuficiente para ${item.sigla}: livre ${(disco.livreBytes / 1024 ** 3).toFixed(1)} GB, ` +
      `preciso de ${(g.precisaBytes / 1024 ** 3).toFixed(1)} GB (zip + extraido + folga).`);
  }

  await mkdir(dir, { recursive: true });
  const zip = join(dir, `${item.sigla}.zip`);

  const r = await fetch(DADOS(item.id), { redirect: 'follow' });
  if (!r.ok || !r.body) throw new Error(`Download de ${item.titulo} falhou: HTTP ${r.status}`);
  await pipeline(Readable.fromWeb(r.body as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(zip));

  await exec('unzip', ['-q', '-o', zip, '-d', dir], { maxBuffer: 1 << 24 });
  await rm(zip, { force: true });   // o extraído basta; o zip é 5,3x menor mas ainda é 1 GB

  const achados = (await readdir(dir)).filter(n => n.endsWith('.gdb'));
  if (achados.length !== 1) {
    throw new Error(`Esperava um .gdb em ${dir}, achei ${achados.length}: ${achados.join(', ')}`);
  }
  return join(dir, achados[0]);
}
```

- [ ] **Step 4: Rodar e ver passar**

```bash
cd worker/ludmilla && rm -rf dist-test && npm test 2>&1 | tail -6
```

Esperado: **94 testes, 70 passando, 24 falhando.**

- [ ] **Step 5: Provar contra a ANEEL de verdade**

```bash
cd worker/ludmilla && npm run build && node -e "
import('./dist/bdgd/catalogo.js').then(async m => {
  const i = await m.acharItem('CPFL_Piratininga');
  console.log(i.sigla, i.dataBase, (i.bytesZip/1024**3).toFixed(2), 'GB');
  console.log(m.cabeNoDisco(30*1024**3, i.bytesZip));
});
"
```

Esperado, medido em 13/10/2026:

```
CPFL_Piratininga   cod 2937  base 2025-12-31 0.41 GB | precisa 3.4 GB  | cabe true
CPFL_Paulista      cod 63    base 2025-12-31 1.22 GB | precisa 10.0 GB | cabe true
Paulista em 8 GB livres : false
Paulista em 12 GB livres: true
```

No container de desenvolvimento, prefixe com `NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt` (ver Global Constraints).

- [ ] **Step 6: Commit**

```bash
git add worker/ludmilla/src/bdgd/catalogo.ts worker/ludmilla/test/catalogo.test.ts
git commit -m "feat(bdgd): catalogo da ANEEL e download com guard-rail de disco"
```

---

## Task 4: Extração com ogr2ogr

**Files:**
- Create: `worker/ludmilla/src/bdgd/extrair.ts`
- Test: `worker/ludmilla/test/extrair.test.ts`

**Interfaces:**
- Consumes: `gerarCaseSql`, `Curva` de `./curvas.js`.
- Produces: `export async function lerCurvas(gdb: string): Promise<Curva[]>`; `export function sqlCargaPorTrafo(caseSql: string, camada: 'UCBT_tab' | 'UCMT_tab'): string`; `export function sqlGdPorTrafo(camada: 'UGBT_tab' | 'UGMT_tab'): string`; `export async function extrair(gdb: string, dir: string, janela: { inicio: number; fim: number }): Promise<{ trafos: string; carga: string; gd: string; alimentadores: string; cargaAlim: string; gdAlim: string; subestacoes: string }>` (caminhos dos CSVs).

Todos os comandos abaixo foram **rodados** na Piratininga em 13/10/2026, com o tempo medido. Não os reescreva de cabeça.

- [ ] **Step 1: Escrever os testes que falham**

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sqlCargaPorTrafo, sqlGdPorTrafo } from '../src/bdgd/extrair.js';

test('a carga agrupa por trafo e usa o CASE, sem JOIN', () => {
  const sql = sqlCargaPorTrafo("CASE u.TIP_CC WHEN 'X' THEN 0.5 ELSE NULL END", 'UCBT_tab');
  assert.ok(sql.includes('GROUP BY u.UNI_TR_MT'));
  assert.ok(sql.includes('FROM UCBT_tab u'));
  assert.ok(sql.includes("CASE u.TIP_CC WHEN 'X' THEN 0.5"));
  // O JOIN entre camadas levou 11 min sem saida; nao pode voltar.
  assert.ok(!/\bJOIN\b/i.test(sql), 'o SQL da carga nao pode ter JOIN');
});

test('a carga descarta UC sem trafo', () => {
  const sql = sqlCargaPorTrafo('CASE u.TIP_CC ELSE NULL END', 'UCBT_tab');
  assert.ok(sql.includes("u.UNI_TR_MT <> ''"));
});

test('a GD soma a potencia instalada por trafo', () => {
  const sql = sqlGdPorTrafo('UGBT_tab');
  assert.ok(sql.includes('sum(POT_INST)'));
  assert.ok(sql.includes('GROUP BY UNI_TR_MT'));
  assert.ok(sql.includes('FROM UGBT_tab'));
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
cd worker/ludmilla && rm -rf dist-test && npm test 2>&1 | tail -6
```

- [ ] **Step 3: Implementar**

```typescript
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { gerarCaseSql, type Curva } from './curvas.js';

const exec = promisify(execFile);

/**
 * Extração das camadas da BDGD com `ogr2ogr`, dialeto SQLite.
 *
 * REGRA QUE NÃO SE NEGOCIA: nada de `JOIN` entre camadas. O
 * `JOIN UCBT_tab × CRVCRG` foi abortado depois de 11 minutos sem uma linha de
 * saída (laço aninhado de 2 milhões × 68). O `CASE` gerado em `curvas.ts` faz
 * o mesmo em 12,5 s. Ver "Decisões medidas" no plano.
 *
 * A coluna de geometria do FileGDB chama-se `Shape` (não `geometry`), e vem
 * já em graus — EPSG:4326, sem reprojeção.
 */

const soma12 = (p: string) =>
  Array.from({ length: 12 }, (_, i) => `${p}.ENE_${String(i + 1).padStart(2, '0')}`).join('+');

export function sqlCargaPorTrafo(caseSql: string, camada: 'UCBT_tab' | 'UCMT_tab'): string {
  // kWh/mes -> kW medio: energia media mensal / (30,4 dias x 24 h).
  // Depois, x fator de forma = minimo na janela de geracao.
  return `SELECT u.UNI_TR_MT AS trafo, count(*) AS ucs,
       sum( ((${soma12('u')})/12.0) / (30.4*24.0) * (${caseSql}) ) AS carga_min_diurna_kw
  FROM ${camada} u
 WHERE u.UNI_TR_MT <> ''
 GROUP BY u.UNI_TR_MT`;
}

export function sqlGdPorTrafo(camada: 'UGBT_tab' | 'UGMT_tab'): string {
  return `SELECT UNI_TR_MT AS trafo, count(*) AS unidades, sum(POT_INST) AS gd_kw
  FROM ${camada}
 WHERE UNI_TR_MT <> ''
 GROUP BY UNI_TR_MT`;
}

async function paraCsv(gdb: string, destino: string, sql: string, comGeom = false): Promise<string> {
  const args = ['-f', 'CSV', destino, gdb, '-dialect', 'SQLITE', '-sql', sql,
                '-lco', 'SEPARATOR=COMMA'];
  if (comGeom) args.push('-lco', 'GEOMETRY=AS_WKT');
  await exec('ogr2ogr', args, { maxBuffer: 1 << 26 });
  return destino;
}

/** As 68 tipologias: 204 linhas, leitura instantânea. */
export async function lerCurvas(gdb: string): Promise<Curva[]> {
  const tmp = `${gdb}.curvas.csv`;
  await paraCsv(gdb, tmp, 'SELECT * FROM CRVCRG');
  const texto = await readFile(tmp, 'utf8');
  const [cab, ...linhas] = texto.trim().split('\n');
  const cols = cab.split(',');
  const idx = (n: string) => cols.indexOf(n);
  const iCod = idx('COD_ID'), iDia = idx('TIP_DIA');
  const iPot = Array.from({ length: 96 }, (_, i) => idx(`POT_${String(i + 1).padStart(2, '0')}`));

  return linhas.map(l => {
    const c = l.split(',');
    return {
      codId: c[iCod]?.replace(/^"|"$/g, '') ?? '',
      tipDia: c[iDia]?.replace(/^"|"$/g, '') ?? '',
      pot: iPot.map(i => Number(c[i])),
    };
  }).filter(c => c.codId !== '');
}

export async function extrair(
  gdb: string, dir: string, janela: { inicio: number; fim: number },
): Promise<{ trafos: string; carga: string; gd: string; alimentadores: string;
             cargaAlim: string; gdAlim: string; subestacoes: string }> {
  await mkdir(dir, { recursive: true });
  const caseSql = gerarCaseSql(await lerCurvas(gdb), janela.inicio, janela.fim);

  // 0,46 s na Piratininga (52.976 pontos).
  const trafos = await paraCsv(gdb, join(dir, 'trafos.csv'),
    `SELECT COD_ID, POT_NOM, CTMT, SUB, FAS_CON_P, FAS_CON_S, TEN_LIN_SE, SIT_ATIV
       FROM UNTRMT`, true);

  // 12,5 s na Piratininga (2.037.215 UCs -> 49.378 trafos).
  const carga = await paraCsv(gdb, join(dir, 'carga.csv'), sqlCargaPorTrafo(caseSql, 'UCBT_tab'));

  // 0,37 s (49.771 unidades geradoras -> 19.643 trafos, 267,9 MW).
  const gd = await paraCsv(gdb, join(dir, 'gd.csv'), sqlGdPorTrafo('UGBT_tab'));

  // TEN_NOM e codigo de dominio (46/63/49/37), nao kV: nao vem, para ninguem
  // ser tentado a converter. Ver "Decisoes medidas".
  const alimentadores = await paraCsv(gdb, join(dir, 'alimentadores.csv'),
    `SELECT COD_ID, NOME, SUB FROM CTMT`);

  // Carga e GD por ALIMENTADOR: 0,3 s cada, e sem elas
  // `rede_aplicar_alimentadores` e letra morta — todo alimentador ficaria
  // `sem_dado` para sempre. Mesma agregacao dos trafos, agrupando por CTMT.
  const cargaAlim = await paraCsv(gdb, join(dir, 'carga-alim.csv'),
    `SELECT u.CTMT AS alimentador,
            sum( ((${soma12('u')})/12.0) / (30.4*24.0) * (${caseSql}) ) AS carga_min_diurna_kw
       FROM UCBT_tab u WHERE u.CTMT <> '' GROUP BY u.CTMT`);
  const gdAlim = await paraCsv(gdb, join(dir, 'gd-alim.csv'),
    `SELECT CTMT AS alimentador, sum(POT_INST) AS gd_kw
       FROM UGBT_tab WHERE CTMT <> '' GROUP BY CTMT`);

  // SUB e MultiPolygon e rede_subestacao.geom e Point: ponto na superficie.
  const subestacoes = await paraCsv(gdb, join(dir, 'subestacoes.csv'),
    `SELECT COD_ID, NOME, ST_X(ST_PointOnSurface(SHAPE)) AS lng,
            ST_Y(ST_PointOnSurface(SHAPE)) AS lat FROM SUB`);

  return { trafos, carga, gd, alimentadores, cargaAlim, gdAlim, subestacoes };
}
```

- [ ] **Step 4: Rodar e ver passar**

```bash
cd worker/ludmilla && rm -rf dist-test && npm test 2>&1 | tail -6
```

Esperado: **97 testes, 73 passando, 24 falhando.**

- [ ] **Step 5: Rodar contra o `.gdb` de verdade e cronometrar**

```bash
cd worker/ludmilla && npm run build && time node -e "
import('./dist/bdgd/extrair.js').then(async m => {
  const r = await m.extrair(process.argv[1], '/tmp/bdgd-saida', { inicio: 9, fim: 15 });
  console.log(r);
});
" "<caminho>/CPFL_Piratininga_2937_2025-12-31_V11_20260823-1826.gdb"
wc -l /tmp/bdgd-saida/*.csv
```

Esperado, conferido em 13/10/2026 — **compare linha por linha, é o teste mais forte deste plano**:

| arquivo | linhas (+1 de cabeçalho) |
|---|---|
| `trafos.csv` | 52.976 (dos quais **52.971** com `SIT_ATIV = 'AT'`, e só esses sobem) |
| `carga.csv` | 49.378 |
| `gd.csv` | 19.643 |
| `alimentadores.csv` | 553 |
| `subestacoes.csv` | 139 |
| `carga-alim.csv` | **474** |
| `gd-alim.csv` | **440** |

Os dois últimos são menores que os 553 alimentadores de propósito: **79 alimentadores não têm nenhuma UC de baixa tensão** e 113 não têm GD. `rede_aplicar_alimentadores` manda esses para `sem_dado`, que é a resposta correta — não é perda de linha.

Tempo total esperado: **menos de 20 s**. Se passar de um minuto, um `JOIN` voltou para o SQL.

- [ ] **Step 6: Commit**

```bash
git add worker/ludmilla/src/bdgd/extrair.ts worker/ludmilla/test/extrair.test.ts
git commit -m "feat(bdgd): extracao das camadas com ogr2ogr, sem JOIN entre camadas"
```

---

## Task 5: Juntar os CSVs e carregar o staging

**Files:**
- Create: `worker/ludmilla/src/bdgd/carregar.ts`
- Test: `worker/ludmilla/test/carregar.test.ts`

**Interfaces:**
- Consumes: os cinco CSVs da Task 4; `supabase()` de `../fila.js`.
- Produces: `export interface LinhaTrafo { codigo: string; alimentador_codigo: string | null; potencia_nominal_kva: number | null; fases: number | null; tensao_secundaria_v: number | null; carga_min_diurna_kw: number | null; gd_conectada_kw: number | null; lng: number; lat: number }`; `export function lerCsv(texto: string): Record<string,string>[]`; `export function fasesDe(fasCon: string): number | null`; `export function pontoDeWkt(wkt: string): { lng: number; lat: number } | null`; `export function montarTrafos(...): LinhaTrafo[]`; `export async function enviarEmLotes<T>(tabela: string, linhas: T[], tamanho?: number): Promise<number>`.

- [ ] **Step 1: Escrever os testes que falham**

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lerCsv, fasesDe, pontoDeWkt, montarTrafos } from '../src/bdgd/carregar.js';

test('o CSV do ogr2ogr vem com campo entre aspas e virgula dentro', () => {
  const r = lerCsv('a,b\n"POINT (-47.6 -23.5)","SOROCABA 3, SIMUS"\n');
  assert.deepEqual(r, [{ a: 'POINT (-47.6 -23.5)', b: 'SOROCABA 3, SIMUS' }]);
});

test('o CSV respeita aspas dupla escapada', () => {
  assert.deepEqual(lerCsv('a\n"diz ""oi"""\n'), [{ a: 'diz "oi"' }]);
});

test('as fases saem do numero de condutores de fase, sem o neutro', () => {
  assert.equal(fasesDe('ABC'), 3);
  assert.equal(fasesDe('ABCN'), 3);
  assert.equal(fasesDe('AB'), 2);
  assert.equal(fasesDe('AN'), 1);
  assert.equal(fasesDe('A'), 1);
  assert.equal(fasesDe('0'), null);
  assert.equal(fasesDe(''), null);
});

test('o WKT de ponto virа lng/lat', () => {
  assert.deepEqual(pontoDeWkt('POINT (-47.60626405784 -23.5769915617112)'),
    { lng: -47.60626405784, lat: -23.5769915617112 });
  assert.deepEqual(pontoDeWkt('POINT(-47.4 -23.5)'), { lng: -47.4, lat: -23.5 });
  assert.equal(pontoDeWkt(''), null);
  assert.equal(pontoDeWkt('MULTIPOLYGON (((0 0, 1 1, 1 0, 0 0)))'), null);
});

test('monta o trafo juntando carga e GD pelo codigo', () => {
  const r = montarTrafos(
    [{ Shape: 'POINT (-47.6 -23.5)', COD_ID: '1159063', POT_NOM: '75', CTMT: 'SPI14',
       SUB: 'SPI', FAS_CON_P: 'ABC', FAS_CON_S: 'ABCN', TEN_LIN_SE: '0.22', SIT_ATIV: 'AT' }],
    [{ trafo: '1159063', ucs: '42', carga_min_diurna_kw: '11.7072635132107' }],
    [{ trafo: '1159063', unidades: '2', gd_kw: '8.4' }],
  );
  assert.equal(r.length, 1);
  assert.equal(r[0].codigo, '1159063');
  assert.equal(r[0].alimentador_codigo, 'SPI14');
  assert.equal(r[0].potencia_nominal_kva, 75);
  assert.equal(r[0].fases, 3);
  assert.equal(r[0].tensao_secundaria_v, 220);          // 0,22 kV -> 220 V
  assert.equal(r[0].carga_min_diurna_kw, 11.71);        // 2 casas
  assert.equal(r[0].gd_conectada_kw, 8.4);
  assert.deepEqual({ lng: r[0].lng, lat: r[0].lat }, { lng: -47.6, lat: -23.5 });
});

test('trafo sem carga fica NULO, nunca zero', () => {
  // Zero diria "tem carga, e e nenhuma"; nulo diz "nao sei". A regra do
  // semaforo manda os dois para sem_dado, mas o insumo tem de ser honesto.
  const r = montarTrafos(
    [{ Shape: 'POINT (-47.6 -23.5)', COD_ID: 'X', POT_NOM: '75', CTMT: 'A', SUB: 'S',
       FAS_CON_P: 'ABC', FAS_CON_S: 'ABCN', TEN_LIN_SE: '0.22', SIT_ATIV: 'AT' }],
    [], []);
  assert.equal(r[0].carga_min_diurna_kw, null);
  assert.equal(r[0].gd_conectada_kw, 0);   // sem GD e zero de verdade: ninguem conectou
});

const bom = (cod: string) => ({ Shape: 'POINT (-47.6 -23.5)', COD_ID: cod,
  POT_NOM: '75', CTMT: 'A', SUB: 'S', FAS_CON_P: 'ABC', FAS_CON_S: 'ABCN',
  TEN_LIN_SE: '0.22', SIT_ATIV: 'AT' });

test('um trafo sem geometria e descartado, nao aborta a ingestao', () => {
  // Abortar 6,5 GB por uma linha torta e pior que seguir sem ela.
  const entrada = [...Array.from({ length: 200 }, (_, i) => bom(`T${i}`)),
                   { ...bom('SEM_GEOM'), Shape: '' }];
  const r = montarTrafos(entrada, [], []);
  assert.equal(r.length, 200);
  assert.ok(!r.some(x => x.codigo === 'SEM_GEOM'));
});

test('descarte em massa aborta, porque e defeito de dado', () => {
  const entrada = [bom('T1'), { ...bom('A'), Shape: '' }, { ...bom('B'), Shape: '' }];
  assert.throws(() => montarTrafos(entrada, [], []), /sem geometria utilizavel/);
});

test('trafo desativado na BDGD nao entra', () => {
  const r = montarTrafos(
    [{ Shape: 'POINT (-47.6 -23.5)', COD_ID: 'DESL', POT_NOM: '75', CTMT: 'A', SUB: 'S',
       FAS_CON_P: 'ABC', FAS_CON_S: 'ABCN', TEN_LIN_SE: '0.22', SIT_ATIV: 'DS' }],
    [], []);
  assert.equal(r.length, 0);
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
cd worker/ludmilla && rm -rf dist-test && npm test 2>&1 | tail -6
```

- [ ] **Step 3: Implementar**

```typescript
import { supabase } from '../fila.js';

/**
 * Dos CSVs do ogr2ogr para as tabelas de staging.
 *
 * Volume real: ~53 mil trafos, 553 alimentadores, 139 subestações — ~6 MB na
 * Piratininga. É por isso que não há `COPY` nem driver Postgres aqui: os 2
 * milhões de UCs foram agregados pelo ogr2ogr e nunca entram no banco.
 */

export interface LinhaTrafo {
  codigo: string;
  alimentador_codigo: string | null;
  potencia_nominal_kva: number | null;
  fases: number | null;
  tensao_secundaria_v: number | null;
  carga_min_diurna_kw: number | null;
  gd_conectada_kw: number | null;
  lng: number;
  lat: number;
}

/** CSV do ogr2ogr: vírgula, aspas duplas, `""` para aspas literal. */
export function lerCsv(texto: string): Record<string, string>[] {
  const linhas: string[][] = [];
  let campo = '', atual: string[] = [], dentro = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (dentro) {
      if (c === '"') {
        if (texto[i + 1] === '"') { campo += '"'; i++; } else dentro = false;
      } else campo += c;
    } else if (c === '"') dentro = true;
    else if (c === ',') { atual.push(campo); campo = ''; }
    else if (c === '\n') { atual.push(campo); linhas.push(atual); atual = []; campo = ''; }
    else if (c !== '\r') campo += c;
  }
  if (campo !== '' || atual.length > 0) { atual.push(campo); linhas.push(atual); }
  if (linhas.length === 0) return [];
  const [cab, ...resto] = linhas;
  return resto
    .filter(l => l.length === cab.length)
    .map(l => Object.fromEntries(cab.map((k, i) => [k, l[i]])));
}

const num = (v: string | undefined): number | null => {
  if (v === undefined || v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** `ABCN` = três fases mais neutro: o N não conta. */
export function fasesDe(fasCon: string): number | null {
  const n = (fasCon.match(/[ABC]/g) ?? []).length;
  return n >= 1 && n <= 3 ? n : null;
}

export function pontoDeWkt(wkt: string): { lng: number; lat: number } | null {
  const m = /^POINT\s*\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)$/i.exec(wkt.trim());
  return m ? { lng: Number(m[1]), lat: Number(m[2]) } : null;
}

const duasCasas = (n: number | null): number | null =>
  n === null ? null : Math.round(n * 100) / 100;

export function montarTrafos(
  trafos: Record<string, string>[],
  carga: Record<string, string>[],
  gd: Record<string, string>[],
): LinhaTrafo[] {
  const porCarga = new Map(carga.map(c => [c.trafo, num(c.carga_min_diurna_kw)]));
  const porGd = new Map(gd.map(g => [g.trafo, num(g.gd_kw)]));

  const saida: LinhaTrafo[] = [];
  const descartados: string[] = [];
  for (const t of trafos) {
    if (t.SIT_ATIV !== 'AT') continue;          // desativado na BDGD não entra
    const p = pontoDeWkt(t.Shape ?? '');
    if (!p) { descartados.push(t.COD_ID); continue; }
    const tenKv = num(t.TEN_LIN_SE);
    saida.push({
      codigo: t.COD_ID,
      alimentador_codigo: t.CTMT || null,
      potencia_nominal_kva: num(t.POT_NOM),
      fases: fasesDe(t.FAS_CON_P ?? ''),
      tensao_secundaria_v: tenKv === null ? null : duasCasas(tenKv * 1000),
      // nulo = "nao sei"; zero diria "sei que e zero". Sao coisas diferentes.
      carga_min_diurna_kw: duasCasas(porCarga.get(t.COD_ID) ?? null),
      // GD ausente E zero de verdade: ninguem conectou nada neste trafo.
      gd_conectada_kw: duasCasas(porGd.get(t.COD_ID) ?? 0),
      lng: p.lng, lat: p.lat,
    });
  }
  // Abortar 6,5 GB de ingestão por uma linha torta é pior que seguir sem ela.
  // Mas descarte em massa é defeito de dado, e aí parar é o certo: na
  // Piratininga o número real é ZERO (medido em 13/10/2026).
  if (descartados.length > 0) {
    const pct = descartados.length / trafos.length * 100;
    const amostra = descartados.slice(0, 5).join(', ');
    if (pct > 1) {
      throw new Error(
        `${descartados.length} trafos (${pct.toFixed(2)}%) sem geometria utilizavel: ${amostra}...`);
    }
    console.warn(`[bdgd] ${descartados.length} trafos sem geometria, descartados: ${amostra}`);
  }
  return saida;
}

/**
 * Lotes de 2000: ~27 requisições para a Piratininga. Cada `insert` é aguardado,
 * porque `supabase-js` é lazy e um builder sem `await` nunca sai do lugar.
 */
export async function enviarEmLotes<T>(tabela: string, linhas: T[], tamanho = 2000): Promise<number> {
  let enviadas = 0;
  for (let i = 0; i < linhas.length; i += tamanho) {
    const lote = linhas.slice(i, i + tamanho);
    const { error } = await supabase().from(tabela).insert(lote as never);
    if (error) throw new Error(`Lote ${i / tamanho + 1} de ${tabela} falhou: ${error.message}`);
    enviadas += lote.length;
  }
  return enviadas;
}
```

- [ ] **Step 4: Rodar e ver passar**

```bash
cd worker/ludmilla && rm -rf dist-test && npm test 2>&1 | tail -6
```

Esperado: **106 testes, 82 passando, 24 falhando.**

- [ ] **Step 5: Commit**

```bash
git add worker/ludmilla/src/bdgd/carregar.ts worker/ludmilla/test/carregar.test.ts
git commit -m "feat(bdgd): leitura dos CSVs e carga em lotes no staging"
```

---

## Task 6: Orquestração, auditoria e vigilância de disco

**Files:**
- Create: `worker/ludmilla/src/bdgd/index.ts`
- Modify: `worker/ludmilla/package.json` — acrescentar o script `bdgd`

**Interfaces:**
- Consumes: `acharItem`, `baixarEExtrair` (Task 3); `extrair` (Task 4); `lerCsv`, `montarTrafos`, `enviarEmLotes` (Task 5); `supabase`, `reportarDisco` de `../fila.js`; RPCs `rede_janela_geracao`, `rede_importacao_promover`, `grid_capacity_recalcular`, `rede_celula_recalcular`.
- Produces: `export async function ingerir(sigla: string): Promise<void>`; entrada de linha de comando.

- [ ] **Step 1: Implementar**

```typescript
import { rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { supabase, reportarDisco } from '../fila.js';
import { acharItem, baixarEExtrair } from './catalogo.js';
import { extrair } from './extrair.js';
import { lerCsv, montarTrafos, enviarEmLotes } from './carregar.js';

/**
 * Ingestão da BDGD de uma distribuidora, ponta a ponta.
 *
 * Roda FORA do laço da Ludmilla (`npm run bdgd`), porque é um trabalho de
 * minutos que não pode travar o robô dos portais. O disco é reportado em cada
 * etapa com `reportarDisco('ingestao', etapa)` — a função já existe do plano
 * do painel de armazenamento, e o `'ingestao'` já estava previsto nela.
 *
 * A auditoria em `rede_importacao` não é enfeite: é dela que a tela tira o
 * rótulo de data-base e idade do dado, que é a principal proteção contra a
 * leitura otimista do semáforo (opção B da spec).
 */
export async function ingerir(sigla: string): Promise<void> {
  const sb = supabase();
  const item = await acharItem(sigla);
  console.log(`[bdgd] ${item.sigla} · data-base ${item.dataBase} · ${(item.bytesZip / 1024 ** 3).toFixed(2)} GB`);

  // A distribuidora precisa existir antes da importação apontar para ela.
  const { data: dist, error: eDist } = await sb
    .from('rede_distribuidora')
    .upsert({ sigla: item.sigla, nome: item.sigla.replace(/_/g, ' '),
              codigo_aneel: item.codigoAneel, uf: 'SP', data_base: item.dataBase },
            { onConflict: 'sigla' })
    .select('id').single();
  if (eDist || !dist) throw new Error(`Nao consegui registrar a distribuidora: ${eDist?.message}`);

  const { data: imp, error: eImp } = await sb
    .from('rede_importacao')
    .insert({ distribuidora_id: dist.id, data_base: item.dataBase,
              arquivo_origem: item.titulo, etapa: 'baixando', situacao: 'rodando' })
    .select('id').single();
  if (eImp || !imp) throw new Error(`Nao consegui abrir a importacao: ${eImp?.message}`);

  const dir = join(tmpdir(), `bdgd-${item.sigla}-${imp.id}`);
  const marcar = async (etapa: string) => {
    await sb.from('rede_importacao').update({ etapa }).eq('id', imp.id);
    await reportarDisco('ingestao', etapa);
  };

  try {
    await marcar('baixando');
    const gdb = await baixarEExtrair(item, dir);

    await marcar('extraindo');
    const { data: jan } = await sb.rpc('rede_janela_geracao' as never);
    const janela = Array.isArray(jan) && jan[0]
      ? { inicio: Number(jan[0].inicio), fim: Number(jan[0].fim) }
      : { inicio: 9, fim: 15 };
    const csv = await extrair(gdb, join(dir, 'csv'), janela);

    await marcar('carregando');
    const subs = lerCsv(await readFile(csv.subestacoes, 'utf8')).map(s => ({
      importacao_id: imp.id, codigo: s.COD_ID, nome: s.NOME || null,
      lng: Number(s.lng), lat: Number(s.lat),
    }));
    const cargaPorAlim = new Map(lerCsv(await readFile(csv.cargaAlim, 'utf8'))
      .map(x => [x.alimentador, x.carga_min_diurna_kw]));
    const gdPorAlim = new Map(lerCsv(await readFile(csv.gdAlim, 'utf8'))
      .map(x => [x.alimentador, x.gd_kw]));
    const n2 = (v: string | undefined) => {
      if (v === undefined || v.trim() === '') return null;
      const n = Number(v);
      return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
    };
    const alims = lerCsv(await readFile(csv.alimentadores, 'utf8')).map(a => ({
      importacao_id: imp.id, codigo: a.COD_ID, subestacao_codigo: a.SUB || null,
      // tensao_kv fica nula de proposito: TEN_NOM e codigo de dominio, nao kV.
      tensao_kv: null,
      carga_min_diurna_kw: n2(cargaPorAlim.get(a.COD_ID)),
      // GD ausente e zero de verdade: ninguem conectou nada neste alimentador.
      gd_conectada_kw: n2(gdPorAlim.get(a.COD_ID)) ?? 0,
    }));
    const trafos = montarTrafos(
      lerCsv(await readFile(csv.trafos, 'utf8')),
      lerCsv(await readFile(csv.carga, 'utf8')),
      lerCsv(await readFile(csv.gd, 'utf8')),
    ).map(t => ({ importacao_id: imp.id, ...t }));

    console.log(`[bdgd] ${subs.length} subestacoes · ${alims.length} alimentadores · ${trafos.length} trafos`);
    await enviarEmLotes('rede_stg_subestacao', subs);
    await enviarEmLotes('rede_stg_alimentador', alims);
    await enviarEmLotes('rede_stg_transformador', trafos);

    await marcar('promovendo');
    const { data: prom, error: eProm } = await sb
      .rpc('rede_importacao_promover' as never, { p_importacao_id: imp.id } as never);
    if (eProm) throw new Error(`Promocao falhou: ${eProm.message}`);
    console.log('[bdgd] promovido:', prom);

    // A faxina do staging e nossa, nao da funcao de promocao: ela garante que
    // o mapa nunca fica meio-carregado, e isso ja aconteceu. Se um destes
    // deletes falhar, as linhas ficam orfas e inofensivas — o ON DELETE
    // CASCADE as leva quando a importacao for removida.
    for (const t of ['rede_stg_transformador', 'rede_stg_alimentador', 'rede_stg_subestacao']) {
      const { error } = await sb.from(t).delete().eq('importacao_id', imp.id);
      if (error) console.warn(`[bdgd] staging ${t} nao limpou: ${error.message}`);
    }

    // O veredito e derivado, nunca importado: recalcular fecha a ingestao.
    await marcar('recalculando');
    const { data: semaforo } = await sb.rpc('grid_capacity_recalcular' as never);
    const { data: celulas } = await sb.rpc('rede_celula_recalcular' as never);
    console.log('[bdgd] semaforo:', semaforo, '| celulas:', celulas);

    await reportarDisco('ingestao', 'concluida');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await sb.from('rede_importacao')
      .update({ situacao: 'falhou', erro: msg, concluido_em: new Date().toISOString() })
      .eq('id', imp.id);
    throw e;
  } finally {
    // O extraído são gigabytes: sai do disco mesmo quando a ingestão falha.
    await rm(dir, { recursive: true, force: true });
    await reportarDisco('ingestao', 'limpeza');
  }
}

const sigla = process.argv[2];
if (!sigla) {
  console.error('uso: npm run bdgd -- CPFL_Piratininga');
  process.exit(1);
}
ingerir(sigla).then(
  () => { console.log('[bdgd] fim'); process.exit(0); },
  e => { console.error('[bdgd] falhou:', e); process.exit(1); },
);
```

- [ ] **Step 2: Acrescentar o script**

Em `worker/ludmilla/package.json`, na seção `scripts`, logo depois de `"start"`:

```json
    "bdgd": "node dist/bdgd/index.js",
```

- [ ] **Step 3: Compilar**

```bash
cd worker/ludmilla && npm ci && npx tsc --version && npm run build
```

Esperado: `5.5.x` ou superior no worker (ele tem o seu próprio TypeScript) e build sem erro.

- [ ] **Step 4: Commit**

```bash
git add worker/ludmilla/src/bdgd/index.ts worker/ludmilla/package.json
git commit -m "feat(bdgd): orquestracao da ingestao com auditoria e vigilancia de disco"
```

---

## Task 7: Rodar de verdade, na Piratininga e na Paulista

**Files:** nenhum. Esta task é execução e conferência.

> **Antes de qualquer coisa: tirar a amostra do ar.** O seed
> `supabase/seeds/rede-amostra.sql` criou a distribuidora `AMOSTRA` com
> `data_base = 2025-12-31` — **a mesma data-base da CPFL**. E
> `rede_base_atual()` escolhe a distribuidora por `data_base DESC`, sem critério
> de desempate. Com as duas no banco, o rótulo da tela pode dizer
> "AMOSTRA — não é dado real" sobre dado real da CPFL, ou o contrário.
>
> ```sql
> DELETE FROM public.rede_distribuidora WHERE sigla = 'AMOSTRA';
> ```
>
> O `ON DELETE CASCADE` leva subestação, alimentador, trafo, células e
> importação da amostra junto. Confirme com
> `select sigla, data_base from public.rede_distribuidora;` — só a CPFL deve
> sobrar.

- [ ] **Step 1: Instalar o GDAL na VPS**

```bash
sudo apt-get update && sudo apt-get install -y gdal-bin
ogr2ogr --version
```

O `apt-get update` é obrigatório: sem ele o install falha com 404 em `libminizip1t64` e `libmysqlclient21`. Esperado: `GDAL 3.8.4` ou superior.

- [ ] **Step 2: Conferir o disco antes**

```bash
df -h /
```

Precisa de **10,0 GB livres** para a Paulista e **3,4 GB** para a Piratininga — os dois números saem do próprio `cabeNoDisco` com o `content-length` real da ANEEL. Se não houver, o guard-rail da Task 3 recusa antes de baixar — o que é o comportamento certo, não um defeito.

- [ ] **Step 3: Rodar a Piratininga**

```bash
cd worker/ludmilla && npm run bdgd -- CPFL_Piratininga
```

Esperado no log, **conferido em 13/10/2026**:

```
[bdgd] CPFL_Piratininga · data-base 2025-12-31 · 0.41 GB
[bdgd] 139 subestacoes · 553 alimentadores · 52971 trafos
[bdgd] promovido: { subestacao: 139, alimentador: 553, transformador: 52971, inativados: 0 }
```

E o semáforo na faixa medida pelo script de validação (§9.4 da spec): **~11,7% risco, ~4,5% atenção, ~76,6% folga, ~7,2% sem dado**. Divergência grande aqui significa que a janela de geração, o fator de forma ou a junção carga↔trafo saiu diferente — não siga adiante; compare com a tabela da §9.4.

- [ ] **Step 4: Conferir no banco**

```sql
select d.sigla, d.data_base, i.situacao, i.linhas_por_camada, i.concluido_em
  from public.rede_importacao i
  join public.rede_distribuidora d on d.id = i.distribuidora_id
 order by i.id desc limit 3;

select risco, count(*), round(100.0*count(*)/sum(count(*)) over (), 1) as pct
  from public.rede_transformador where ativo group by risco order by 2 desc;

-- A regra que não se negocia: sem carga NUNCA vira folga.
select count(*) as deveria_ser_zero
  from public.rede_transformador
 where risco = 'folga' and (carga_min_diurna_kw is null or carga_min_diurna_kw <= 0);
```

A última consulta tem de devolver **0**.

- [ ] **Step 5: Ver na tela**

`/painel` → **Capacidade de rede**, com usuário master. Esperado: a faixa âmbar com "Base de 31/12/2025" e a idade em meses; marcadores reais em Sorocaba/Jundiaí; zoom abaixo de 12 virando células.

- [ ] **Step 6: Rodar a Paulista**

```bash
df -h / && cd worker/ludmilla && npm run bdgd -- CPFL_Paulista
```

A Paulista é ~5× a Piratininga. Registre o tempo e o pico de disco — é o que calibra o agendamento.

- [ ] **Step 7: Agendar**

A BDGD é anual (data-base 31/12), publicada no meio do ano seguinte. Agendar **mensal** é desperdício; **semanal** é absurdo. Um `pg_cron` não serve — a ingestão roda na VPS, não no banco. Use `cron` da VPS, dia 5 de cada mês às 3h, e deixe o próprio `acharItem` decidir: se a data-base do item for a mesma já registrada em `rede_distribuidora.data_base`, saia sem baixar 1,2 GB.

Acrescente essa guarda no início de `ingerir`, antes do `upsert` da distribuidora:

```typescript
  const { data: atual } = await sb.from('rede_distribuidora')
    .select('data_base').eq('sigla', item.sigla).maybeSingle();
  if (atual?.data_base === item.dataBase) {
    console.log(`[bdgd] ${item.sigla} ja esta na data-base ${item.dataBase}; nada a fazer.`);
    return;
  }
```

- [ ] **Step 8: Commit**

```bash
git add worker/ludmilla/src/bdgd/index.ts
git commit -m "feat(bdgd): sai sem baixar quando a data-base ja esta carregada"
```

---

## Task 8: Documentação

**Files:**
- Modify: `docs/modules/engineering/overview.md` — a subseção do grupo 13
- Modify: `docs/project/architecture.md` — a ingestão na VPS
- Modify: `CLAUDE.md` — o estado do módulo

- [ ] **Step 1: Atualizar o grupo 13**

Em `docs/modules/engineering/overview.md`, na subseção "Grupo 13", troque "ingestão pendente" por uma descrição do que passou a existir: `npm run bdgd -- <sigla>` na VPS, staging mais promoção transacional, auditoria em `rede_importacao`, e os números reais da carga (52.976 trafos na Piratininga). Cite o plano.

- [ ] **Step 2: Atualizar a arquitetura**

Em `docs/project/architecture.md`, na seção da VPS, acrescente a ingestão da BDGD ao lado da Ludmilla: mesmo host, processo separado, GDAL como dependência de sistema, disco vigiado por `reportarDisco('ingestao', etapa)`.

- [ ] **Step 3: Atualizar o índice**

Em `CLAUDE.md`, na tabela de módulos, troque a linha da capacidade de rede:

```
| Capacidade de rede (BDGD) | 🟡 CPFL carregada (Paulista e Piratininga); demais distribuidoras de SP pendentes; só GD Manager | [modules/engineering](docs/modules/engineering/overview.md) |
```

- [ ] **Step 4: Commit**

```bash
git add docs/ CLAUDE.md
git commit -m "docs: ingestao da BDGD carregada e agendada"
```

---

## Verificação final

- [ ] `apt-get update && apt-get install -y gdal-bin` → `ogr2ogr --version` ≥ 3.8
- [ ] `npm ci` → `npx tsc --version` 5.8.x → **65** erros em `tsconfig.app.json`
- [ ] Worker: `rm -rf dist-test && npm test` → **106 testes, 82 passando, 24 falhando**
- [ ] Extração na Piratininga: 52.976 (52.971 ativos) / 49.378 / 19.643 / 553 / 139 linhas, em menos de 20 s
- [ ] `rede_importacao` com `situacao = 'concluida'` e `data_base = 2025-12-31`
- [ ] Semáforo na faixa da §9.4 da spec (~11,7% risco · ~4,5% atenção · ~76,6% folga · ~7,2% sem dado)
- [ ] **Zero** trafos com carga nula ou zero classificados como `folga`
- [ ] `anon` e `authenticated` sem privilégio nenhum nas três tabelas de staging e nas duas RPCs novas
- [ ] Tela `/painel` → Capacidade de rede mostrando a data-base e a idade do dado
- [ ] Diretório temporário removido depois da ingestão (`df -h /` volta ao que era)

## Self-review

**Cobertura da spec:** §4 (ingestão: baixar, extrair, transformar, carregar, registrar) → Tasks 3 a 7. §9.1 (camadas e campos) → Task 4. §9.2 (volume) → guard-rail da Task 3. §9.4 (a fórmula) → Tasks 2 e 4, com o resultado da §9.4 usado como critério de aceite na Task 7 Step 3. §5 (painel de armazenamento) → consumido via `reportarDisco`, já existia. §6 (cálculo) → **não é deste plano**: o veredito já é derivado por RPC desde a Fase A; a ingestão só chama o recálculo.

**Desvios declarados da spec, com o número que os justifica:** (1) sem `COPY` nem staging de milhões de linhas, porque a opção B deixa só ~54 mil linhas agregadas; (2) sem geometria de alimentador, porque nenhum consumidor existe na tela e custaria 18,9 MB de WKT; (3) `JOIN` entre camadas proibido, 11 min contra 12,5 s; (4) `tensao_kv` do alimentador fica nula, porque `TEN_NOM` é código de domínio e traduzi-lo exige uma tabela que o `.gdb` não traz. Os quatro estão na tabela "Decisões medidas".

**Placeholders:** nenhum. Cada SQL e cada comando `ogr2ogr` deste plano foi executado em 13/10/2026 contra `CPFL_Piratininga_2937_2025-12-31_V11`, e as contagens esperadas são as que saíram. As duas exceções, marcadas como tal: o `.gdb` da Paulista não foi baixado (só o `content-length`, 1,22 GB, e a extrapolação de 5,3×), e a tela com dado real só pode ser vista depois da Task 7.

**Consistência de tipos:** `Curva` é definida na Task 2 e consumida na Task 4 com os mesmos campos (`codId`, `tipDia`, `pot`). `LinhaTrafo` sai da Task 5 e entra em `rede_stg_transformador` da Task 1 — os nomes de coluna batem um a um (`codigo`, `alimentador_codigo`, `potencia_nominal_kva`, `fases`, `tensao_secundaria_v`, `carga_min_diurna_kw`, `gd_conectada_kw`, `lng`, `lat`), mais o `importacao_id` que a Task 6 acrescenta. `cabeNoDisco` devolve `{ cabe, precisaBytes }` na Task 3 e é usada com esses dois campos na mesma task. `extrair` devolve as cinco chaves (`trafos`, `carga`, `gd`, `alimentadores`, `subestacoes`) que a Task 6 lê pelo mesmo nome. `reportarDisco('ingestao', etapa)` usa a assinatura que já existe em `fila.ts:98`.
