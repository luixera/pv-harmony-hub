-- Ludmilla: da varredura às RECOMENDAÇÕES.
--
-- O robô devolve a lista crua de protocolos (resultado->'protocolos'). Aqui
-- o banco guarda o último estado visto de cada protocolo, casa com o projeto
-- pelo número, traduz o status do portal para a etapa do Kanban pela tabela
-- editável e, quando algo mudou, cria a linha do relatório — que uma pessoa
-- aplica ou ignora. Nada disto move card.

-- ── Último estado visto de cada protocolo ────────────────────────────────────
-- É a memória entre varreduras: sem ela, toda varredura pareceria "tudo mudou".
CREATE TABLE IF NOT EXISTS public.portal_protocol_state (
  tenant_id       UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  account_id      UUID NOT NULL REFERENCES public.portal_accounts(id) ON DELETE CASCADE,
  protocolo       TEXT NOT NULL,
  titular_portal  TEXT,
  status_portal   TEXT NOT NULL,
  project_id      UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  raw             JSONB,
  visto_em        TIMESTAMPTZ NOT NULL DEFAULT now(),
  mudou_em        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, protocolo)
);
CREATE INDEX IF NOT EXISTS idx_portal_protocol_state_tenant ON public.portal_protocol_state (tenant_id);
CREATE INDEX IF NOT EXISTS idx_portal_protocol_state_project ON public.portal_protocol_state (project_id);

ALTER TABLE public.portal_protocol_state ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.portal_protocol_state;
CREATE POLICY tenant_isolation ON public.portal_protocol_state AS RESTRICTIVE FOR ALL
  USING      (tenant_id = public.get_user_tenant_id((select auth.uid())))
  WITH CHECK (tenant_id = public.get_user_tenant_id((select auth.uid())));
DROP POLICY IF EXISTS equipe_le_estado ON public.portal_protocol_state;
CREATE POLICY equipe_le_estado ON public.portal_protocol_state FOR SELECT
  USING ((select public.ludmilla_equipe_ok()));

-- ── Tradução inicial (CPFL) — editável depois pela equipe ────────────────────
-- Só o que é inequívoco. "Pendente" e "Em Andamento" ficam sem recomendação
-- até a equipe decidir a etapa correspondente.
INSERT INTO public.portal_status_map (tenant_id, connector, status_portal, project_status)
SELECT t.id, 'cpfl', m.status_portal, m.project_status
FROM public.tenants t
CROSS JOIN (VALUES ('Aprovado', 'approved'), ('Reprovado', 'pendencia')) AS m(status_portal, project_status)
WHERE t.is_library
ON CONFLICT (tenant_id, connector, status_portal) DO NOTHING;

-- ── A recomendação faz sentido para a etapa atual? ───────────────────────────
-- O portal mostra o status ATUAL do protocolo, e o projeto pode já ter
-- andado além dele (aprovado → vistoria → concluído). Recomendar "Aprovado"
-- para um projeto concluído é andar para trás — na primeira varredura isso
-- gerou 17 linhas de ruído em 23. Regra: só etapa à FRENTE da atual;
-- "pendência" (reprovado) vale enquanto o projeto não estiver concluído.
CREATE OR REPLACE FUNCTION public.ludmilla_recomendacao_vale(p_atual TEXT, p_recom TEXT)
RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE
AS $$
  WITH ordem(etapa, n) AS (VALUES
    ('pending', 1), ('analysis', 2), ('documentation', 3), ('approval', 4),
    ('approved', 5), ('vistoria_solicitada', 6), ('completed', 7))
  SELECT CASE
    WHEN p_recom IS NULL OR p_recom = p_atual THEN FALSE
    WHEN p_atual = 'completed' THEN FALSE
    WHEN p_recom = 'pendencia' THEN p_atual <> 'pendencia'
    WHEN p_atual = 'pendencia' THEN TRUE                       -- sair da pendência é sempre andar
    ELSE coalesce((SELECT n FROM ordem WHERE etapa = p_recom), 0)
       > coalesce((SELECT n FROM ordem WHERE etapa = p_atual), 0)
  END;
$$;

-- ── Registrar a varredura ────────────────────────────────────────────────────
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
  _estado    public.portal_protocol_state%ROWTYPE;
  _projeto   public.projects%ROWTYPE;
  _recom     TEXT;
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
    _status    := trim(_p->>'status');
    _titular   := _p->>'titular';
    IF _protocolo = '' OR _status = '' THEN CONTINUE; END IF;

    -- o projeto, pelo número do protocolo (mesmo tenant, vivo)
    SELECT * INTO _projeto FROM public.projects
     WHERE tenant_id = _run.tenant_id AND protocol_number = _protocolo
       AND NOT is_deleted AND archived_at IS NULL
     LIMIT 1;

    SELECT * INTO _estado FROM public.portal_protocol_state
     WHERE account_id = _run.account_id AND protocolo = _protocolo;

    -- etapa recomendada pela tradução; nulo = a equipe ainda não decidiu
    SELECT m.project_status INTO _recom FROM public.portal_status_map m
     WHERE m.tenant_id = _run.tenant_id AND m.connector = _conta.connector
       AND lower(m.status_portal) = lower(_status);

    -- Vale uma linha no relatório quando há projeto casado E:
    --   (a) o status no portal MUDOU desde a última varredura (sempre vale
    --       saber, mesmo sem tradução — a recomendação pode ir vazia), ou
    --   (b) é a primeira vez que vemos o protocolo e a tradução aponta uma
    --       etapa que faz sentido em relação à atual (à frente, ou pendência).
    IF _projeto.id IS NOT NULL AND (
         (_estado.protocolo IS NOT NULL AND _estado.status_portal IS DISTINCT FROM _status
            AND _projeto.status::text <> 'completed')
      OR (_estado.protocolo IS NULL AND public.ludmilla_recomendacao_vale(_projeto.status::text, _recom))
    ) THEN
      -- uma recomendação que não faz sentido para a etapa atual vai vazia
      IF NOT public.ludmilla_recomendacao_vale(_projeto.status::text, _recom) THEN _recom := NULL; END IF;
      -- não duplica uma recomendação pendente igual
      IF NOT EXISTS (
        SELECT 1 FROM public.portal_updates u
         WHERE u.account_id = _run.account_id AND u.protocolo = _protocolo
           AND u.status_portal = _status AND u.situacao = 'pendente'
      ) THEN
        INSERT INTO public.portal_updates
          (tenant_id, run_id, account_id, protocolo, titular_portal, status_portal, status_anterior,
           project_id, casamento, recomendacao, raw)
        VALUES
          (_run.tenant_id, _run.id, _run.account_id, _protocolo, _titular, _status, _estado.status_portal,
           _projeto.id, 'protocolo', _recom, _p->'raw');
        _mudancas := _mudancas + 1;
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
REVOKE ALL ON FUNCTION public.ludmilla_registrar_varredura(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ludmilla_registrar_varredura(UUID) TO service_role;

-- O fechamento do run chama o registro quando é varredura bem-sucedida —
-- um passo só para o robô, atômico no banco.
CREATE OR REPLACE FUNCTION public.ludmilla_finalizar_run(
  p_run_id        UUID,
  p_situacao      TEXT,
  p_erro          TEXT DEFAULT NULL,
  p_resultado     JSONB DEFAULT NULL,
  p_print_path    TEXT DEFAULT NULL,
  p_protocolos    INTEGER DEFAULT 0,
  p_mudancas      INTEGER DEFAULT 0,
  p_situacao_conta TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _account UUID; _tipo TEXT;
BEGIN
  IF (select auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'permission denied: só o robô finaliza runs';
  END IF;
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
   WHERE id = _account;

  IF _tipo = 'varredura' AND p_situacao = 'ok' THEN
    PERFORM public.ludmilla_registrar_varredura(p_run_id);
  END IF;
END;
$$;

COMMENT ON TABLE public.portal_protocol_state IS
  'Ludmilla: último status visto de cada protocolo no portal — a memória entre varreduras.';
