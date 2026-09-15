-- Ludmilla: anexos da CPFL para o card e casamento por CPF/UC/título.
--
-- Regras do usuário (14/09/2026):
-- 1. Depois de aprovado, o portal da CPFL disponibiliza os anexos
--    "Relacionamento Operacional" e "Orçamento de Conexão Simplificado". A
--    Ludmilla baixa os dois e coloca nos comentários do card — CONFERINDO
--    antes que o card é mesmo daquele projeto (titular/UC).
-- 2. Um projeto reprovado pode ter sido reenviado sob protocolo NOVO, com o
--    cadastro ainda no protocolo velho. Casa pelo título do projeto, ou pelos
--    dados por dentro (titular, UC) — e sugere atualizar o protocolo.
--
-- Cada concessionária é diferente: esta lógica é da CPFL, mas as tabelas e
-- RPCs servem a qualquer conector que traga `documentoTitular`, `ucs` e
-- `anexosCpfl` no raw.

-- ── Fila de anexos ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.portal_anexos (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  account_id    UUID NOT NULL REFERENCES public.portal_accounts(id) ON DELETE CASCADE,
  protocolo     TEXT NOT NULL,
  project_id    UUID REFERENCES public.projects(id) ON DELETE CASCADE,
  id_arquivo    TEXT NOT NULL,
  nome_arquivo  TEXT NOT NULL,
  -- pendente = autorizado, o robô vai baixar · enviado = está no card ·
  -- bloqueado = titular/UC não conferem, ninguém anexa · erro = falhou
  situacao      TEXT NOT NULL DEFAULT 'pendente'
                CHECK (situacao IN ('pendente', 'enviado', 'bloqueado', 'erro')),
  motivo        TEXT,
  conferido_por TEXT,           -- 'cpf' | 'uc'
  document_id   UUID REFERENCES public.documents(id) ON DELETE SET NULL,
  enviado_em    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, id_arquivo)
);
CREATE INDEX IF NOT EXISTS idx_portal_anexos_pendentes ON public.portal_anexos (account_id) WHERE situacao = 'pendente';
CREATE INDEX IF NOT EXISTS idx_portal_anexos_tenant ON public.portal_anexos (tenant_id);

ALTER TABLE public.portal_anexos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.portal_anexos;
CREATE POLICY tenant_isolation ON public.portal_anexos AS RESTRICTIVE FOR ALL
  USING      (tenant_id = public.get_user_tenant_id((select auth.uid())))
  WITH CHECK (tenant_id = public.get_user_tenant_id((select auth.uid())));
DROP POLICY IF EXISTS equipe_le_anexos ON public.portal_anexos;
CREATE POLICY equipe_le_anexos ON public.portal_anexos FOR SELECT
  USING ((select public.ludmilla_equipe_ok()));

-- ── Recomendação de protocolo novo ───────────────────────────────────────────
ALTER TABLE public.portal_updates
  ADD COLUMN IF NOT EXISTS atualizar_protocolo BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS protocolo_anterior  TEXT;
ALTER TABLE public.portal_updates DROP CONSTRAINT IF EXISTS portal_updates_casamento_check;
ALTER TABLE public.portal_updates
  ADD CONSTRAINT portal_updates_casamento_check CHECK (casamento IN ('protocolo', 'cpf', 'uc', 'titular'));

-- ── O protocolo é mesmo deste projeto? ───────────────────────────────────────
-- Compara o CPF/CNPJ e as UCs lidos no portal com o cadastro. Devolve por
-- onde conferiu ('cpf' | 'uc') ou nulo. É a checagem que o usuário exigiu
-- antes de anexar qualquer coisa no card.
CREATE OR REPLACE FUNCTION public.ludmilla_identidade_confere(p_project_id UUID, p_documento TEXT, p_ucs TEXT)
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  WITH g AS (
    SELECT regexp_replace(coalesce(holder_cpf_cnpj, ''), '\D', '', 'g') AS doc,
           regexp_replace(coalesce(uc_number, ''), '\D', '', 'g') AS uc
    FROM public.project_general_data WHERE project_id = p_project_id
  )
  SELECT CASE
    WHEN coalesce(p_documento, '') <> '' AND length(p_documento) >= 11
         AND EXISTS (SELECT 1 FROM g WHERE g.doc = p_documento) THEN 'cpf'
    WHEN coalesce(p_ucs, '') <> ''
         AND EXISTS (SELECT 1 FROM g, unnest(string_to_array(p_ucs, ',')) AS u
                      WHERE g.uc <> '' AND (g.uc = u OR ltrim(g.uc, '0') = ltrim(u, '0'))) THEN 'uc'
  END;
$$;

-- ── Registrar a varredura: recomendações + anexos + casamento ───────────────
CREATE OR REPLACE FUNCTION public.ludmilla_registrar_varredura(p_run_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  _run       public.portal_sync_runs%ROWTYPE;
  _conta     public.portal_accounts%ROWTYPE;
  _p         JSONB;
  _protocolo TEXT;
  _status    TEXT;
  _titular   TEXT;
  _doc       TEXT;
  _ucs       TEXT;
  _estado    public.portal_protocol_state%ROWTYPE;
  _projeto   public.projects%ROWTYPE;
  _recom     TEXT;
  _casamento TEXT;
  _conferiu  TEXT;
  _no_escopo BOOLEAN;
  _anexo     JSONB;
  _mudancas  INTEGER := 0;
BEGIN
  IF (select auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'permission denied: só o robô registra varreduras';
  END IF;

  SELECT * INTO _run FROM public.portal_sync_runs WHERE id = p_run_id;
  IF _run.id IS NULL OR _run.tipo <> 'varredura' THEN RETURN 0; END IF;
  SELECT * INTO _conta FROM public.portal_accounts WHERE id = _run.account_id;

  FOR _p IN SELECT * FROM jsonb_array_elements(coalesce(_run.resultado->'protocolos', '[]'::jsonb)) LOOP
    _protocolo := trim(_p->>'protocolo');
    _status    := public.ludmilla_normalizar_status(_p->>'status');
    _titular   := _p->>'titular';
    _doc       := regexp_replace(coalesce(_p->'raw'->>'documentoTitular', ''), '\D', '', 'g');
    _ucs       := coalesce(_p->'raw'->>'ucs', '');
    IF _protocolo = '' OR _status = '' THEN CONTINUE; END IF;

    -- 1) pelo número do protocolo
    _casamento := NULL;
    SELECT * INTO _projeto FROM public.projects
     WHERE tenant_id = _run.tenant_id AND protocol_number = _protocolo
       AND NOT is_deleted AND archived_at IS NULL
     LIMIT 1;
    IF _projeto.id IS NOT NULL THEN _casamento := 'protocolo'; END IF;

    -- 2) sem par pelo número: reprovado reenviado sob protocolo novo? Procura
    --    pelo CPF/CNPJ do titular, pela UC, ou pelo título igual ao de outro
    --    protocolo da mesma conta que já está casado. Só projetos vivos.
    IF _projeto.id IS NULL AND _doc <> '' THEN
      SELECT p.* INTO _projeto FROM public.projects p
        JOIN public.project_general_data g ON g.project_id = p.id
       WHERE p.tenant_id = _run.tenant_id AND NOT p.is_deleted AND p.archived_at IS NULL
         AND p.status::text <> 'completed'
         AND regexp_replace(coalesce(g.holder_cpf_cnpj, ''), '\D', '', 'g') = _doc
       ORDER BY p.created_at DESC LIMIT 1;
      IF _projeto.id IS NOT NULL THEN _casamento := 'cpf'; END IF;
    END IF;
    IF _projeto.id IS NULL AND _ucs <> '' THEN
      SELECT p.* INTO _projeto FROM public.projects p
        JOIN public.project_general_data g ON g.project_id = p.id
       WHERE p.tenant_id = _run.tenant_id AND NOT p.is_deleted AND p.archived_at IS NULL
         AND p.status::text <> 'completed'
         AND regexp_replace(coalesce(g.uc_number, ''), '\D', '', 'g') <> ''
         AND ltrim(regexp_replace(coalesce(g.uc_number, ''), '\D', '', 'g'), '0')
             IN (SELECT ltrim(u, '0') FROM unnest(string_to_array(_ucs, ',')) AS u)
       ORDER BY p.created_at DESC LIMIT 1;
      IF _projeto.id IS NOT NULL THEN _casamento := 'uc'; END IF;
    END IF;
    IF _projeto.id IS NULL AND coalesce(_titular, '') <> '' THEN
      SELECT p.* INTO _projeto FROM public.portal_protocol_state s
        JOIN public.projects p ON p.id = s.project_id
       WHERE s.account_id = _run.account_id AND s.protocolo <> _protocolo
         AND upper(trim(s.titular_portal)) = upper(trim(_titular))
         AND NOT p.is_deleted AND p.archived_at IS NULL AND p.status::text <> 'completed'
       ORDER BY s.visto_em DESC LIMIT 1;
      IF _projeto.id IS NOT NULL THEN _casamento := 'titular'; END IF;
    END IF;

    SELECT * INTO _estado FROM public.portal_protocol_state
     WHERE account_id = _run.account_id AND protocolo = _protocolo;

    SELECT m.project_status INTO _recom FROM public.portal_status_map m
     WHERE m.tenant_id = _run.tenant_id AND m.connector = _conta.connector
       AND m.status_portal = _status;

    _no_escopo := _projeto.id IS NOT NULL AND _projeto.status::text = ANY (_conta.etapas_acompanhadas);

    -- Recomendação de status (só protocolo casado pelo número e em escopo)
    IF _casamento = 'protocolo' AND _no_escopo AND (
         (_estado.protocolo IS NOT NULL AND _estado.status_portal IS DISTINCT FROM _status)
      OR (_estado.protocolo IS NULL AND public.ludmilla_recomendacao_vale(_run.tenant_id, _projeto.status::text, _recom))
    ) THEN
      IF NOT public.ludmilla_recomendacao_vale(_run.tenant_id, _projeto.status::text, _recom) THEN _recom := NULL; END IF;
      IF NOT EXISTS (SELECT 1 FROM public.portal_updates u
                      WHERE u.account_id = _run.account_id AND u.protocolo = _protocolo
                        AND u.status_portal = _status AND u.situacao = 'pendente') THEN
        INSERT INTO public.portal_updates
          (tenant_id, run_id, account_id, protocolo, titular_portal, status_portal, status_anterior,
           project_id, casamento, recomendacao, raw)
        VALUES
          (_run.tenant_id, _run.id, _run.account_id, _protocolo, _titular, _status, _estado.status_portal,
           _projeto.id, 'protocolo', _recom, _p->'raw');
        _mudancas := _mudancas + 1;
      END IF;
    END IF;

    -- Protocolo novo para um projeto conhecido (casado por cpf/uc/título): a
    -- recomendação é ATUALIZAR o protocolo — e a etapa, se a tradução couber.
    IF _casamento IN ('cpf', 'uc', 'titular') AND _estado.protocolo IS NULL
       AND coalesce(_projeto.protocol_number, '') <> _protocolo THEN
      IF NOT public.ludmilla_recomendacao_vale(_run.tenant_id, _projeto.status::text, _recom) THEN _recom := NULL; END IF;
      IF NOT EXISTS (SELECT 1 FROM public.portal_updates u
                      WHERE u.account_id = _run.account_id AND u.protocolo = _protocolo AND u.situacao = 'pendente') THEN
        INSERT INTO public.portal_updates
          (tenant_id, run_id, account_id, protocolo, titular_portal, status_portal, status_anterior,
           project_id, casamento, recomendacao, atualizar_protocolo, protocolo_anterior, raw)
        VALUES
          (_run.tenant_id, _run.id, _run.account_id, _protocolo, _titular, _status, NULL,
           _projeto.id, _casamento, _recom, TRUE, _projeto.protocol_number, _p->'raw');
        _mudancas := _mudancas + 1;
      END IF;
    END IF;

    -- Anexos da CPFL: só para projeto casado PELO NÚMERO, em escopo ou já
    -- aprovado/em vistoria, e com titular/UC conferidos. Sem conferência,
    -- fica registrado como bloqueado — ninguém anexa no card errado.
    IF _casamento = 'protocolo' AND (_p->'raw'->>'anexosCpfl') IS NOT NULL
       AND _projeto.status::text = ANY (_conta.etapas_acompanhadas || ARRAY['pendencia', 'vistoria_reprovada']) THEN
      _conferiu := public.ludmilla_identidade_confere(_projeto.id, _doc, _ucs);
      FOR _anexo IN SELECT * FROM jsonb_array_elements((_p->'raw'->>'anexosCpfl')::jsonb) LOOP
        INSERT INTO public.portal_anexos
          (tenant_id, account_id, protocolo, project_id, id_arquivo, nome_arquivo, situacao, motivo, conferido_por)
        VALUES
          (_run.tenant_id, _run.account_id, _protocolo, _projeto.id,
           _anexo->>'idArquivo', coalesce(_anexo->>'nomeArquivo', _anexo->>'idArquivo'),
           CASE WHEN _conferiu IS NULL THEN 'bloqueado' ELSE 'pendente' END,
           CASE WHEN _conferiu IS NULL
                THEN 'Titular/UC do portal não conferem com o cadastro do ' || coalesce(_projeto.code, 'projeto') || ' — anexo não enviado ao card.'
           END,
           _conferiu)
        ON CONFLICT (account_id, id_arquivo) DO NOTHING;
      END LOOP;
    END IF;

    INSERT INTO public.portal_protocol_state
      (tenant_id, account_id, protocolo, titular_portal, status_portal, project_id, raw, visto_em, mudou_em)
    VALUES
      (_run.tenant_id, _run.account_id, _protocolo, _titular, _status, _projeto.id, _p->'raw', now(), now())
    ON CONFLICT (account_id, protocolo) DO UPDATE
      SET titular_portal = EXCLUDED.titular_portal,
          status_portal  = EXCLUDED.status_portal,
          project_id     = coalesce(EXCLUDED.project_id, public.portal_protocol_state.project_id),
          raw            = EXCLUDED.raw,
          visto_em       = now(),
          mudou_em       = CASE WHEN public.portal_protocol_state.status_portal IS DISTINCT FROM EXCLUDED.status_portal
                                THEN now() ELSE public.portal_protocol_state.mudou_em END;
  END LOOP;

  UPDATE public.portal_sync_runs SET mudancas = _mudancas WHERE id = p_run_id;
  RETURN _mudancas;
END;
$$;

-- ── O robô pergunta o que baixar e avisa o que enviou ────────────────────────
CREATE OR REPLACE FUNCTION public.ludmilla_anexos_pendentes(p_account_id UUID)
RETURNS TABLE (id UUID, project_id UUID, company_id UUID, protocolo TEXT, id_arquivo TEXT, nome_arquivo TEXT, codigo TEXT)
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  SELECT a.id, a.project_id, p.company_id, a.protocolo, a.id_arquivo, a.nome_arquivo, p.code
  FROM public.portal_anexos a JOIN public.projects p ON p.id = a.project_id
  WHERE a.account_id = p_account_id AND a.situacao = 'pendente'
    AND (select auth.role()) = 'service_role'
  ORDER BY a.created_at LIMIT 20;
$$;
REVOKE ALL ON FUNCTION public.ludmilla_anexos_pendentes(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ludmilla_anexos_pendentes(UUID) TO service_role;

-- O arquivo já está no bucket project-documents: registra como documento do
-- projeto (tipo other_photos, o mesmo dos anexos de comentário) e deixa o
-- comentário no card, assinado pela Ludmilla — igual ao que uma pessoa faz.
CREATE OR REPLACE FUNCTION public.ludmilla_anexo_enviado(p_anexo_id UUID, p_file_path TEXT, p_file_type TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  _a   public.portal_anexos%ROWTYPE;
  _doc UUID;
  _ludmilla CONSTANT UUID := '00000000-10d1-4000-8000-000000000002';
BEGIN
  IF (select auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'permission denied: só o robô registra anexos';
  END IF;
  SELECT * INTO _a FROM public.portal_anexos WHERE id = p_anexo_id AND situacao = 'pendente';
  IF _a.id IS NULL THEN RETURN; END IF;

  INSERT INTO public.documents (project_id, document_type, file_name, file_url, file_type, uploaded_by)
  VALUES (_a.project_id, 'other_photos', _a.nome_arquivo, p_file_path, p_file_type, _ludmilla)
  RETURNING id INTO _doc;

  INSERT INTO public.comments (project_id, user_id, message)
  VALUES (_a.project_id, _ludmilla,
          '📡 Anexo emitido pela CPFL para o protocolo ' || _a.protocolo
          || ' (titular/UC conferidos por ' || coalesce(_a.conferido_por, '?') || ').' || E'\n📎 ' || _a.nome_arquivo);

  UPDATE public.portal_anexos SET situacao = 'enviado', document_id = _doc, enviado_em = now(), motivo = NULL
   WHERE id = _a.id;
END;
$$;
REVOKE ALL ON FUNCTION public.ludmilla_anexo_enviado(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ludmilla_anexo_enviado(UUID, TEXT, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.ludmilla_anexo_erro(p_anexo_id UUID, p_motivo TEXT)
RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  UPDATE public.portal_anexos SET situacao = 'erro', motivo = p_motivo
   WHERE id = p_anexo_id AND (select auth.role()) = 'service_role';
$$;
REVOKE ALL ON FUNCTION public.ludmilla_anexo_erro(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ludmilla_anexo_erro(UUID, TEXT) TO service_role;

-- ── Aplicar: pode atualizar o protocolo além da etapa ────────────────────────
CREATE OR REPLACE FUNCTION public.ludmilla_aplicar_update(p_update_id UUID, p_status TEXT DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  _uid    UUID := (select auth.uid());
  _u      public.portal_updates%ROWTYPE;
  _novo   TEXT;
  _nome   TEXT;
  _texto  TEXT;
BEGIN
  IF _uid IS NULL OR NOT public.ludmilla_equipe_ok() THEN
    RAISE EXCEPTION 'Sem acesso à Ludmilla.';
  END IF;
  SELECT * INTO _u FROM public.portal_updates
   WHERE id = p_update_id AND tenant_id = public.get_user_tenant_id(_uid);
  IF _u.id IS NULL THEN RAISE EXCEPTION 'Recomendação não encontrada.'; END IF;
  IF _u.situacao <> 'pendente' THEN RAISE EXCEPTION 'Esta recomendação já foi %.', _u.situacao; END IF;
  IF _u.project_id IS NULL THEN RAISE EXCEPTION 'Recomendação sem projeto casado — não há o que mover.'; END IF;

  _novo := coalesce(nullif(trim(p_status), ''), _u.recomendacao);
  IF _novo IS NULL AND NOT _u.atualizar_protocolo THEN
    RAISE EXCEPTION 'Escolha a etapa para onde mover o projeto.';
  END IF;

  SELECT name INTO _nome FROM public.profiles WHERE id = _uid;
  _texto := 'Protocolo ' || _u.protocolo || ' está "' || _u.status_portal || '" no portal';

  IF _u.atualizar_protocolo THEN
    UPDATE public.projects SET protocol_number = _u.protocolo WHERE id = _u.project_id;
    _texto := _texto || '; protocolo do cadastro atualizado de ' || coalesce(_u.protocolo_anterior, '(vazio)')
           || ' para ' || _u.protocolo || ' (casado por ' || coalesce(_u.casamento, '?') || ')';
  END IF;
  IF _novo IS NOT NULL THEN
    UPDATE public.projects SET status = _novo::public.project_status WHERE id = _u.project_id;
    _texto := _texto || '; ' || coalesce(_nome, 'a equipe') || ' moveu para ' || _novo;
  END IF;

  UPDATE public.portal_updates
     SET situacao = 'aplicada', aplicada_por = _uid, aplicada_em = now()
   WHERE id = _u.id;

  INSERT INTO public.comments (project_id, user_id, message)
  VALUES (_u.project_id, _uid, '📡 Ludmilla: ' || _texto || '.');
  INSERT INTO public.project_history (project_id, action, description, user_id, user_name)
  VALUES (_u.project_id, CASE WHEN _novo IS NOT NULL THEN 'Status atualizado pelo portal' ELSE 'Protocolo atualizado pelo portal' END,
          _texto || '.', _uid, coalesce(_nome, 'Equipe'));
END;
$$;
