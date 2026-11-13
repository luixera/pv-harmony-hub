-- Ludmilla: a leitura agendada por e-mail passa a incluir a EDP (13/11/2026).
--
-- Até aqui ludmilla_agendar_email (cron ludmilla-enel-email, seg–sex 8h–18h de Brasília) só
-- enfileirava contas com identificacao = 'remetente' (a ENEL): a EDP ficou de fora de propósito
-- porque a 1ª leitura dela tinha de ser manual e acompanhada. Essa leitura foi em 10/11/2026
-- (8 projetos conferidos, 8 documentos, 0 falhas). Pedido do usuário: ler a EDP sozinha, de hora
-- em hora, como a ENEL.
--
-- Corpo COPIADO do prosrc vivo (pg_get_functiondef em 13/11/2026); muda SÓ o filtro das contas.
-- O agendador do portal (ludmilla_agendar_varreduras, CPFL) não é tocado. Grants: CREATE OR
-- REPLACE mantém o ACL atual (só postgres executa). O nome do cron segue ludmilla-enel-email.

CREATE OR REPLACE FUNCTION public.ludmilla_agendar_email()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _n INTEGER := 0; _a RECORD; _r RECORD; _c public.portal_cobrancas%ROWTYPE;
BEGIN
  FOR _a IN SELECT a.id, a.tenant_id FROM public.portal_accounts a
             WHERE a.enabled AND a.acompanhamento = 'email'
               -- 13/11/2026: toda conta por e-mail (a EDP, que acha pelo protocolo no assunto, entrou;
               -- antes era só identificacao = 'remetente', a ENEL). A 1ª leitura da EDP foi em 10/11.
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
          '📡 A cobrança da nota ' || coalesce(public.ludmilla_nota_na_tela(_c.nota_servico), 'sem número') || ' não saiu (o robô parou antes de enviar)',
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
$function$;
