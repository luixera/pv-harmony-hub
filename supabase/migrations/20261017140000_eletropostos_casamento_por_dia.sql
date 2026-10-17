-- ============================================================================
-- Eletropostos — casamento: a fonte do local passa a ser escolhida POR DIA
-- (17/10/2026). A escolha pelo período inteiro descartava a fonte nova quando a
-- antiga parava: a Tupi pela API leu mais na semana, parou (403), e as leituras
-- do app da Tupi na VMOS ficavam fora da conta. Agora, em cada dia de Brasília:
-- a fonte_principal do cadastro, se leu naquele dia; senão a que somou mais
-- minutos válidos (livre/ocupado/fora). Duplicidade no mesmo dia continua fora.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.eletropostos_fontes_por_dia(a timestamptz, b timestamptz, p_local uuid DEFAULT NULL)
RETURNS TABLE (cad uuid, dia date, fonte text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT DISTINCT ON (fl.local_id, x.d) fl.local_id, x.d, le.fonte
    FROM public.eletroposto_leitura le
    JOIN public.eletroposto_fonte_local fl ON fl.fonte = le.fonte AND fl.local_fonte = le.local_fonte
    JOIN public.eletroposto_local el ON el.id = fl.local_id
    LEFT JOIN public.eletroposto_fonte_config c ON c.fonte = le.fonte
    CROSS JOIN LATERAL (SELECT (le.slot AT TIME ZONE 'America/Sao_Paulo')::date AS d) x
   WHERE le.slot >= a AND le.slot < b
     AND (p_local IS NULL OR fl.local_id = p_local)
   GROUP BY fl.local_id, x.d, le.fonte, el.fonte_principal
   ORDER BY fl.local_id, x.d,
            (le.fonte = el.fonte_principal AND count(*) FILTER (WHERE le.status <> 'desconhecido') > 0) DESC NULLS LAST,
            sum(COALESCE(le.passo_min, c.passo_min, 5)) FILTER (WHERE le.status <> 'desconhecido') DESC NULLS LAST,
            le.fonte
$$;
REVOKE ALL ON FUNCTION public.eletropostos_fontes_por_dia(timestamptz, timestamptz, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.eletropostos_conectores(a timestamptz, b timestamptz, p_local uuid DEFAULT NULL)
RETURNS SETOF public.eletroposto_conector_agg
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  WITH l0 AS (
    SELECT le.slot, le.fonte, le.local_fonte, le.conector, le.potencia_kw, le.status, le.status_bruto,
           fl.local_id AS cad,
           COALESCE(le.passo_min, c.passo_min, 5) AS passo,   -- passo da LEITURA, senão o da fonte
           public.eletropostos_carregando(le.status, le.status_bruto) AS carregando,
           public.eletropostos_grupo(COALESCE(c.agrupar, 'conector'), le.conector) AS grupo
      FROM public.eletroposto_leitura le
      LEFT JOIN public.eletroposto_fonte_local fl ON fl.fonte = le.fonte AND fl.local_fonte = le.local_fonte
      LEFT JOIN public.eletroposto_fonte_config c ON c.fonte = le.fonte
     WHERE le.slot >= a AND le.slot < b
       AND (p_local IS NULL OR fl.local_id = p_local)
  ),
  -- uma fonte por local POR DIA: a do cadastro (se leu no dia) ou a que mais leu no dia
  escolha AS (SELECT * FROM public.eletropostos_fontes_por_dia(a, b, p_local)),
  l AS (
    SELECT l0.*,
           CASE WHEN l0.carregando
                THEN l0.passo::numeric / GREATEST(count(*) FILTER (WHERE l0.carregando) OVER (PARTITION BY l0.fonte, l0.local_fonte, l0.grupo, l0.slot), 1)
                ELSE 0 END AS energia,
           lag(l0.status) OVER w AS st_ant, lag(l0.slot) OVER w AS slot_ant
      FROM l0
      LEFT JOIN escolha e ON e.cad = l0.cad AND e.dia = (l0.slot AT TIME ZONE 'America/Sao_Paulo')::date
     WHERE l0.cad IS NULL OR e.fonte IS NULL OR l0.fonte = e.fonte
    WINDOW w AS (PARTITION BY l0.fonte, l0.local_fonte, l0.conector ORDER BY l0.slot)
  )
  SELECT cad, fonte, local_fonte, conector,
         COALESCE(sum(passo) FILTER (WHERE status = 'livre'), 0)::numeric,
         COALESCE(sum(passo) FILTER (WHERE status = 'ocupado'), 0)::numeric,
         COALESCE(sum(passo) FILTER (WHERE status = 'fora'), 0)::numeric,
         COALESCE(sum(passo) FILTER (WHERE status = 'desconhecido'), 0)::numeric,
         count(*) FILTER (WHERE status = 'ocupado'
                            AND NOT COALESCE(st_ant = 'ocupado' AND slot - slot_ant <= make_interval(mins => passo + 1), false))::integer,
         (array_agg(status ORDER BY slot DESC))[1],
         (array_agg(status_bruto ORDER BY slot DESC))[1],
         max(slot),
         (array_agg(potencia_kw ORDER BY slot DESC) FILTER (WHERE potencia_kw IS NOT NULL))[1],
         max(passo)::integer,
         COALESCE(sum(energia), 0)::numeric
    FROM l
   GROUP BY cad, fonte, local_fonte, conector
$$;
REVOKE ALL ON FUNCTION public.eletropostos_conectores(timestamptz, timestamptz, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.eletropostos_detalhe(p_local uuid, p_de date, p_ate date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  per record; p jsonb; loc public.eletroposto_local; base jsonb; cons jsonb;
  diario jsonb; perfil jsonb; linha jsonb; vinc jsonb; kw numeric; preco numeric; _fonte text;
BEGIN
  IF NOT public.is_master(auth.uid()) THEN RAISE EXCEPTION 'permission denied'; END IF;
  SELECT * INTO loc FROM public.eletroposto_local WHERE id = p_local;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO per FROM public.eletropostos_periodo(p_de, p_ate);
  p := public.eletropostos_premissas();

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'fonte', c.fonte, 'local_fonte', c.local_fonte, 'conector', c.conector,
           'nome', c.fonte || ' · ' || c.local_fonte || ' · ' || c.conector,
           'm', public.eletropostos_metricas(c, per.esperadas))
         ORDER BY c.fonte, c.local_fonte, c.conector), '[]'::jsonb)
    INTO cons FROM public.eletropostos_conectores(per.a, per.b, p_local) c;

  base := public.eletropostos_montar_local(loc, cons, p, per.dias);
  cons := base->'conectores_detalhe';
  base := base - 'conectores_detalhe';
  kw := (base->>'potencia_kw')::numeric;
  preco := (base->>'preco_efetivo')::numeric;

  -- leituras do local no período, em horário de Brasília
  CREATE TEMP TABLE IF NOT EXISTS pg_temp._fd (dia date, fonte text) ON COMMIT DROP;
  TRUNCATE pg_temp._fd;
  INSERT INTO pg_temp._fd SELECT f.dia, f.fonte FROM public.eletropostos_fontes_por_dia(per.a, per.b, p_local) f;
  SELECT string_agg(DISTINCT fonte, ', ' ORDER BY fonte) INTO _fonte FROM pg_temp._fd;
  CREATE TEMP TABLE IF NOT EXISTS pg_temp._el (slot_local timestamp, status text, nome text, passo integer, peso numeric) ON COMMIT DROP;
  TRUNCATE pg_temp._el;   -- não DELETE: o safeupdate do PostgREST recusa DELETE sem WHERE
  INSERT INTO pg_temp._el
  SELECT slot_local, status, nome, passo,
         CASE WHEN carregando THEN 1.0 / GREATEST(count(*) FILTER (WHERE carregando) OVER (PARTITION BY fonte, local_fonte, grupo, slot), 1) ELSE 0 END
    FROM (
      SELECT le.slot, le.slot AT TIME ZONE 'America/Sao_Paulo' AS slot_local, le.status, le.fonte, le.local_fonte,
             le.fonte || ' · ' || le.local_fonte || ' · ' || le.conector AS nome,
             COALESCE(le.passo_min, public.eletropostos_passo(le.fonte)) AS passo,
             public.eletropostos_carregando(le.status, le.status_bruto) AS carregando,
             public.eletropostos_grupo(COALESCE(c.agrupar, 'conector'), le.conector) AS grupo
        FROM public.eletroposto_leitura le
        JOIN public.eletroposto_fonte_local fl ON fl.fonte = le.fonte AND fl.local_fonte = le.local_fonte
        LEFT JOIN public.eletroposto_fonte_config c ON c.fonte = le.fonte
       WHERE fl.local_id = p_local AND le.slot >= per.a AND le.slot < per.b
         AND NOT EXISTS (SELECT 1 FROM pg_temp._fd f WHERE f.dia = (le.slot AT TIME ZONE 'America/Sao_Paulo')::date AND f.fonte <> le.fonte)
    ) x;

  -- série diária (todos os dias do período, mesmo sem leitura); minutos = Σ passo da fonte
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'dia', d.dia::date, 'horas_ocupado', s.oc / 60.0, 'horas_observadas', s.ob / 60.0,
           'ocupacao', CASE WHEN s.ob > 0 THEN s.oc::numeric / s.ob END,
           'receita_min', e.e[1] * preco, 'receita_max', e.e[2] * preco) ORDER BY d.dia), '[]'::jsonb)
    INTO diario
    FROM generate_series(least(p_de, p_ate), greatest(p_de, p_ate), interval '1 day') AS d(dia)
    CROSS JOIN LATERAL (
      SELECT COALESCE(sum(passo) FILTER (WHERE status = 'ocupado'), 0) AS oc,
             COALESCE(sum(passo) FILTER (WHERE status IN ('livre', 'ocupado')), 0) AS ob,
             COALESCE(sum(passo * peso), 0) AS en
        FROM pg_temp._el WHERE slot_local::date = d.dia::date) s
    CROSS JOIN LATERAL (SELECT public.eletropostos_energia(s.en / 60.0, kw, loc.tipo, p) AS e) e;

  -- perfil dia da semana (0 = segunda) × hora: fração do tempo carregando
  SELECT jsonb_agg(linha_dia ORDER BY w) INTO perfil
    FROM (
      SELECT w, jsonb_agg(CASE WHEN n > 0 THEN to_jsonb(oc::numeric / n) ELSE 'null'::jsonb END ORDER BY h) AS linha_dia
        FROM generate_series(0, 6) w
        CROSS JOIN generate_series(0, 23) h
        CROSS JOIN LATERAL (
          SELECT count(*) FILTER (WHERE status = 'ocupado') AS oc, count(*) AS n
            FROM pg_temp._el WHERE status IN ('livre', 'ocupado')
             AND extract(isodow FROM slot_local) - 1 = w AND extract(hour FROM slot_local) = h) x
       GROUP BY w) z;

  -- linha do tempo: últimas 48 h de cada conector (o que a tela desenha)
  SELECT COALESCE(jsonb_object_agg(nome, pts), '{}'::jsonb) INTO linha
    FROM (
      SELECT nome, jsonb_agg(jsonb_build_array(to_char(slot_local, 'YYYY-MM-DD"T"HH24:MI'), status) ORDER BY slot_local) AS pts
        FROM (SELECT *, max(slot_local) OVER (PARTITION BY nome) AS fim FROM pg_temp._el) t
       WHERE slot_local >= fim - interval '48 hours'
       GROUP BY nome) q;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('fonte', fonte, 'local_fonte', local_fonte, 'nome', nome,
                                               'na_conta', NOT EXISTS (SELECT 1 FROM pg_temp._fd) OR fonte IN (SELECT f.fonte FROM pg_temp._fd f))), '[]'::jsonb)
    INTO vinc FROM public.eletroposto_fonte_local WHERE local_id = p_local;

  RETURN jsonb_build_object(
    'periodo', jsonb_build_object('de', least(p_de, p_ate), 'ate', greatest(p_de, p_ate)),
    'local', base, 'conectores', cons, 'diario', diario, 'perfil', perfil,
    'linha_do_tempo', linha, 'vinculos', vinc, 'fonte_na_conta', _fonte);
END;
$$;
REVOKE ALL ON FUNCTION public.eletropostos_detalhe(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.eletropostos_detalhe(uuid, date, date) TO authenticated;

-- a escolha pelo período não é mais usada
DROP FUNCTION IF EXISTS public.eletropostos_fonte_escolhida(uuid, timestamptz, timestamptz);
