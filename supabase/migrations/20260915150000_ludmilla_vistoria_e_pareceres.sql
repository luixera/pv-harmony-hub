-- Ludmilla (CPFL): concluído só com VISTORIA APROVADA, e pareceres no card.
--
-- Regras do usuário (15/09/2026):
-- 1. Vistoria solicitada → concluído quando, dentro do projeto, a aba
--    Vistoria mostra "VISTORIA APROVADA". "PROJETO ENCERRADO" sozinho não
--    basta — existe o botão "Encerrar projeto", e um encerramento manual não
--    é vistoria concluída.
-- 2. O texto de "Mostrar parecer" (cada parecer da CPFL) vai para os
--    comentários do projeto — uma vez só, e só com titular/UC conferidos,
--    como os anexos.

-- ── Quais protocolos merecem o detalhe (pareceres, titular, UC, anexos) ─────
-- O robô só sabe o que mexeu recentemente; o banco sabe quais projetos a
-- conta acompanha. A união dos dois é o que a varredura detalha.
CREATE OR REPLACE FUNCTION public.ludmilla_protocolos_de_interesse(p_account_id UUID)
RETURNS TABLE (protocolo TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT p.protocol_number
  FROM public.portal_accounts a
  JOIN public.projects p ON p.tenant_id = a.tenant_id AND p.concessionaire_id = a.concessionaire_id
  WHERE a.id = p_account_id
    AND (select auth.role()) = 'service_role'
    AND NOT p.is_deleted AND p.archived_at IS NULL
    AND p.protocol_number IS NOT NULL AND p.protocol_number <> ''
    AND p.status::text = ANY (a.etapas_acompanhadas || ARRAY['pendencia', 'vistoria_reprovada'])
  LIMIT 200;
$$;
REVOKE ALL ON FUNCTION public.ludmilla_protocolos_de_interesse(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ludmilla_protocolos_de_interesse(UUID) TO service_role;

-- ── Pareceres já comentados ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.portal_pareceres (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  account_id  UUID NOT NULL REFERENCES public.portal_accounts(id) ON DELETE CASCADE,
  protocolo   TEXT NOT NULL,
  chave       TEXT NOT NULL,            -- codigoInboxUsuario: um parecer, um comentário
  project_id  UUID REFERENCES public.projects(id) ON DELETE CASCADE,
  comment_id  UUID,
  data        TEXT,
  analise     TEXT,
  status      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, chave)
);
CREATE INDEX IF NOT EXISTS idx_portal_pareceres_tenant ON public.portal_pareceres (tenant_id);
ALTER TABLE public.portal_pareceres ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.portal_pareceres;
CREATE POLICY tenant_isolation ON public.portal_pareceres AS RESTRICTIVE FOR ALL
  USING      (tenant_id = public.get_user_tenant_id((select auth.uid())))
  WITH CHECK (tenant_id = public.get_user_tenant_id((select auth.uid())));
DROP POLICY IF EXISTS equipe_le_pareceres ON public.portal_pareceres;
CREATE POLICY equipe_le_pareceres ON public.portal_pareceres FOR SELECT
  USING ((select public.ludmilla_equipe_ok()));

-- ── Registrar: vistoria aprovada + pareceres ─────────────────────────────────
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
  _vistoria  TEXT;
  _estado    public.portal_protocol_state%ROWTYPE;
  _projeto   public.projects%ROWTYPE;
  _recom     TEXT;
  _casamento TEXT;
  _conferiu  TEXT;
  _no_escopo BOOLEAN;
  _anexo     JSONB;
  _parecer   JSONB;
  _coment    UUID;
  _mudancas  INTEGER := 0;
  _ludmilla  CONSTANT UUID := '00000000-10d1-4000-8000-000000000002';
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
    _vistoria  := coalesce(_p->'raw'->>'vistoriaAprovada', '');
    IF _protocolo = '' OR _status = '' THEN CONTINUE; END IF;

    _casamento := NULL;
    SELECT * INTO _projeto FROM public.projects
     WHERE tenant_id = _run.tenant_id AND protocol_number = _protocolo
       AND NOT is_deleted AND archived_at IS NULL
     LIMIT 1;
    IF _projeto.id IS NOT NULL THEN _casamento := 'protocolo'; END IF;

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

    -- CONCLUÍDO exige vistoria aprovada dentro do projeto. Sem essa prova
    -- (encerramento manual, ou parecer ainda não lido) a linha aparece no
    -- relatório SEM recomendação — a pessoa decide olhando o parecer.
    IF _recom = 'completed' AND _vistoria <> 'sim' THEN _recom := NULL; END IF;

    _no_escopo := _projeto.id IS NOT NULL AND _projeto.status::text = ANY (_conta.etapas_acompanhadas);

    IF _casamento = 'protocolo' AND _no_escopo AND (
         (_estado.protocolo IS NOT NULL AND _estado.status_portal IS DISTINCT FROM _status)
      OR (_estado.protocolo IS NULL AND public.ludmilla_recomendacao_vale(_run.tenant_id, _projeto.status::text, _recom))
      -- o status não mudou, mas agora a vistoria consta aprovada: é a hora de concluir
      OR (_estado.protocolo IS NOT NULL AND _recom = 'completed'
          AND coalesce(_estado.raw->>'vistoriaAprovada', '') <> 'sim')
    ) THEN
      IF NOT public.ludmilla_recomendacao_vale(_run.tenant_id, _projeto.status::text, _recom) THEN _recom := NULL; END IF;
      IF EXISTS (SELECT 1 FROM public.portal_updates u
                  WHERE u.account_id = _run.account_id AND u.protocolo = _protocolo
                    AND u.status_portal = _status AND u.situacao = 'pendente') THEN
        -- já está no relatório com este status; se agora há prova da vistoria,
        -- a recomendação que estava vazia passa a "concluído"
        UPDATE public.portal_updates u
           SET recomendacao = _recom, raw = _p->'raw'
         WHERE u.account_id = _run.account_id AND u.protocolo = _protocolo
           AND u.status_portal = _status AND u.situacao = 'pendente'
           AND u.recomendacao IS NULL AND _recom IS NOT NULL;
      ELSE
        INSERT INTO public.portal_updates
          (tenant_id, run_id, account_id, protocolo, titular_portal, status_portal, status_anterior,
           project_id, casamento, recomendacao, raw)
        VALUES
          (_run.tenant_id, _run.id, _run.account_id, _protocolo, _titular, _status, _estado.status_portal,
           _projeto.id, 'protocolo', _recom, _p->'raw');
        _mudancas := _mudancas + 1;
      END IF;
    END IF;

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

    -- Anexos e PARECERES: só projeto casado pelo número, e só com titular/UC
    -- conferidos. Sem conferência, nada entra no card.
    IF _casamento = 'protocolo'
       AND _projeto.status::text = ANY (_conta.etapas_acompanhadas || ARRAY['pendencia', 'vistoria_reprovada']) THEN
      _conferiu := public.ludmilla_identidade_confere(_projeto.id, _doc, _ucs);

      IF (_p->'raw'->>'anexosCpfl') IS NOT NULL THEN
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

      IF _conferiu IS NOT NULL AND (_p->'raw'->>'pareceres') IS NOT NULL THEN
        FOR _parecer IN SELECT * FROM jsonb_array_elements((_p->'raw'->>'pareceres')::jsonb) LOOP
          CONTINUE WHEN coalesce(_parecer->>'chave', '') = '' OR coalesce(_parecer->>'texto', '') = '';
          CONTINUE WHEN EXISTS (SELECT 1 FROM public.portal_pareceres x
                                 WHERE x.account_id = _run.account_id AND x.chave = _parecer->>'chave');
          INSERT INTO public.comments (project_id, user_id, message)
          VALUES (_projeto.id, _ludmilla,
                  '📡 Parecer da CPFL — ' || coalesce(_parecer->>'data', '') || ' · '
                  || coalesce(nullif(_parecer->>'analise', ''), 'análise') || ' · ' || coalesce(_parecer->>'status', '')
                  || E'\n' || (_parecer->>'texto'))
          RETURNING id INTO _coment;
          INSERT INTO public.portal_pareceres (tenant_id, account_id, protocolo, chave, project_id, comment_id, data, analise, status)
          VALUES (_run.tenant_id, _run.account_id, _protocolo, _parecer->>'chave', _projeto.id, _coment,
                  _parecer->>'data', _parecer->>'analise', _parecer->>'status');
        END LOOP;
      END IF;
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

-- As 3 recomendações "Concluído" pendentes nasceram só do PROJETO ENCERRADO,
-- sem a prova da vistoria. Voltam para "sem recomendação" até a próxima
-- varredura confirmar pelo parecer (o texto explica na tela).
UPDATE public.portal_updates SET recomendacao = NULL
 WHERE situacao = 'pendente' AND recomendacao = 'completed'
   AND coalesce(raw->>'vistoriaAprovada', '') <> 'sim';
