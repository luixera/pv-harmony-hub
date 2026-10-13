-- ============================================================================
-- ASSINATURA DIGITAL — o fluxo (03/10/2026)
--
-- pedir → preparando → conferir → (triagem) → pendente → assinando → assinado
--                                      ↘ aguardando_ze ↗  ou  recusado
--
-- A tranca mora em assinatura_pedir: documento sem assinavel_id, de projeto
-- apagado, de outro tenant ou sem certificado válido não entra.
-- ============================================================================

-- ── Um pedido em andamento por documento (a trava de verdade) ──────────────
-- O EXISTS de assinatura_pedir dá a mensagem boa; este índice garante que dois
-- cliques simultâneos não criem dois pedidos.
CREATE UNIQUE INDEX IF NOT EXISTS assinatura_uma_por_documento
  ON public.assinaturas (document_id)
  WHERE situacao IN ('preparando', 'conferir', 'triagem', 'aguardando_ze', 'pendente', 'assinando');

-- ── Pedir ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.assinatura_pedir(
  p_project_id UUID, p_document_id UUID, p_assinavel_id UUID, p_motivo TEXT DEFAULT NULL)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  _uid UUID := (select auth.uid()); _tenant UUID; _id UUID;
  _cert public.certificados_digitais; _tipo public.documentos_assinaveis;
  _restricao TEXT;
BEGIN
  IF _uid IS NULL OR NOT public.assinatura_equipe_ok() THEN
    RAISE EXCEPTION 'Sem acesso à assinatura digital.' USING ERRCODE = '42501';
  END IF;
  _tenant := public.get_user_tenant_id(_uid);

  -- 1. o projeto é deste tenant e está vivo
  IF NOT EXISTS (SELECT 1 FROM public.projects pr
                  WHERE pr.id = p_project_id AND pr.tenant_id = _tenant AND NOT pr.is_deleted) THEN
    RAISE EXCEPTION 'Projeto não encontrado.';
  END IF;

  -- 2. o tipo está no catálogo e está ativo
  SELECT * INTO _tipo FROM public.documentos_assinaveis
   WHERE id = p_assinavel_id AND tenant_id = _tenant AND ativo;
  IF _tipo.id IS NULL THEN
    RAISE EXCEPTION 'Este tipo de documento não está liberado para assinatura.';
  END IF;

  -- 3. o documento é do projeto e carrega a marca do MESMO tipo
  --    (é esta linha que impede contrato social, procuração avulsa e anexo solto)
  IF NOT EXISTS (SELECT 1 FROM public.documents d
                  WHERE d.id = p_document_id AND d.project_id = p_project_id
                    AND d.assinavel_id = p_assinavel_id) THEN
    RAISE EXCEPTION 'Este documento não entrou pelo fluxo de assinatura — não é assinável.';
  END IF;

  -- 4. há certificado conferido e dentro da validade
  SELECT * INTO _cert FROM public.certificados_digitais
   WHERE tenant_id = _tenant AND ativo;
  IF _cert.id IS NULL THEN RAISE EXCEPTION 'Nenhum certificado cadastrado.'; END IF;
  IF _cert.situacao <> 'ok' THEN
    RAISE EXCEPTION 'O certificado está em "%" — não dá para assinar.', _cert.situacao;
  END IF;
  IF _cert.validade_fim IS NOT NULL AND _cert.validade_fim < current_date THEN
    RAISE EXCEPTION 'O certificado venceu em %.', to_char(_cert.validade_fim, 'DD/MM/YYYY');
  END IF;

  -- 5. nada de pedido duplicado em andamento para o mesmo documento
  IF EXISTS (SELECT 1 FROM public.assinaturas a
              WHERE a.document_id = p_document_id
                AND a.situacao IN ('preparando', 'conferir', 'triagem', 'aguardando_ze', 'pendente', 'assinando')) THEN
    RAISE EXCEPTION 'Já existe um pedido de assinatura em andamento para este documento.';
  END IF;

  BEGIN
    INSERT INTO public.assinaturas
      (tenant_id, project_id, document_id, assinavel_id, certificado_id,
       titular_nome, titular_cpf, serial, pedida_por, motivo, situacao, codigo_verificacao)
    VALUES (_tenant, p_project_id, p_document_id, p_assinavel_id, _cert.id,
            _cert.titular_nome, _cert.titular_cpf, _cert.serial, _uid,
            left(coalesce(p_motivo, ''), 500), 'preparando',
            public.assinatura_codigo_novo(_tenant))
    RETURNING id INTO _id;
  EXCEPTION WHEN unique_violation THEN
    -- duplo clique: o índice parcial barrou o segundo. Outro unique que
    -- estoure por outro motivo continua subindo como está.
    GET STACKED DIAGNOSTICS _restricao = CONSTRAINT_NAME;
    IF _restricao = 'assinatura_uma_por_documento' THEN
      RAISE EXCEPTION 'Já existe um pedido de assinatura em andamento para este documento.';
    END IF;
    RAISE;
  END;
  RETURN _id;
END;
$$;
REVOKE ALL ON FUNCTION public.assinatura_pedir(UUID, UUID, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assinatura_pedir(UUID, UUID, UUID, TEXT) TO authenticated;

-- ── "Está certo": a pessoa conferiu o PDF preparado ─────────────────────────
CREATE OR REPLACE FUNCTION public.assinatura_aprovar(p_id UUID)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _uid UUID := (select auth.uid()); _a public.assinaturas; _proxima TEXT; _exige BOOLEAN; _n INT;
BEGIN
  IF _uid IS NULL OR NOT public.assinatura_equipe_ok() THEN
    RAISE EXCEPTION 'Sem acesso à assinatura digital.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _a FROM public.assinaturas
   WHERE id = p_id AND tenant_id = public.get_user_tenant_id(_uid);
  IF _a.id IS NULL THEN RAISE EXCEPTION 'Pedido não encontrado.'; END IF;
  IF _a.situacao <> 'conferir' THEN
    RAISE EXCEPTION 'Este pedido está em "%" — não é hora de aprovar.', _a.situacao;
  END IF;

  SELECT exige_triagem INTO _exige FROM public.documentos_assinaveis WHERE id = _a.assinavel_id;
  _proxima := CASE WHEN coalesce(_exige, TRUE) THEN 'triagem' ELSE 'pendente' END;

  -- o UPDATE filtra pela situação: se outro clique (Recusar) chegou entre a
  -- leitura e a gravação, não ressuscita o pedido.
  UPDATE public.assinaturas
     SET situacao = _proxima, aprovada_por = _uid, aprovada_em = now(), claim_em = NULL,
         tentativas = 0, updated_at = now()
   WHERE id = p_id AND tenant_id = public.get_user_tenant_id(_uid) AND situacao = 'conferir';
  GET DIAGNOSTICS _n = ROW_COUNT;
  IF _n = 0 THEN
    RAISE EXCEPTION 'Este pedido já não estava aguardando conferência.';
  END IF;
  RETURN _proxima;
END;
$$;
REVOKE ALL ON FUNCTION public.assinatura_aprovar(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assinatura_aprovar(UUID) TO authenticated;

-- ── Desistir / recusar (a pessoa, na tela) ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.assinatura_recusar(p_id UUID, p_motivo TEXT DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _uid UUID := (select auth.uid()); _n INT;
BEGIN
  IF _uid IS NULL OR NOT public.assinatura_equipe_ok() THEN
    RAISE EXCEPTION 'Sem acesso à assinatura digital.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.assinaturas
     SET situacao = 'recusado', recusa = left(coalesce(p_motivo, 'Recusado na tela.'), 500),
         claim_em = NULL, updated_at = now()
   WHERE id = p_id AND tenant_id = public.get_user_tenant_id(_uid)
     AND situacao IN ('preparando', 'conferir', 'triagem', 'aguardando_ze', 'pendente', 'assinando', 'erro');
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n > 0;
END;
$$;
REVOKE ALL ON FUNCTION public.assinatura_recusar(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assinatura_recusar(UUID, TEXT) TO authenticated;

-- ── O robô pega trabalho ────────────────────────────────────────────────────
-- Três etapas no mesmo claim: preparar, triar e assinar. `claim_em` evita que
-- dois laços peguem a mesma linha e devolve o trabalho se o robô cair.
CREATE OR REPLACE FUNCTION public.assinatura_claim()
RETURNS TABLE (
  id UUID, tenant_id UUID, project_id UUID, document_id UUID, assinavel_id UUID,
  certificado_id UUID, situacao TEXT, titular_nome TEXT, titular_cpf TEXT,
  codigo_verificacao TEXT, documento_aprovado_path TEXT, hash_aprovado TEXT,
  file_url TEXT, file_name TEXT, file_type TEXT, cidade TEXT, tentativas SMALLINT
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _id UUID;
BEGIN
  IF (select auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
  END IF;

  -- `tentativas` limita o retry POR ETAPA (assinatura_passo zera ao mudar de
  -- situação). Quem esgotou as 3 e já está com o claim vencido vai para 'erro',
  -- onde a pessoa vê e pode cancelar — em vez de ficar inalcançável na fila e
  -- bloquear o documento pela checagem de duplicidade.
  UPDATE public.assinaturas a
     SET situacao = 'erro',
         erro = coalesce(a.erro, 'Esgotei as tentativas nesta etapa.'),
         claim_em = NULL, updated_at = now()
   WHERE a.situacao IN ('preparando', 'triagem', 'pendente')
     AND a.tentativas >= 3
     AND (a.claim_em IS NULL OR a.claim_em < now() - interval '10 minutes');

  SELECT a.id INTO _id FROM public.assinaturas a
   WHERE a.situacao IN ('preparando', 'triagem', 'pendente')
     AND a.tentativas < 3
     AND (a.claim_em IS NULL OR a.claim_em < now() - interval '10 minutes')
   ORDER BY a.created_at
   LIMIT 1
   FOR UPDATE SKIP LOCKED;
  IF _id IS NULL THEN RETURN; END IF;

  UPDATE public.assinaturas a
     SET claim_em = now(), tentativas = a.tentativas + 1, updated_at = now()
   WHERE a.id = _id;

  RETURN QUERY
    SELECT a.id, a.tenant_id, a.project_id, a.document_id, a.assinavel_id,
           a.certificado_id, a.situacao, a.titular_nome, a.titular_cpf,
           a.codigo_verificacao, a.documento_aprovado_path, a.hash_aprovado,
           d.file_url, d.file_name, d.file_type,
           coalesce(g.city, '') AS cidade, a.tentativas
      FROM public.assinaturas a
      LEFT JOIN public.documents d ON d.id = a.document_id
      LEFT JOIN public.project_general_data g ON g.project_id = a.project_id
     WHERE a.id = _id;
END;
$$;
REVOKE ALL ON FUNCTION public.assinatura_claim() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assinatura_claim() TO service_role;

-- ── O robô devolve o passo ──────────────────────────────────────────────────
-- `p_campos` leva o que aquele passo produziu. Ao chegar em 'assinado',
-- registra o documento novo, comenta no card e escreve no histórico.
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

-- ── Liberar exceção (o "pode" do gestor, pelo Zé ou pela tela) ──────────────
CREATE OR REPLACE FUNCTION public.assinatura_liberar(p_id UUID, p_autor UUID DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _uid UUID := (select auth.uid()); _autor UUID; _tenant UUID; _n INT;
BEGIN
  IF _uid IS NOT NULL THEN
    -- pela tela: só admin libera, e só dentro do próprio tenant.
    IF NOT public.assinatura_admin_ok() THEN
      RAISE EXCEPTION 'Só o admin libera assinatura fora do catálogo.' USING ERRCODE = '42501';
    END IF;
    _autor := _uid;
    _tenant := public.get_user_tenant_id(_uid);
  ELSE
    -- pelo Zé: chega como service_role com p_autor, que tem de ser admin do
    -- tenant DA LINHA (o robô não pode liberar com a identidade de qualquer um).
    IF (select auth.role()) IS DISTINCT FROM 'service_role' THEN
      RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
    END IF;
    IF p_autor IS NULL THEN
      RAISE EXCEPTION 'Informe quem está liberando (p_autor).';
    END IF;
    SELECT a.tenant_id INTO _tenant FROM public.assinaturas a WHERE a.id = p_id;
    IF _tenant IS NULL THEN RETURN FALSE; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.profiles pf
                    WHERE pf.id = p_autor AND pf.role = 'admin' AND pf.tenant_id = _tenant) THEN
      RAISE EXCEPTION 'Quem libera precisa ser admin do tenant deste pedido.' USING ERRCODE = '42501';
    END IF;
    _autor := p_autor;
  END IF;

  UPDATE public.assinaturas
     SET situacao = 'pendente', liberada_por = _autor, liberada_em = now(),
         claim_em = NULL, tentativas = 0, updated_at = now()
   WHERE id = p_id AND tenant_id = _tenant AND situacao = 'aguardando_ze';
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n > 0;
END;
$$;
REVOKE ALL ON FUNCTION public.assinatura_liberar(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assinatura_liberar(UUID, UUID) TO authenticated, service_role;

-- ── Extrato para a tela ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.assinatura_registro(p_limite INT DEFAULT 100)
RETURNS TABLE (
  id UUID, project_id UUID, codigo_projeto TEXT, titular_projeto TEXT,
  tipo TEXT, situacao TEXT, titular_nome TEXT, serial TEXT,
  pedida_por_nome TEXT, pedida_em TIMESTAMPTZ, liberada_por_nome TEXT,
  codigo_verificacao TEXT, recusa TEXT, erro TEXT,
  documento_aprovado_path TEXT, assinado_path TEXT, assinado_nome TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT a.id, a.project_id, pr.code, coalesce(g.holder_name, ''),
         coalesce(da.nome, '—'), a.situacao, a.titular_nome, a.serial,
         coalesce(qp.name, '—'), a.pedida_em, ql.name,
         a.codigo_verificacao, a.recusa, a.erro,
         a.documento_aprovado_path, ds.file_url, ds.file_name
    FROM public.assinaturas a
    JOIN public.projects pr ON pr.id = a.project_id
    LEFT JOIN public.project_general_data g ON g.project_id = a.project_id
    LEFT JOIN public.documentos_assinaveis da ON da.id = a.assinavel_id
    LEFT JOIN public.profiles qp ON qp.id = a.pedida_por
    LEFT JOIN public.profiles ql ON ql.id = a.liberada_por
    LEFT JOIN public.documents ds ON ds.id = a.documento_assinado_id
   WHERE a.tenant_id = public.get_user_tenant_id((select auth.uid()))
     AND public.assinatura_equipe_ok()
   ORDER BY a.created_at DESC
   LIMIT greatest(1, least(coalesce(p_limite, 100), 500));
$$;
REVOKE ALL ON FUNCTION public.assinatura_registro(INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assinatura_registro(INT) TO authenticated;

SELECT 'fluxo da assinatura aplicado' AS resultado;
