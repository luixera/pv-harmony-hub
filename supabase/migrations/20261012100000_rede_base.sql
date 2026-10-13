-- Base de rede elétrica (BDGD/ANEEL) — Fase A: só o schema de destino.
--
-- Spec:  docs/superpowers/specs/2026-10-10-capacidade-rede-design.md §3
-- Plano: docs/superpowers/plans/2026-10-12-capacidade-rede-fase-a.md
--
-- ADR 0009: estas tabelas NÃO têm tenant_id. Dado público, idêntico para todos,
-- no tenant biblioteca, com leitura restrita a master por controle de produto —
-- não por confidencialidade (o dado é aberto na ANEEL).
--
-- A divisão que sustenta o módulo: a ingestão grava INSUMOS (potência nominal,
-- carga mínima estimada, GD conectada); o VEREDITO (margem, ocupação, risco) é
-- derivado por RPC e recalculável em segundos quando um limiar muda.

CREATE EXTENSION IF NOT EXISTS postgis;

-- Estado do semáforo. Domínio e não enum: acrescentar valor não exige ALTER TYPE.
DO $dom$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'rede_risco') THEN
    CREATE DOMAIN public.rede_risco AS TEXT
      CHECK (VALUE IN ('folga', 'atencao', 'risco', 'sem_dado'));
  END IF;
END $dom$;

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
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  distribuidora_id    BIGINT NOT NULL REFERENCES public.rede_distribuidora(id) ON DELETE CASCADE,
  subestacao_id       BIGINT REFERENCES public.rede_subestacao(id) ON DELETE SET NULL,
  codigo              TEXT NOT NULL,
  tensao_kv           NUMERIC(8,2),
  -- insumos (vêm da ingestão)
  carga_min_diurna_kw NUMERIC(12,2),
  gd_conectada_kw     NUMERIC(12,2),
  -- veredito (derivado por RPC)
  ocupacao_pct        NUMERIC(8,2),
  risco               public.rede_risco NOT NULL DEFAULT 'sem_dado',
  geom                geometry(MultiLineString, 4326),
  ativo               BOOLEAN NOT NULL DEFAULT TRUE,
  atualizado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (distribuidora_id, codigo)
);

CREATE TABLE public.rede_transformador (
  id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  distribuidora_id     BIGINT NOT NULL REFERENCES public.rede_distribuidora(id) ON DELETE CASCADE,
  alimentador_id       BIGINT REFERENCES public.rede_alimentador(id) ON DELETE SET NULL,
  codigo               TEXT NOT NULL,
  potencia_nominal_kva NUMERIC(10,2),
  fases                SMALLINT CHECK (fases BETWEEN 1 AND 3),
  tensao_primaria_kv   NUMERIC(8,2),
  tensao_secundaria_v  NUMERIC(8,1),
  -- insumos
  carga_min_diurna_kw  NUMERIC(12,2),
  gd_conectada_kw      NUMERIC(12,2),
  -- veredito
  margem_kw            NUMERIC(12,2),
  ocupacao_pct         NUMERIC(8,2),
  risco                public.rede_risco NOT NULL DEFAULT 'sem_dado',
  geom                 geometry(Point, 4326) NOT NULL,
  ativo                BOOLEAN NOT NULL DEFAULT TRUE,
  atualizado_em        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (distribuidora_id, codigo)
);
COMMENT ON COLUMN public.rede_transformador.carga_min_diurna_kw IS
  'ESTIMATIVA derivada da curva de carga das UCs, não medição. Ver §6 da spec.';
COMMENT ON COLUMN public.rede_transformador.ativo IS
  'FALSE quando o trafo deixou de aparecer na BDGD — marcado, nunca apagado em silêncio.';

-- Agregado por célula de grade, para o zoom distante não varrer centenas de
-- milhares de pontos. Derivado de rede_transformador por rede_celula_recalcular.
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
-- GiST para geometria; B-tree nas FKs (as duas cobranças da skill de Postgres).
CREATE INDEX rede_subestacao_geom_idx      ON public.rede_subestacao      USING gist (geom);
CREATE INDEX rede_alimentador_geom_idx     ON public.rede_alimentador     USING gist (geom);
CREATE INDEX rede_transformador_geom_idx   ON public.rede_transformador   USING gist (geom);
CREATE INDEX rede_celula_geom_idx          ON public.rede_celula_agregada USING gist (geom);

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
-- Leitura só master; nenhuma política de escrita para authenticated, então não
-- existe caminho pela API para alterar a base de rede.
DO $rls$
DECLARE t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY['rede_distribuidora', 'rede_subestacao', 'rede_alimentador',
                               'rede_transformador', 'rede_celula_agregada', 'rede_importacao'])
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING ((SELECT public.is_master(auth.uid())))',
      t || '_master_le', t);
  END LOOP;
END $rls$;
