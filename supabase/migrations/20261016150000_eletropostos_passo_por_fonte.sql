-- ============================================================================
-- Eletropostos — passo de coleta por fonte (16/10/2026)
--
-- Pedido do usuário: Cury e ATM EVs passam a ser lidos a cada 8 min (o ciclo
-- do ATM leva ~4,5 min e encostava nos 5). A Tupi segue em 5. A regra "cada
-- janela ocupado vale 5 min" vira "cada leitura ocupado vale o PASSO da sua
-- fonte": horas = Σ passo; recarga nova quando o intervalo entre leituras
-- ocupado passa de passo + 1 min; cobertura = minutos lidos / minutos do
-- período. Para fontes de 5 min nada muda (a validação sintética continua
-- 28/28). O slot continua na grade de 5 min (UNIQUE por janela).
-- ============================================================================

CREATE TABLE public.eletroposto_fonte_config (
  fonte          text PRIMARY KEY,
  tenant_id      uuid NOT NULL DEFAULT public.eletropostos_tenant() REFERENCES public.tenants(id) ON DELETE CASCADE,
  passo_min      integer NOT NULL CHECK (passo_min BETWEEN 1 AND 60),
  atualizado_em  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.eletroposto_fonte_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.eletroposto_fonte_config AS RESTRICTIVE FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id((select auth.uid())))
  WITH CHECK (tenant_id = public.get_user_tenant_id((select auth.uid())));
CREATE POLICY eletroposto_fonte_config_master_le ON public.eletroposto_fonte_config FOR SELECT TO authenticated
  USING ((SELECT public.is_master(auth.uid())));

INSERT INTO public.eletroposto_fonte_config (fonte, passo_min) VALUES ('tupi', 5), ('cury', 8), ('atm', 8);

CREATE OR REPLACE FUNCTION public.eletropostos_passo(p_fonte text)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT COALESCE((SELECT passo_min FROM public.eletroposto_fonte_config WHERE fonte = p_fonte), 5) $$;
REVOKE ALL ON FUNCTION public.eletropostos_passo(text) FROM PUBLIC, anon;

-- ── métricas por conector, em MINUTOS ponderados pelo passo ─────────────────
DROP FUNCTION public.eletropostos_metricas(public.eletroposto_conector_agg, integer);
DROP FUNCTION public.eletropostos_conectores(timestamptz, timestamptz, uuid);
DROP TYPE public.eletroposto_conector_agg;

CREATE TYPE public.eletroposto_conector_agg AS (
  cad uuid, fonte text, local_fonte text, conector text,
  livre_min numeric, ocupado_min numeric, fora_min numeric, desconhecido_min numeric, sessoes integer,
  ultimo_status text, ultimo_bruto text, ultima_leitura timestamptz, potencia_kw numeric, passo_min integer
);

CREATE OR REPLACE FUNCTION public.eletropostos_conectores(a timestamptz, b timestamptz, p_local uuid DEFAULT NULL)
RETURNS SETOF public.eletroposto_conector_agg
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  WITH l AS (
    SELECT le.slot, le.fonte, le.local_fonte, le.conector, le.potencia_kw, le.status, le.status_bruto,
           fl.local_id AS cad,
           COALESCE(c.passo_min, 5) AS passo,
           lag(le.status) OVER w AS st_ant, lag(le.slot) OVER w AS slot_ant
      FROM public.eletroposto_leitura le
      LEFT JOIN public.eletroposto_fonte_local fl ON fl.fonte = le.fonte AND fl.local_fonte = le.local_fonte
      LEFT JOIN public.eletroposto_fonte_config c ON c.fonte = le.fonte
     WHERE le.slot >= a AND le.slot < b
       AND (p_local IS NULL OR fl.local_id = p_local)
    WINDOW w AS (PARTITION BY le.fonte, le.local_fonte, le.conector ORDER BY le.slot)
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
         max(passo)::integer
    FROM l
   GROUP BY cad, fonte, local_fonte, conector
$$;
REVOKE ALL ON FUNCTION public.eletropostos_conectores(timestamptz, timestamptz, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.eletropostos_metricas(c public.eletroposto_conector_agg, esperadas integer)
RETURNS jsonb LANGUAGE sql STABLE
AS $$
  SELECT jsonb_build_object(
    'horas_ocupado',     c.ocupado_min / 60.0,
    'horas_observadas',  (c.livre_min + c.ocupado_min) / 60.0,
    'horas_fora',        c.fora_min / 60.0,
    'ocupacao',          CASE WHEN c.livre_min + c.ocupado_min > 0 THEN c.ocupado_min / (c.livre_min + c.ocupado_min) END,
    'cobertura',         CASE WHEN esperadas > 0 THEN least(1, (c.livre_min + c.ocupado_min + c.fora_min) / (esperadas * 5.0)) END,
    'sessoes',           c.sessoes,
    'duracao_media_min', CASE WHEN c.sessoes > 0 THEN c.ocupado_min / c.sessoes END,
    'ultimo_status',     c.ultimo_status,
    'ultimo_bruto',      c.ultimo_bruto,
    'ultima_leitura',    c.ultima_leitura,
    'potencia_kw',       c.potencia_kw,
    'passo_min',         c.passo_min)
$$;

-- ── detalhe: série diária em minutos ponderados ─────────────────────────────
CREATE OR REPLACE FUNCTION public.eletropostos_detalhe(p_local uuid, p_de date, p_ate date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  per record; p jsonb; loc public.eletroposto_local; base jsonb; cons jsonb;
  diario jsonb; perfil jsonb; linha jsonb; vinc jsonb; kw numeric; preco numeric;
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
  CREATE TEMP TABLE IF NOT EXISTS pg_temp._el (slot_local timestamp, status text, nome text, passo integer) ON COMMIT DROP;
  TRUNCATE pg_temp._el;   -- não DELETE: o safeupdate do PostgREST recusa DELETE sem WHERE
  INSERT INTO pg_temp._el
  SELECT le.slot AT TIME ZONE 'America/Sao_Paulo', le.status, le.fonte || ' · ' || le.local_fonte || ' · ' || le.conector,
         public.eletropostos_passo(le.fonte)
    FROM public.eletroposto_leitura le
    JOIN public.eletroposto_fonte_local fl ON fl.fonte = le.fonte AND fl.local_fonte = le.local_fonte
   WHERE fl.local_id = p_local AND le.slot >= per.a AND le.slot < per.b;

  -- série diária (todos os dias do período, mesmo sem leitura); minutos = Σ passo da fonte
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'dia', d.dia::date, 'horas_ocupado', s.oc / 60.0, 'horas_observadas', s.ob / 60.0,
           'ocupacao', CASE WHEN s.ob > 0 THEN s.oc::numeric / s.ob END,
           'receita_min', e.e[1] * preco, 'receita_max', e.e[2] * preco) ORDER BY d.dia), '[]'::jsonb)
    INTO diario
    FROM generate_series(least(p_de, p_ate), greatest(p_de, p_ate), interval '1 day') AS d(dia)
    CROSS JOIN LATERAL (
      SELECT COALESCE(sum(passo) FILTER (WHERE status = 'ocupado'), 0) AS oc,
             COALESCE(sum(passo) FILTER (WHERE status IN ('livre', 'ocupado')), 0) AS ob
        FROM pg_temp._el WHERE slot_local::date = d.dia::date) s
    CROSS JOIN LATERAL (SELECT public.eletropostos_energia(s.oc / 60.0, kw, loc.tipo, p) AS e) e;

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

  SELECT COALESCE(jsonb_agg(jsonb_build_object('fonte', fonte, 'local_fonte', local_fonte, 'nome', nome)), '[]'::jsonb)
    INTO vinc FROM public.eletroposto_fonte_local WHERE local_id = p_local;

  RETURN jsonb_build_object(
    'periodo', jsonb_build_object('de', least(p_de, p_ate), 'ate', greatest(p_de, p_ate)),
    'local', base, 'conectores', cons, 'diario', diario, 'perfil', perfil,
    'linha_do_tempo', linha, 'vinculos', vinc);
END;
$$;

