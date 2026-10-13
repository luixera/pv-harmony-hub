-- ============================================================================
-- A VPS NÃO PEGA MAIS RUN DE CONTA EM MODO ESTAÇÃO LOCAL (13/10/2026)
--
-- `ludmilla_claim_run` (a fila da VPS) selecionava qualquer run `na_fila`, sem
-- olhar o modo da conta. Como a VPS está sempre ligada e consulta a fila a cada
-- 5–30 s, ela chegava primeiro e engolia os pedidos da Elektro — que só a
-- estação local consegue executar, porque o Portal GD exige Chrome real em IP
-- de pessoa e um humano para digitar o código da imagem.
--
-- O sintoma era enganoso: o run morria em 1,5 s com "o portal exige CAPTCHA e a
-- Ludmilla não resolve CAPTCHA" (o guarda `soNaEstacao()` do conector), nenhum
-- código era fotografado, e a estação — online e pulsando — ficava esperando um
-- pedido que nunca chegava.
--
-- A fila da estação (`ludmilla_claim_run_local`) já filtrava `a.modo = 'local'`
-- e o operador; faltava o espelho do outro lado. Esta função é a original, com
-- UMA linha a mais: a trava de `service_role` e o resto seguem intocados.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.ludmilla_claim_run()
RETURNS SETOF portal_sync_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE _id UUID;
BEGIN
  IF (select auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'permission denied: só o robô pega runs';
  END IF;
  SELECT r.id INTO _id
    FROM public.portal_sync_runs r
    JOIN public.portal_accounts a ON a.id = r.account_id AND a.enabled
   WHERE r.situacao = 'na_fila'
     -- conta de estação local é da estação: a VPS não tem como digitar o código
     AND coalesce(a.modo, 'vps') <> 'local'
   ORDER BY r.pedido_em
   FOR UPDATE OF r SKIP LOCKED
   LIMIT 1;
  IF _id IS NULL THEN RETURN; END IF;
  RETURN QUERY
    UPDATE public.portal_sync_runs
       SET situacao = 'rodando', iniciado_em = now()
     WHERE id = _id
    RETURNING *;
END;
$function$;
