-- Ludmilla: o ciclo da CPFL, a ordem do Kanban e o escopo de acompanhamento.
--
-- Regras trazidas pelo usuário (14/09/2026):
-- 1. Na CPFL, "Aprovado" NÃO é concluído. Concluído é aprovado COM vistoria
--    concluída — no portal, "PROJETO ENCERRADO". Um aprovado pode estar em
--    adequação (inversão de fluxo / obra): "ORÇAMENTO DE CONEXÃO EMITIDO E
--    AGUARDANDO APROVAÇÃO DO CLIENTE", "AGUARDAR EXECUÇÃO DE OBRA".
-- 2. Só projetos em Análise (ENVIADO - EM ANÁLISE), Aprovados e Vistoria
--    Solicitada são acompanhados; concluídos ficam de fora.
-- 3. Cada concessionária é diferente: isto é o mapa da CPFL.
--
-- E uma correção minha: "etapa à frente" passa a seguir a ORDEM DO KANBAN do
-- tenant, não uma lista fixa — o status é a coluna do Kanban.

-- ── Escopo por conta ─────────────────────────────────────────────────────────
ALTER TABLE public.portal_accounts
  ADD COLUMN IF NOT EXISTS etapas_acompanhadas TEXT[] NOT NULL
  DEFAULT ARRAY['analysis', 'approved', 'vistoria_solicitada'];
COMMENT ON COLUMN public.portal_accounts.etapas_acompanhadas IS
  'Etapas do Kanban cujos projetos a Ludmilla acompanha neste portal. Fora delas, nada de recomendação.';

-- ── "À frente" pela ordem do Kanban ──────────────────────────────────────────
-- O modelo padrão é o primeiro ativo do tenant (mesma escolha do front,
-- useDefaultKanbanModel). Etapa fora do modelo conta como 0.
CREATE OR REPLACE FUNCTION public.ludmilla_ordem_etapa(p_tenant UUID, p_etapa TEXT)
RETURNS INTEGER
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT coalesce((
    SELECT c.order_index + 1
    FROM public.kanban_columns c
    WHERE c.kanban_model_id = (
      SELECT m.id FROM public.kanban_models m
      WHERE m.tenant_id = p_tenant AND m.is_active
      ORDER BY m.created_at LIMIT 1)
      AND c.status_key = p_etapa
  ), 0);
$$;
REVOKE ALL ON FUNCTION public.ludmilla_ordem_etapa(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ludmilla_ordem_etapa(UUID, TEXT) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.ludmilla_recomendacao_vale(TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.ludmilla_recomendacao_vale(p_tenant UUID, p_atual TEXT, p_recom TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_recom IS NULL OR p_recom = p_atual THEN FALSE
    WHEN p_atual = 'completed' THEN FALSE
    -- desvios (reprovação) valem sempre que o projeto não estiver lá nem concluído
    WHEN p_recom IN ('pendencia', 'vistoria_reprovada') THEN TRUE
    -- sair de um desvio é sempre andar
    WHEN p_atual IN ('pendencia', 'vistoria_reprovada') THEN TRUE
    ELSE public.ludmilla_ordem_etapa(p_tenant, p_recom) > public.ludmilla_ordem_etapa(p_tenant, p_atual)
  END;
$$;

-- ── Normalização do status detalhado ─────────────────────────────────────────
-- O robô já grava normalizado ("A | B", partes em ordem, maiúsculas); a
-- função garante o mesmo tratamento para o que a equipe digitar no mapa.
CREATE OR REPLACE FUNCTION public.ludmilla_normalizar_status(p TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE
AS $$
  SELECT coalesce((
    SELECT string_agg(parte, ' | ' ORDER BY parte)
    FROM (SELECT DISTINCT upper(regexp_replace(trim(x), '\s+', ' ', 'g')) AS parte
            FROM unnest(string_to_array(coalesce(p, ''), '|')) AS x
           WHERE trim(x) <> '') s
  ), '');
$$;

-- ── Mapa da CPFL (status detalhado → etapa do Kanban) ────────────────────────
DELETE FROM public.portal_status_map m
 USING public.tenants t
 WHERE m.tenant_id = t.id AND t.is_library AND m.connector = 'cpfl';

INSERT INTO public.portal_status_map (tenant_id, connector, status_portal, project_status)
SELECT t.id, 'cpfl', public.ludmilla_normalizar_status(m.status_portal), m.project_status
FROM public.tenants t
CROSS JOIN (VALUES
  -- concluído de verdade: aprovado + vistoria concluída
  ('PROJETO ENCERRADO',                                                     'completed'),
  -- aprovado, à espera de o projetista solicitar a vistoria
  ('DOCUMENTOS APROVADOS|SOLICITAR VISTORIA',                               'approved'),
  ('SOLICITAR VISTORIA',                                                    'approved'),
  -- aprovado com adequação/obra (inversão de fluxo): continua "aprovado"
  ('ORÇAMENTO DE CONEXÃO EMITIDO E AGUARDANDO APROVAÇÃO DO CLIENTE',        'approved'),
  ('DOCUMENTOS APROVADOS - AGUARDAR EXECUÇÃO DE OBRA',                      'approved'),
  -- vistoria
  ('VISTORIA E CONEXÃO EM EXECUÇÃO',                                        'vistoria_solicitada'),
  ('VISTORIA REPROVADA - AGUARDANDO SOLICITAR VISTORIA E CONEXÃO',          'vistoria_reprovada'),
  -- reprovações de documentos
  ('DOCUMENTOS INDEFERIDOS',                                                'pendencia'),
  ('DOCUMENTOS APROVADOS|DOCUMENTOS INDEFERIDOS',                           'pendencia'),
  -- em análise na CPFL
  ('VALIDAÇÃO DOS DOCUMENTOS PARA ORÇAMENTO DE CONEXÃO',                    'analysis'),
  ('DOCUMENTOS EM ANÁLISE',                                                 'analysis'),
  ('SOLICITAÇÃO DE CONEXÃO EM ANÁLISE',                                     'analysis')
) AS m(status_portal, project_status)
WHERE t.is_library
ON CONFLICT (tenant_id, connector, status_portal) DO UPDATE SET project_status = EXCLUDED.project_status;

-- ── Registrar a varredura, agora com escopo e ordem do Kanban ────────────────
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
  _no_escopo BOOLEAN;
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
    IF _protocolo = '' OR _status = '' THEN CONTINUE; END IF;

    SELECT * INTO _projeto FROM public.projects
     WHERE tenant_id = _run.tenant_id AND protocol_number = _protocolo
       AND NOT is_deleted AND archived_at IS NULL
     LIMIT 1;

    SELECT * INTO _estado FROM public.portal_protocol_state
     WHERE account_id = _run.account_id AND protocolo = _protocolo;

    SELECT m.project_status INTO _recom FROM public.portal_status_map m
     WHERE m.tenant_id = _run.tenant_id AND m.connector = _conta.connector
       AND m.status_portal = _status;

    -- escopo: só as etapas acompanhadas nesta conta (concluídos ficam de fora)
    _no_escopo := _projeto.id IS NOT NULL
              AND _projeto.status::text = ANY (_conta.etapas_acompanhadas);

    IF _no_escopo AND (
         (_estado.protocolo IS NOT NULL AND _estado.status_portal IS DISTINCT FROM _status)
      OR (_estado.protocolo IS NULL AND public.ludmilla_recomendacao_vale(_run.tenant_id, _projeto.status::text, _recom))
    ) THEN
      IF NOT public.ludmilla_recomendacao_vale(_run.tenant_id, _projeto.status::text, _recom) THEN _recom := NULL; END IF;
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

-- O estado anterior foi gravado com o selo genérico ("Aprovado"); a partir
-- de agora é o status detalhado. Zera a memória para a primeira leitura nova
-- não parecer "tudo mudou", e limpa as recomendações pendentes da fase antiga.
DELETE FROM public.portal_updates WHERE situacao = 'pendente';
DELETE FROM public.portal_protocol_state;
