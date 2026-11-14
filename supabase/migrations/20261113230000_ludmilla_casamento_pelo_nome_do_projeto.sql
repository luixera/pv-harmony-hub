-- Ludmilla: casar pelo NOME do titular no cadastro do projeto quando o portal só manda o nome
-- (13/11/2026, pedido do usuário: a Elektro não reconhecia projeto sem protocolo gravado, ex. PRJ-69492).
--
-- Até aqui o casamento "por titular" só procurava OUTRO protocolo do mesmo titular já ligado a um
-- projeto (reenvio com protocolo novo). Projeto novo sem protocolo nunca casava: a lista da Elektro
-- só traz protocolo, status e nome (sem CPF/UC). Duas mudanças, o resto igual ao prosrc vivo
-- (pg_get_functiondef em 13/11/2026, já com a ordem pelo projeto mais novo de 20261113131000):
--  1. casamento pelo nome do titular do projeto: mesma concessionária, sem protocolo, fora de
--     concluído, nome inteiro igual (sem acento/caixa/espaço repetido), candidato ÚNICO; só quando o
--     portal não mandou CPF nem UC (a CPFL manda, e para ela nada muda);
--  2. o cartão de gravar protocolo também sai para protocolo já visto sem projeto (uma vez: o estado
--     passa a guardar o projeto).
-- Nada é aplicado sozinho: vira cartão na /ludmilla para a pessoa confirmar.

CREATE OR REPLACE FUNCTION public.ludmilla_registrar_varredura(p_run_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  _n_nome    INTEGER;
  _id_nome   UUID;
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
     ORDER BY created_at DESC
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
       ORDER BY p.created_at DESC LIMIT 1;
      IF _projeto.id IS NOT NULL THEN _casamento := 'titular'; END IF;
    END IF;
    -- 13/11/2026: o NOME do titular no CADASTRO do projeto, quando o portal só manda o nome (sem CPF
    -- nem UC: a Elektro pela extensão manda protocolo, status e titular). Projeto da MESMA
    -- concessionária, ainda SEM protocolo, fora de concluído; nome inteiro igual sem acento, caixa e
    -- espaço repetido; e ÚNICO (dois candidatos = ninguém). Vira cartão de gravar o protocolo.
    IF _projeto.id IS NULL AND coalesce(_titular, '') <> '' AND _doc = '' AND _ucs = '' THEN
      SELECT count(*), (array_agg(p.id))[1] INTO _n_nome, _id_nome
        FROM public.projects p
        LEFT JOIN public.project_general_data g ON g.project_id = p.id
       WHERE p.tenant_id = _run.tenant_id AND p.concessionaire_id = _conta.concessionaire_id
         AND NOT p.is_deleted AND p.archived_at IS NULL AND p.status::text <> 'completed'
         AND coalesce(p.protocol_number, '') = ''
         AND regexp_replace(upper(translate(trim(coalesce(nullif(g.holder_name, ''), p.title)), 'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')), '\s+', ' ', 'g')
           = regexp_replace(upper(translate(trim(_titular), 'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')), '\s+', ' ', 'g');
      IF _n_nome = 1 THEN
        SELECT * INTO _projeto FROM public.projects WHERE id = _id_nome;
        _casamento := 'titular';
      END IF;
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

    -- 13/11/2026: protocolo já visto SEM projeto também vale (antes só o nunca visto): sem isso, quem
    -- passou uma vez sem casar nunca ganhava o cartão. O estado guarda o projeto, então é uma vez só.
    IF _casamento IN ('cpf', 'uc', 'titular') AND (_estado.protocolo IS NULL OR _estado.project_id IS NULL)
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
$function$;
