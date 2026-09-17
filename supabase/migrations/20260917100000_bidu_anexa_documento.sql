-- ============================================================================
-- ENGENHEIRO BIDU — entrega documentos no projeto (17/09/2026)
--
-- O Bidu deixa de só conversar: preenche o Formulário MicroGD da CEMIG e
-- ANEXA no projeto. A tela gera e sobe o arquivo com a sessão da pessoa; esta
-- RPC registra o documento e o comentário no card em nome do Bidu, como a
-- Ludmilla faz com os anexos da concessionária.
--
-- Spec: docs/superpowers/specs/2026-09-17-bidu-formulario-cemig-design.md
-- ============================================================================

-- Os documentos gerados (planilha da CEMIG, memorial) precisam caber no bucket
-- dos documentos do projeto: até aqui ele só aceitava PDF e imagem.
UPDATE storage.buckets
   SET allowed_mime_types = (
     SELECT array_agg(DISTINCT m) FROM unnest(coalesce(allowed_mime_types, '{}'::text[]) || ARRAY[
       'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
       'application/vnd.ms-excel',
       'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
     ]) AS m
   )
 WHERE id = 'project-documents';

-- Quem pode usar o Bidu: admin/staff do tenant GD Manager (is_library) — o
-- mesmo recorte de `useBiduDisponivel()` na tela.
CREATE OR REPLACE FUNCTION public.bidu_equipe_ok()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p JOIN public.tenants t ON t.id = p.tenant_id
    WHERE p.id = (select auth.uid()) AND p.role IN ('admin', 'staff') AND t.is_library
  );
$$;

/**
 * Registra um documento que o Bidu produziu (o arquivo já está no bucket
 * `project-documents`, subido pela sessão da pessoa) e deixa o comentário no
 * card. Devolve o id do documento.
 */
CREATE OR REPLACE FUNCTION public.bidu_anexar_documento(
  p_project_id UUID, p_file_path TEXT, p_file_name TEXT, p_file_type TEXT, p_resumo TEXT
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  _bidu CONSTANT UUID := '00000000-b1d0-4000-8000-000000000001';
  _uid UUID := (select auth.uid());
  _doc UUID;
BEGIN
  IF _uid IS NULL OR NOT public.bidu_equipe_ok() THEN
    RAISE EXCEPTION 'Sem acesso ao Bidu.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.projects pr
    WHERE pr.id = p_project_id AND pr.tenant_id = public.get_user_tenant_id(_uid) AND NOT pr.is_deleted
  ) THEN
    RAISE EXCEPTION 'Projeto não encontrado.';
  END IF;
  IF coalesce(trim(p_file_path), '') = '' OR coalesce(trim(p_file_name), '') = '' THEN
    RAISE EXCEPTION 'Arquivo sem caminho ou sem nome.';
  END IF;

  INSERT INTO public.documents (project_id, document_type, file_name, file_url, file_type, uploaded_by)
  VALUES (p_project_id, 'extra_attachment', left(p_file_name, 200), p_file_path, p_file_type, _bidu)
  RETURNING id INTO _doc;

  INSERT INTO public.comments (project_id, user_id, message, type)
  VALUES (p_project_id, _bidu, left(coalesce(p_resumo, '📐 Documento gerado pelo Engenheiro Bidu.'), 2000) || E'\n📎 ' || left(p_file_name, 200), 'comment');

  RETURN _doc;
END;
$$;
REVOKE ALL ON FUNCTION public.bidu_anexar_documento(UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bidu_anexar_documento(UUID, TEXT, TEXT, TEXT, TEXT) TO authenticated;
