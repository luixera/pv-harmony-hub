-- ============================================================================
-- ASSINATURA DIGITAL — fundação (03/10/2026)
--
-- Certificado A1 guardado no sistema, catálogo de documentos assináveis e a
-- tabela que é fila e histórico ao mesmo tempo.
--
-- A TRANCA: só é assinável o documento que entrou pelo fluxo de assinatura,
-- com um tipo do catálogo (documents.assinavel_id). Contrato social, procuração
-- avulsa e qualquer anexo solto ficam com assinavel_id NULL — não aparece botão
-- e a RPC recusa.
--
-- Spec: docs/superpowers/specs/2026-10-02-assinatura-digital-design.md
-- ============================================================================

-- ── Quem pode usar: admin/staff do tenant GD Manager (is_library) ───────────
CREATE OR REPLACE FUNCTION public.assinatura_equipe_ok()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p JOIN public.tenants t ON t.id = p.tenant_id
    WHERE p.id = (select auth.uid()) AND p.role IN ('admin', 'staff') AND t.is_library
  );
$$;

CREATE OR REPLACE FUNCTION public.assinatura_admin_ok()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p JOIN public.tenants t ON t.id = p.tenant_id
    WHERE p.id = (select auth.uid()) AND p.role = 'admin' AND t.is_library
  );
$$;

-- ── Catálogo: o que pode ser assinado ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.documentos_assinaveis (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  codigo         TEXT NOT NULL,
  nome           TEXT NOT NULL,
  origem         TEXT NOT NULL DEFAULT 'ambos' CHECK (origem IN ('gerado', 'enviado', 'ambos')),
  exige_triagem  BOOLEAN NOT NULL DEFAULT TRUE,
  ativo          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, codigo)
);

-- ── Certificado A1 ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.certificados_digitais (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  titular_nome    TEXT NOT NULL,
  titular_cpf     TEXT NOT NULL,
  emissor         TEXT,
  serial          TEXT,
  validade_inicio DATE,
  validade_fim    DATE,
  arquivo_path    TEXT NOT NULL,
  secret_id       UUID,
  situacao        TEXT NOT NULL DEFAULT 'conferindo'
                  CHECK (situacao IN ('conferindo', 'ok', 'invalido', 'vencido')),
  erro            TEXT,
  ativo           BOOLEAN NOT NULL DEFAULT TRUE,
  created_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- um certificado ATIVO por tenant
CREATE UNIQUE INDEX IF NOT EXISTS certificado_ativo_unico
  ON public.certificados_digitais (tenant_id) WHERE ativo;

-- ── A marca nos documentos: é esta coluna que autoriza assinar ──────────────
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS assinavel_id UUID
  REFERENCES public.documentos_assinaveis(id) ON DELETE SET NULL;

ALTER TABLE public.concessionaire_templates
  ADD COLUMN IF NOT EXISTS assinavel_id UUID
  REFERENCES public.documentos_assinaveis(id) ON DELETE SET NULL;

-- ── Fila e histórico ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.assinaturas (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  project_id              UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  document_id             UUID REFERENCES public.documents(id) ON DELETE SET NULL,
  assinavel_id            UUID REFERENCES public.documentos_assinaveis(id) ON DELETE SET NULL,
  certificado_id          UUID REFERENCES public.certificados_digitais(id) ON DELETE SET NULL,
  -- cópia do certificado no momento da assinatura: o histórico não muda se o
  -- certificado for trocado depois
  titular_nome            TEXT,
  titular_cpf             TEXT,
  serial                  TEXT,
  pedida_por              UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  pedida_em               TIMESTAMPTZ NOT NULL DEFAULT now(),
  liberada_por            UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  liberada_em             TIMESTAMPTZ,
  aprovada_por            UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  aprovada_em             TIMESTAMPTZ,
  situacao                TEXT NOT NULL DEFAULT 'preparando'
                          CHECK (situacao IN ('preparando', 'conferir', 'triagem',
                                              'aguardando_ze', 'pendente', 'assinando',
                                              'assinado', 'recusado', 'erro')),
  motivo                  TEXT,
  recusa                  TEXT,
  documento_aprovado_path TEXT,
  documento_assinado_id   UUID REFERENCES public.documents(id) ON DELETE SET NULL,
  hash_original           TEXT,
  hash_aprovado           TEXT,
  hash_assinado           TEXT,
  -- preenchido por assinatura_codigo_novo() na hora de pedir (ver abaixo):
  -- um DEFAULT aleatório com UNIQUE pode colidir e derrubar o INSERT
  codigo_verificacao      TEXT NOT NULL,
  erro                    TEXT,
  tentativas              SMALLINT NOT NULL DEFAULT 0,
  claim_em                TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, codigo_verificacao)
);
CREATE INDEX IF NOT EXISTS assinaturas_tenant_idx ON public.assinaturas (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS assinaturas_projeto_idx ON public.assinaturas (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS assinaturas_fila_idx ON public.assinaturas (created_at)
  WHERE situacao IN ('preparando', 'triagem', 'pendente');

-- ── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.documentos_assinaveis  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.certificados_digitais  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assinaturas            ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['documentos_assinaveis', 'certificados_digitais', 'assinaturas'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', t);
    EXECUTE format($p$
      CREATE POLICY tenant_isolation ON public.%I AS RESTRICTIVE FOR ALL
        USING      (tenant_id = public.get_user_tenant_id((select auth.uid())))
        WITH CHECK (tenant_id = public.get_user_tenant_id((select auth.uid())))
    $p$, t);
    EXECUTE format('DROP POLICY IF EXISTS equipe_le ON public.%I', t);
    EXECUTE format($p$
      CREATE POLICY equipe_le ON public.%I FOR SELECT
        USING ((select public.assinatura_equipe_ok()))
    $p$, t);
  END LOOP;
END $$;
-- escrita é só pelas RPCs (SECURITY DEFINER): nenhuma policy de INSERT/UPDATE.

-- ── Bucket do certificado: SEM policy nenhuma ───────────────────────────────
-- Nem o admin baixa o .pfx depois de subir. Só o service role alcança.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('certificados', 'certificados', false, 5242880,
        ARRAY['application/x-pkcs12', 'application/pkcs12', 'application/octet-stream'])
ON CONFLICT (id) DO NOTHING;

-- Subir o .pfx: o admin precisa de UM insert na pasta do próprio tenant.
DROP POLICY IF EXISTS certificado_admin_sobe ON storage.objects;
CREATE POLICY certificado_admin_sobe ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'certificados'
    AND (storage.foldername(name))[1] = public.get_user_tenant_id((select auth.uid()))::text
    AND (select public.assinatura_admin_ok())
  );
-- Nenhuma policy de SELECT/UPDATE/DELETE: ninguém lê de volta pela API.

-- ── Código de verificação: curto, único e sem risco de colisão no INSERT ───
-- 6 caracteres de um alfabeto sem ambiguidade visual (sem O/0, I/1, S/5): o
-- código é lido em voz alta e digitado por gente. Tenta até achar um livre, em
-- vez de confiar num DEFAULT aleatório que o UNIQUE pode recusar.
CREATE OR REPLACE FUNCTION public.assinatura_codigo_novo(_tenant UUID)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  _alfabeto CONSTANT TEXT := 'ABCDEFGHJKLMNPQRTUVWXY2346789';
  _codigo TEXT; _i INT;
BEGIN
  FOR _tentativa IN 1..50 LOOP
    _codigo := '';
    FOR _i IN 1..6 LOOP
      _codigo := _codigo || substr(_alfabeto, 1 + floor(random() * length(_alfabeto))::int, 1);
    END LOOP;
    IF NOT EXISTS (SELECT 1 FROM public.assinaturas
                    WHERE tenant_id = _tenant AND codigo_verificacao = _codigo) THEN
      RETURN _codigo;
    END IF;
  END LOOP;
  -- 29^6 ≈ 594 milhões: 50 tentativas só esgotam se algo estiver muito errado
  RAISE EXCEPTION 'Não consegui gerar um código de verificação livre.';
END;
$$;
REVOKE ALL ON FUNCTION public.assinatura_codigo_novo(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assinatura_codigo_novo(UUID) TO authenticated, service_role;

-- ── Catálogo: salvar (só admin) ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.catalogo_assinavel_salvar(
  p_codigo TEXT, p_nome TEXT, p_origem TEXT DEFAULT 'ambos',
  p_exige_triagem BOOLEAN DEFAULT TRUE, p_ativo BOOLEAN DEFAULT TRUE)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _tenant UUID; _id UUID;
BEGIN
  IF NOT public.assinatura_admin_ok() THEN
    RAISE EXCEPTION 'Só o admin mexe no catálogo de documentos assináveis.' USING ERRCODE = '42501';
  END IF;
  _tenant := public.get_user_tenant_id((select auth.uid()));
  INSERT INTO public.documentos_assinaveis (tenant_id, codigo, nome, origem, exige_triagem, ativo)
  VALUES (_tenant, lower(trim(p_codigo)), trim(p_nome), p_origem, p_exige_triagem, p_ativo)
  ON CONFLICT (tenant_id, codigo) DO UPDATE
    SET nome = EXCLUDED.nome, origem = EXCLUDED.origem,
        exige_triagem = EXCLUDED.exige_triagem, ativo = EXCLUDED.ativo, updated_at = now()
  RETURNING id INTO _id;
  RETURN _id;
END;
$$;
REVOKE ALL ON FUNCTION public.catalogo_assinavel_salvar(TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.catalogo_assinavel_salvar(TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN) TO authenticated;

-- ── Certificado: cadastrar (só admin; a senha vai para o Vault) ─────────────
CREATE OR REPLACE FUNCTION public.certificado_cadastrar(
  p_path TEXT, p_senha TEXT, p_titular_nome TEXT, p_titular_cpf TEXT)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _tenant UUID; _uid UUID := (select auth.uid()); _id UUID; _cpf TEXT; _segredo UUID;
BEGIN
  IF NOT public.assinatura_admin_ok() THEN
    RAISE EXCEPTION 'Só o admin cadastra o certificado.' USING ERRCODE = '42501';
  END IF;
  _tenant := public.get_user_tenant_id(_uid);
  _cpf := regexp_replace(coalesce(p_titular_cpf, ''), '[^0-9]', '', 'g');
  IF length(_cpf) <> 11 THEN RAISE EXCEPTION 'CPF do titular inválido.'; END IF;
  IF coalesce(trim(p_senha), '') = '' THEN RAISE EXCEPTION 'Sem a senha do certificado não dá para usá-lo.'; END IF;
  IF (storage.foldername(p_path))[1] IS DISTINCT FROM _tenant::text THEN
    RAISE EXCEPTION 'O arquivo não está na pasta deste tenant.' USING ERRCODE = '42501';
  END IF;

  -- o anterior sai de cena (o índice único só aceita um ativo)
  UPDATE public.certificados_digitais SET ativo = FALSE, updated_at = now()
   WHERE tenant_id = _tenant AND ativo;

  _segredo := vault.create_secret(p_senha, 'certificado:' || _tenant || ':' || _cpf || ':' || extract(epoch from now())::bigint,
                                  'Senha do certificado A1 de ' || trim(p_titular_nome));
  INSERT INTO public.certificados_digitais
    (tenant_id, titular_nome, titular_cpf, arquivo_path, secret_id, situacao, ativo, created_by)
  VALUES (_tenant, trim(p_titular_nome), _cpf, p_path, _segredo, 'conferindo', TRUE, _uid)
  RETURNING id INTO _id;
  RETURN _id;
END;
$$;
REVOKE ALL ON FUNCTION public.certificado_cadastrar(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.certificado_cadastrar(TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- ── Certificado: ler a senha — SÓ o robô ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.certificado_do_robo(p_id UUID)
RETURNS TABLE (arquivo_path TEXT, senha TEXT, titular_cpf TEXT, titular_nome TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF (select auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'permission denied: só o robô lê a senha do certificado' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT c.arquivo_path, s.decrypted_secret, c.titular_cpf, c.titular_nome
      FROM public.certificados_digitais c
      JOIN vault.decrypted_secrets s ON s.id = c.secret_id
     WHERE c.id = p_id AND c.ativo;
END;
$$;
REVOKE ALL ON FUNCTION public.certificado_do_robo(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.certificado_do_robo(UUID) TO service_role;

-- ── Certificado: o robô devolve o resultado da conferência ──────────────────
CREATE OR REPLACE FUNCTION public.certificado_conferido(
  p_id UUID, p_situacao TEXT, p_emissor TEXT DEFAULT NULL, p_serial TEXT DEFAULT NULL,
  p_inicio DATE DEFAULT NULL, p_fim DATE DEFAULT NULL, p_erro TEXT DEFAULT NULL)
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
         validade_fim = coalesce(p_fim, validade_fim), erro = p_erro, updated_at = now()
   WHERE id = p_id;
  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION public.certificado_conferido(UUID, TEXT, TEXT, TEXT, DATE, DATE, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.certificado_conferido(UUID, TEXT, TEXT, TEXT, DATE, DATE, TEXT) TO service_role;

-- ── Catálogo semeado para o tenant GD Manager ───────────────────────────────
INSERT INTO public.documentos_assinaveis (tenant_id, codigo, nome, origem, exige_triagem)
SELECT t.id, v.codigo, v.nome, v.origem, v.exige_triagem
  FROM public.tenants t
 CROSS JOIN (VALUES
   ('memorial_descritivo',       'Memorial descritivo',              'ambos',  TRUE),
   ('formulario_concessionaria', 'Formulário da concessionária',     'ambos',  FALSE),
   ('art',                       'ART / TRT do CREA',                'enviado', TRUE),
   ('diagrama_unifilar',         'Diagrama unifilar',                'ambos',  TRUE),
   ('declaracao_conformidade',   'Declaração de conformidade',       'ambos',  TRUE),
   ('procuracao_concessionaria', 'Procuração para a concessionária', 'enviado', TRUE)
 ) AS v(codigo, nome, origem, exige_triagem)
 WHERE t.is_library
ON CONFLICT (tenant_id, codigo) DO NOTHING;

SELECT 'fundação da assinatura aplicada' AS resultado,
       (SELECT count(*) FROM public.documentos_assinaveis) AS tipos_no_catalogo;
