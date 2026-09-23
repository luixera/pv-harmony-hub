-- Zé — o quadro do projeto vem do TENANT, não da linha do projeto
--
-- `projects.kanban_model_id` é nulo em 246 de 246 projetos: quem manda é o
-- modelo ativo do tenant (é o que a tela faz, via useDefaultKanbanModel).
-- As funções do Zé juntavam por `p.kanban_model_id` e, com nulo, o LEFT JOIN
-- não trazia coluna nenhuma — em silêncio:
--
--   • ze_projetos_parados     → `stale_days` da coluna nunca era usado, todo
--                               card caía no limite geral (96 "parados").
--   • ze_projetos_dados_faltando → `requires_protocol` sempre falso, a regra
--                               do protocolo nunca disparava ("0 faltando").
--   • ze_mover_etapa          → recusava QUALQUER etapa (essa ao menos gritou).

CREATE OR REPLACE FUNCTION public.ze_modelo_do_projeto(_tenant UUID, _project_model UUID)
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT coalesce(_project_model, (
    SELECT id FROM public.kanban_models
     WHERE tenant_id = _tenant AND is_active
     ORDER BY created_at LIMIT 1));
$$;
REVOKE ALL ON FUNCTION public.ze_modelo_do_projeto(UUID, UUID) FROM PUBLIC, anon, authenticated;

-- ── Cards parados (agora com o limite de cada coluna) ───────────────────────
CREATE OR REPLACE FUNCTION public.ze_projetos_parados(_tenant UUID, _dias INTEGER DEFAULT 7)
RETURNS TABLE (
  project_id UUID, codigo TEXT, etapa TEXT, etapa_label TEXT,
  titular TEXT, empresa TEXT, dias INTEGER, protocolo TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT p.id, p.code, p.status::text,
         coalesce(kc.status_label, p.status::text),
         g.holder_name, co.name,
         (extract(epoch FROM (now() - coalesce(p.last_status_change, p.updated_at))) / 86400)::int,
         p.protocol_number
    FROM public.projects p
    LEFT JOIN public.project_general_data g ON g.project_id = p.id
    LEFT JOIN public.companies co ON co.id = p.company_id
    LEFT JOIN public.kanban_columns kc
           ON kc.kanban_model_id = public.ze_modelo_do_projeto(p.tenant_id, p.kanban_model_id)
          AND kc.status_key = p.status::text
   WHERE p.tenant_id = _tenant
     AND NOT coalesce(p.is_deleted, false)
     AND p.archived_at IS NULL
     AND p.status::text <> 'completed'
     AND coalesce(p.last_status_change, p.updated_at)
         < now() - make_interval(days => coalesce(nullif(kc.stale_days, 0), _dias))
   ORDER BY coalesce(p.last_status_change, p.updated_at);
$$;
REVOKE ALL ON FUNCTION public.ze_projetos_parados(UUID, INTEGER) FROM PUBLIC, anon, authenticated;

-- ── Dados faltando (agora enxergando requires_protocol) ─────────────────────
CREATE OR REPLACE FUNCTION public.ze_projetos_dados_faltando(_tenant UUID)
RETURNS TABLE (project_id UUID, codigo TEXT, etapa TEXT, titular TEXT, empresa TEXT, falta TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT p.id, p.code, p.status::text, g.holder_name, co.name,
         array_to_string(array_remove(ARRAY[
           CASE WHEN coalesce(g.holder_name, '') = ''     THEN 'titular'    END,
           CASE WHEN coalesce(g.holder_cpf_cnpj, '') = '' THEN 'CPF/CNPJ'   END,
           CASE WHEN coalesce(g.uc_number, '') = ''       THEN 'UC'         END,
           CASE WHEN coalesce(g.holder_phone, '') = ''    THEN 'telefone'   END,
           CASE WHEN e.project_id IS NULL                 THEN 'equipamento' END,
           CASE WHEN coalesce(kc.requires_protocol, false)
                 AND coalesce(p.protocol_number, '') = ''  THEN 'protocolo'  END
         ], NULL), ', ')
    FROM public.projects p
    LEFT JOIN public.project_general_data g ON g.project_id = p.id
    LEFT JOIN public.project_equipment e ON e.project_id = p.id
    LEFT JOIN public.companies co ON co.id = p.company_id
    LEFT JOIN public.kanban_columns kc
           ON kc.kanban_model_id = public.ze_modelo_do_projeto(p.tenant_id, p.kanban_model_id)
          AND kc.status_key = p.status::text
   WHERE p.tenant_id = _tenant
     AND NOT coalesce(p.is_deleted, false)
     AND p.archived_at IS NULL
     AND p.status::text NOT IN ('completed', 'pending')
     AND (coalesce(g.holder_name, '') = '' OR coalesce(g.holder_cpf_cnpj, '') = ''
       OR coalesce(g.uc_number, '') = '' OR coalesce(g.holder_phone, '') = ''
       OR e.project_id IS NULL
       OR (coalesce(kc.requires_protocol, false) AND coalesce(p.protocol_number, '') = ''))
   ORDER BY p.code;
$$;
REVOKE ALL ON FUNCTION public.ze_projetos_dados_faltando(UUID) FROM PUBLIC, anon, authenticated;

-- ── Mover etapa (valida contra o quadro certo) ──────────────────────────────
CREATE OR REPLACE FUNCTION public.ze_mover_etapa(
  _tenant UUID, _project_id UUID, _to_status TEXT, _autor UUID, _motivo TEXT DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _de TEXT; _nome TEXT; _label_de TEXT; _label_para TEXT; _modelo UUID;
BEGIN
  SELECT p.status::text, public.ze_modelo_do_projeto(p.tenant_id, p.kanban_model_id)
    INTO _de, _modelo
    FROM public.projects p WHERE p.id = _project_id AND p.tenant_id = _tenant;
  IF _de IS NULL THEN RETURN FALSE; END IF;
  IF _de = _to_status THEN RETURN FALSE; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.kanban_columns
                  WHERE kanban_model_id = _modelo AND status_key = _to_status) THEN
    RAISE EXCEPTION 'etapa % não existe no quadro deste projeto', _to_status;
  END IF;

  SELECT status_label INTO _label_de   FROM public.kanban_columns
   WHERE kanban_model_id = _modelo AND status_key = _de;
  SELECT status_label INTO _label_para FROM public.kanban_columns
   WHERE kanban_model_id = _modelo AND status_key = _to_status;
  SELECT name INTO _nome FROM public.profiles WHERE id = _autor;

  UPDATE public.projects
     SET status = _to_status::public.project_status, last_status_change = now()
   WHERE id = _project_id;

  INSERT INTO public.project_history (project_id, action, description, user_id, user_name)
  VALUES (_project_id, 'Etapa alterada',
          'Etapa alterada de "' || coalesce(_label_de, _de) || '" para "' || coalesce(_label_para, _to_status) || '"'
            || coalesce(' — via Zé: ' || _motivo, ' — via Zé'),
          _autor, coalesce(_nome, 'gestor') || ' (via Zé)');
  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION public.ze_mover_etapa(UUID, UUID, TEXT, UUID, TEXT) FROM PUBLIC, anon, authenticated;

SELECT 'antes o limite era sempre o geral; agora vale o da coluna.'
    || E'\nstale_days configurados: ' || coalesce((
         SELECT string_agg(status_key || '=' || coalesce(stale_days::text, 'nulo'), ', ' ORDER BY order_index)
           FROM public.kanban_columns
          WHERE kanban_model_id = (SELECT id FROM public.kanban_models
                                    WHERE tenant_id = '58a63ecb-7b97-42e4-bb6b-42dbaf2283c3' AND is_active LIMIT 1)), '?')
    || E'\nparados agora: ' || (SELECT count(*)::text FROM public.ze_projetos_parados('58a63ecb-7b97-42e4-bb6b-42dbaf2283c3', 7))
    || E'\ndados faltando agora: ' || (SELECT count(*)::text FROM public.ze_projetos_dados_faltando('58a63ecb-7b97-42e4-bb6b-42dbaf2283c3'))
   AS resultado;
