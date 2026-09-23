-- Zé — o panorama passa a dizer QUAIS etapas existem
--
-- Sem isso o modelo chuta o status_key pelo rótulo em português ("concluido"
-- em vez de "completed") e a pendência nasce condenada: só quebraria na hora
-- da confirmação, depois de o gestor já ter dito sim. Com as etapas no
-- panorama ele acerta a chave, e a ferramenta ainda confere por cima.

CREATE OR REPLACE FUNCTION public.ze_panorama(_tenant UUID)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'tarefas_abertas', (SELECT count(*) FROM public.tasks
                         WHERE tenant_id = _tenant AND status <> 'completed'),
    'tarefas_hoje', (SELECT count(*) FROM public.tasks
                      WHERE tenant_id = _tenant AND status <> 'completed'
                        AND due_date = (now() AT TIME ZONE 'America/Sao_Paulo')::date),
    'tarefas_atrasadas', (SELECT count(*) FROM public.tasks
                           WHERE tenant_id = _tenant AND status <> 'completed'
                             AND due_date < (now() AT TIME ZONE 'America/Sao_Paulo')::date),
    'projetos_por_etapa', coalesce((SELECT jsonb_object_agg(s, n) FROM (
        SELECT p.status::text AS s, count(*) AS n FROM public.projects p
         WHERE p.tenant_id = _tenant AND NOT coalesce(p.is_deleted, false)
           AND p.archived_at IS NULL AND p.status::text <> 'completed'
         GROUP BY p.status::text) x), '{}'::jsonb),
    -- As etapas do quadro, na ordem: o modelo precisa da CHAVE, não do rótulo.
    'etapas_do_quadro', coalesce((
        SELECT jsonb_agg(jsonb_build_object('chave', kc.status_key, 'rotulo', kc.status_label)
                         ORDER BY kc.order_index)
          FROM public.kanban_columns kc
         WHERE kc.kanban_model_id = (SELECT id FROM public.kanban_models
                                      WHERE tenant_id = _tenant AND is_active
                                      ORDER BY created_at LIMIT 1)), '[]'::jsonb),
    'emails_sem_aplicar', (SELECT count(*) FROM public.email_updates
                            WHERE tenant_id = _tenant AND status = 'pending'
                              AND ai_suggested_status IS NOT NULL),
    'ludmilla_pendentes', (SELECT count(*) FROM public.portal_updates
                            WHERE tenant_id = _tenant AND situacao = 'pendente'),
    'sugestoes_pendentes', (SELECT count(*) FROM public.ze_tarefas_sugeridas
                             WHERE tenant_id = _tenant AND situacao = 'pendente'),
    'acoes_pendentes', (SELECT count(*) FROM public.ze_pending_actions
                         WHERE tenant_id = _tenant AND situacao = 'pendente'),
    'equipe', coalesce((SELECT jsonb_agg(jsonb_build_object('id', id, 'nome', name, 'papel', role))
                          FROM public.profiles
                         WHERE tenant_id = _tenant AND role IN ('admin', 'staff')), '[]'::jsonb)
  );
$$;
REVOKE ALL ON FUNCTION public.ze_panorama(UUID) FROM PUBLIC, anon, authenticated;

SELECT 'etapas no panorama: ' || (
  SELECT jsonb_array_length(public.ze_panorama('58a63ecb-7b97-42e4-bb6b-42dbaf2283c3')->'etapas_do_quadro')::text
) AS resultado;
