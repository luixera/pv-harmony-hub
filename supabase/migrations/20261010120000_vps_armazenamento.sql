-- Armazenamento da VPS no painel de monitoramento.
--
-- Spec: docs/superpowers/specs/2026-10-10-capacidade-rede-design.md §5
-- Plano: docs/superpowers/plans/2026-10-10-painel-armazenamento-vps.md
--
-- A SPA é estática e não vê o disco da VPS. Quem vê é o worker da Ludmilla,
-- que já roda lá e já fala com o banco: ele mede num batimento e grava aqui
-- por RPC (service role). O console lê pela console_vps_armazenamento, no
-- mesmo padrão das outras console_*.
--
-- Por que isso existe antes do mapa de capacidade de rede: a importação da
-- BDGD baixa e descompacta gigabytes na mesma máquina que serve o app. Ficar
-- sem disco no meio é falha silenciosa — melhor ver o aperto chegando.

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
AS $fn$
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Só o service role registra medição de disco';
  END IF;
  INSERT INTO public.vps_armazenamento
    (host, particao, total_bytes, usado_bytes, livre_bytes, origem, etapa)
  VALUES (p_host, p_particao, p_total, p_usado, p_livre, p_origem, p_etapa);
END $fn$;

REVOKE EXECUTE ON FUNCTION public.vps_armazenamento_registrar(TEXT, TEXT, BIGINT, BIGINT, BIGINT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;

-- ── Leitura: última medição + série diária ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.console_vps_armazenamento(p_dias INTEGER DEFAULT 30)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
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
  )
  SELECT jsonb_build_object(
    'atual', (SELECT to_jsonb(a) FROM atual a),
    'serie', COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.dia) FROM serie s), '[]'::jsonb)
  );
$fn$;

REVOKE EXECUTE ON FUNCTION public.console_vps_armazenamento(INTEGER) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.console_vps_armazenamento(INTEGER) TO authenticated;

-- ── Retenção: 90 dias ───────────────────────────────────────────────────────
-- Minuto 17 para não disputar o :00 com os outros jobs.
SELECT cron.unschedule('vps_armazenamento_retencao')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'vps_armazenamento_retencao');

SELECT cron.schedule(
  'vps_armazenamento_retencao',
  '17 4 * * *',
  $job$DELETE FROM public.vps_armazenamento WHERE medido_em < now() - INTERVAL '90 days'$job$
);
