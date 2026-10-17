-- ============================================================================
-- Eletropostos — casamento de carregadores (17/10/2026, pedido do usuário)
--
-- 1) Plugues do mesmo carregador formam um GRUPO (eletroposto_fonte_config.agrupar):
--    cury e tupi_app pelo prefixo do conector ("91748 - 1" → 91748), tupi (API)
--    pela estação, atm cada conector é um carregador.
-- 2) REGRA DO USUÁRIO: dois carros no mesmo carregador dividem a potência —
--    metade para cada. Em cada leitura, a energia do plugue = passo × (1 / nº de
--    plugues CARREGANDO no grupo naquela janela). Plugue "Em preparação" /
--    Preparing / Finishing / Suspended conta como tempo ocupado (carro conectado)
--    mas não leva energia — é o caso do Cury 80 kW, que aparecia em dobro
--    ("Carregando" + "Em preparação" no mesmo carregador).
-- 3) Ocupação e recargas seguem por plugue (cada carro conta).
-- 4) O mesmo local em duas fontes (casadas pela localização, ≤150 m): só UMA
--    entra na conta — a escolhida no cadastro (eletroposto_local.fonte_principal)
--    ou, sem escolha, a que mais leu no período. As outras continuam gravando.
-- ============================================================================

ALTER TABLE public.eletroposto_fonte_config ADD COLUMN IF NOT EXISTS agrupar text NOT NULL DEFAULT 'conector'
  CHECK (agrupar IN ('conector', 'estacao', 'prefixo'));
INSERT INTO public.eletroposto_fonte_config (fonte, passo_min, agrupar) VALUES
  ('cury', 8, 'prefixo'), ('tupi', 5, 'estacao'), ('tupi_app', 8, 'prefixo'), ('atm', 8, 'conector')
ON CONFLICT (fonte) DO UPDATE SET agrupar = EXCLUDED.agrupar;

ALTER TABLE public.eletroposto_local ADD COLUMN IF NOT EXISTS fonte_principal text;

-- o plugue está entregando energia? (ocupado, mas não em preparação/fim/suspenso)
CREATE OR REPLACE FUNCTION public.eletropostos_carregando(p_status text, p_bruto text)
RETURNS boolean LANGUAGE sql IMMUTABLE
AS $$ SELECT p_status = 'ocupado' AND COALESCE(p_bruto, '') !~* '(prepar|finish|finaliz|suspend)' $$;

-- a que carregador o plugue pertence (dentro da mesma fonte e local_fonte)
CREATE OR REPLACE FUNCTION public.eletropostos_grupo(p_agrupar text, p_conector text)
RETURNS text LANGUAGE sql IMMUTABLE
AS $$ SELECT CASE p_agrupar
                 WHEN 'estacao' THEN '*'
                 WHEN 'prefixo' THEN trim(split_part(p_conector, ' - ', 1))
                 ELSE p_conector END $$;

-- a fonte que entra na conta de um local: a do cadastro ou a que mais leu no período
CREATE OR REPLACE FUNCTION public.eletropostos_fonte_escolhida(p_local uuid, a timestamptz, b timestamptz)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT COALESCE(
    (SELECT fonte_principal FROM public.eletroposto_local WHERE id = p_local),
    (SELECT le.fonte FROM public.eletroposto_leitura le
       JOIN public.eletroposto_fonte_local fl ON fl.fonte = le.fonte AND fl.local_fonte = le.local_fonte
      WHERE fl.local_id = p_local AND le.slot >= a AND le.slot < b
      GROUP BY le.fonte ORDER BY count(*) DESC, le.fonte LIMIT 1))
$$;
REVOKE ALL ON FUNCTION public.eletropostos_fonte_escolhida(uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;

-- ── métricas por conector, agora com a energia dividida ────────────────────
DROP FUNCTION public.eletropostos_metricas(public.eletroposto_conector_agg, integer);
DROP FUNCTION public.eletropostos_conectores(timestamptz, timestamptz, uuid);
DROP TYPE public.eletroposto_conector_agg;

CREATE TYPE public.eletroposto_conector_agg AS (
  cad uuid, fonte text, local_fonte text, conector text,
  livre_min numeric, ocupado_min numeric, fora_min numeric, desconhecido_min numeric, sessoes integer,
  ultimo_status text, ultimo_bruto text, ultima_leitura timestamptz, potencia_kw numeric, passo_min integer,
  energia_min numeric      -- minutos-equivalentes à potência cheia (Σ passo × parte da potência)
);

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
  -- uma fonte por local: a do cadastro ou a que mais leu no período
  contagem AS (SELECT cad, fonte, count(*) AS n FROM l0 WHERE cad IS NOT NULL GROUP BY cad, fonte),
  escolha AS (
    SELECT DISTINCT ON (ct.cad) ct.cad, COALESCE(el.fonte_principal, ct.fonte) AS fonte
      FROM contagem ct JOIN public.eletroposto_local el ON el.id = ct.cad
     ORDER BY ct.cad, ct.n DESC, ct.fonte
  ),
  l AS (
    SELECT l0.*,
           CASE WHEN l0.carregando
                THEN l0.passo::numeric / GREATEST(count(*) FILTER (WHERE l0.carregando) OVER (PARTITION BY l0.fonte, l0.local_fonte, l0.grupo, l0.slot), 1)
                ELSE 0 END AS energia,
           lag(l0.status) OVER w AS st_ant, lag(l0.slot) OVER w AS slot_ant
      FROM l0
      LEFT JOIN escolha e ON e.cad = l0.cad
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

CREATE OR REPLACE FUNCTION public.eletropostos_metricas(c public.eletroposto_conector_agg, esperadas integer)
RETURNS jsonb LANGUAGE sql STABLE
AS $$
  SELECT jsonb_build_object(
    'horas_ocupado',     c.ocupado_min / 60.0,
    'horas_energia',     c.energia_min / 60.0,
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

-- ── local montado: energia pela potência dividida ──────────────────────────
CREATE OR REPLACE FUNCTION public.eletropostos_montar_local(loc public.eletroposto_local, cons jsonb, p jsonb, dias numeric)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  c jsonb; m jsonb; e numeric[]; kw numeric; preco numeric; custo numeric;
  h_oc numeric := 0; h_obs numeric := 0; sess integer := 0; kmin numeric := 0; kmax numeric := 0;
  cob_soma numeric := 0; cob_n integer := 0;
  agora jsonb := '{}'::jsonb; st text;
  cons_out jsonb := '[]'::jsonb;
  n integer := COALESCE(jsonb_array_length(cons), 0);
BEGIN
  kw := loc.potencia_kw;
  IF kw IS NULL THEN
    SELECT (x->'m'->>'potencia_kw')::numeric INTO kw FROM jsonb_array_elements(COALESCE(cons, '[]'::jsonb)) x
     WHERE x->'m'->>'potencia_kw' IS NOT NULL LIMIT 1;
  END IF;
  preco := COALESCE(loc.preco_kwh, (p->>'preco_kwh_padrao')::numeric);
  custo := COALESCE(loc.custo_energia_kwh, (p->>'custo_energia_kwh_padrao')::numeric);

  FOR c IN SELECT x FROM jsonb_array_elements(COALESCE(cons, '[]'::jsonb)) x LOOP
    m := c->'m';
    e := public.eletropostos_energia(COALESCE((m->>'horas_energia')::numeric, (m->>'horas_ocupado')::numeric), COALESCE(loc.potencia_kw, (m->>'potencia_kw')::numeric), loc.tipo, p);
    m := m || jsonb_build_object('kwh_min', e[1], 'kwh_max', e[2]);
    h_oc := h_oc + (m->>'horas_ocupado')::numeric;
    h_obs := h_obs + (m->>'horas_observadas')::numeric;
    sess := sess + (m->>'sessoes')::integer;
    kmin := kmin + e[1]; kmax := kmax + e[2];
    IF m->>'cobertura' IS NOT NULL THEN cob_soma := cob_soma + (m->>'cobertura')::numeric; cob_n := cob_n + 1; END IF;
    st := COALESCE(m->>'ultimo_status', 'desconhecido');
    agora := agora || jsonb_build_object(st, COALESCE((agora->>st)::integer, 0) + 1);
    cons_out := cons_out || jsonb_build_array(c || jsonb_build_object('m', m));
  END LOOP;

  RETURN to_jsonb(loc) || jsonb_build_object(
    'potencia_kw', kw,
    'preco_efetivo', preco, 'custo_efetivo', custo,
    'preco_estimado', loc.preco_kwh IS NULL, 'custo_estimado', loc.custo_energia_kwh IS NULL,
    'monitorado', n > 0,
    'conectores_monitorados', n,
    'conectores_detalhe', cons_out,
    'horas_ocupado', h_oc,
    'horas_ocupado_dia', CASE WHEN dias > 0 THEN h_oc / dias ELSE 0 END,
    'ocupacao', CASE WHEN h_obs > 0 THEN h_oc / h_obs END,
    'cobertura', CASE WHEN cob_n > 0 THEN cob_soma / cob_n END,
    'sessoes', sess,
    'kwh_min', kmin, 'kwh_max', kmax,
    'receita_min', kmin * preco, 'receita_max', kmax * preco,
    'custo_min', kmin * custo, 'custo_max', kmax * custo,
    'margem_min', kmin * (preco - custo), 'margem_max', kmax * (preco - custo),
    'agora', agora);
END;
$$;

-- ── cadastro: fonte principal ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.eletropostos_local_salvar(p_local jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _id uuid := (p_local->>'id')::uuid;
BEGIN
  IF NOT public.is_master(auth.uid()) THEN RAISE EXCEPTION 'permission denied'; END IF;
  IF _id IS NULL THEN
    INSERT INTO public.eletroposto_local (nome, cidade, tipo)
    VALUES (COALESCE(NULLIF(p_local->>'nome', ''), 'Novo local'), COALESCE(p_local->>'cidade', 'São José do Rio Preto'), COALESCE(p_local->>'tipo', 'DC'))
    RETURNING id INTO _id;
  END IF;
  UPDATE public.eletroposto_local SET
    nome              = CASE WHEN p_local ? 'nome' THEN COALESCE(NULLIF(p_local->>'nome', ''), nome) ELSE nome END,
    operadora         = CASE WHEN p_local ? 'operadora' THEN NULLIF(p_local->>'operadora', '') ELSE operadora END,
    cidade            = CASE WHEN p_local ? 'cidade' THEN NULLIF(p_local->>'cidade', '') ELSE cidade END,
    endereco          = CASE WHEN p_local ? 'endereco' THEN NULLIF(p_local->>'endereco', '') ELSE endereco END,
    lat               = CASE WHEN p_local ? 'lat' THEN (p_local->>'lat')::double precision ELSE lat END,
    lng               = CASE WHEN p_local ? 'lng' THEN (p_local->>'lng')::double precision ELSE lng END,
    tipo              = CASE WHEN p_local ? 'tipo' THEN NULLIF(p_local->>'tipo', '') ELSE tipo END,
    potencia_kw       = CASE WHEN p_local ? 'potencia_kw' THEN (p_local->>'potencia_kw')::numeric ELSE potencia_kw END,
    conectores        = CASE WHEN p_local ? 'conectores' THEN (p_local->>'conectores')::integer ELSE conectores END,
    preco_kwh         = CASE WHEN p_local ? 'preco_kwh' THEN (p_local->>'preco_kwh')::numeric ELSE preco_kwh END,
    custo_energia_kwh = CASE WHEN p_local ? 'custo_energia_kwh' THEN (p_local->>'custo_energia_kwh')::numeric ELSE custo_energia_kwh END,
    fonte_status      = CASE WHEN p_local ? 'fonte_status' THEN NULLIF(p_local->>'fonte_status', '') ELSE fonte_status END,
    observacoes       = CASE WHEN p_local ? 'observacoes' THEN NULLIF(p_local->>'observacoes', '') ELSE observacoes END,
    ativo             = CASE WHEN p_local ? 'ativo' THEN COALESCE((p_local->>'ativo')::boolean, true) ELSE ativo END,
    fonte_principal   = CASE WHEN p_local ? 'fonte_principal' THEN NULLIF(p_local->>'fonte_principal', '') ELSE fonte_principal END,
    atualizado_em     = now()
  WHERE id = _id;
  RETURN _id;
END;
$$;
REVOKE ALL ON FUNCTION public.eletropostos_local_salvar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.eletropostos_local_salvar(jsonb) TO authenticated;

-- ── detalhe: só a fonte escolhida, energia diária dividida ─────────────────
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
  _fonte := public.eletropostos_fonte_escolhida(p_local, per.a, per.b);
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
         AND (_fonte IS NULL OR le.fonte = _fonte)
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
                                               'na_conta', _fonte IS NULL OR fonte = _fonte)), '[]'::jsonb)
    INTO vinc FROM public.eletroposto_fonte_local WHERE local_id = p_local;

  RETURN jsonb_build_object(
    'periodo', jsonb_build_object('de', least(p_de, p_ate), 'ate', greatest(p_de, p_ate)),
    'local', base, 'conectores', cons, 'diario', diario, 'perfil', perfil,
    'linha_do_tempo', linha, 'vinculos', vinc, 'fonte_na_conta', _fonte);
END;
$$;
REVOKE ALL ON FUNCTION public.eletropostos_detalhe(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.eletropostos_detalhe(uuid, date, date) TO authenticated;
