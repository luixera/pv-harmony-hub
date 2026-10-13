-- ============================================================================
-- ASSINATURA — correções da revisão final (onda única)
--
--   C-1  "Formulário da concessionária" volta a exigir triagem
--   I-1  o nome do certificado vem do .pfx, não do que o admin digitou
--   I-2  aguardando_ze sem pendência é reaberto sozinho (cron de hora em hora)
--   I-3  "Assinei…" também vai para o sino dos admins (além do WhatsApp)
--
-- Idempotente: o UPDATE é por valor; as funções são CREATE OR REPLACE (a única
-- troca de assinatura, certificado_conferido, usa DROP IF EXISTS antes).
-- ============================================================================

-- ── C-1 ─────────────────────────────────────────────────────────────────────
-- O tipo foi semeado com exige_triagem = FALSE sob o argumento "documento
-- gerado pelo sistema não precisa de triagem — nós o produzimos". Só que o canal
-- "documento gerado" NUNCA foi construído: o tipo é origem 'ambos', aparece no
-- seletor de upload, e quem envia contrato.pdf escolhendo "Formulário da
-- concessionária" chegava ao e-CPF sem triagem, sem Zé e sem "Libero?".
--
-- ISTO SÓ VOLTA A FALSE quando o canal "documento gerado" existir: a isenção de
-- triagem pressupõe que o SISTEMA produziu o arquivo (e o caminho garante isso).
-- Enquanto o arquivo vier de upload de uma pessoa, a triagem é a última barreira.
UPDATE public.documentos_assinaveis
   SET exige_triagem = TRUE, updated_at = now()
 WHERE codigo = 'formulario_concessionaria';

-- ── I-1 ─────────────────────────────────────────────────────────────────────
-- certificado_cadastrar grava o nome DIGITADO; a conferência do robô só olhava o
-- CPF. Resultado: a estampa (que sai de certificados_digitais.titular_nome, via
-- assinaturas.titular_nome) levava o nome digitado, enquanto a assinatura usa o
-- CN do .pfx. Agora a conferência grava o nome LIDO DO ARQUIVO por cima.
--
-- Assinatura nova (parâmetro a mais) => função nova; a antiga sai, senão ficaria
-- um segundo overload com o mesmo nome, sem GRANT e sem uso.
DROP FUNCTION IF EXISTS public.certificado_conferido(UUID, TEXT, TEXT, TEXT, DATE, DATE, TEXT);

CREATE FUNCTION public.certificado_conferido(
  p_id UUID, p_situacao TEXT, p_emissor TEXT DEFAULT NULL, p_serial TEXT DEFAULT NULL,
  p_inicio DATE DEFAULT NULL, p_fim DATE DEFAULT NULL, p_erro TEXT DEFAULT NULL,
  p_titular_nome TEXT DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF (select auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
  END IF;
  UPDATE public.certificados_digitais
     SET situacao = p_situacao, emissor = coalesce(p_emissor, emissor),
         serial = coalesce(p_serial, serial), validade_inicio = coalesce(p_inicio, validade_inicio),
         validade_fim = coalesce(p_fim, validade_fim), erro = p_erro,
         -- o nome do CERTIFICADO prevalece sobre o digitado; sem nome (certificado
         -- inválido, que nem chegou a ser lido) mantém o que está
         titular_nome = coalesce(nullif(btrim(p_titular_nome), ''), titular_nome),
         updated_at = now()
   WHERE id = p_id;
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.certificado_conferido(UUID, TEXT, TEXT, TEXT, DATE, DATE, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.certificado_conferido(UUID, TEXT, TEXT, TEXT, DATE, DATE, TEXT, TEXT) TO service_role;

-- ── I-2 ─────────────────────────────────────────────────────────────────────
-- A linha vai a 'aguardando_ze' ANTES de o robô pedir a pendência, e o robô
-- engole o erro do pedido. Se a chamada falhar, a linha sai do alcance do claim,
-- ninguém volta a pedir, e o cron só expira pendências que EXISTEM.
--
-- O corpo de assinatura_pedir_ao_ze passa para uma função interna sem a checagem
-- de service_role (o cron roda como postgres, sem JWT), e a pública vira um
-- invólucro que checa e delega. Mesmo corpo, mesmos efeitos.
CREATE OR REPLACE FUNCTION public.assinatura_pedir_ao_ze_interno(p_id UUID)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _a public.assinaturas; _pend UUID; _codigo TEXT; _nome TEXT; _arquivo TEXT; _quem TEXT; _resumo TEXT;
BEGIN
  -- Duas chamadas ao mesmo tempo para a mesma assinatura esperam uma pela
  -- outra. O índice ze_pendencia_liberar_unica é a trava de verdade.
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

  -- O resumo entra no prompt do Zé e vai para o WhatsApp do gestor. Nome de
  -- arquivo e motivo da triagem vêm de fora (a IA leu o PDF de um cliente):
  -- uma linha só, sem aspas nem crase, com tamanho limitado. As ÚNICAS aspas
  -- do texto são as nossas, em volta do nome do arquivo.
  _resumo := coalesce(nullif(public.ze_texto_limpo(_quem, 80), ''), 'Alguém')
    || ' quer assinar "' || coalesce(nullif(public.ze_texto_limpo(_arquivo, 120), ''), 'documento')
    || '" no ' || coalesce(public.ze_texto_limpo(_codigo, 40), 'projeto')
    || ' como ' || coalesce(nullif(public.ze_texto_limpo(_nome, 80), ''), 'documento')
    || '. ' || coalesce(nullif(public.ze_texto_limpo(_a.recusa, 300), ''), 'A triagem ficou em dúvida.')
    || ' Libero?';

  INSERT INTO public.ze_pending_actions (tenant_id, tipo, payload, resumo)
  VALUES (_a.tenant_id, 'liberar_assinatura',
          jsonb_build_object('assinatura_id', p_id, 'project_id', _a.project_id), _resumo)
  ON CONFLICT ((payload->>'assinatura_id')) WHERE tipo = 'liberar_assinatura' AND situacao = 'pendente'
  DO NOTHING
  RETURNING id INTO _pend;

  IF _pend IS NULL THEN
    SELECT id INTO _pend FROM public.ze_pending_actions
     WHERE tipo = 'liberar_assinatura' AND situacao = 'pendente'
       AND (payload->>'assinatura_id')::uuid = p_id;
    RETURN _pend;
  END IF;

  -- abrir a pendência não avisa ninguém: o "Libero?" vai pela outbox
  PERFORM public.ze_recado_enfileirar(_a.tenant_id, _resumo, _pend);
  RETURN _pend;
END;
$$;
REVOKE ALL ON FUNCTION public.assinatura_pedir_ao_ze_interno(UUID) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.assinatura_pedir_ao_ze(p_id UUID)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF (select auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
  END IF;
  RETURN public.assinatura_pedir_ao_ze_interno(p_id);
END;
$$;
REVOKE ALL ON FUNCTION public.assinatura_pedir_ao_ze(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assinatura_pedir_ao_ze(UUID) TO service_role;

-- A faxina de hora em hora, agora com a reabertura. Primeiro expira o que tem de
-- expirar (recusando a assinatura, como antes); só depois olha quem ficou sem
-- pergunta — assim uma linha que acabou de ser recusada não é reaberta.
--
-- Cada reabertura roda em sub-bloco: se uma falhar, só ela é pulada (e tentada de
-- novo no ciclo seguinte, uma hora depois) — nunca derruba a expiração.
CREATE OR REPLACE FUNCTION public.ze_expirar_pendentes()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _n INTEGER := 0; _m INTEGER := 0; _k INTEGER := 0; _r RECORD;
BEGIN
  FOR _r IN
    SELECT pa.tenant_id, (pa.payload->>'assinatura_id')::uuid AS assinatura_id
      FROM public.ze_pending_actions pa
     WHERE pa.tipo = 'liberar_assinatura' AND pa.situacao = 'pendente' AND pa.expira_em < now()
  LOOP
    PERFORM public.assinatura_pendencia_expirou(_r.tenant_id, _r.assinatura_id);
  END LOOP;

  UPDATE public.ze_pending_actions SET situacao = 'expirada', resolvida_em = now()
   WHERE situacao = 'pendente' AND expira_em < now();
  GET DIAGNOSTICS _n = ROW_COUNT;
  -- Sugestão sem resposta em 7 dias conta como recusa branda (§7.1).
  UPDATE public.ze_tarefas_sugeridas SET situacao = 'expirada', resolvida_em = now()
   WHERE situacao = 'pendente' AND created_at < now() - interval '7 days';
  GET DIAGNOSTICS _m = ROW_COUNT;

  -- Assinatura em 'aguardando_ze' há mais de 15 min SEM pergunta aberta: o pedido
  -- ao Zé falhou depois de a linha mudar de situação. Reabre a pergunta.
  FOR _r IN
    SELECT a.id
      FROM public.assinaturas a
     WHERE a.situacao = 'aguardando_ze'
       AND a.updated_at < now() - interval '15 minutes'
       AND NOT EXISTS (
         SELECT 1 FROM public.ze_pending_actions pa
          WHERE pa.tipo = 'liberar_assinatura' AND pa.situacao = 'pendente'
            AND (pa.payload->>'assinatura_id')::uuid = a.id)
  LOOP
    BEGIN
      PERFORM public.assinatura_pedir_ao_ze_interno(_r.id);
      _k := _k + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'ze_expirar_pendentes: não consegui reabrir a pergunta da assinatura %: %', _r.id, SQLERRM;
    END;
  END LOOP;

  RETURN _n + _m + _k;
END;
$$;
REVOKE ALL ON FUNCTION public.ze_expirar_pendentes() FROM PUBLIC, anon, authenticated;

-- ── I-3 ─────────────────────────────────────────────────────────────────────
-- "Assinei…" é a promessa principal da spec §7, e o recado do WhatsApp pode se
-- perder de três jeitos (tenant sem Zé, falha de enfileirar, Zé fora do ar por
-- mais de 20 h). O sino dos admins entra no mesmo commit da assinatura, como já
-- acontece no vencimento do certificado. O resto do corpo é o de antes.
--
-- A notificação roda em sub-bloco: o PDF já foi assinado e subiu para o bucket;
-- uma falha de aviso não pode desfazer o registro da assinatura.
CREATE OR REPLACE FUNCTION public.assinatura_passo(
  p_id UUID, p_situacao TEXT, p_campos JSONB DEFAULT '{}'::jsonb)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  _a public.assinaturas; _doc UUID; _nome TEXT; _autor UUID; _n INT; _origens TEXT[];
BEGIN
  IF (select auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _a FROM public.assinaturas WHERE id = p_id;
  IF _a.id IS NULL THEN RETURN FALSE; END IF;

  -- Guarda de transição: de onde cada situação pode ser alcançada. É o que
  -- impede o robô de sobrescrever um 'recusado' com 'assinado' (o portão
  -- humano) e de repetir um passo já dado.
  _origens := CASE p_situacao
    WHEN 'preparando'    THEN ARRAY['preparando']
    WHEN 'conferir'      THEN ARRAY['preparando']
    WHEN 'triagem'       THEN ARRAY['triagem']
    WHEN 'pendente'      THEN ARRAY['triagem', 'pendente']
    WHEN 'aguardando_ze' THEN ARRAY['triagem']
    WHEN 'assinando'     THEN ARRAY['pendente']
    WHEN 'assinado'      THEN ARRAY['pendente', 'assinando']
    WHEN 'recusado'      THEN ARRAY['preparando', 'triagem', 'aguardando_ze', 'pendente', 'assinando']
    WHEN 'erro'          THEN ARRAY['preparando', 'triagem', 'pendente', 'assinando']
    ELSE NULL
  END;
  IF _origens IS NULL THEN
    RAISE EXCEPTION 'Situação de assinatura desconhecida: %.', p_situacao;
  END IF;

  IF p_situacao = 'assinado'
     AND (coalesce(p_campos->>'file_url', '') = '' OR coalesce(p_campos->>'file_name', '') = '') THEN
    RAISE EXCEPTION 'Para marcar como assinado é preciso informar o arquivo (file_url e file_name).';
  END IF;

  -- Reserva a transição ANTES de qualquer efeito colateral: se a linha não está
  -- numa origem válida (ou outra chamada já a moveu), devolve FALSE e não grava
  -- documento, comentário nem histórico — a chamada repetida é inofensiva.
  UPDATE public.assinaturas
     SET situacao = p_situacao,
         documento_aprovado_path = coalesce(p_campos->>'documento_aprovado_path', documento_aprovado_path),
         hash_original = coalesce(p_campos->>'hash_original', hash_original),
         hash_aprovado = coalesce(p_campos->>'hash_aprovado', hash_aprovado),
         hash_assinado = coalesce(p_campos->>'hash_assinado', hash_assinado),
         recusa = coalesce(p_campos->>'recusa', recusa),
         erro = p_campos->>'erro',
         -- o limite de tentativas vale por etapa: mudou de situação, zera
         tentativas = CASE WHEN situacao <> p_situacao THEN 0 ELSE tentativas END,
         claim_em = NULL, updated_at = now()
   WHERE id = p_id AND situacao = ANY (_origens);
  GET DIAGNOSTICS _n = ROW_COUNT;
  IF _n = 0 THEN RETURN FALSE; END IF;

  IF p_situacao IN ('assinado', 'recusado') THEN
    -- quem pediu pode ter sido apagado (pedida_por é ON DELETE SET NULL) e
    -- comments.user_id é NOT NULL: cai para um admin do tenant da linha.
    _autor := coalesce(_a.pedida_por,
                       (SELECT pf.id FROM public.profiles pf
                         WHERE pf.tenant_id = _a.tenant_id AND pf.role = 'admin' LIMIT 1));
    IF _autor IS NULL THEN
      RAISE EXCEPTION 'Não há usuário para registrar esta assinatura no card.';
    END IF;
    SELECT da.nome INTO _nome FROM public.documentos_assinaveis da WHERE da.id = _a.assinavel_id;
  END IF;

  IF p_situacao = 'assinado' THEN
    -- o assinado é documento NOVO; o original fica onde está. Sem assinavel_id:
    -- o assinado não é, ele mesmo, assinável (o vínculo com o tipo mora em
    -- assinaturas.assinavel_id e o rastro em documento_assinado_id).
    INSERT INTO public.documents
      (project_id, document_type, file_name, file_url, file_type, assinavel_id)
    VALUES (_a.project_id, 'extra_attachment',
            left(p_campos->>'file_name', 200), p_campos->>'file_url',
            'application/pdf', NULL)
    RETURNING id INTO _doc;

    UPDATE public.assinaturas SET documento_assinado_id = _doc WHERE id = p_id;

    INSERT INTO public.comments (project_id, user_id, message, type)
    VALUES (_a.project_id, _autor,
            '✍️ ' || coalesce(_nome, 'Documento') || ' assinado digitalmente com o e-CPF de '
              || coalesce(_a.titular_nome, '—') || '. Código ' || _a.codigo_verificacao
              || E'\n📎 ' || left(coalesce(p_campos->>'file_name', ''), 200), 'comment');

    INSERT INTO public.project_history (project_id, action, description, user_id, user_name)
    VALUES (_a.project_id, 'Documento assinado',
            coalesce(_nome, 'Documento') || ' assinado com o certificado de '
              || coalesce(_a.titular_nome, '—') || ' (código ' || _a.codigo_verificacao || ')',
            _autor,
            coalesce((SELECT p.name FROM public.profiles p WHERE p.id = _autor), 'equipe'));

    -- O sino dos admins: o aviso que não depende do WhatsApp estar de pé.
    BEGIN
      INSERT INTO public.notifications (tenant_id, user_id, title, message, type, read, project_id)
      SELECT _a.tenant_id, p.id,
             'Documento assinado com o e-CPF',
             public.ze_texto_limpo(coalesce(_nome, 'Documento') || ' — ' || coalesce(p_campos->>'file_name', ''), 120)
               || ' · e-CPF de ' || public.ze_texto_limpo(coalesce(_a.titular_nome, '—'), 60)
               || ' · código ' || _a.codigo_verificacao,
             'document', FALSE, _a.project_id
        FROM public.profiles p
       WHERE p.tenant_id = _a.tenant_id AND p.role = 'admin';
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'assinatura_passo: não consegui notificar os admins da assinatura %: %', p_id, SQLERRM;
    END;
  END IF;

  IF p_situacao = 'recusado' THEN
    INSERT INTO public.comments (project_id, user_id, message, type)
    VALUES (_a.project_id, _autor,
            '🚫 Assinatura recusada — ' || coalesce(p_campos->>'recusa', 'sem cunho de projeto')
              || ' (' || coalesce(_nome, 'documento') || ').', 'comment');
  END IF;

  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION public.assinatura_passo(UUID, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assinatura_passo(UUID, TEXT, JSONB) TO service_role;

SELECT 'correcoes finais aplicadas' AS resultado,
       (SELECT exige_triagem FROM public.documentos_assinaveis WHERE codigo = 'formulario_concessionaria' LIMIT 1) AS formulario_exige_triagem,
       (SELECT count(*) FROM pg_proc WHERE proname = 'certificado_conferido') AS overloads_conferido;
