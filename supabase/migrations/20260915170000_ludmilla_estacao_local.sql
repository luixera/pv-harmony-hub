-- Ludmilla: estação LOCAL (Elektro no computador do coworking) e agendamento.
--
-- Spec: docs/superpowers/specs/2026-09-15-ludmilla-elektro-local-design.md
--
-- O Portal GD da Elektro bloqueia navegador sem tela e IP de datacenter, e
-- tem CAPTCHA no login. Então o robô roda também numa máquina de pessoa
-- ("modo local"), com Chrome de verdade, e uma pessoa digita o CAPTCHA.
--
-- Nessa máquina NÃO existe service role. A estação entra no GD Manager com
-- um usuário staff dedicado, e as funções "_local" abaixo checam que quem
-- chama é o OPERADOR cadastrado na conta do portal — nem outro staff do
-- tenant pega runs ou lê a senha do portal por elas.

-- ── Conta: modo e operador ───────────────────────────────────────────────────
ALTER TABLE public.portal_accounts
  ADD COLUMN IF NOT EXISTS modo TEXT NOT NULL DEFAULT 'vps' CHECK (modo IN ('vps', 'local')),
  ADD COLUMN IF NOT EXISTS operador_local UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS estacao_vista_em TIMESTAMPTZ;
COMMENT ON COLUMN public.portal_accounts.modo IS
  'vps = o robô da VPS visita; local = uma estação (máquina de pessoa) visita, com login assistido';
COMMENT ON COLUMN public.portal_accounts.operador_local IS
  'Usuário staff com que a estação entra no GD Manager; só ele opera esta conta';

-- ── A conta da Elektro passa a ser local ─────────────────────────────────────
-- O operador (usuário staff com que a estação entra) é escolhido pelo admin
-- na tela de acesso ao portal: crie o usuário em Usuários (com senha) e
-- selecione-o lá. Sem operador, a estação não pega runs.
UPDATE public.portal_accounts a SET modo = 'local'
  FROM public.tenants t WHERE t.id = a.tenant_id AND t.is_library AND a.connector = 'elektro';

-- ── Quem chama é o operador desta conta? ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ludmilla_operador_ok(p_account_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.portal_accounts a
    WHERE a.id = p_account_id AND a.modo = 'local'
      AND a.operador_local = (select auth.uid())
      AND a.tenant_id = public.get_user_tenant_id((select auth.uid()))
  );
$$;

-- ── Fechamento comum (sem checagem de papel) + as duas portas ────────────────
CREATE OR REPLACE FUNCTION public.ludmilla_finalizar_run_impl(
  p_run_id UUID, p_situacao TEXT, p_erro TEXT, p_resultado JSONB, p_print_path TEXT,
  p_protocolos INTEGER, p_mudancas INTEGER, p_situacao_conta TEXT
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _account UUID; _tipo TEXT; _conta public.portal_accounts%ROWTYPE; _dest UUID;
BEGIN
  UPDATE public.portal_sync_runs
     SET situacao = p_situacao, terminado_em = now(), erro = p_erro, resultado = p_resultado,
         print_path = p_print_path, protocolos_lidos = p_protocolos, mudancas = p_mudancas
   WHERE id = p_run_id
   RETURNING account_id, tipo INTO _account, _tipo;
  IF _account IS NULL THEN RETURN; END IF;

  UPDATE public.portal_accounts
     SET situacao = coalesce(p_situacao_conta, situacao),
         ultimo_erro = CASE WHEN p_situacao = 'erro' THEN p_erro ELSE NULL END,
         ultima_varredura_em = CASE WHEN _tipo = 'varredura' AND p_situacao = 'ok' THEN now() ELSE ultima_varredura_em END
   WHERE id = _account
   RETURNING * INTO _conta;

  IF _tipo = 'varredura' AND p_situacao = 'ok' THEN
    PERFORM public.ludmilla_registrar_varredura(p_run_id);
  END IF;

  -- Estação local sem ninguém para o login: avisa os admins pelo sino.
  IF _conta.modo = 'local' AND p_situacao_conta = 'sessao_expirada' THEN
    FOR _dest IN SELECT p.id FROM public.profiles p WHERE p.tenant_id = _conta.tenant_id AND p.role = 'admin' LOOP
      INSERT INTO public.notifications (tenant_id, user_id, title, message, type, project_id, read)
      VALUES (_conta.tenant_id, _dest, '📡 Ludmilla precisa de login na Elektro',
              coalesce(p_erro, 'A estação abriu o portal, mas ninguém digitou o CAPTCHA.') || ' Ela tenta de novo no próximo horário.',
              'ludmilla', NULL, FALSE);
    END LOOP;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.ludmilla_finalizar_run(
  p_run_id UUID, p_situacao TEXT, p_erro TEXT DEFAULT NULL, p_resultado JSONB DEFAULT NULL,
  p_print_path TEXT DEFAULT NULL, p_protocolos INTEGER DEFAULT 0, p_mudancas INTEGER DEFAULT 0,
  p_situacao_conta TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF (select auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'permission denied: só o robô finaliza runs';
  END IF;
  PERFORM public.ludmilla_finalizar_run_impl(p_run_id, p_situacao, p_erro, p_resultado, p_print_path, p_protocolos, p_mudancas, p_situacao_conta);
END;
$$;

CREATE OR REPLACE FUNCTION public.ludmilla_finalizar_run_local(
  p_run_id UUID, p_situacao TEXT, p_erro TEXT DEFAULT NULL, p_resultado JSONB DEFAULT NULL,
  p_print_path TEXT DEFAULT NULL, p_protocolos INTEGER DEFAULT 0, p_mudancas INTEGER DEFAULT 0,
  p_situacao_conta TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _account UUID;
BEGIN
  SELECT account_id INTO _account FROM public.portal_sync_runs WHERE id = p_run_id;
  IF _account IS NULL OR NOT public.ludmilla_operador_ok(_account) THEN
    RAISE EXCEPTION 'permission denied: só o operador da estação fecha este run';
  END IF;
  PERFORM public.ludmilla_finalizar_run_impl(p_run_id, p_situacao, p_erro, p_resultado, p_print_path, p_protocolos, p_mudancas, p_situacao_conta);
END;
$$;
REVOKE ALL ON FUNCTION public.ludmilla_finalizar_run_local(UUID, TEXT, TEXT, JSONB, TEXT, INTEGER, INTEGER, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ludmilla_finalizar_run_local(UUID, TEXT, TEXT, JSONB, TEXT, INTEGER, INTEGER, TEXT) TO authenticated;

-- ── registrar_varredura: service role (VPS) OU operador da estação local ─────
-- (corpo idêntico ao de 20260915150000, só a checagem muda)
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
  SELECT * INTO _run FROM public.portal_sync_runs WHERE id = p_run_id;
  -- service role (VPS) ou o operador da estação local desta conta
  IF (select auth.role()) IS DISTINCT FROM 'service_role'
     AND NOT (_run.id IS NOT NULL AND public.ludmilla_operador_ok(_run.account_id)) THEN
    RAISE EXCEPTION 'permission denied: só o robô registra varreduras';
  END IF;
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

-- ── Fila: pegar run (só das contas locais do operador) ───────────────────────
CREATE OR REPLACE FUNCTION public.ludmilla_claim_run_local()
RETURNS SETOF public.portal_sync_runs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _id UUID;
BEGIN
  SELECT r.id INTO _id
    FROM public.portal_sync_runs r
    JOIN public.portal_accounts a ON a.id = r.account_id AND a.enabled
   WHERE r.situacao = 'na_fila' AND a.modo = 'local'
     AND a.operador_local = (select auth.uid())
     AND a.tenant_id = public.get_user_tenant_id((select auth.uid()))
   ORDER BY r.pedido_em
   FOR UPDATE OF r SKIP LOCKED
   LIMIT 1;
  IF _id IS NULL THEN RETURN; END IF;
  RETURN QUERY
    UPDATE public.portal_sync_runs SET situacao = 'rodando', iniciado_em = now()
     WHERE id = _id RETURNING *;
END;
$$;
REVOKE ALL ON FUNCTION public.ludmilla_claim_run_local() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ludmilla_claim_run_local() TO authenticated;

-- ── Credenciais do portal (só o operador da conta) ───────────────────────────
CREATE OR REPLACE FUNCTION public.ludmilla_portal_credentials_local(p_account_id UUID)
RETURNS TABLE (login TEXT, senha TEXT, connector TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT public.ludmilla_operador_ok(p_account_id) THEN
    RAISE EXCEPTION 'permission denied: só o operador da estação lê estas credenciais';
  END IF;
  RETURN QUERY
    SELECT a.login, s.decrypted_secret, a.connector
    FROM public.portal_accounts a JOIN vault.decrypted_secrets s ON s.id = a.secret_id
    WHERE a.id = p_account_id AND a.enabled;
END;
$$;
REVOKE ALL ON FUNCTION public.ludmilla_portal_credentials_local(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ludmilla_portal_credentials_local(UUID) TO authenticated;

-- ── Heartbeat da estação ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ludmilla_estacao_pulsa()
RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  UPDATE public.portal_accounts SET estacao_vista_em = now()
   WHERE modo = 'local' AND operador_local = (select auth.uid())
     AND tenant_id = public.get_user_tenant_id((select auth.uid()));
$$;
REVOKE ALL ON FUNCTION public.ludmilla_estacao_pulsa() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ludmilla_estacao_pulsa() TO authenticated;

-- ── Anexos e interesse, versão do operador ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.ludmilla_anexos_pendentes_local(p_account_id UUID)
RETURNS TABLE (id UUID, project_id UUID, company_id UUID, protocolo TEXT, id_arquivo TEXT, nome_arquivo TEXT, codigo TEXT)
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  SELECT a.id, a.project_id, p.company_id, a.protocolo, a.id_arquivo, a.nome_arquivo, p.code
  FROM public.portal_anexos a JOIN public.projects p ON p.id = a.project_id
  WHERE a.account_id = p_account_id AND a.situacao = 'pendente'
    AND public.ludmilla_operador_ok(p_account_id)
  ORDER BY a.created_at LIMIT 20;
$$;
REVOKE ALL ON FUNCTION public.ludmilla_anexos_pendentes_local(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ludmilla_anexos_pendentes_local(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.ludmilla_anexo_enviado_local(p_anexo_id UUID, p_file_path TEXT, p_file_type TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _a public.portal_anexos%ROWTYPE; _doc UUID;
        _ludmilla CONSTANT UUID := '00000000-10d1-4000-8000-000000000002';
BEGIN
  SELECT * INTO _a FROM public.portal_anexos WHERE id = p_anexo_id AND situacao = 'pendente';
  IF _a.id IS NULL OR NOT public.ludmilla_operador_ok(_a.account_id) THEN
    RAISE EXCEPTION 'permission denied: só o operador da estação registra este anexo';
  END IF;
  INSERT INTO public.documents (project_id, document_type, file_name, file_url, file_type, uploaded_by)
  VALUES (_a.project_id, 'other_photos', _a.nome_arquivo, p_file_path, p_file_type, _ludmilla)
  RETURNING id INTO _doc;
  INSERT INTO public.comments (project_id, user_id, message)
  VALUES (_a.project_id, _ludmilla,
          '📡 Anexo emitido pela concessionária para o protocolo ' || _a.protocolo
          || ' (titular/UC conferidos por ' || coalesce(_a.conferido_por, '?') || ').' || E'\n📎 ' || _a.nome_arquivo);
  UPDATE public.portal_anexos SET situacao = 'enviado', document_id = _doc, enviado_em = now(), motivo = NULL WHERE id = _a.id;
END;
$$;
REVOKE ALL ON FUNCTION public.ludmilla_anexo_enviado_local(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ludmilla_anexo_enviado_local(UUID, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.ludmilla_anexo_erro_local(p_anexo_id UUID, p_motivo TEXT)
RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  UPDATE public.portal_anexos a SET situacao = 'erro', motivo = p_motivo
   WHERE a.id = p_anexo_id AND public.ludmilla_operador_ok(a.account_id);
$$;
REVOKE ALL ON FUNCTION public.ludmilla_anexo_erro_local(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ludmilla_anexo_erro_local(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.ludmilla_protocolos_de_interesse_local(p_account_id UUID)
RETURNS TABLE (protocolo TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT p.protocol_number
  FROM public.portal_accounts a
  JOIN public.projects p ON p.tenant_id = a.tenant_id AND p.concessionaire_id = a.concessionaire_id
  WHERE a.id = p_account_id AND public.ludmilla_operador_ok(p_account_id)
    AND NOT p.is_deleted AND p.archived_at IS NULL
    AND p.protocol_number IS NOT NULL AND p.protocol_number <> ''
    AND p.status::text = ANY (a.etapas_acompanhadas || ARRAY['pendencia', 'vistoria_reprovada'])
  LIMIT 200;
$$;
REVOKE ALL ON FUNCTION public.ludmilla_protocolos_de_interesse_local(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ludmilla_protocolos_de_interesse_local(UUID) TO authenticated;

-- A estação grava prints/HTML no bucket `ludmilla` como usuário autenticado:
-- política de escrita na pasta do próprio tenant, só para operadores locais.
DROP POLICY IF EXISTS ludmilla_estacao_escreve ON storage.objects;
CREATE POLICY ludmilla_estacao_escreve ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'ludmilla'
    AND (storage.foldername(name))[1] = public.get_user_tenant_id((select auth.uid()))::text
    AND EXISTS (SELECT 1 FROM public.portal_accounts a WHERE a.modo = 'local' AND a.operador_local = (select auth.uid()))
  );
-- …e documentos do projeto (anexos) no bucket project-documents
DROP POLICY IF EXISTS ludmilla_estacao_anexa ON storage.objects;
CREATE POLICY ludmilla_estacao_anexa ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'project-documents'
    AND EXISTS (SELECT 1 FROM public.portal_accounts a WHERE a.modo = 'local' AND a.operador_local = (select auth.uid()))
  );

-- ── Agendamento 2×/dia (08h e 17h em Brasília) ───────────────────────────────
CREATE OR REPLACE FUNCTION public.ludmilla_agendar_varreduras()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _n INTEGER := 0; _a RECORD;
BEGIN
  FOR _a IN SELECT id, tenant_id FROM public.portal_accounts WHERE enabled AND login IS NOT NULL AND secret_id IS NOT NULL LOOP
    IF NOT EXISTS (SELECT 1 FROM public.portal_sync_runs r
                    WHERE r.account_id = _a.id AND r.tipo = 'varredura' AND r.situacao IN ('na_fila', 'rodando')) THEN
      INSERT INTO public.portal_sync_runs (tenant_id, account_id, tipo) VALUES (_a.tenant_id, _a.id, 'varredura');
      _n := _n + 1;
    END IF;
  END LOOP;
  RETURN _n;
END;
$$;
REVOKE ALL ON FUNCTION public.ludmilla_agendar_varreduras() FROM PUBLIC, anon, authenticated;

SELECT cron.unschedule('ludmilla-08h') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ludmilla-08h');
SELECT cron.unschedule('ludmilla-17h') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ludmilla-17h');
SELECT cron.schedule('ludmilla-08h', '0 11 * * *', $cron$ SELECT public.ludmilla_agendar_varreduras(); $cron$);
SELECT cron.schedule('ludmilla-17h', '0 20 * * *', $cron$ SELECT public.ludmilla_agendar_varreduras(); $cron$);
