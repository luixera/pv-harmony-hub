-- ============================================================================
-- LUDMILLA — cobrança da troca do relógio: "não deu para conferir se o e-mail saiu" (rodada 5, 01/11/2026)
--
-- REGRA: e-mail para a ENEL NUNCA sai em dobro. O robô manda a cobrança aprovada por SMTP
-- (worker/ludmilla/src/email/enel/enviar.ts). Se a conexão cai no meio do envio, ele confere a pasta Enviados
-- do Gmail por IMAP. Quando essa conferência TAMBÉM falha, não dá para saber se o e-mail saiu. Até aqui o robô
-- chamava ludmilla_cobranca_falhou, que devolve a cobrança para 'aguardando_envio', limpa a aprovação, não grava
-- ultima_enviada_em e abre um A fazer com o botão Enviar: quem clicasse mandaria o e-mail em dobro.
--
-- ludmilla_cobranca_sem_confirmacao(p_run_id, p_erro) faz, para UM run e NA HORA, o mesmo que o passo 2 de
-- ludmilla_cobrancas_abrir_vencidas faz depois de 30 minutos: o reset conservador, em que o e-mail é tratado
-- como POSSIVELMENTE enviado.
--   · o run fecha em 'erro' (senão ludmilla_agendar_email pula a conta para sempre), marcado sem_confirmacao;
--   · a cobrança vira 'agendada' com ultima_enviada_em = início do envio (atualizado_em, posto por
--     ludmilla_cobranca_iniciar_envio) e vence_em = início + 7 dias, sem aprovação; se já estava encerrando
--     (encerrar_apos_envio), vira 'encerrada' e não abre aviso;
--   · abre um A fazer do tipo 'aviso' (NUNCA cobrar_troca: sem botão Enviar) pedindo para conferir a pasta Enviados.
-- Se o e-mail saiu de fato, o robô confirma depois com ludmilla_cobranca_enviada(run_id, message_id), que continua
-- aceitando (o run fica marcado sem_confirmacao, como no reset de 30 min).
--
-- Copiado do prosrc VIVO de ludmilla_cobrancas_abrir_vencidas (passo 2), md5 4dce38fd1bb35cf6c6f5b2abf2e0e67e,
-- cujo texto está em 20261026120000_ludmilla_cobranca_nota_na_tela.sql. Diferenças, de propósito:
--   · TRAVA ANTES: a cobrança é travada primeiro (SELECT ... run_id = p_run_id AND situacao = 'enviando' FOR UPDATE,
--     a mesma ordem de trava do reset de 30 min: cobrança, depois run). Se ela não está 'enviando', ou se o run não
--     é um enviar_cobranca em na_fila/rodando, NADA muda (nem o run). Assim também o cobranca_id do run é conhecido.
--   · o erro vem do robô (limpo de caracteres de controle, no máximo 500) e é gravado no run e na cobrança;
--   · só o robô (service_role) chama; chamar duas vezes (o robô repete uma vez se a RPC falhar) não muda nada.
--
-- NÃO mexe em nenhuma função existente nem nos crons. md5 do prosrc VIVO, antes e depois, iguais:
--   ludmilla_cobranca_falhou ced7c0c7bc9b441267d684d7a403e3d4 · ludmilla_cobranca_enviada 8e3584795efd5fc1506eee947b9b831e
--   ludmilla_cobrancas_abrir_vencidas 4dce38fd1bb35cf6c6f5b2abf2e0e67e · ludmilla_cobranca_iniciar_envio 74ded66fb23b009d4f2def8ae612d386
--   ludmilla_cobranca_agendar 699c36efb3d8dd292ba1b5f20b5450d9 · ludmilla_agendar_email 03dae8f9f1a05c2e93bb5043b5948e9c
--   ludmilla_agendar_varreduras (CPFL) 3d0d2d0f1e7455ec701230bc925e1bde · ludmilla_aplicar_update 6183edef6c3f93810282039bdd565a26
--   ludmilla_email_registrar 5d5375a0cb842209b6fb5f82327ee579
-- ============================================================================

CREATE OR REPLACE FUNCTION public.ludmilla_cobranca_sem_confirmacao(p_run_id UUID, p_erro TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  _c public.portal_cobrancas%ROWTYPE;
  -- sem caractere de controle (nem DEL nem C1), aparado, no máximo 500; vazio vira o texto padrão
  _erro TEXT := left(coalesce(nullif(btrim(regexp_replace(coalesce(p_erro, ''), '[[:cntrl:]\u007f-\u009f]+', ' ', 'g')), ''),
                              'envio sem confirmação'), 500);
  _vence TIMESTAMPTZ;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'permission denied: só o robô registra o envio sem confirmação';
  END IF;

  -- trava a cobrança ANTES (como o reset de 30 min): só vale se ela está 'enviando' neste run
  SELECT * INTO _c FROM public.portal_cobrancas c
   WHERE c.run_id = p_run_id AND c.situacao = 'enviando' FOR UPDATE;
  IF _c.id IS NULL THEN RETURN; END IF;

  UPDATE public.portal_sync_runs
     SET situacao = 'erro', terminado_em = now(), erro = _erro,
         resultado = coalesce(resultado, '{}'::jsonb) || jsonb_build_object('sem_confirmacao', true, 'cobranca_id', _c.id)
   WHERE id = p_run_id AND tipo = 'enviar_cobranca' AND situacao IN ('na_fila', 'rodando');
  IF NOT FOUND THEN RETURN; END IF;

  IF _c.encerrar_apos_envio IS NOT NULL THEN
    -- a cobrança já estava encerrando (troca feita etc.): só registra que pode ter saído
    UPDATE public.portal_cobrancas
       SET situacao = 'encerrada', motivo_encerramento = _c.encerrar_apos_envio,
           ultima_enviada_em = _c.atualizado_em, ultimo_texto_enviado = _c.texto_aprovado,
           aprovada_por = NULL, aprovada_em = NULL, texto_aprovado = NULL,
           erro = 'envio sem confirmação: o e-mail pode ter saído', atualizado_em = now()
     WHERE id = _c.id;
  ELSE
    _vence := _c.atualizado_em + interval '7 days';   -- atualizado_em é o INÍCIO do envio (iniciar_envio)
    UPDATE public.portal_cobrancas
       SET situacao = 'agendada', ultima_enviada_em = _c.atualizado_em, ultimo_texto_enviado = _c.texto_aprovado,
           vence_em = _vence,
           aprovada_por = NULL, aprovada_em = NULL, texto_aprovado = NULL,
           erro = _erro, atualizado_em = now()
     WHERE id = _c.id;
    -- 'aviso' (e não cobrar_troca): a cobrança está agendada, não esperando decisão; um cobrar_troca aberto
    -- mostraria um Enviar que seria recusado. Sem botão Enviar: quem manda é o Gmail, depois de conferir.
    INSERT INTO public.portal_afazeres (tenant_id, account_id, project_id, tipo, titulo, mensagem)
    VALUES (_c.tenant_id, _c.account_id, _c.project_id, 'aviso',
            left('📡 Confira se a cobrança da nota ' || coalesce(public.ludmilla_nota_na_tela(_c.nota_servico), 'sem número') || ' saiu', 200),
            left('O robô não conseguiu conferir se o e-mail saiu. Veja a pasta Enviados do Gmail: se não estiver lá, responda a conversa da nota pelo próprio Gmail. '
                 || 'Por segurança, a próxima cobrança desta nota só vence em '
                 || to_char(_vence AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY') || '.', 1000));
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.ludmilla_cobranca_sem_confirmacao(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ludmilla_cobranca_sem_confirmacao(UUID, TEXT) TO service_role;
COMMENT ON FUNCTION public.ludmilla_cobranca_sem_confirmacao(UUID, TEXT) IS
  'Só o robô (service_role). Envio por SMTP que caiu no meio e cuja conferência na pasta Enviados também falhou: faz na hora o reset conservador (pode ter saído). Run em erro/sem_confirmacao; cobrança agendada com ultima_enviada_em = início e vence_em = início + 7 dias (ou encerrada, se já estava encerrando); A fazer aviso sem botão Enviar. ludmilla_cobranca_enviada(run_id, message_id) segue aceitando a confirmação atrasada.';

NOTIFY pgrst, 'reload schema';
