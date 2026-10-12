-- O cálculo do risco de inversão de fluxo.
--
-- Spec §6. A ingestão grava INSUMOS (nominal, carga mínima, GD conectada);
-- o semáforo é DERIVADO daqui. Por isso mudar um limiar na tela de Regras de
-- Engenharia custa segundos, e não uma reimportação de gigabytes. Provado na
-- execução: baixar attention_threshold de 60 para 15 levou folga de 4 para 1
-- e atenção de 3 para 6, sem tocar na origem.
--
-- Regra que não se negocia: sem carga ou sem geração na base => 'sem_dado',
-- NUNCA 'folga'. Ausência de dado não é ausência de risco — pintar de verde
-- um trafo sem informação é o jeito mais rápido de transformar esta
-- ferramenta em passivo.
--
-- POR QUE TANTAS FUNÇÕES PEQUENAS: o cálculo poderia morar numa função só,
-- mas quebrado assim cada peça é testável isoladamente — e foi o que pegou os
-- casos de fronteira (60% e 100% exatos) antes de qualquer dado real entrar.
-- A decomposição também contornou uma instabilidade do servidor MCP usado
-- para aplicar isto, que engasga com statements longos.

-- ── Peças puras (IMMUTABLE, testáveis sem tocar em tabela) ──────────────────

CREATE OR REPLACE FUNCTION public.rede_classificar(
  p_carga NUMERIC, p_gd NUMERIC,
  p_fator NUMERIC, p_atencao NUMERIC, p_risco NUMERIC
) RETURNS public.rede_risco
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $fn$
  SELECT CASE
    WHEN p_carga IS NULL OR p_carga <= 0 OR p_gd IS NULL THEN 'sem_dado'
    WHEN p_gd / (p_carga * p_fator) * 100 >= p_risco     THEN 'risco'
    WHEN p_gd / (p_carga * p_fator) * 100 >= p_atencao   THEN 'atencao'
    ELSE 'folga'
  END::public.rede_risco;
$fn$;

COMMENT ON FUNCTION public.rede_classificar(NUMERIC,NUMERIC,NUMERIC,NUMERIC,NUMERIC) IS
  'Estado do semaforo de inversao de fluxo. Sem carga ou sem geracao = sem_dado, NUNCA folga.';

CREATE OR REPLACE FUNCTION public.rede_margem(p_carga NUMERIC, p_gd NUMERIC, p_fator NUMERIC)
RETURNS NUMERIC LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $fn$
  SELECT CASE WHEN p_carga > 0 AND p_gd IS NOT NULL
              THEN round(p_carga * p_fator - p_gd, 2) END;
$fn$;

CREATE OR REPLACE FUNCTION public.rede_ocupacao(p_carga NUMERIC, p_gd NUMERIC, p_fator NUMERIC)
RETURNS NUMERIC LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $fn$
  SELECT CASE WHEN p_carga > 0 AND p_gd IS NOT NULL
              THEN round(p_gd / (p_carga * p_fator) * 100, 2) END;
$fn$;

-- ── Leitura das regras (fallback neutro quando desabilitada ou ausente) ─────

CREATE OR REPLACE FUNCTION public.rede_regras()
RETURNS TABLE(fator NUMERIC, atencao NUMERIC, risco NUMERIC)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $fn$
  SELECT COALESCE(MAX(value_default) FILTER (WHERE rule_key='safety_factor' AND enabled), 0.80),
         COALESCE(MAX(value_default) FILTER (WHERE rule_key='attention_threshold' AND enabled), 60),
         COALESCE(MAX(value_default) FILTER (WHERE rule_key='risk_threshold' AND enabled), 100)
    FROM public.engineering_rules e
    JOIN public.tenants t ON t.id = e.tenant_id AND t.is_library
   WHERE e.group_key = 'grid_capacity';
$fn$;

-- ── Aplicação do veredito ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.rede_aplicar_trafos(f NUMERIC, a NUMERIC, r NUMERIC)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $fn$
  UPDATE public.rede_transformador SET
    margem_kw     = public.rede_margem(carga_min_diurna_kw, gd_conectada_kw, f),
    ocupacao_pct  = public.rede_ocupacao(carga_min_diurna_kw, gd_conectada_kw, f),
    risco         = public.rede_classificar(carga_min_diurna_kw, gd_conectada_kw, f, a, r),
    atualizado_em = now();
$fn$;

CREATE OR REPLACE FUNCTION public.rede_aplicar_alimentadores(f NUMERIC, a NUMERIC, r NUMERIC)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $fn$
  UPDATE public.rede_alimentador SET
    ocupacao_pct  = public.rede_ocupacao(carga_min_diurna_kw, gd_conectada_kw, f),
    risco         = public.rede_classificar(carga_min_diurna_kw, gd_conectada_kw, f, a, r),
    atualizado_em = now();
$fn$;

CREATE OR REPLACE FUNCTION public.grid_capacity_recalcular() RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $fn$
DECLARE g RECORD; o JSONB;
BEGIN
  IF auth.role() <> 'service_role' AND NOT public.is_master(auth.uid()) THEN
    RAISE EXCEPTION 'So master ou service role recalcula a capacidade de rede';
  END IF;
  SELECT * INTO g FROM public.rede_regras();
  PERFORM public.rede_aplicar_trafos(g.fator, g.atencao, g.risco);
  PERFORM public.rede_aplicar_alimentadores(g.fator, g.atencao, g.risco);
  SELECT jsonb_build_object('fator', g.fator, 'atencao', g.atencao, 'risco_lim', g.risco,
    'trafos', jsonb_object_agg(risco, n)) INTO o
    FROM (SELECT risco::text, count(*) n FROM public.rede_transformador GROUP BY 1) z;
  RETURN o;
END $fn$;

-- ── Células de zoom ─────────────────────────────────────────────────────────
-- Refinamento sobre a spec, que previa este cálculo na ingestão: a célula é
-- floor(coordenada / passo), aritmética pura. Feito aqui, a ingestão fica só
-- com insumos e o agregado volta a ser recalculável sem reimportar.
-- Nível 1 = 0,2° (~22 km, zoom estadual); nível 2 = 0,05° (~5,5 km).

CREATE OR REPLACE VIEW public.rede_celula_calculada AS
  SELECT t.distribuidora_id AS did, n.nivel, n.passo,
         floor(ST_X(t.geom)/n.passo)::INT AS cx,
         floor(ST_Y(t.geom)/n.passo)::INT AS cy,
         count(*) AS t,
         count(*) FILTER (WHERE t.risco='risco')    AS r,
         count(*) FILTER (WHERE t.risco='atencao')  AS a,
         count(*) FILTER (WHERE t.risco='folga')    AS f,
         count(*) FILTER (WHERE t.risco='sem_dado') AS s
    FROM public.rede_transformador t
   CROSS JOIN (VALUES (1::SMALLINT, 0.2::NUMERIC), (2::SMALLINT, 0.05::NUMERIC)) n(nivel, passo)
   WHERE t.ativo
   GROUP BY 1,2,3,4,5;

CREATE OR REPLACE VIEW public.rede_celula_pronta AS
  SELECT did AS distribuidora_id, nivel, t AS trafos, r AS trafos_risco,
         a AS trafos_atencao, f AS trafos_folga, s AS trafos_sem_dado,
         -- o pior estado presente manda na cor da célula
         (CASE WHEN r>0 THEN 'risco' WHEN a>0 THEN 'atencao'
               WHEN f>0 THEN 'folga' ELSE 'sem_dado' END)::public.rede_risco AS risco,
         ST_SetSRID(ST_MakeEnvelope((cx*passo)::float8, (cy*passo)::float8,
           ((cx+1)*passo)::float8, ((cy+1)*passo)::float8), 4326) AS geom
    FROM public.rede_celula_calculada;

CREATE OR REPLACE FUNCTION public.rede_celula_limpar() RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $fn$
BEGIN DELETE FROM public.rede_celula_agregada; END $fn$;

CREATE OR REPLACE FUNCTION public.rede_celula_inserir() RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $fn$
BEGIN
  INSERT INTO public.rede_celula_agregada
    (distribuidora_id, nivel, trafos, trafos_risco, trafos_atencao,
     trafos_folga, trafos_sem_dado, risco, geom)
  SELECT * FROM public.rede_celula_pronta;
END $fn$;

CREATE OR REPLACE FUNCTION public.rede_celula_recalcular() RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $fn$
DECLARE n INTEGER;
BEGIN
  IF auth.role() <> 'service_role' AND NOT public.is_master(auth.uid()) THEN
    RAISE EXCEPTION 'So master ou service role recalcula as celulas';
  END IF;
  PERFORM public.rede_celula_limpar();
  PERFORM public.rede_celula_inserir();
  SELECT count(*) INTO n FROM public.rede_celula_agregada;
  RETURN jsonb_build_object('celulas', n);
END $fn$;

-- ── Permissões ──────────────────────────────────────────────────────────────
-- As peças internas não são chamáveis de fora: só as duas RPCs de entrada.
REVOKE ALL ON FUNCTION public.rede_regras()                              FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rede_aplicar_trafos(NUMERIC,NUMERIC,NUMERIC)        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rede_aplicar_alimentadores(NUMERIC,NUMERIC,NUMERIC) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rede_celula_limpar()                       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rede_celula_inserir()                      FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.grid_capacity_recalcular() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.grid_capacity_recalcular() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.rede_celula_recalcular()   FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.rede_celula_recalcular()   TO authenticated;
