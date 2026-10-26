-- ============================================================================
-- LUDMILLA — cobrança da troca do relógio: run preso e dispensar só por pessoa (rodada 2, 26/10/2026)
-- Corrige o que ficou das preocupações da rodada 1 (20261025120000_ludmilla_cobranca_ajustes.sql).
--
-- 1. Run que morreu em 'rodando' parava a leitura de hora em hora: ludmilla_agendar_email pula a conta
--    com run aberto, e NENHUM lugar fechava o run. Agora, ANTES de procurar run aberto, para cada conta
--    elegível, todo run 'rodando' com iniciado_em há mais de 2 horas é fechado como erro (a leitura de
--    120 dias leva de 18 a 46 s). Se o run é de enviar_cobranca e a cobrança dele AINDA NÃO chegou a
--    'enviando' (nada saiu), ela volta para a equipe pelo mesmo caminho de falha do desenho (aprovação
--    limpa, erro gravado, A fazer "o robô parou antes de enviar; nada saiu — pode clicar em Enviar de
--    novo"). Se a cobrança está 'enviando', NADA é tocado aqui (nem o run): o reset de 30 min de
--    ludmilla_cobrancas_abrir_vencidas é o dono desse estado, e fechar o run antes dele tiraria a
--    marca sem_confirmacao e a confirmação atrasada. Run 'na_fila' nunca é tocado: a fila é do worker.
--    Como a função é do cron e não tem sessão de robô, o caminho de falha é feito aqui, sem chamar
--    ludmilla_cobranca_falhou (que exige service_role).
--    A elegibilidade passa a exigir também o tenant biblioteca (GD Manager): a Ludmilla é só dele
--    (ludmilla_equipe_ok), e assim conta de outro tenant nunca é lida, enfileirada nem fechada.
-- 2. ludmilla_cobranca_dispensar também só por PESSOA (ludmilla_pessoa_da_equipe), como aprovar.
--
-- md5 do prosrc VIVO antes desta migração (cada corpo abaixo é cópia dele, com as mudanças marcadas R2,
-- exceto ludmilla_agendar_email, reescrita):
--   ludmilla_agendar_email        e486208f018c409bdea145375e76cee3
--   ludmilla_cobranca_dispensar   539b430208e0893699da567675e682b1
--
-- NÃO mexe em: ludmilla_agendar_varreduras (CPFL, 3d0d2d0f1e7455ec701230bc925e1bde), ludmilla_aplicar_update (6183edef6c3f93810282039bdd565a26),
-- ludmilla_email_registrar (5d5375a0cb842209b6fb5f82327ee579), ludmilla_equipe_ok (144f52037d242b2c3e267169c80fcad0), ludmilla_claim_run (ae9483442de82621cb7307fccb656898),
-- nem nos crons (o de 20261024170000 continua sem ser aplicado). Assinaturas iguais.
-- ============================================================================

-- ── 1. A leitura agendada fecha o run que morreu em 'rodando' ─────────────────
CREATE OR REPLACE FUNCTION public.ludmilla_agendar_email()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _n INTEGER := 0; _a RECORD; _r RECORD; _c public.portal_cobrancas%ROWTYPE;
BEGIN
  FOR _a IN SELECT a.id, a.tenant_id FROM public.portal_accounts a
             WHERE a.enabled AND a.acompanhamento = 'email' AND a.identificacao = 'remetente'
               AND coalesce(a.modo, 'vps') <> 'local'
               -- R2: só o tenant biblioteca (GD Manager); a Ludmilla é só dele
               AND EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = a.tenant_id AND t.is_library) LOOP

    -- R2: run que morreu em 'rodando' há mais de 2 horas (o robô parou no meio): fecha, senão a conta
    -- fica pulada para sempre. 'na_fila' não é tocado (a fila é do worker).
    FOR _r IN SELECT r.id, r.tipo FROM public.portal_sync_runs r
               WHERE r.account_id = _a.id AND r.situacao = 'rodando'
                 AND r.iniciado_em < now() - interval '2 hours' LOOP
      _c := NULL;
      IF _r.tipo = 'enviar_cobranca' THEN
        -- trava a cobrança ANTES de decidir: ludmilla_cobranca_iniciar_envio espera nesta trava
        SELECT * INTO _c FROM public.portal_cobrancas c WHERE c.run_id = _r.id FOR UPDATE;
        -- cobrança 'enviando': o reset de 30 min (ludmilla_cobrancas_abrir_vencidas) é o dono; nem o run se toca
        IF _c.id IS NOT NULL AND _c.situacao = 'enviando' THEN CONTINUE; END IF;
      END IF;
      UPDATE public.portal_sync_runs
         SET situacao = 'erro', terminado_em = now(),
             erro = 'o robô parou no meio e o run foi fechado pela leitura agendada (rodando há mais de 2 horas)'
       WHERE id = _r.id AND situacao = 'rodando';
      IF NOT FOUND THEN CONTINUE; END IF;
      -- enviar_cobranca que caiu ANTES de iniciar_envio: nada saiu; volta para a equipe, que pode aprovar de novo
      IF _r.tipo = 'enviar_cobranca' AND _c.id IS NOT NULL AND _c.situacao = 'aguardando_envio' THEN
        UPDATE public.portal_cobrancas
           SET aprovada_por = NULL, aprovada_em = NULL, erro = 'o robô parou antes de enviar; nada saiu', atualizado_em = now()
         WHERE id = _c.id;
        PERFORM public.ludmilla_cobranca_abrir_afazer(_c.id,
          '📡 A cobrança da nota ' || coalesce(_c.nota_servico, 'sem número') || ' não saiu (o robô parou antes de enviar)',
          'O robô parou antes de enviar; nada saiu — pode clicar em Enviar de novo.');
      END IF;
    END LOOP;

    IF NOT EXISTS (SELECT 1 FROM public.portal_sync_runs r
                    WHERE r.account_id = _a.id AND r.situacao IN ('na_fila', 'rodando')) THEN
      INSERT INTO public.portal_sync_runs (tenant_id, account_id, tipo) VALUES (_a.tenant_id, _a.id, 'varredura_email');
      _n := _n + 1;
    END IF;
  END LOOP;
  RETURN _n;
END;
$$;
REVOKE ALL ON FUNCTION public.ludmilla_agendar_email() FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION public.ludmilla_agendar_email() IS
  'Fecha o run de e-mail que morreu em rodando há mais de 2 horas (e devolve à equipe a cobrança que ainda não tinha saído) e enfileira varredura_email para as contas de e-mail por remetente (ENEL) do tenant biblioteca, ligadas, fora da estação local e sem run aberto. Chamada pelo cron ludmilla-enel-email (seg–sex, 8h–18h de Brasília). Não é o agendador da CPFL.';

-- ── 2. Dispensar também só por PESSOA ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ludmilla_cobranca_dispensar(p_cobranca_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _uid UUID := (SELECT auth.uid()); _tenant UUID; _c public.portal_cobrancas%ROWTYPE;
BEGIN
  IF _uid IS NULL OR NOT public.ludmilla_equipe_ok() THEN RAISE EXCEPTION 'Sem acesso à Ludmilla.'; END IF;
  -- R2: dispensar também é ato de uma PESSOA da equipe (como aprovar). ludmilla_equipe_ok() deixa passar os
  -- perfis-agente (Ludmilla, Bidu); um robô que dispensa apagaria a cobrança sem ninguém ver.
  IF NOT public.ludmilla_pessoa_da_equipe(_uid) THEN
    RAISE EXCEPTION 'Só uma pessoa da equipe pode dispensar uma cobrança.';
  END IF;
  _tenant := public.get_user_tenant_id(_uid);
  SELECT * INTO _c FROM public.portal_cobrancas WHERE id = p_cobranca_id AND tenant_id = _tenant FOR UPDATE;
  IF _c.id IS NULL THEN RAISE EXCEPTION 'Cobrança não encontrada.'; END IF;
  IF _c.situacao IN ('dispensada', 'encerrada') THEN RETURN FALSE; END IF;
  IF _c.situacao = 'enviando' THEN RAISE EXCEPTION 'O envio desta cobrança já começou.'; END IF;
  UPDATE public.portal_cobrancas
     SET situacao = 'dispensada', encerrada_por = _uid, motivo_encerramento = 'dispensada pela equipe', atualizado_em = now()
   WHERE id = _c.id;
  PERFORM public.ludmilla_cobranca_fechar_afazer(_c.id, _uid);
  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION public.ludmilla_cobranca_dispensar(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ludmilla_cobranca_dispensar(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
