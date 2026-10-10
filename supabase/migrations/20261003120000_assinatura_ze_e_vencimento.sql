-- ============================================================================
-- ASSINATURA — o Zé e o vencimento do certificado (03/10/2026)
--
-- O Zé avisa toda assinatura (recado) e autoriza a exceção: documento fora do
-- catálogo ou com "dúvida" na triagem só assina com o "pode" do gestor.
-- ============================================================================

-- ── O CHECK de ze_pending_actions passa a aceitar a liberação ───────────────
ALTER TABLE public.ze_pending_actions DROP CONSTRAINT IF EXISTS ze_pending_actions_tipo_check;
ALTER TABLE public.ze_pending_actions
  ADD CONSTRAINT ze_pending_actions_tipo_check
  CHECK (tipo IN ('mover_etapa', 'liberar_assinatura'));

-- ── O robô abre a pendência para o gestor ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.assinatura_pedir_ao_ze(p_id UUID)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _a public.assinaturas; _pend UUID; _codigo TEXT; _nome TEXT; _arquivo TEXT; _quem TEXT;
BEGIN
  IF (select auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
  END IF;

  -- Duas chamadas ao mesmo tempo para a mesma assinatura esperam uma pela
  -- outra: sem isto as duas veriam "não tem pendência" e abririam duas.
  PERFORM pg_advisory_xact_lock(hashtextextended('assinatura_pedir_ao_ze:' || p_id::text, 0));

  SELECT * INTO _a FROM public.assinaturas WHERE id = p_id AND situacao = 'aguardando_ze';
  IF _a.id IS NULL THEN RETURN NULL; END IF;

  -- não empilha: uma pendência por assinatura
  SELECT id INTO _pend FROM public.ze_pending_actions
   WHERE tipo = 'liberar_assinatura' AND situacao = 'pendente'
     AND (payload->>'assinatura_id')::uuid = p_id;
  IF _pend IS NOT NULL THEN RETURN _pend; END IF;

  SELECT pr.code INTO _codigo FROM public.projects pr WHERE pr.id = _a.project_id;
  SELECT da.nome INTO _nome FROM public.documentos_assinaveis da WHERE da.id = _a.assinavel_id;
  SELECT d.file_name INTO _arquivo FROM public.documents d WHERE d.id = _a.document_id;
  SELECT p.name INTO _quem FROM public.profiles p WHERE p.id = _a.pedida_por;

  -- O resumo entra no prompt do Zé ("esperando a palavra dele"). Nome de arquivo
  -- e motivo da triagem vêm de fora (a IA lê o documento), então vão numa linha
  -- só e com tamanho limitado: nada de quebra de linha para fingir instrução.
  INSERT INTO public.ze_pending_actions (tenant_id, tipo, payload, resumo)
  VALUES (_a.tenant_id, 'liberar_assinatura',
          jsonb_build_object('assinatura_id', p_id, 'project_id', _a.project_id),
          coalesce(left(regexp_replace(_quem, '\s+', ' ', 'g'), 80), 'Alguém')
            || ' quer assinar "' || coalesce(left(regexp_replace(_arquivo, '\s+', ' ', 'g'), 120), 'documento')
            || '" no ' || coalesce(_codigo, 'projeto') || ' como ' || coalesce(_nome, 'documento')
            || '. ' || coalesce(left(regexp_replace(_a.recusa, '\s+', ' ', 'g'), 300), 'A triagem ficou em dúvida.')
            || ' Libero?')
  RETURNING id INTO _pend;
  RETURN _pend;
END;
$$;
REVOKE ALL ON FUNCTION public.assinatura_pedir_ao_ze(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assinatura_pedir_ao_ze(UUID) TO service_role;

-- ── O "pode" (ou o "não") do gestor cai aqui (o mesmo caminho do mover_etapa) ─
CREATE OR REPLACE FUNCTION public.ze_resolver_pendencia(
  _id UUID, _confirmar BOOLEAN, _como_usuario UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _p public.ze_pending_actions; _autor UUID; _feito BOOLEAN;
BEGIN
  _autor := coalesce((select auth.uid()), _como_usuario);
  SELECT * INTO _p FROM public.ze_pending_actions WHERE id = _id;
  IF _p.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'motivo', 'não encontrada'); END IF;
  IF _p.situacao <> 'pendente' THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'já estava ' || _p.situacao);
  END IF;
  IF _p.expira_em < now() THEN
    UPDATE public.ze_pending_actions SET situacao = 'expirada', resolvida_em = now() WHERE id = _id;
    -- expirado = recusado: a assinatura não fica pendurada
    IF _p.tipo = 'liberar_assinatura' THEN
      UPDATE public.assinaturas
         SET situacao = 'recusado', recusa = 'O pedido de liberação expirou sem resposta.', updated_at = now()
       WHERE id = (_p.payload->>'assinatura_id')::uuid AND tenant_id = _p.tenant_id
         AND situacao = 'aguardando_ze';
    END IF;
    RETURN jsonb_build_object('ok', false, 'motivo', 'expirou');
  END IF;
  -- IS DISTINCT FROM (e não <>): get_user_tenant_id devolve NULL para quem é de
  -- um tenant sem acesso (suspenso), e `NULL <> x` é NULL — o IF não disparava e
  -- essa pessoa passava por esta conferência.
  IF (select auth.uid()) IS NOT NULL
     AND public.get_user_tenant_id((select auth.uid())) IS DISTINCT FROM _p.tenant_id THEN
    RAISE EXCEPTION 'pendência de outro tenant' USING ERRCODE = '42501';
  END IF;

  IF NOT _confirmar THEN
    -- pela tela, recusar a assinatura de um colega também é coisa de admin
    -- (liberar já é: assinatura_liberar confere). Pelo Zé o autor é o dono.
    IF _p.tipo = 'liberar_assinatura' AND (select auth.uid()) IS NOT NULL
       AND NOT public.assinatura_admin_ok() THEN
      RAISE EXCEPTION 'Só o admin decide sobre assinatura fora do catálogo.' USING ERRCODE = '42501';
    END IF;
    UPDATE public.ze_pending_actions
       SET situacao = 'cancelada', resolvida_em = now(), resolvida_por = _autor WHERE id = _id;
    IF _p.tipo = 'liberar_assinatura' THEN
      -- liberada_por fica vazio de propósito: quem NEGOU não "liberou" nada
      UPDATE public.assinaturas
         SET situacao = 'recusado', recusa = 'O gestor não liberou a assinatura.', updated_at = now()
       WHERE id = (_p.payload->>'assinatura_id')::uuid AND tenant_id = _p.tenant_id
         AND situacao = 'aguardando_ze';
    END IF;
    RETURN jsonb_build_object('ok', true, 'acao', 'cancelada');
  END IF;

  IF _p.tipo = 'mover_etapa' THEN
    _feito := public.ze_mover_etapa(
      _p.tenant_id, (_p.payload->>'project_id')::uuid, _p.payload->>'to_status',
      _autor, _p.payload->>'motivo');
  ELSIF _p.tipo = 'liberar_assinatura' THEN
    _feito := public.assinatura_liberar((_p.payload->>'assinatura_id')::uuid, _autor);
  END IF;

  UPDATE public.ze_pending_actions
     SET situacao = 'confirmada', resolvida_em = now(), resolvida_por = _autor WHERE id = _id;
  RETURN jsonb_build_object('ok', coalesce(_feito, false), 'acao', 'confirmada');
END;
$$;
GRANT EXECUTE ON FUNCTION public.ze_resolver_pendencia(UUID, BOOLEAN, UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.ze_resolver_pendencia(UUID, BOOLEAN, UUID) FROM PUBLIC, anon;

-- ── Faxina diária: a pendência que ninguém respondeu também recusa a assinatura
-- Sem isto o cron (04:00) marcava a pendência como 'expirada' e a assinatura
-- ficava em 'aguardando_ze' para sempre — o caminho "expirou" do resolver só
-- roda se alguém tentar responder depois do prazo.
CREATE OR REPLACE FUNCTION public.ze_expirar_pendentes()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _n INTEGER := 0; _m INTEGER := 0;
BEGIN
  UPDATE public.assinaturas a
     SET situacao = 'recusado', recusa = 'O pedido de liberação expirou sem resposta.', updated_at = now()
    FROM public.ze_pending_actions pa
   WHERE pa.tipo = 'liberar_assinatura' AND pa.situacao = 'pendente' AND pa.expira_em < now()
     AND a.id = (pa.payload->>'assinatura_id')::uuid AND a.tenant_id = pa.tenant_id
     AND a.situacao = 'aguardando_ze';

  UPDATE public.ze_pending_actions SET situacao = 'expirada', resolvida_em = now()
   WHERE situacao = 'pendente' AND expira_em < now();
  GET DIAGNOSTICS _n = ROW_COUNT;
  -- Sugestão sem resposta em 7 dias conta como recusa branda (§7.1).
  UPDATE public.ze_tarefas_sugeridas SET situacao = 'expirada', resolvida_em = now()
   WHERE situacao = 'pendente' AND created_at < now() - interval '7 days';
  GET DIAGNOSTICS _m = ROW_COUNT;
  RETURN _n + _m;
END;
$$;
REVOKE ALL ON FUNCTION public.ze_expirar_pendentes() FROM PUBLIC, anon, authenticated;

-- ── Vencimento do certificado: 30, 15, 7 e 1 dia antes (e no dia) ───────────
CREATE OR REPLACE FUNCTION public.certificados_avisar_vencimento()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _n INTEGER := 0; _c RECORD; _dias INTEGER; _titulo TEXT; _msg TEXT;
BEGIN
  FOR _c IN
    SELECT c.*, (c.validade_fim - current_date) AS faltam
      FROM public.certificados_digitais c
     WHERE c.ativo AND c.validade_fim IS NOT NULL
       AND (c.validade_fim - current_date) IN (30, 15, 7, 1, 0)
  LOOP
    _dias := _c.faltam;
    _titulo := CASE WHEN _dias = 0 THEN 'Certificado digital vence HOJE'
                    ELSE 'Certificado digital vence em ' || _dias || ' dia' || CASE WHEN _dias > 1 THEN 's' ELSE '' END END;
    _msg := 'O certificado de ' || _c.titular_nome || ' vence em '
            || to_char(_c.validade_fim, 'DD/MM/YYYY') || '. Sem ele não dá para assinar documento nenhum.';

    INSERT INTO public.notifications (tenant_id, user_id, title, message, type, read)
    SELECT _c.tenant_id, p.id, _titulo, _msg, 'warning', FALSE
      FROM public.profiles p
     WHERE p.tenant_id = _c.tenant_id AND p.role = 'admin';

    -- e um recado do Zé (texto pronto, sem IA): fica no histórico do chat "Você"
    INSERT INTO public.ze_messages (tenant_id, papel, texto, rotina)
    VALUES (_c.tenant_id, 'sistema', _titulo || ' — ' || _msg, 'certificado_vencimento');

    _n := _n + 1;
  END LOOP;

  -- quem passou da validade sai de 'ok' na hora
  UPDATE public.certificados_digitais
     SET situacao = 'vencido', erro = 'Venceu em ' || to_char(validade_fim, 'DD/MM/YYYY') || '.', updated_at = now()
   WHERE ativo AND situacao = 'ok' AND validade_fim IS NOT NULL AND validade_fim < current_date;

  RETURN _n;
END;
$$;
REVOKE ALL ON FUNCTION public.certificados_avisar_vencimento() FROM PUBLIC, anon, authenticated;

-- 07:00 em Brasília (10:00 UTC)
SELECT cron.unschedule('certificado-vencimento') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'certificado-vencimento');
SELECT cron.schedule('certificado-vencimento', '0 10 * * *', $cron$ SELECT public.certificados_avisar_vencimento(); $cron$);

SELECT 'Zé e vencimento aplicados' AS resultado,
       (SELECT count(*) FROM cron.job WHERE jobname = 'certificado-vencimento') AS job;
