# Capacidade de rede — Fase A (base, cálculo e mapa) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pôr no ar a seção **Capacidade de rede** do console `/painel` — mapa exploratório com semáforo de risco de inversão de fluxo por transformador e alimentador — funcionando de ponta a ponta sobre dados de amostra, antes de a ingestão da BDGD existir.

**Architecture:** Seis tabelas `rede_*` no tenant biblioteca, sem `tenant_id` (ADR 0009), com PostGIS. A ingestão (Plano 3) trará apenas **insumos**; tudo que é **veredito** — o semáforo e as células de zoom — é derivado em SQL por RPC recalculável. Isso é o que permite construir e validar a Fase A inteira com amostra, e o que fará o semáforo responder em segundos quando um limiar mudar, sem reimportar gigabytes.

**Tech Stack:** Postgres/Supabase (PostGIS 3.3.7, RLS, `SECURITY DEFINER`) · React + React Query + `@react-google-maps/api` · Recharts já presente.

**Spec:** [docs/superpowers/specs/2026-10-10-capacidade-rede-design.md](../specs/2026-10-10-capacidade-rede-design.md)
**ADR:** [0009 — base pública de rede sem `tenant_id`](../../adr/0009-rede-publica-sem-tenant.md)
**Plano anterior:** [painel de armazenamento da VPS](2026-10-10-painel-armazenamento-vps.md) — concluído

## Por que este plano para na porta da ingestão

A spec marca três coisas como **não verificadas**: os nomes e campos das camadas da BDGD, o volume real do arquivo da CPFL, e se alguma distribuidora de SP tem consulta de capacidade não indexada. A política de rede deste ambiente nega todos os hosts da ANEEL, do ArcGIS e da CPFL — confirmado com `curl` (403 no CONNECT) e com Chromium via Playwright (`ERR_TUNNEL_CONNECTION_FAILED`, que é o túnel recusado no proxy, não um problema do navegador).

As **tabelas de destino são nosso schema**; só o mapeamento origem→destino depende dos nomes reais. Então a Fase A não depende de nada bloqueado, e o script de ingestão fica para o Plano 3, escrito quando os nomes forem conhecidos. Escrevê-lo agora produziria placeholders disfarçados de código.

## Global Constraints

- **Comunicação e comentários em português.** Nomes de tabela e coluna em português (`rede_transformador`, `potencia_nominal_kva`); `group_key`/`rule_key` de `engineering_rules` em **inglês**, seguindo os 12 grupos que já existem.
- **Gate master é `public.is_master(auth.uid())`** — a função que já existe. Não criar helper novo lendo `app_metadata`: `app_metadata` (ADR 0003) é papel e tenant **dentro** do tenant.
- **Toda RPC**: `SECURITY DEFINER` + `SET search_path TO 'public', 'pg_temp'`, com a permissão checada **dentro** da função.
- **Escrita das tabelas `rede_*`: nenhuma política para `authenticated`.** Só service role grava.
- **`engineering_rules.tenant_id` é NOT NULL com default `get_user_tenant_id(auth.uid())`** — ao semear, passe o id do tenant biblioteca **explicitamente** (`select id from tenants where is_library`), senão as regras caem no tenant de quem rodou a migração.
- **Banco**: aplicar com `npx -y supabase db query --linked -f arquivo.sql`. RLS testada com impersonação dentro de `begin; … rollback;`.
- **Verificação antes de concluir**: `npm ci` primeiro (obrigatório), confirmar `npx tsc --version` → **5.8.x**, depois `npx tsc --noEmit -p tsconfig.app.json` contra o baseline de **65 erros** e `npm run build`.
  **Armadilha confirmada:** sem `node_modules`, o `npx` baixa **TypeScript 6.0.2**, que trata `baseUrl` como erro e aborta antes de checar os arquivos — devolvendo **1 erro em vez de 65**, o que parece melhoria e não é.
- **Cores de status** (validadas, ΔE 12,6 em protanopia): folga `#1F7A3D`, atenção `#F5A800`, risco `#F0523F`, sem dado `#8A8A96`. **Cada estado tem forma própria** além da cor: círculo cheio, anel vazado, triângulo, contorno tracejado.
- **O estado verde se chama "sem risco aparente"** — nunca "aprovado" ou "liberado". A spec adotou a opção B (defasagem não descontada, só rotulada), e essa palavra é a proteção que sobra.
- **Nada de cruzamento com projetos.** Por decisão de escopo de 10/10/2026, o módulo não lê `projects` nem `project_general_data`.

---

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/20261012100000_rede_base.sql` (criar) | PostGIS, as 6 tabelas, índices, RLS |
| `supabase/migrations/20261012110000_grid_capacity_regras.sql` (criar) | Grupo 13 em `engineering_rules`, semeado no tenant biblioteca |
| `supabase/migrations/20261012120000_rede_calculo.sql` (criar) | `grid_capacity_recalcular()` e `rede_celula_recalcular()` |
| `supabase/migrations/20261012130000_rede_no_mapa.sql` (criar) | `rede_no_mapa(bbox, zoom)` |
| `supabase/seeds/rede-amostra.sql` (criar) | Amostra rotulada para desenvolver e testar sem a BDGD |
| `src/pages/painel/NetworkSection.tsx` (criar) | A seção: mapa, filtros, legenda, drawer, lista acessível |
| `src/pages/painel/PainelConsole.tsx` (modificar: linhas 4-19 e 87-93) | Registrar a seção nova no `type Section`, no `NAV` e no render |
| `docs/modules/engineering/overview.md` (modificar) | O grupo 13 e o módulo de capacidade de rede |

---

## Task 1: PostGIS e as seis tabelas

**Files:**
- Create: `supabase/migrations/20261012100000_rede_base.sql`

**Interfaces:**
- Consumes: `public.is_master(uuid)`.
- Produces: `rede_distribuidora`, `rede_subestacao`, `rede_alimentador`, `rede_transformador`, `rede_celula_agregada`, `rede_importacao`. O enum de risco é o domínio `rede_risco` com os valores `'folga' | 'atencao' | 'risco' | 'sem_dado'`.

- [ ] **Step 1: Escrever a migração**

```sql
-- Base de rede elétrica (BDGD/ANEEL) — Fase A: só o schema de destino.
--
-- Spec: docs/superpowers/specs/2026-10-10-capacidade-rede-design.md §3
-- ADR 0009: estas tabelas NÃO têm tenant_id. Dado público, idêntico para todos,
-- no tenant biblioteca, com leitura restrita a master por controle de produto —
-- não por confidencialidade (o dado é aberto na ANEEL).

CREATE EXTENSION IF NOT EXISTS postgis;

-- Estado do semáforo. Domínio e não enum: acrescentar valor não exige ALTER TYPE.
CREATE DOMAIN public.rede_risco AS TEXT
  CHECK (VALUE IN ('folga', 'atencao', 'risco', 'sem_dado'));

CREATE TABLE public.rede_distribuidora (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sigla         TEXT NOT NULL UNIQUE,
  nome          TEXT NOT NULL,
  codigo_aneel  TEXT,
  uf            TEXT NOT NULL CHECK (char_length(uf) = 2),
  data_base     DATE,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON COLUMN public.rede_distribuidora.data_base IS
  'Data-base da BDGD carregada (31/12 do ano). Nulo = nunca importada.';

CREATE TABLE public.rede_subestacao (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  distribuidora_id  BIGINT NOT NULL REFERENCES public.rede_distribuidora(id) ON DELETE CASCADE,
  codigo            TEXT NOT NULL,
  nome              TEXT,
  tensao_kv         NUMERIC(8,2),
  potencia_mva      NUMERIC(10,2),
  geom              geometry(Point, 4326) NOT NULL,
  ativo             BOOLEAN NOT NULL DEFAULT TRUE,
  atualizado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (distribuidora_id, codigo)
);

CREATE TABLE public.rede_alimentador (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  distribuidora_id  BIGINT NOT NULL REFERENCES public.rede_distribuidora(id) ON DELETE CASCADE,
  subestacao_id     BIGINT REFERENCES public.rede_subestacao(id) ON DELETE SET NULL,
  codigo            TEXT NOT NULL,
  tensao_kv         NUMERIC(8,2),
  -- insumos (vêm da ingestão)
  carga_min_diurna_kw NUMERIC(12,2),
  gd_conectada_kw     NUMERIC(12,2),
  -- veredito (derivado por RPC)
  ocupacao_pct      NUMERIC(8,2),
  risco             public.rede_risco NOT NULL DEFAULT 'sem_dado',
  geom              geometry(MultiLineString, 4326),
  ativo             BOOLEAN NOT NULL DEFAULT TRUE,
  atualizado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (distribuidora_id, codigo)
);

CREATE TABLE public.rede_transformador (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  distribuidora_id    BIGINT NOT NULL REFERENCES public.rede_distribuidora(id) ON DELETE CASCADE,
  alimentador_id      BIGINT REFERENCES public.rede_alimentador(id) ON DELETE SET NULL,
  codigo              TEXT NOT NULL,
  potencia_nominal_kva NUMERIC(10,2),
  fases               SMALLINT CHECK (fases BETWEEN 1 AND 3),
  tensao_primaria_kv   NUMERIC(8,2),
  tensao_secundaria_v  NUMERIC(8,1),
  -- insumos
  carga_min_diurna_kw NUMERIC(12,2),
  gd_conectada_kw     NUMERIC(12,2),
  -- veredito
  margem_kw           NUMERIC(12,2),
  ocupacao_pct        NUMERIC(8,2),
  risco               public.rede_risco NOT NULL DEFAULT 'sem_dado',
  geom                geometry(Point, 4326) NOT NULL,
  ativo               BOOLEAN NOT NULL DEFAULT TRUE,
  atualizado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (distribuidora_id, codigo)
);
COMMENT ON COLUMN public.rede_transformador.carga_min_diurna_kw IS
  'ESTIMATIVA derivada da curva de carga das UCs, não medição. Ver §6 da spec.';
COMMENT ON COLUMN public.rede_transformador.ativo IS
  'FALSE quando o trafo deixou de aparecer na BDGD — marcado, nunca apagado em silêncio.';

-- Agregado por célula de grade, para o zoom distante não varrer centenas de
-- milhares de pontos. Derivado de rede_transformador por RPC (ver Task 4).
CREATE TABLE public.rede_celula_agregada (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  distribuidora_id  BIGINT NOT NULL REFERENCES public.rede_distribuidora(id) ON DELETE CASCADE,
  nivel             SMALLINT NOT NULL CHECK (nivel IN (1, 2)),
  trafos            INTEGER NOT NULL DEFAULT 0,
  trafos_risco      INTEGER NOT NULL DEFAULT 0,
  trafos_atencao    INTEGER NOT NULL DEFAULT 0,
  trafos_folga      INTEGER NOT NULL DEFAULT 0,
  trafos_sem_dado   INTEGER NOT NULL DEFAULT 0,
  risco             public.rede_risco NOT NULL DEFAULT 'sem_dado',
  geom              geometry(Polygon, 4326) NOT NULL,
  atualizado_em     TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON COLUMN public.rede_celula_agregada.nivel IS
  '1 = grade grossa (0,2°, ~22 km) para zoom estadual; 2 = média (0,05°, ~5,5 km)';

CREATE TABLE public.rede_importacao (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  distribuidora_id  BIGINT NOT NULL REFERENCES public.rede_distribuidora(id) ON DELETE CASCADE,
  data_base         DATE,
  arquivo_origem    TEXT,
  linhas_por_camada JSONB NOT NULL DEFAULT '{}'::jsonb,
  etapa             TEXT,
  situacao          TEXT NOT NULL DEFAULT 'rodando'
                    CHECK (situacao IN ('rodando', 'concluida', 'falhou')),
  erro              TEXT,
  iniciado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
  concluido_em      TIMESTAMPTZ
);
COMMENT ON TABLE public.rede_importacao IS
  'Auditoria da ingestão E fonte do rótulo de data-base/idade do dado na tela.';

-- ── Índices ─────────────────────────────────────────────────────────────────
-- GiST para geometria (a skill de Postgres é explícita); B-tree nas FKs.
CREATE INDEX rede_subestacao_geom_idx     ON public.rede_subestacao     USING gist (geom);
CREATE INDEX rede_alimentador_geom_idx    ON public.rede_alimentador    USING gist (geom);
CREATE INDEX rede_transformador_geom_idx  ON public.rede_transformador  USING gist (geom);
CREATE INDEX rede_celula_geom_idx         ON public.rede_celula_agregada USING gist (geom);

CREATE INDEX rede_alimentador_distribuidora_idx   ON public.rede_alimentador (distribuidora_id);
CREATE INDEX rede_alimentador_subestacao_idx      ON public.rede_alimentador (subestacao_id);
CREATE INDEX rede_transformador_distribuidora_idx ON public.rede_transformador (distribuidora_id);
CREATE INDEX rede_transformador_alimentador_idx   ON public.rede_transformador (alimentador_id);
CREATE INDEX rede_celula_nivel_idx                ON public.rede_celula_agregada (distribuidora_id, nivel);
CREATE INDEX rede_importacao_distribuidora_idx    ON public.rede_importacao (distribuidora_id, iniciado_em DESC);

-- Parcial: a tela quase sempre quer o que NÃO está com folga.
CREATE INDEX rede_transformador_risco_idx ON public.rede_transformador (distribuidora_id)
  WHERE risco <> 'folga';

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Leitura só master; nenhuma política de escrita para authenticated.
DO $rls$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['rede_distribuidora','rede_subestacao','rede_alimentador',
                           'rede_transformador','rede_celula_agregada','rede_importacao']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING ((SELECT public.is_master(auth.uid())))',
      t || '_master_le', t);
  END LOOP;
END $rls$;
```

- [ ] **Step 2: Aplicar**

```bash
cd /home/user/pv-harmony-hub
npx -y supabase db query --linked -f supabase/migrations/20261012100000_rede_base.sql
```

- [ ] **Step 3: Conferir que PostGIS entrou e a RLS está ligada nas seis**

```bash
npx -y supabase db query --linked --query "
select
  (select extversion from pg_extension where extname = 'postgis') as postgis,
  (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname like 'rede\_%' and c.relkind='r' and c.relrowsecurity) as tabelas_com_rls,
  (select count(*) from pg_policies where tablename like 'rede\_%') as politicas,
  (select count(*) from pg_indexes where tablename like 'rede\_%' and indexdef ilike '%gist%') as indices_gist"
```

Esperado: `postgis` com versão, `tabelas_com_rls` = 6, `politicas` = 6, `indices_gist` = 4.

- [ ] **Step 4: Testar a RLS com impersonação**

Rode **duas** chamadas separadas (uma transação por ator — temp table não aceita escrita do role `authenticated`, e trocar claims no meio de uma só mede o ator errado; os dois erros aconteceram no plano anterior):

```bash
# descubra um master
npx -y supabase db query --linked --query "select id from profiles where is_master limit 1"
```

```sql
-- não-master: espera 0
begin;
insert into public.rede_distribuidora (sigla, nome, uf) values ('TESTE', 'Teste RLS', 'SP');
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
select 'NAO-MASTER' as ator, count(*) as linhas from public.rede_distribuidora;
rollback;
```

```sql
-- master: espera >= 1 (troque o UUID)
begin;
insert into public.rede_distribuidora (sigla, nome, uf) values ('TESTE', 'Teste RLS', 'SP');
set local role authenticated;
set local request.jwt.claims to '{"sub":"<UUID-DO-MASTER>","role":"authenticated"}';
select 'MASTER' as ator, count(*) as linhas from public.rede_distribuidora;
rollback;
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261012100000_rede_base.sql
git commit -m "feat(banco): base de rede elétrica — PostGIS, seis tabelas e RLS master"
```

---

## Task 2: Grupo 13 `grid_capacity` em `engineering_rules`

**Files:**
- Create: `supabase/migrations/20261012110000_grid_capacity_regras.sql`

**Interfaces:**
- Produces: seis linhas em `engineering_rules` com `group_key = 'grid_capacity'` e `rule_key` em `generation_window_start`, `generation_window_end`, `safety_factor`, `attention_threshold`, `risk_threshold`, `power_factor`.

- [ ] **Step 1: Escrever a migração**

A armadilha aqui é o `tenant_id`: ele é NOT NULL com default `get_user_tenant_id(auth.uid())`, então um INSERT sem a coluna joga as regras no tenant de quem aplicou a migração, não na biblioteca.

```sql
-- Grupo 13 do Motor de Engenharia: capacidade de rede e inversão de fluxo.
--
-- Spec §6. Princípio do ADR 0007: os VALORES vivem no banco, o código só
-- conhece as CHAVES. O histórico é automático pelo trigger que já existe.
--
-- tenant_id EXPLÍCITO: o default da coluna é get_user_tenant_id(auth.uid()),
-- que colocaria as regras no tenant de quem rodou a migração.

INSERT INTO public.engineering_rules
  (tenant_id, group_key, rule_key, label, description,
   value_default, value_min, value_max, unit, priority, source)
SELECT t.id, v.group_key, v.rule_key, v.label, v.description,
       v.value_default, v.value_min, v.value_max, v.unit, v.priority, v.source
  FROM public.tenants t
 CROSS JOIN (VALUES
   ('grid_capacity', 'generation_window_start',
    'Início da janela de geração',
    'Hora em que a conta passa a considerar que há sol. O mínimo de carga procurado é o desta janela.',
    9, 5, 12, 'h', 10, 'Regra interna'),
   ('grid_capacity', 'generation_window_end',
    'Fim da janela de geração',
    'Hora em que a janela de geração se encerra.',
    15, 13, 20, 'h', 20, 'Regra interna'),
   ('grid_capacity', 'safety_factor',
    'Fator de segurança sobre a carga mínima',
    'Multiplica a carga mínima diurna estimada antes de comparar com a geração. Abaixo de 1 deixa folga para o erro da estimativa.',
    0.80, 0.50, 1.00, '×', 30, 'Regra interna'),
   ('grid_capacity', 'attention_threshold',
    'Limiar de atenção',
    'A partir desta ocupação da margem o ponto fica âmbar.',
    60, 10, 99, '%', 40, 'Regra interna'),
   ('grid_capacity', 'risk_threshold',
    'Limiar de risco',
    'A partir desta ocupação a margem está esgotada e o ponto fica vermelho.',
    100, 50, 200, '%', 50, 'REN 1.000/2021 (art. 73)'),
   ('grid_capacity', 'power_factor',
    'Fator de potência para converter kVA em kW',
    'Usado quando só a potência aparente nominal do transformador é conhecida.',
    0.92, 0.70, 1.00, '×', 60, 'Regra interna')
 ) AS v(group_key, rule_key, label, description,
        value_default, value_min, value_max, unit, priority, source)
 WHERE t.is_library
   AND NOT EXISTS (
     SELECT 1 FROM public.engineering_rules e
      WHERE e.tenant_id = t.id AND e.group_key = v.group_key AND e.rule_key = v.rule_key
   );
```

- [ ] **Step 2: Aplicar e conferir**

```bash
npx -y supabase db query --linked -f supabase/migrations/20261012110000_grid_capacity_regras.sql
npx -y supabase db query --linked --query "
select e.rule_key, e.value_default, e.unit, e.source, t.is_library
  from engineering_rules e join tenants t on t.id = e.tenant_id
 where e.group_key = 'grid_capacity' order by e.priority"
```

Esperado: 6 linhas, todas com `is_library = true`. Se vier `false`, o `tenant_id` foi pelo default — apague essas linhas e reaplique.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20261012110000_grid_capacity_regras.sql
git commit -m "feat(banco): grupo grid_capacity no Motor de Engenharia (6 regras)"
```

---

## Task 3: Amostra para desenvolver sem a BDGD

**Files:**
- Create: `supabase/seeds/rede-amostra.sql`

**Interfaces:**
- Produces: uma `rede_distribuidora` de sigla `AMOSTRA`, com 1 subestação, 3 alimentadores e 12 transformadores em volta de Campinas, cobrindo todos os quatro estados de risco e um trafo sem carga (para provar que "sem dado" não vira "folga").

- [ ] **Step 1: Escrever a amostra**

```sql
-- Amostra para desenvolver e testar a Fase A sem a BDGD.
--
-- A distribuidora se chama AMOSTRA de propósito: aparece rotulada na tela, e
-- `delete from rede_distribuidora where sigla = 'AMOSTRA'` limpa tudo em
-- cascata. NÃO é dado real e não deve ser confundido com a CPFL.

DELETE FROM public.rede_distribuidora WHERE sigla = 'AMOSTRA';

WITH d AS (
  INSERT INTO public.rede_distribuidora (sigla, nome, uf, data_base)
  VALUES ('AMOSTRA', 'AMOSTRA — não é dado real', 'SP', '2025-12-31')
  RETURNING id
), se AS (
  INSERT INTO public.rede_subestacao (distribuidora_id, codigo, nome, tensao_kv, potencia_mva, geom)
  SELECT d.id, 'SE-AMOSTRA-01', 'Campinas Centro (amostra)', 138, 60,
         ST_SetSRID(ST_MakePoint(-47.0616, -22.9056), 4326)
    FROM d RETURNING id, distribuidora_id
), al AS (
  INSERT INTO public.rede_alimentador
    (distribuidora_id, subestacao_id, codigo, tensao_kv, carga_min_diurna_kw, gd_conectada_kw, geom)
  SELECT se.distribuidora_id, se.id, v.codigo, 13.8, v.carga, v.gd,
         ST_SetSRID(ST_GeomFromText(v.wkt), 4326)
    FROM se CROSS JOIN (VALUES
      ('CTMT-AM-01', 4200.0, 7900.0, 'MULTILINESTRING((-47.08 -22.90, -47.05 -22.91, -47.03 -22.93))'),
      ('CTMT-AM-02', 3100.0, 2200.0, 'MULTILINESTRING((-47.09 -22.88, -47.06 -22.87, -47.04 -22.86))'),
      ('CTMT-AM-03', 2800.0,  900.0, 'MULTILINESTRING((-47.02 -22.95, -47.00 -22.97, -46.98 -22.98))')
    ) AS v(codigo, carga, gd, wkt)
  RETURNING id, distribuidora_id, codigo
)
INSERT INTO public.rede_transformador
  (distribuidora_id, alimentador_id, codigo, potencia_nominal_kva, fases,
   tensao_primaria_kv, tensao_secundaria_v, carga_min_diurna_kw, gd_conectada_kw, geom)
SELECT al.distribuidora_id, al.id, v.codigo, v.kva, 3, 13.8, 220,
       v.carga, v.gd, ST_SetSRID(ST_MakePoint(v.lng, v.lat), 4326)
  FROM al JOIN (VALUES
    -- risco: GD muito acima da carga mínima
    ('CTMT-AM-01', 'TR-AM-0001', 75.0,  28.0, 52.4, -47.0700, -22.9020),
    ('CTMT-AM-01', 'TR-AM-0002', 112.5, 40.0, 61.0, -47.0650, -22.9080),
    ('CTMT-AM-01', 'TR-AM-0003', 45.0,  16.0, 29.5, -47.0520, -22.9140),
    -- atenção: entre 60% e 100% da margem
    ('CTMT-AM-02', 'TR-AM-0004', 75.0,  30.0, 19.0, -47.0880, -22.8810),
    ('CTMT-AM-02', 'TR-AM-0005', 112.5, 48.0, 32.0, -47.0620, -22.8740),
    ('CTMT-AM-02', 'TR-AM-0006', 45.0,  20.0, 13.0, -47.0410, -22.8660),
    -- folga
    ('CTMT-AM-03', 'TR-AM-0007', 75.0,  32.0,  5.0, -47.0180, -22.9480),
    ('CTMT-AM-03', 'TR-AM-0008', 112.5, 55.0, 10.0, -47.0020, -22.9690),
    ('CTMT-AM-03', 'TR-AM-0009', 150.0, 70.0,  0.0, -46.9830, -22.9820),
    ('CTMT-AM-03', 'TR-AM-0010', 45.0,  22.0,  3.0, -46.9950, -22.9750),
    -- sem dado: carga nula (NÃO pode virar folga) e carga zero
    ('CTMT-AM-02', 'TR-AM-0011', 75.0,  NULL, 12.0, -47.0750, -22.8900),
    ('CTMT-AM-02', 'TR-AM-0012', 75.0,   0.0,  8.0, -47.0500, -22.8950)
  ) AS v(alim, codigo, kva, carga, gd, lng, lat)
    ON v.alim = al.codigo;

INSERT INTO public.rede_importacao
  (distribuidora_id, data_base, arquivo_origem, linhas_por_camada, situacao, concluido_em)
SELECT id, '2025-12-31', 'amostra-local.sql',
       '{"subestacao":1,"alimentador":3,"transformador":12}'::jsonb,
       'concluida', now()
  FROM public.rede_distribuidora WHERE sigla = 'AMOSTRA';
```

- [ ] **Step 2: Aplicar e conferir as contagens**

```bash
npx -y supabase db query --linked -f supabase/seeds/rede-amostra.sql
npx -y supabase db query --linked --query "
select
  (select count(*) from rede_subestacao)    as subestacoes,
  (select count(*) from rede_alimentador)   as alimentadores,
  (select count(*) from rede_transformador) as trafos,
  (select count(*) from rede_transformador where carga_min_diurna_kw is null) as sem_carga"
```

Esperado: 1, 3, 12, 1.

- [ ] **Step 3: Commit**

```bash
git add supabase/seeds/rede-amostra.sql
git commit -m "feat(banco): amostra de rede para desenvolver a Fase A sem a BDGD"
```

---

## Task 4: O cálculo — semáforo e células, derivados por RPC

**Files:**
- Create: `supabase/migrations/20261012120000_rede_calculo.sql`

**Interfaces:**
- Consumes: as tabelas da Task 1, as regras da Task 2, a amostra da Task 3.
- Produces: `public.grid_capacity_recalcular() returns jsonb` (contagens por estado) e `public.rede_celula_recalcular() returns jsonb`.

**Refinamento sobre a spec:** a spec dizia que a ingestão calcularia as células. Aqui elas são derivadas em SQL a partir de `rede_transformador`, como o semáforo — a célula é `floor(coordenada / passo)`, aritmética pura. A ingestão fica mais simples (só traz insumos) e o agregado é recalculável sem reimportar.

- [ ] **Step 1: Escrever a migração**

```sql
-- O cálculo do risco de inversão de fluxo.
--
-- Spec §6. A ingestão grava INSUMOS (nominal, carga mínima, GD conectada);
-- o semáforo é DERIVADO daqui. Por isso mudar um limiar na tela de Regras de
-- Engenharia custa segundos, e não uma reimportação de gigabytes.
--
-- Regra que não se negocia: sem carga ou sem geração na base => 'sem_dado',
-- NUNCA 'folga'. Ausência de dado não é ausência de risco.

CREATE OR REPLACE FUNCTION public.grid_capacity_recalcular()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_fator      NUMERIC;
  v_atencao    NUMERIC;
  v_risco      NUMERIC;
  v_resultado  JSONB;
BEGIN
  IF auth.role() <> 'service_role' AND NOT public.is_master(auth.uid()) THEN
    RAISE EXCEPTION 'Só master ou service role recalcula a capacidade de rede';
  END IF;

  -- Regra desabilitada ou ausente cai no fallback neutro, como no resto do motor.
  SELECT COALESCE(MAX(value_default) FILTER (WHERE rule_key = 'safety_factor'       AND enabled), 0.80),
         COALESCE(MAX(value_default) FILTER (WHERE rule_key = 'attention_threshold' AND enabled), 60),
         COALESCE(MAX(value_default) FILTER (WHERE rule_key = 'risk_threshold'      AND enabled), 100)
    INTO v_fator, v_atencao, v_risco
    FROM public.engineering_rules e
    JOIN public.tenants t ON t.id = e.tenant_id AND t.is_library
   WHERE e.group_key = 'grid_capacity';

  UPDATE public.rede_transformador SET
    margem_kw = CASE
      WHEN carga_min_diurna_kw IS NULL OR carga_min_diurna_kw <= 0 OR gd_conectada_kw IS NULL
        THEN NULL
      ELSE ROUND(carga_min_diurna_kw * v_fator - gd_conectada_kw, 2)
    END,
    ocupacao_pct = CASE
      WHEN carga_min_diurna_kw IS NULL OR carga_min_diurna_kw <= 0 OR gd_conectada_kw IS NULL
        THEN NULL
      ELSE ROUND(gd_conectada_kw / (carga_min_diurna_kw * v_fator) * 100, 2)
    END,
    risco = CASE
      WHEN carga_min_diurna_kw IS NULL OR carga_min_diurna_kw <= 0 OR gd_conectada_kw IS NULL
        THEN 'sem_dado'
      WHEN gd_conectada_kw / (carga_min_diurna_kw * v_fator) * 100 >= v_risco   THEN 'risco'
      WHEN gd_conectada_kw / (carga_min_diurna_kw * v_fator) * 100 >= v_atencao THEN 'atencao'
      ELSE 'folga'
    END,
    atualizado_em = now();

  UPDATE public.rede_alimentador SET
    ocupacao_pct = CASE
      WHEN carga_min_diurna_kw IS NULL OR carga_min_diurna_kw <= 0 OR gd_conectada_kw IS NULL
        THEN NULL
      ELSE ROUND(gd_conectada_kw / (carga_min_diurna_kw * v_fator) * 100, 2)
    END,
    risco = CASE
      WHEN carga_min_diurna_kw IS NULL OR carga_min_diurna_kw <= 0 OR gd_conectada_kw IS NULL
        THEN 'sem_dado'
      WHEN gd_conectada_kw / (carga_min_diurna_kw * v_fator) * 100 >= v_risco   THEN 'risco'
      WHEN gd_conectada_kw / (carga_min_diurna_kw * v_fator) * 100 >= v_atencao THEN 'atencao'
      ELSE 'folga'
    END,
    atualizado_em = now();

  SELECT jsonb_build_object(
    'fator_seguranca', v_fator,
    'limiar_atencao',  v_atencao,
    'limiar_risco',    v_risco,
    'trafos', jsonb_build_object(
      'risco',    count(*) FILTER (WHERE risco = 'risco'),
      'atencao',  count(*) FILTER (WHERE risco = 'atencao'),
      'folga',    count(*) FILTER (WHERE risco = 'folga'),
      'sem_dado', count(*) FILTER (WHERE risco = 'sem_dado')
    )
  ) INTO v_resultado
  FROM public.rede_transformador;

  RETURN v_resultado;
END $fn$;

REVOKE EXECUTE ON FUNCTION public.grid_capacity_recalcular() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.grid_capacity_recalcular() TO authenticated;

-- ── Células de zoom ─────────────────────────────────────────────────────────
-- A célula é floor(coordenada / passo): aritmética pura, sem dependência da
-- ingestão. Nível 1 = 0,2° (~22 km, zoom estadual); nível 2 = 0,05° (~5,5 km).
CREATE OR REPLACE FUNCTION public.rede_celula_recalcular()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE v_total INTEGER;
BEGIN
  IF auth.role() <> 'service_role' AND NOT public.is_master(auth.uid()) THEN
    RAISE EXCEPTION 'Só master ou service role recalcula as células';
  END IF;

  DELETE FROM public.rede_celula_agregada;

  INSERT INTO public.rede_celula_agregada
    (distribuidora_id, nivel, trafos, trafos_risco, trafos_atencao,
     trafos_folga, trafos_sem_dado, risco, geom)
  SELECT g.distribuidora_id, g.nivel, g.trafos, g.r, g.a, g.f, g.s,
         -- o pior estado presente manda na cor da célula
         CASE WHEN g.r > 0 THEN 'risco'
              WHEN g.a > 0 THEN 'atencao'
              WHEN g.f > 0 THEN 'folga'
              ELSE 'sem_dado' END,
         ST_SetSRID(ST_MakeEnvelope(
           g.cx * g.passo, g.cy * g.passo,
           (g.cx + 1) * g.passo, (g.cy + 1) * g.passo), 4326)
    FROM (
      SELECT t.distribuidora_id,
             n.nivel,
             n.passo,
             floor(ST_X(t.geom) / n.passo)::INT AS cx,
             floor(ST_Y(t.geom) / n.passo)::INT AS cy,
             count(*)                                  AS trafos,
             count(*) FILTER (WHERE t.risco = 'risco')    AS r,
             count(*) FILTER (WHERE t.risco = 'atencao')  AS a,
             count(*) FILTER (WHERE t.risco = 'folga')    AS f,
             count(*) FILTER (WHERE t.risco = 'sem_dado') AS s
        FROM public.rede_transformador t
       CROSS JOIN (VALUES (1::SMALLINT, 0.2::NUMERIC), (2::SMALLINT, 0.05::NUMERIC)) AS n(nivel, passo)
       WHERE t.ativo
       GROUP BY 1, 2, 3, 4, 5
    ) g;

  SELECT count(*) INTO v_total FROM public.rede_celula_agregada;
  RETURN jsonb_build_object('celulas', v_total);
END $fn$;

REVOKE EXECUTE ON FUNCTION public.rede_celula_recalcular() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.rede_celula_recalcular() TO authenticated;
```

- [ ] **Step 2: Aplicar e rodar o cálculo sobre a amostra**

```bash
npx -y supabase db query --linked -f supabase/migrations/20261012120000_rede_calculo.sql
npx -y supabase db query --linked --query "select public.grid_capacity_recalcular()"
```

Esperado, com a amostra da Task 3 e os padrões (fator 0,80 · atenção 60% · risco 100%):

```
trafos: risco 3, atencao 3, folga 4, sem_dado 2
```

Confira a conta à mão num caso: `TR-AM-0001` tem carga 28,0 e GD 52,4 → margem `28 × 0,8 − 52,4 = −30,0` e ocupação `52,4 / 22,4 = 233,93%` → **risco**. E `TR-AM-0011` (carga nula) e `TR-AM-0012` (carga zero) precisam dar **`sem_dado`**, não `folga` — se derem folga, o `CASE` está errado e isso é o defeito mais grave possível aqui.

- [ ] **Step 3: Provar os casos de fronteira**

```bash
npx -y supabase db query --linked --query "
select codigo, carga_min_diurna_kw, gd_conectada_kw, margem_kw, ocupacao_pct, risco
  from rede_transformador order by codigo"
```

Verifique linha por linha: nenhum trafo com `carga_min_diurna_kw` nula ou zero pode ter `risco <> 'sem_dado'`, e nenhum com `ocupacao_pct >= 100` pode ter `risco <> 'risco'`.

- [ ] **Step 4: Recalcular as células e conferir**

```bash
npx -y supabase db query --linked --query "select public.rede_celula_recalcular()"
npx -y supabase db query --linked --query "
select nivel, count(*) as celulas, sum(trafos) as trafos_somados from rede_celula_agregada group by nivel order by nivel"
```

Esperado: dois níveis, e `trafos_somados` = **12** em cada um (toda a amostra contada uma vez por nível).

- [ ] **Step 5: Provar que um limiar novo muda o veredito sem reimportar**

```bash
npx -y supabase db query --linked --query "
update engineering_rules e set value_default = 40
  from tenants t where t.id = e.tenant_id and t.is_library
   and e.group_key = 'grid_capacity' and e.rule_key = 'attention_threshold';
select public.grid_capacity_recalcular()"
```

Esperado: a contagem de `atencao` **sobe** e a de `folga` cai, sem nenhuma reimportação. Depois devolva para 60:

```bash
npx -y supabase db query --linked --query "
update engineering_rules e set value_default = 60
  from tenants t where t.id = e.tenant_id and t.is_library
   and e.group_key = 'grid_capacity' and e.rule_key = 'attention_threshold';
select public.grid_capacity_recalcular()"
```

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20261012120000_rede_calculo.sql
git commit -m "feat(banco): cálculo do risco de inversão de fluxo e células de zoom"
```

---

## Task 5: A RPC do mapa

**Files:**
- Create: `supabase/migrations/20261012130000_rede_no_mapa.sql`

**Interfaces:**
- Produces: `public.rede_no_mapa(p_oeste, p_sul, p_leste, p_norte NUMERIC, p_zoom INTEGER, p_so_risco BOOLEAN) returns jsonb`, devolvendo `{"camada": "celula"|"ponto", "base": {...}, "itens": [...], "total": n, "excedeu": bool}`.

- [ ] **Step 1: Escrever a migração**

```sql
-- O que o mapa lê, por bounding box e zoom.
--
-- Spec §7. Zoom distante lê células; zoom próximo lê trafos reais. O teto de
-- feições existe para o navegador não travar: acima dele a tela diz
-- "aproxime para ver pontos individuais" em vez de tentar desenhar tudo.

CREATE OR REPLACE FUNCTION public.rede_no_mapa(
  p_oeste    NUMERIC,
  p_sul      NUMERIC,
  p_leste    NUMERIC,
  p_norte    NUMERIC,
  p_zoom     INTEGER DEFAULT 10,
  p_so_risco BOOLEAN DEFAULT FALSE
) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  TETO       CONSTANT INTEGER := 1500;
  v_caixa    geometry;
  v_camada   TEXT;
  v_nivel    SMALLINT;
  v_total    INTEGER;
  v_itens    JSONB;
  v_base     JSONB;
BEGIN
  IF NOT public.is_master(auth.uid()) THEN
    RAISE EXCEPTION 'Capacidade de rede é restrita à administração da plataforma';
  END IF;

  v_caixa := ST_MakeEnvelope(p_oeste, p_sul, p_leste, p_norte, 4326);

  -- Procedência: alimenta o rótulo de data-base e idade do dado na tela.
  SELECT jsonb_build_object(
           'distribuidora', d.nome,
           'sigla',         d.sigla,
           'data_base',     d.data_base,
           'importado_em',  i.concluido_em
         )
    INTO v_base
    FROM public.rede_distribuidora d
    LEFT JOIN LATERAL (
      SELECT concluido_em FROM public.rede_importacao
       WHERE distribuidora_id = d.id AND situacao = 'concluida'
       ORDER BY concluido_em DESC NULLS LAST LIMIT 1
    ) i ON TRUE
   ORDER BY d.data_base DESC NULLS LAST
   LIMIT 1;

  IF p_zoom < 12 THEN
    v_camada := 'celula';
    v_nivel  := CASE WHEN p_zoom < 9 THEN 1 ELSE 2 END;

    SELECT count(*) INTO v_total
      FROM public.rede_celula_agregada c
     WHERE c.nivel = v_nivel AND ST_Intersects(c.geom, v_caixa)
       AND (NOT p_so_risco OR c.risco IN ('risco', 'atencao'));

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'id', c.id, 'risco', c.risco, 'trafos', c.trafos,
             'trafos_risco', c.trafos_risco, 'trafos_atencao', c.trafos_atencao,
             'oeste', ST_XMin(c.geom), 'sul', ST_YMin(c.geom),
             'leste', ST_XMax(c.geom), 'norte', ST_YMax(c.geom)
           )), '[]'::jsonb)
      INTO v_itens
      FROM (
        SELECT * FROM public.rede_celula_agregada c
         WHERE c.nivel = v_nivel AND ST_Intersects(c.geom, v_caixa)
           AND (NOT p_so_risco OR c.risco IN ('risco', 'atencao'))
         LIMIT TETO
      ) c;
  ELSE
    v_camada := 'ponto';

    SELECT count(*) INTO v_total
      FROM public.rede_transformador t
     WHERE t.ativo AND ST_Intersects(t.geom, v_caixa)
       AND (NOT p_so_risco OR t.risco IN ('risco', 'atencao', 'sem_dado'));

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'id', t.id, 'codigo', t.codigo, 'risco', t.risco,
             'lng', ST_X(t.geom), 'lat', ST_Y(t.geom),
             'potencia_nominal_kva', t.potencia_nominal_kva,
             'carga_min_diurna_kw', t.carga_min_diurna_kw,
             'gd_conectada_kw', t.gd_conectada_kw,
             'margem_kw', t.margem_kw,
             'ocupacao_pct', t.ocupacao_pct,
             'alimentador', a.codigo,
             'subestacao', s.nome
           )), '[]'::jsonb)
      INTO v_itens
      FROM (
        SELECT * FROM public.rede_transformador t
         WHERE t.ativo AND ST_Intersects(t.geom, v_caixa)
           AND (NOT p_so_risco OR t.risco IN ('risco', 'atencao', 'sem_dado'))
         ORDER BY t.ocupacao_pct DESC NULLS LAST
         LIMIT TETO
      ) t
      LEFT JOIN public.rede_alimentador a ON a.id = t.alimentador_id
      LEFT JOIN public.rede_subestacao  s ON s.id = a.subestacao_id;
  END IF;

  RETURN jsonb_build_object(
    'camada',  v_camada,
    'base',    COALESCE(v_base, '{}'::jsonb),
    'itens',   v_itens,
    'total',   v_total,
    'excedeu', v_total > TETO
  );
END $fn$;

REVOKE EXECUTE ON FUNCTION public.rede_no_mapa(NUMERIC, NUMERIC, NUMERIC, NUMERIC, INTEGER, BOOLEAN) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.rede_no_mapa(NUMERIC, NUMERIC, NUMERIC, NUMERIC, INTEGER, BOOLEAN) TO authenticated;
```

- [ ] **Step 2: Aplicar e exercitar as duas camadas**

```bash
npx -y supabase db query --linked -f supabase/migrations/20261012130000_rede_no_mapa.sql

# zoom próximo (pontos) sobre a amostra de Campinas
npx -y supabase db query --linked --query "
select jsonb_build_object(
  'camada', r->>'camada', 'total', r->>'total',
  'itens', jsonb_array_length(r->'itens'), 'base', r->'base')
from (select public.rede_no_mapa(-47.12, -23.00, -46.96, -22.84, 14, false) as r) z"

# zoom distante (células)
npx -y supabase db query --linked --query "
select jsonb_build_object('camada', r->>'camada', 'total', r->>'total',
  'itens', jsonb_array_length(r->'itens'))
from (select public.rede_no_mapa(-48.0, -24.0, -46.0, -22.0, 8, false) as r) z"
```

Esperado: `camada = ponto` com 12 itens no primeiro; `camada = celula` no segundo, e o `base` trazendo `AMOSTRA — não é dado real` com `data_base` 2025-12-31.

- [ ] **Step 3: Provar que não-master é recusado**

```sql
begin;
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
-- espera ERRO 'restrita à administração da plataforma'
select public.rede_no_mapa(-48, -24, -46, -22, 8, false);
rollback;
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20261012130000_rede_no_mapa.sql
git commit -m "feat(banco): rede_no_mapa — bounding box, zoom e teto de feições"
```

---

## Task 6: A seção Capacidade de rede no console

**Files:**
- Create: `src/pages/painel/NetworkSection.tsx`
- Modify: `src/pages/painel/PainelConsole.tsx` — import (linhas 4-5), `type Section` (linha 9), `NAV` (linhas 11-19), render (linhas 87-93)

**Interfaces:**
- Consumes: `rede_no_mapa` da Task 5; `card`, `GOLD`, `Loading` de `./ConsoleSections` (linhas 27, 11, 38).
- Produces: `export function NetworkSection(): JSX.Element`.

- [ ] **Step 1: Registrar a seção em `PainelConsole.tsx`**

Quatro pontos, seguindo exatamente o padrão das seções que já existem:

```tsx
// 1. no import, junto do MonitoringSection (linha 5)
import { NetworkSection } from './NetworkSection';

// 2. no type (linha 9) — acrescente 'network'
type Section = 'tenants' | 'overview' | 'access' | 'usage' | 'finance' | 'ai' | 'network' | 'monitoring';

// 3. no NAV, antes de 'monitoring' (linha 18). Importe Zap de lucide-react.
  { key: 'network', label: 'Capacidade de rede', icon: Zap },

// 4. no render, junto das outras (linha 92)
        {section === 'network' && <NetworkSection />}
```

- [ ] **Step 2: Escrever a seção**

```tsx
import { useState, useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { GoogleMap, useJsApiLoader, Marker, Rectangle } from '@react-google-maps/api';
import { supabase } from '@/integrations/supabase/client';
import { Zap, AlertTriangle, Clock } from 'lucide-react';
import { card, GOLD, Loading, SectionTitle } from './ConsoleSections';

/**
 * Capacidade de rede e risco de inversão de fluxo.
 *
 * O dado é a BDGD da ANEEL, pública e anual. Isto NÃO cruza com projetos do
 * GD Manager (decisão de escopo de 10/10/2026) e NÃO é parecer de acesso:
 * só a distribuidora emite parecer, com estudo por ponto de conexão.
 *
 * Zoom < 12 lê células agregadas; daí para cima, trafos reais. Quem decide é
 * a RPC, não a tela.
 *
 * Cor nunca sozinha: cada estado tem forma própria (o validador de paleta
 * reprovou verde×âmbar em protanopia com ΔE 3,5; com estas cores dá 12,6).
 * E a lista lateral é o equivalente acessível do mapa, não enfeite — mil
 * marcadores não se navegam por teclado.
 */

const CORES: Record<string, string> = {
  folga: '#1F7A3D', atencao: '#F5A800', risco: '#F0523F', sem_dado: '#8A8A96',
};
const ROTULOS: Record<string, string> = {
  folga: 'Sem risco aparente', atencao: 'Atenção', risco: 'Risco', sem_dado: 'Sem dado',
};
const CENTRO_PADRAO = { lat: -22.9056, lng: -47.0616 };

interface Ponto {
  id: number; codigo: string; risco: string; lng: number; lat: number;
  potencia_nominal_kva: number | null; carga_min_diurna_kw: number | null;
  gd_conectada_kw: number | null; margem_kw: number | null;
  ocupacao_pct: number | null; alimentador: string | null; subestacao: string | null;
}
interface Celula {
  id: number; risco: string; trafos: number; trafos_risco: number; trafos_atencao: number;
  oeste: number; sul: number; leste: number; norte: number;
}
interface Base {
  distribuidora?: string; sigla?: string; data_base?: string | null; importado_em?: string | null;
}
interface Resposta {
  camada: 'celula' | 'ponto';
  base: Base;
  itens: (Ponto | Celula)[];
  total: number;
  excedeu: boolean;
}

/** Marcador por estado: forma distinta, não só cor. */
function iconeDe(risco: string): google.maps.Symbol {
  const cor = CORES[risco] ?? CORES.sem_dado;
  if (risco === 'risco') {
    return { path: 'M 0 -8 L 7 6 L -7 6 Z', fillColor: cor, fillOpacity: 1,
             strokeColor: '#0E0E14', strokeWeight: 1.5, scale: 1 };
  }
  if (risco === 'atencao') {
    return { path: google.maps.SymbolPath.CIRCLE, fillColor: 'transparent', fillOpacity: 0,
             strokeColor: cor, strokeWeight: 4, scale: 6 };
  }
  if (risco === 'sem_dado') {
    return { path: google.maps.SymbolPath.CIRCLE, fillColor: 'transparent', fillOpacity: 0,
             strokeColor: cor, strokeWeight: 2, scale: 6 };
  }
  return { path: google.maps.SymbolPath.CIRCLE, fillColor: cor, fillOpacity: 1,
           strokeColor: 'rgba(255,255,255,0.45)', strokeWeight: 1.6, scale: 6 };
}

const mesesDesde = (iso: string) => {
  const d = new Date(iso);
  const meses = (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24 * 30.4);
  return Math.max(0, Math.round(meses));
};

export function NetworkSection() {
  const { isLoaded } = useJsApiLoader({
    id: 'google-map-script',
    googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? '',
  });

  const [caixa, setCaixa] = useState({ oeste: -47.12, sul: -23.0, leste: -46.96, norte: -22.84 });
  const [zoom, setZoom] = useState(14);
  const [soRisco, setSoRisco] = useState(false);
  const [aberto, setAberto] = useState<Ponto | null>(null);

  const q = useQuery({
    queryKey: ['rede-no-mapa', caixa.oeste.toFixed(2), caixa.sul.toFixed(2),
               caixa.leste.toFixed(2), caixa.norte.toFixed(2), zoom, soRisco],
    queryFn: async (): Promise<Resposta> => {
      const { data, error } = await supabase.rpc('rede_no_mapa' as never, {
        p_oeste: caixa.oeste, p_sul: caixa.sul, p_leste: caixa.leste,
        p_norte: caixa.norte, p_zoom: zoom, p_so_risco: soRisco,
      } as never);
      if (error) throw error;
      return data as Resposta;
    },
    staleTime: 60_000,
    placeholderData: anterior => anterior,   // o mapa não pisca ao arrastar
  });

  // Debounce: cada arrasto do mouse não pode virar uma consulta.
  const onIdle = useCallback((mapa: google.maps.Map | null) => {
    if (!mapa) return;
    const b = mapa.getBounds();
    if (!b) return;
    const sw = b.getSouthWest(), ne = b.getNorthEast();
    setCaixa({ oeste: sw.lng(), sul: sw.lat(), leste: ne.lng(), norte: ne.lat() });
    setZoom(mapa.getZoom() ?? 14);
  }, []);

  const pontos = useMemo(
    () => (q.data?.camada === 'ponto' ? (q.data.itens as Ponto[]) : []),
    [q.data],
  );
  const celulas = useMemo(
    () => (q.data?.camada === 'celula' ? (q.data.itens as Celula[]) : []),
    [q.data],
  );

  const base = q.data?.base ?? {};
  const idade = base.data_base ? mesesDesde(base.data_base) : null;

  return (
    <div style={{ maxWidth: 1180, margin: '0 auto' }}>
      <SectionTitle>Capacidade de rede e inversão de fluxo</SectionTitle>

      {/* procedência e idade do dado: a spec adotou a opção B, então a idade
          precisa ficar à vista — é ela que segura a leitura otimista */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12, alignItems: 'center' }}>
        {base.distribuidora && (
          <span style={{ fontSize: 11, color: '#9A9AA8', padding: '3px 9px', borderRadius: 20,
                         background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}>
            {base.distribuidora}
          </span>
        )}
        {base.data_base && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11,
                         color: '#E3B341', padding: '3px 9px', borderRadius: 20,
                         background: 'rgba(245,168,0,0.1)', border: '1px solid rgba(245,168,0,0.25)' }}>
            <Clock size={11} />
            Base de {new Date(base.data_base).toLocaleDateString('pt-BR')}
            {idade !== null && ` · ${idade} ${idade === 1 ? 'mês' : 'meses'} atrás`}
          </span>
        )}
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12,
                        color: '#C6C6D0', cursor: 'pointer', marginLeft: 'auto' }}>
          <input type="checkbox" checked={soRisco} onChange={e => setSoRisco(e.target.checked)}
                 style={{ width: 15, height: 15, accentColor: GOLD, cursor: 'pointer' }} />
          Só o que não está com folga
        </label>
      </div>

      {q.isError && (
        <div style={{ ...card, color: '#FF7A6B', fontSize: 13, marginBottom: 12 }}>
          Não consegui ler a base de rede.{' '}
          <button type="button" onClick={() => void q.refetch()}
                  style={{ background: 'none', border: 'none', color: GOLD, cursor: 'pointer',
                           fontSize: 13, padding: 0, textDecoration: 'underline' }}>
            Tentar de novo
          </button>
        </div>
      )}

      {!q.isError && q.data && q.data.total === 0 && (
        <div style={{ ...card, color: '#777', fontSize: 13, marginBottom: 12 }}>
          Nenhum ponto de rede nesta área. Se a base nunca foi importada, não há o que mostrar ainda.
        </div>
      )}

      {q.data?.excedeu && (
        <div style={{ ...card, display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12,
                      color: '#E3B341', fontSize: 12.5 }}>
          <AlertTriangle size={14} />
          {q.data.total.toLocaleString('pt-BR')} pontos nesta vista — aproxime para ver cada um.
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'stretch' }}>
        <div style={{ flex: '999 1 420px', minWidth: 0, ...card, padding: 0, overflow: 'hidden', minHeight: 460 }}>
          {!isLoaded ? <Loading /> : (
            <GoogleMap
              mapContainerStyle={{ width: '100%', height: 460 }}
              center={CENTRO_PADRAO}
              zoom={14}
              onIdle={function () { onIdle(this as unknown as google.maps.Map); }}
              options={{ mapTypeControl: false, streetViewControl: false, fullscreenControl: false }}
            >
              {pontos.map(p => (
                <Marker key={p.id} position={{ lat: p.lat, lng: p.lng }}
                        icon={iconeDe(p.risco)} title={`${p.codigo} · ${ROTULOS[p.risco]}`}
                        onClick={() => setAberto(p)} />
              ))}
              {celulas.map(c => (
                <Rectangle key={c.id}
                  bounds={{ west: c.oeste, south: c.sul, east: c.leste, north: c.norte }}
                  options={{ fillColor: CORES[c.risco], fillOpacity: 0.3,
                             strokeColor: CORES[c.risco], strokeOpacity: 0.6, strokeWeight: 1 }} />
              ))}
            </GoogleMap>
          )}
        </div>

        {/* a lista é o equivalente acessível do mapa */}
        <div style={{ flex: '1 1 320px', maxWidth: 380, ...card, display: 'flex',
                      flexDirection: 'column', gap: 10, minHeight: 460 }}>
          <p style={{ fontSize: 10, fontWeight: 700, color: '#6B6B78', textTransform: 'uppercase',
                      letterSpacing: '0.07em', margin: 0 }}>
            {q.data?.camada === 'ponto' ? 'Transformadores nesta vista' : 'Aproxime para listar os transformadores'}
          </p>

          {aberto ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <h3 style={{ fontSize: 15, fontWeight: 800, color: '#fff', margin: 0 }}>{aberto.codigo}</h3>
                <p style={{ fontSize: 11.5, color: '#8A8A96', margin: '3px 0 0' }}>
                  {aberto.alimentador ?? 'alimentador não informado'}
                  {aberto.subestacao ? ` · ${aberto.subestacao}` : ''}
                </p>
              </div>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
                             fontSize: 11.5, fontWeight: 600, color: '#ddd', padding: '4px 9px',
                             borderRadius: 20, background: `${CORES[aberto.risco]}2E`,
                             border: `1px solid ${CORES[aberto.risco]}80` }}>
                <AlertTriangle size={11} style={{ color: CORES[aberto.risco] }} />
                {ROTULOS[aberto.risco]}
              </span>
              <dl style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '7px 10px',
                           margin: 0, fontSize: 12 }}>
                <dt style={{ color: '#9A9AA8' }}>Potência nominal</dt>
                <dd style={{ margin: 0, color: '#fff', fontWeight: 700 }}>
                  {aberto.potencia_nominal_kva ?? '—'} kVA</dd>
                <dt style={{ color: '#9A9AA8' }}>Carga mínima diurna estimada</dt>
                <dd style={{ margin: 0, color: '#fff', fontWeight: 700 }}>
                  {aberto.carga_min_diurna_kw ?? '—'} kW</dd>
                <dt style={{ color: '#9A9AA8' }}>GD já conectada</dt>
                <dd style={{ margin: 0, color: '#fff', fontWeight: 700 }}>
                  {aberto.gd_conectada_kw ?? '—'} kW</dd>
                <dt style={{ color: '#D5D5DD', fontWeight: 600 }}>Margem até a inversão</dt>
                <dd style={{ margin: 0, fontWeight: 800, color: CORES[aberto.risco] }}>
                  {aberto.margem_kw ?? '—'} kW</dd>
              </dl>
              <button type="button" onClick={() => setAberto(null)}
                      style={{ alignSelf: 'flex-start', background: 'none', border: 'none',
                               color: GOLD, cursor: 'pointer', fontSize: 12, padding: 0,
                               textDecoration: 'underline' }}>
                Voltar à lista
              </button>
            </div>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex',
                         flexDirection: 'column', gap: 1, overflowY: 'auto', maxHeight: 400 }}>
              {pontos.map(p => (
                <li key={p.id}>
                  <button type="button" onClick={() => setAberto(p)}
                          style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 9,
                                   padding: '9px 10px', background: 'none', border: 'none',
                                   borderRadius: 7, cursor: 'pointer', textAlign: 'left' }}>
                    <span style={{ width: 9, height: 9, borderRadius: 5, flexShrink: 0,
                                   background: CORES[p.risco] }} />
                    <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: '#ddd' }}>{p.codigo}</span>
                    <span style={{ fontSize: 11, color: '#8A8A96', whiteSpace: 'nowrap' }}>
                      {p.ocupacao_pct !== null ? `${p.ocupacao_pct}%` : 'sem dado'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div style={{ marginTop: 'auto', padding: '11px 12px', borderRadius: 9,
                        background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <p style={{ fontSize: 11.5, color: '#9A9AA8', margin: 0, lineHeight: 1.55 }}>
              <strong style={{ color: '#D5D5DD' }}>Indicativo, não é parecer.</strong>{' '}
              A carga mínima é estimada da curva das unidades consumidoras. Só a distribuidora
              emite o parecer de acesso, com estudo por ponto de conexão.
            </p>
          </div>
        </div>
      </div>

      {/* legenda: cor + forma */}
      <div style={{ ...card, marginTop: 14, display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center' }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: '#6B6B78', textTransform: 'uppercase',
                       letterSpacing: '0.07em' }}>Risco de inversão de fluxo</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 11.5, color: '#D5D5DD' }}>
          <span style={{ width: 12, height: 12, borderRadius: 6, background: CORES.folga,
                         border: '1.6px solid rgba(255,255,255,0.45)', boxSizing: 'border-box' }} />
          Sem risco aparente
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 11.5, color: '#D5D5DD' }}>
          <span style={{ width: 13, height: 13, borderRadius: 7, border: `4px solid ${CORES.atencao}`,
                         boxSizing: 'border-box' }} />
          Atenção
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 11.5, color: '#D5D5DD' }}>
          <span style={{ width: 0, height: 0, borderLeft: '7px solid transparent',
                         borderRight: '7px solid transparent', borderBottom: `12px solid ${CORES.risco}` }} />
          Risco
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 11.5, color: '#D5D5DD' }}>
          <span style={{ width: 13, height: 13, borderRadius: 7, border: `2px dashed ${CORES.sem_dado}`,
                         boxSizing: 'border-box' }} />
          Sem dado
        </span>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verificar tipos e build**

```bash
cd /home/user/pv-harmony-hub
npm ci
npx tsc --version                        # precisa ser 5.8.x
npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c "error TS"
npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -E "NetworkSection|PainelConsole" || echo "nenhum erro meu"
npm run build
```

Esperado: **65** erros (o baseline) e nenhum nos dois arquivos. Dois pontos onde o `tsc` pode reclamar legitimamente, e a correção de cada um:

- `iconeDe` usa `google.maps.SymbolPath` em tempo de módulo. Se o `tsc` reclamar que `google` não existe, confirme que a tipagem vem de `@types/google.maps` (o `ProjectsMap.tsx` já usa `google.maps.Symbol` da mesma forma, então deve resolver) — se não, troque `SymbolPath.CIRCLE` pela string de path `'M -6 0 a 6 6 0 1 0 12 0 a 6 6 0 1 0 -12 0'`.
- `placeholderData: anterior => anterior` exige React Query v5. Confirme com `grep '"@tanstack/react-query"' package.json`; se for v4, use `keepPreviousData: true`.

- [ ] **Step 4: Ver na tela**

Abra `/painel` com usuário master → **Capacidade de rede**. Com a amostra aplicada, espere: 12 marcadores em torno de Campinas em quatro formas distintas, a faixa âmbar com a data-base e a idade, a lista lateral navegável por Tab, e o clique num marcador abrindo os números no painel. Afastando o zoom abaixo de 12, os marcadores dão lugar aos retângulos das células.

- [ ] **Step 5: Commit**

```bash
git add src/pages/painel/NetworkSection.tsx src/pages/painel/PainelConsole.tsx
git commit -m "feat(painel): seção Capacidade de rede — mapa, células, lista acessível"
```

---

## Task 7: Documentação

**Files:**
- Modify: `docs/modules/engineering/overview.md`
- Modify: `CLAUDE.md` (a tabela de módulos, linha da Ludmilla em diante)

- [ ] **Step 1: Documentar o grupo 13 no módulo de engenharia**

Em `docs/modules/engineering/overview.md`, na tabela dos grupos, acrescente a linha 13 (`grid_capacity` · capacidade de rede e inversão de fluxo · Fase A) e uma subseção curta explicando: os insumos vêm da ingestão, o veredito é derivado por `grid_capacity_recalcular()`, "sem dado" nunca vira "folga", e a defasagem não é descontada (opção B) — é rotulada.

- [ ] **Step 2: Registrar o módulo no índice**

Em `CLAUDE.md`, na tabela "Estrutura dos módulos", acrescente:

```
| Capacidade de rede (BDGD) | 🟡 Fase A — base, cálculo e mapa; ingestão pendente; só GD Manager | [modules/engineering](docs/modules/engineering/overview.md) |
```

- [ ] **Step 3: Commit**

```bash
git add docs/ CLAUDE.md
git commit -m "docs: capacidade de rede — grupo 13 e módulo no índice"
```

---

## Task 8: Descobrir a BDGD (bloqueada até a rede liberar)

**Esta tarefa não tem código. Ela produz o insumo do Plano 3.**

**Bloqueio:** a política de rede do ambiente nega `dadosabertos.aneel.gov.br`, `dadosabertos-aneel.opendata.arcgis.com` e `*.arcgis.com`. Liberar: menu do ambiente na barra de título → Edit → Network access → **Limited** → **Allowed domains**, mantendo **Allow package managers** marcada. https://code.claude.com/docs/en/cloud-environments#network-access

- [ ] **Step 1: Confirmar o acesso**

```bash
for h in dadosabertos.aneel.gov.br dadosabertos-aneel.opendata.arcgis.com services.arcgis.com; do
  echo "$h -> $(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 https://$h/ 2>&1 | tail -1)"
done
```

`200` em todos = liberado. `000` = ainda negado; pare aqui.

- [ ] **Step 2: Levantar as camadas**

Pelo portal, ou — se o `.gdb` estiver em disco — direto:

```bash
ogr2ogr -so -al "<arquivo>.gdb" | head -200
```

Registre, para **cada** camada que interessa: nome exato, geometria, e os campos de código, potência nominal, vínculo com o alimentador/subestação, energia mensal e tipologia de curva de carga.

- [ ] **Step 3: Medir o volume**

Tamanho do `.gdb` compactado e descompactado, e a contagem de feições por camada. É o que calibra o guard-rail de espaço livre da VPS (já pronto, do plano anterior).

- [ ] **Step 4: Escrever o Plano 3**

Com os nomes reais em mão, use `writing-plans` para o plano da ingestão: download, `ogr2ogr`, agregação UC→trafo fora do banco, `COPY` para staging, upsert transacional, `rede_importacao`, e `reportarDisco('ingestao', etapa)` — que já existe e só precisa ser chamado.

---

## Verificação final da Fase A

- [ ] PostGIS instalado; 6 tabelas com RLS e 6 políticas; 4 índices GiST
- [ ] RLS: não-master lê 0 linhas; master lê; `rede_no_mapa` recusa não-master
- [ ] 6 regras em `grid_capacity`, todas no tenant **biblioteca**
- [ ] `grid_capacity_recalcular()` sobre a amostra: 3 risco · 3 atenção · 4 folga · **2 sem_dado**
- [ ] Nenhum trafo com carga nula ou zero classificado como `folga`
- [ ] `rede_celula_recalcular()`: dois níveis, 12 trafos somados em cada
- [ ] Mudar `attention_threshold` muda as contagens sem reimportar
- [ ] `rede_no_mapa` devolve `camada: ponto` no zoom 14 e `camada: celula` no zoom 8
- [ ] `npm ci` → `tsc` 5.8.x → **65** erros → `npm run build` conclui
- [ ] Tela em `/painel` → Capacidade de rede, com as quatro formas e a lista por teclado

## Self-review

**Cobertura da spec:** §3 (modelo de dados) → Task 1. §6 (cálculo, grupo 13, fórmula, "sem dado" nunca folga, opção B) → Tasks 2 e 4. §7 (RPC por bbox e zoom, estados, acessibilidade, cor+forma, "sem risco aparente") → Tasks 5 e 6. §8 (RLS, `is_master`, escrita só service role) → Tasks 1, 4 e 5. §4 (ingestão) → **fora**, é o Plano 3, por decisão explícita documentada acima. §5 (painel de armazenamento) → plano anterior, concluído.

**Refinamento declarado:** as células passam a ser derivadas em SQL (`rede_celula_recalcular`) em vez de calculadas na ingestão, como a spec dizia. Ganho: a ingestão fica só com insumos, e o agregado é recalculável sem reimportar. A spec deve ser atualizada quando este plano for executado.

**Tipos:** `rede_risco` com os quatro valores é usado igual nas Tasks 1, 4, 5 e 6 (`CORES`/`ROTULOS` cobrem exatamente os quatro). A forma do JSON de `rede_no_mapa` (`camada`, `base`, `itens`, `total`, `excedeu`) é a mesma na Task 5 e nas interfaces `Resposta`/`Ponto`/`Celula`/`Base` da Task 6. `grid_capacity_recalcular` e `rede_celula_recalcular` têm o mesmo nome na definição e nas chamadas.

**Placeholders:** os dois pontos do front que podem precisar de ajuste (tipagem de `google.maps.SymbolPath` e a versão do React Query) estão nomeados com a correção exata de cada um, em vez de deixados como surpresa. O UUID do master nos testes de RLS tem o comando que o descobre.
