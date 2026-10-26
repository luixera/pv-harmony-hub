-- ============================================================================
-- LUDMILLA — cobrança da troca do relógio: só notas NOVAS (rodada 4, 26/10/2026)
--
-- Decisão do usuário (25/10/2026): "só daqui para frente". As notas de serviço já lidas NÃO viram cobrança,
-- nem por "Ler de novo" (ludmilla_email_reler). Até aqui nada garantia isso. Três caminhos criariam cobrança
-- vencida: (1) um "Ler de novo" num dos avisos de nota antigos; (2) a leitura de maio a outubro, quando o
-- limite das pastas IMAP do Gmail for tirado; (3) qualquer releitura futura.
--
-- ludmilla_cobranca_agendar passa a devolver 'anterior_ao_inicio', SEM criar nem atualizar nada, quando
-- p_data_nota é anterior a 25/10/2026 00:00 de Brasília ('2026-10-25 00:00:00-03' = '2026-10-25 03:00:00+00'),
-- ou quando não há data. O corte vive num lugar só: a constante _inicio dentro da função (só ela cria cobrança).
-- Cobrança que JÁ existe não é afetada; nota nova (data >= corte) que atualiza uma cobrança existente continua
-- funcionando. O worker (worker/ludmilla/src/email/enel/run.ts) só trata criada/atualizada; qualquer outro valor é
-- só log (a mensagem conclui normalmente), então o worker não muda.
--
-- md5 do prosrc VIVO antes desta migração (o corpo abaixo é cópia dele, com a mudança marcada R4):
--   ludmilla_cobranca_agendar   8fe44f69f19d685610f0d81408fc11a9
--
-- NÃO mexe em: ludmilla_agendar_varreduras (CPFL, 3d0d2d0f1e7455ec701230bc925e1bde), ludmilla_aplicar_update (6183edef6c3f93810282039bdd565a26),
-- ludmilla_email_registrar (5d5375a0cb842209b6fb5f82327ee579), ludmilla_agendar_email (03dae8f9f1a05c2e93bb5043b5948e9c),
-- ludmilla_email_reler (e63562759af50fc877beb1257b9be69c), nem nos crons. Assinatura igual.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.ludmilla_cobranca_agendar(
  p_account_id UUID, p_message_id TEXT, p_project_id UUID, p_nota TEXT, p_data_nota TIMESTAMPTZ,
  p_prazo_dias INTEGER, p_para TEXT, p_assunto TEXT, p_in_reply_to TEXT, p_referencias TEXT
) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  _conta public.portal_accounts%ROWTYPE; _proj public.projects%ROWTYPE; _msg UUID;
  _c public.portal_cobrancas%ROWTYPE; _id UUID; _resultado TEXT; _velha RECORD;
  _nota TEXT := nullif(btrim(coalesce(p_nota, '')), '');
  _prazo INTEGER := CASE WHEN p_prazo_dias BETWEEN 1 AND 365 THEN p_prazo_dias END;
  -- R1 (M-4): as MESMAS expressões das CHECKs da tabela (sem controle de nenhum tipo; References com no
  -- máximo 20 itens e 2000 caracteres). O que não passa vira NULL, como antes: a cobrança é criada sem o cabeçalho.
  _irt TEXT := CASE WHEN p_in_reply_to ~ '^<[^<>[:cntrl:][:space:]\u007f-\u009f]+@[^<>[:cntrl:][:space:]\u007f-\u009f]+>$' THEN p_in_reply_to END;
  _refs TEXT := CASE WHEN length(p_referencias) <= 2000 AND p_referencias ~ '^<[^<>[:cntrl:][:space:]\u007f-\u009f]+@[^<>[:cntrl:][:space:]\u007f-\u009f]+>( <[^<>[:cntrl:][:space:]\u007f-\u009f]+@[^<>[:cntrl:][:space:]\u007f-\u009f]+>){0,19}$'
                     THEN p_referencias END;
  _assunto TEXT := left(btrim(regexp_replace(coalesce(p_assunto, ''), '[[:cntrl:]\u007f-\u009f]+', ' ', 'g')), 300);
  -- R4: O CORTE. Decisão do usuário de 25/10/2026: "só daqui para frente". Só valem notas de serviço cujo e-mail
  -- é de 25/10/2026 00:00 (Brasília, UTC-3) em diante (= '2026-10-25 03:00:00+00'). As notas já lidas antes disso
  -- (e as de maio a outubro que uma leitura mais longa da caixa trouxer) NÃO viram cobrança, nem por "Ler de novo".
  -- É o ÚNICO lugar do corte: só esta função cria cobrança.
  _inicio CONSTANT TIMESTAMPTZ := '2026-10-25 00:00:00-03';
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'permission denied: só o robô agenda cobranças';
  END IF;
  -- R4: nota de antes do corte (ou sem data, que não dá para provar que é nova): não cria NEM atualiza nada. O worker
  -- trata qualquer resposta que não seja criada/atualizada como "só loga". Cobrança que JÁ existe não é afetada.
  IF p_data_nota IS NULL OR p_data_nota < _inicio THEN RETURN 'anterior_ao_inicio'; END IF;
  IF _nota IS NOT NULL AND _nota !~ '^[0-9]{12}$' THEN _nota := NULL; END IF;
  IF _assunto = '' THEN _assunto := 'RE: TROCA DE RELÓGIO'; END IF;

  SELECT * INTO _conta FROM public.portal_accounts WHERE id = p_account_id;
  IF _conta.id IS NULL OR _conta.connector <> 'enel' THEN RETURN 'conta_recusada'; END IF;
  SELECT * INTO _proj FROM public.projects
   WHERE id = p_project_id AND tenant_id = _conta.tenant_id AND concessionaire_id = _conta.concessionaire_id;
  IF _proj.id IS NULL OR _proj.is_deleted OR _proj.archived_at IS NOT NULL OR _proj.status::text = 'completed' THEN
    RETURN 'projeto_inativo';
  END IF;
  IF NOT public.ludmilla_endereco_da_enel(p_para) THEN RETURN 'para_recusado'; END IF;
  SELECT m.id INTO _msg FROM public.portal_email_mensagens m
   WHERE m.account_id = p_account_id AND m.message_id = p_message_id AND m.protocolo = '';
  IF _msg IS NULL THEN RETURN 'mensagem_inexistente'; END IF;

  -- e-mail mais velho que a nota em andamento do projeto (2ª leitura de um e-mail antigo)
  IF EXISTS (SELECT 1 FROM public.portal_cobrancas c
              WHERE c.project_id = p_project_id AND c.situacao IN ('agendada', 'aguardando_envio', 'enviando')
                AND c.data_nota > p_data_nota AND c.nota_servico IS DISTINCT FROM _nota) THEN
    RETURN 'mais_antiga';
  END IF;

  IF _nota IS NOT NULL THEN
    SELECT * INTO _c FROM public.portal_cobrancas c
     WHERE c.account_id = p_account_id AND c.nota_servico = _nota FOR UPDATE;
  END IF;
  IF _c.id IS NULL THEN
    SELECT * INTO _c FROM public.portal_cobrancas c WHERE c.mensagem_id = _msg FOR UPDATE;
  END IF;

  IF _c.id IS NULL THEN
    INSERT INTO public.portal_cobrancas
      (tenant_id, account_id, project_id, nota_servico, mensagem_id, data_nota, prazo_dias,
       para, assunto, in_reply_to, referencias, vence_em)
    VALUES
      (_conta.tenant_id, p_account_id, p_project_id, _nota, _msg, p_data_nota, _prazo,
       p_para, _assunto, _irt, _refs, p_data_nota + interval '7 days')
    RETURNING id INTO _id;
    _resultado := 'criada';
  ELSIF _c.nota_servico IS NOT NULL AND _nota IS NOT NULL AND _c.nota_servico <> _nota THEN
    RETURN 'mantida';
  ELSIF _c.situacao IN ('agendada', 'aguardando_envio')
        AND (p_data_nota > _c.data_nota OR (_c.nota_servico IS NULL AND _nota IS NOT NULL)) THEN
    -- o mesmo e-mail pode estar preso a outra linha (sem número): solta antes de mover
    UPDATE public.portal_cobrancas SET mensagem_id = NULL WHERE mensagem_id = _msg AND id <> _c.id;
    UPDATE public.portal_cobrancas
       SET nota_servico = coalesce(_nota, nota_servico), mensagem_id = _msg,
           data_nota = greatest(p_data_nota, data_nota), prazo_dias = _prazo,
           para = p_para, assunto = _assunto, in_reply_to = _irt, referencias = _refs,
           vence_em = greatest(p_data_nota, data_nota) + interval '7 days', situacao = 'agendada',
           aprovada_por = NULL, aprovada_em = NULL, texto_aprovado = NULL, erro = NULL, atualizado_em = now()
     WHERE id = _c.id;
    -- a ENEL respondeu (reenviou ou reprogramou): o A fazer aberto perdeu o sentido
    PERFORM public.ludmilla_cobranca_fechar_afazer(_c.id, NULL);
    _id := _c.id;
    _resultado := 'atualizada';
  ELSE
    RETURN 'mantida';
  END IF;

  -- a nota NOVA (com número) encerra as mais antigas do mesmo projeto
  IF _nota IS NOT NULL THEN
    FOR _velha IN SELECT c.id, c.situacao FROM public.portal_cobrancas c
                   WHERE c.project_id = p_project_id AND c.id <> _id
                     AND c.situacao IN ('agendada', 'aguardando_envio', 'enviando')
                     AND c.nota_servico IS DISTINCT FROM _nota AND c.data_nota <= p_data_nota
                   FOR UPDATE LOOP
      IF _velha.situacao = 'enviando' THEN
        -- R1 (M-6): o e-mail dela está saindo e não dá para desfazer; marca, e quem registra o envio encerra
        -- (sem mexer em atualizado_em: é o início do envio, que o reset de 30 min usa)
        UPDATE public.portal_cobrancas SET encerrar_apos_envio = 'substituída pela nota ' || public.ludmilla_nota_na_tela(_nota)
         WHERE id = _velha.id AND encerrar_apos_envio IS NULL;
      ELSE
        UPDATE public.portal_cobrancas
           SET situacao = 'encerrada', motivo_encerramento = 'substituída pela nota ' || public.ludmilla_nota_na_tela(_nota), atualizado_em = now()
         WHERE id = _velha.id;
        PERFORM public.ludmilla_cobranca_fechar_afazer(_velha.id, NULL);
      END IF;
    END LOOP;
  END IF;
  RETURN _resultado;
END;
$$;
REVOKE ALL ON FUNCTION public.ludmilla_cobranca_agendar(UUID, TEXT, UUID, TEXT, TIMESTAMPTZ, INTEGER, TEXT, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ludmilla_cobranca_agendar(UUID, TEXT, UUID, TEXT, TIMESTAMPTZ, INTEGER, TEXT, TEXT, TEXT, TEXT)
  TO service_role;

NOTIFY pgrst, 'reload schema';
