-- ============================================================================
-- ASSINATURA — a porta de entrada do documento assinável (03/10/2026)
--
-- `documents.assinavel_id` é a tranca. Para ela valer, a tela NÃO pode
-- escrevê-la: privilégio por coluna tira essa possibilidade e deixa só a RPC
-- `documento_para_assinar`, que confere equipe, tenant, projeto e catálogo.
-- ============================================================================

-- Privilégio por coluna: tudo menos assinavel_id.
-- (as colunas de `documents` em 03/10/2026: id, project_id, document_type,
--  file_name, file_url, file_type, uploaded_by, created_at, assinavel_id)
-- Conferido no banco antes de escrever. Nenhum código do repositório (src,
-- edge functions, worker) faz UPDATE em `documents`; os inserts da tela são
-- NewProject (com uploaded_by), useUploadDocument e PublicProjectForm (anon,
-- sem uploaded_by). Funções que gravam em `documents` são todas SECURITY
-- DEFINER (dono postgres) e não sofrem este REVOKE.
--
-- NINGUÉM recebe UPDATE nesta tabela. Se houvesse UPDATE em `file_url`, bastava
-- trocar o caminho de um documento JÁ marcado para um arquivo que nunca passou
-- pela porta da assinatura (o contrato social, por exemplo): a marca seguiria
-- valendo e `assinatura_pedir` só confere `assinavel_id`. Renomear anexo, se um
-- dia precisar, vai por RPC. (O REVOKE em nível de tabela leva junto qualquer
-- grant de coluna anterior.)
REVOKE INSERT, UPDATE ON public.documents FROM authenticated, anon;
GRANT INSERT (id, project_id, document_type, file_name, file_url, file_type, uploaded_by, created_at)
  ON public.documents TO authenticated;
-- o formulário público (anon) insere anexo do projeto; segue sem assinavel_id
GRANT INSERT (id, project_id, document_type, file_name, file_url, file_type, created_at)
  ON public.documents TO anon;

/**
 * Registra um documento que entrou PELO FLUXO DE ASSINATURA. O arquivo já está
 * no bucket `project-documents` (subido pela sessão da pessoa); aqui a linha
 * nasce com a marca do tipo do catálogo.
 */
CREATE OR REPLACE FUNCTION public.documento_para_assinar(
  p_project_id UUID, p_assinavel_id UUID, p_path TEXT, p_name TEXT, p_type TEXT)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _uid UUID := (select auth.uid()); _tenant UUID; _doc UUID; _origem TEXT;
        _empresa UUID; _prefixo TEXT;
BEGIN
  IF _uid IS NULL OR NOT public.assinatura_equipe_ok() THEN
    RAISE EXCEPTION 'Sem acesso à assinatura digital.' USING ERRCODE = '42501';
  END IF;
  _tenant := public.get_user_tenant_id(_uid);

  -- a empresa vem do PRÓPRIO projeto, nunca de parâmetro
  SELECT pr.company_id INTO _empresa FROM public.projects pr
   WHERE pr.id = p_project_id AND pr.tenant_id = _tenant AND NOT pr.is_deleted;
  IF _empresa IS NULL THEN
    RAISE EXCEPTION 'Projeto não encontrado.';
  END IF;

  SELECT origem INTO _origem FROM public.documentos_assinaveis
   WHERE id = p_assinavel_id AND tenant_id = _tenant AND ativo;
  IF _origem IS NULL THEN RAISE EXCEPTION 'Tipo de documento não liberado para assinatura.'; END IF;
  IF _origem = 'gerado' THEN
    RAISE EXCEPTION 'Este tipo só aceita documento gerado pelo sistema — não dá para enviar arquivo.';
  END IF;
  IF coalesce(trim(p_path), '') = '' OR coalesce(trim(p_name), '') = '' THEN
    RAISE EXCEPTION 'Arquivo sem caminho ou sem nome.';
  END IF;

  -- O worker (service role, que ignora RLS) baixa e prepara EXATAMENTE este
  -- caminho: ele tem de estar na pasta deste projeto, na convenção
  -- `<empresa>/<projeto>/...`. Senão um arquivo de outra empresa ou outro
  -- tenant entraria no fluxo de assinatura com a marca. Prefixo LITERAL
  -- (left/length), não LIKE.
  _prefixo := _empresa::text || '/' || p_project_id::text || '/';
  IF left(p_path, length(_prefixo)) <> _prefixo THEN
    RAISE EXCEPTION 'O arquivo precisa estar na pasta deste projeto (empresa/projeto/…).';
  END IF;
  IF p_path ~ '(^|/)\.\.(/|$)' THEN
    RAISE EXCEPTION 'Caminho de arquivo inválido.';
  END IF;

  INSERT INTO public.documents
    (project_id, document_type, file_name, file_url, file_type, uploaded_by, assinavel_id)
  VALUES (p_project_id, 'extra_attachment', left(trim(p_name), 200), p_path, p_type, _uid, p_assinavel_id)
  RETURNING id INTO _doc;
  RETURN _doc;
END;
$$;
REVOKE ALL ON FUNCTION public.documento_para_assinar(UUID, UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.documento_para_assinar(UUID, UUID, TEXT, TEXT, TEXT) TO authenticated;

/**
 * Marca um documento JÁ EXISTENTE como assinável — o caminho do que o Bidu
 * gerou (formulário da CEMIG, memorial). Só vale para documento do projeto e
 * tipo cuja origem aceita 'gerado'.
 */
CREATE OR REPLACE FUNCTION public.documento_marcar_assinavel(p_document_id UUID, p_assinavel_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _uid UUID := (select auth.uid()); _tenant UUID; _origem TEXT; _n INT;
BEGIN
  IF _uid IS NULL OR NOT public.assinatura_equipe_ok() THEN
    RAISE EXCEPTION 'Sem acesso à assinatura digital.' USING ERRCODE = '42501';
  END IF;
  _tenant := public.get_user_tenant_id(_uid);
  SELECT origem INTO _origem FROM public.documentos_assinaveis
   WHERE id = p_assinavel_id AND tenant_id = _tenant AND ativo;
  IF _origem IS NULL THEN RAISE EXCEPTION 'Tipo de documento não liberado para assinatura.'; END IF;
  IF _origem = 'enviado' THEN
    RAISE EXCEPTION 'Este tipo só aceita arquivo enviado pelo fluxo de assinatura.';
  END IF;

  UPDATE public.documents d
     SET assinavel_id = p_assinavel_id
   WHERE d.id = p_document_id
     AND EXISTS (SELECT 1 FROM public.projects pr
                  WHERE pr.id = d.project_id AND pr.tenant_id = _tenant AND NOT pr.is_deleted);
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n > 0;
END;
$$;
REVOKE ALL ON FUNCTION public.documento_marcar_assinavel(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.documento_marcar_assinavel(UUID, UUID) TO authenticated;

SELECT 'porta da assinatura aplicada' AS resultado;
