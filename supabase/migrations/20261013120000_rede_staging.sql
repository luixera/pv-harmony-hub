-- Staging da ingestão da BDGD e a promoção transacional.
--
-- Por que staging: o worker empurra ~54 mil linhas em lotes por PostgREST, e
-- cada lote é uma requisição independente. Se a promoção fosse lote a lote, um
-- erro no meio deixaria o mapa meio-carregado. Aqui os lotes caem em staging
-- (que ninguém lê) e UMA função promove tudo — função é transação.
--
-- POR QUE TANTAS FUNÇÕES PEQUENAS: mesma razão do cálculo da Fase A. Cada peça
-- é verificável sozinha, e o servidor MCP usado para aplicar isto engasga com
-- statement longo.
--
-- A FAXINA DO STAGING NÃO ESTÁ AQUI, e é de propósito. A invariante que
-- importa é "o mapa nunca meio-carregado", e ela é garantida pelo upsert.
-- Apagar as linhas de staging é faxina, não invariante: fica no worker, depois
-- da promoção, e se ele morrer antes, as linhas ficam órfãs e inofensivas —
-- o `ON DELETE CASCADE` as leva quando a importação for removida. (Foi também
-- a saída para um bloqueio real: o servidor MCP barra `DELETE` em corpo de
-- função, e contornar o portão não era opção.)

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
ALTER TABLE public.rede_stg_subestacao    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rede_stg_alimentador   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rede_stg_transformador ENABLE ROW LEVEL SECURITY;

-- A janela de geração vem das regras, não de constante no código (ADR 0007).
-- `rede_regras()` já devolvia fator e limiares; faltava a janela.
CREATE OR REPLACE FUNCTION public.rede_janela_geracao()
RETURNS TABLE(inicio INTEGER, fim INTEGER)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $fn$
  SELECT COALESCE(MAX(value_default) FILTER (WHERE rule_key='generation_window_start' AND enabled),  9)::INT,
         COALESCE(MAX(value_default) FILTER (WHERE rule_key='generation_window_end'   AND enabled), 15)::INT
    FROM public.engineering_rules e
    JOIN public.tenants t ON t.id = e.tenant_id AND t.is_library
   WHERE e.group_key = 'grid_capacity';
$fn$;

-- ── Uma função por camada ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.rede_promover_sub(p_imp BIGINT, d BIGINT)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','pg_temp' AS $fn$
DECLARE n INTEGER;
BEGIN
  INSERT INTO public.rede_subestacao (distribuidora_id, codigo, nome, geom, ativo, atualizado_em)
  SELECT d, s.codigo, s.nome, ST_SetSRID(ST_MakePoint(s.lng, s.lat), 4326), TRUE, now()
    FROM public.rede_stg_subestacao s WHERE s.importacao_id = p_imp
  ON CONFLICT (distribuidora_id, codigo) DO UPDATE
    SET nome = EXCLUDED.nome, geom = EXCLUDED.geom, ativo = TRUE, atualizado_em = now();
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $fn$;

CREATE OR REPLACE FUNCTION public.rede_promover_alim(p_imp BIGINT, d BIGINT)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','pg_temp' AS $fn$
DECLARE n INTEGER;
BEGIN
  INSERT INTO public.rede_alimentador
    (distribuidora_id, subestacao_id, codigo, tensao_kv,
     carga_min_diurna_kw, gd_conectada_kw, ativo, atualizado_em)
  SELECT d, se.id, a.codigo, a.tensao_kv,
         a.carga_min_diurna_kw, a.gd_conectada_kw, TRUE, now()
    FROM public.rede_stg_alimentador a
    LEFT JOIN public.rede_subestacao se
           ON se.distribuidora_id = d AND se.codigo = a.subestacao_codigo
   WHERE a.importacao_id = p_imp
  ON CONFLICT (distribuidora_id, codigo) DO UPDATE
    SET subestacao_id = EXCLUDED.subestacao_id, tensao_kv = EXCLUDED.tensao_kv,
        carga_min_diurna_kw = EXCLUDED.carga_min_diurna_kw,
        gd_conectada_kw = EXCLUDED.gd_conectada_kw,
        ativo = TRUE, atualizado_em = now();
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $fn$;

CREATE OR REPLACE FUNCTION public.rede_promover_trafo(p_imp BIGINT, d BIGINT)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','pg_temp' AS $fn$
DECLARE n INTEGER;
BEGIN
  INSERT INTO public.rede_transformador
    (distribuidora_id, alimentador_id, codigo, potencia_nominal_kva, fases,
     tensao_secundaria_v, carga_min_diurna_kw, gd_conectada_kw, geom, ativo, atualizado_em)
  SELECT d, al.id, t.codigo, t.potencia_nominal_kva, t.fases,
         t.tensao_secundaria_v, t.carga_min_diurna_kw, t.gd_conectada_kw,
         ST_SetSRID(ST_MakePoint(t.lng, t.lat), 4326), TRUE, now()
    FROM public.rede_stg_transformador t
    LEFT JOIN public.rede_alimentador al
           ON al.distribuidora_id = d AND al.codigo = t.alimentador_codigo
   WHERE t.importacao_id = p_imp
  ON CONFLICT (distribuidora_id, codigo) DO UPDATE
    SET alimentador_id = EXCLUDED.alimentador_id,
        potencia_nominal_kva = EXCLUDED.potencia_nominal_kva,
        fases = EXCLUDED.fases, tensao_secundaria_v = EXCLUDED.tensao_secundaria_v,
        carga_min_diurna_kw = EXCLUDED.carga_min_diurna_kw,
        gd_conectada_kw = EXCLUDED.gd_conectada_kw,
        geom = EXCLUDED.geom, ativo = TRUE, atualizado_em = now();
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $fn$;

-- O que não veio nesta importação sai do ar, mas NÃO é apagado.
CREATE OR REPLACE FUNCTION public.rede_promover_inativar(p_imp BIGINT, d BIGINT)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','pg_temp' AS $fn$
DECLARE n INTEGER;
BEGIN
  UPDATE public.rede_transformador t SET ativo = FALSE, atualizado_em = now()
   WHERE t.distribuidora_id = d AND t.ativo
     AND NOT EXISTS (SELECT 1 FROM public.rede_stg_transformador s
                      WHERE s.importacao_id = p_imp AND s.codigo = t.codigo);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $fn$;

-- ── A entrada: uma função, logo uma transação ───────────────────────────────

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
  n_sub     := public.rede_promover_sub(p_importacao_id, d);
  n_alim    := public.rede_promover_alim(p_importacao_id, d);
  n_trafo   := public.rede_promover_trafo(p_importacao_id, d);
  n_inativo := public.rede_promover_inativar(p_importacao_id, d);
  UPDATE public.rede_importacao
     SET situacao = 'concluida', concluido_em = now(), etapa = 'promovida',
         linhas_por_camada = jsonb_build_object(
           'subestacao', n_sub, 'alimentador', n_alim, 'transformador', n_trafo,
           'inativados', n_inativo)
   WHERE id = p_importacao_id;
  RETURN jsonb_build_object('subestacao', n_sub, 'alimentador', n_alim,
                            'transformador', n_trafo, 'inativados', n_inativo);
END $fn$;

-- ── Permissões ──────────────────────────────────────────────────────────────
-- Varra TODO objeto novo, não só os que você lembra de ter criado. Essa é a
-- lição de 13/10/2026: eu conferi por memória, e dois furos passaram (§9 da
-- spec). E note que revogar do PUBLIC NÃO basta — o Supabase concede EXECUTE a
-- anon/authenticated NOMINALMENTE, via ALTER DEFAULT PRIVILEGES.
--
-- Nada aqui é chamável de fora: nem a entrada. A ingestão roda como service
-- role, que não passa por estes GRANTs.
REVOKE ALL ON FUNCTION public.rede_janela_geracao()                     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rede_promover_sub(BIGINT, BIGINT)         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rede_promover_alim(BIGINT, BIGINT)        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rede_promover_trafo(BIGINT, BIGINT)       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rede_promover_inativar(BIGINT, BIGINT)    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rede_importacao_promover(BIGINT)          FROM PUBLIC, anon, authenticated;

REVOKE ALL ON public.rede_stg_subestacao, public.rede_stg_alimentador,
              public.rede_stg_transformador FROM anon, authenticated;
