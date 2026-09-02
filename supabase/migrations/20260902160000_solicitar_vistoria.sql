-- ─────────────────────────────────────────────────────────────────────────────
-- A EMPRESA pede a vistoria
--
-- Pedido do usuário (set/2026): botão no modal do cliente, clicável só com o
-- projeto na etapa APROVADO; ao clicar, cria tarefa para o admin e para o
-- projetista responsável (quando houver).
--
-- Por que RPC e não insert direto do front: a empresa não tem — e não deve
-- ter — permissão para criar tarefa para outra pessoa. Aqui o servidor decide
-- quem recebe, confere a etapa, impede pedido repetido e registra o pedido no
-- histórico e nos comentários do projeto. O front só chama e mostra o
-- resultado.
-- ─────────────────────────────────────────────────────────────────────────────

-- Marca a origem da tarefa: distingue o pedido de vistoria das tarefas
-- manuais e das criadas por automação de etapa, e é o que impede duplicar.
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS origin TEXT;

CREATE INDEX IF NOT EXISTS idx_tasks_origin_projeto
  ON public.tasks (project_id, origin)
  WHERE origin IS NOT NULL;

COMMENT ON COLUMN public.tasks.origin IS
  'De onde a tarefa nasceu: NULL = manual, ''vistoria_request'' = pedido de vistoria da empresa.';

-- ── Existe pedido de vistoria em aberto? ─────────────────────────────────────
-- O front precisa saber para desenhar o botão, mas a empresa não enxerga as
-- tarefas dos outros — por isso a resposta vem por função, e não por consulta.
CREATE OR REPLACE FUNCTION public.vistoria_status(_project_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_proj    RECORD;
  v_perfil  RECORD;
  v_aberta  RECORD;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('permitido', false); END IF;

  SELECT id, status, tenant_id, company_id INTO v_proj
    FROM projects WHERE id = _project_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('permitido', false); END IF;

  SELECT role, tenant_id, company_id INTO v_perfil FROM profiles WHERE id = auth.uid();
  IF v_perfil.tenant_id IS DISTINCT FROM v_proj.tenant_id THEN
    RETURN jsonb_build_object('permitido', false);
  END IF;
  IF v_perfil.role = 'company' AND v_perfil.company_id IS DISTINCT FROM v_proj.company_id THEN
    RETURN jsonb_build_object('permitido', false);
  END IF;

  SELECT created_at INTO v_aberta
    FROM tasks
   WHERE project_id = _project_id
     AND origin = 'vistoria_request'
     AND status IN ('pending','in_progress')
   ORDER BY created_at
   LIMIT 1;

  RETURN jsonb_build_object(
    'permitido', true,
    'etapa_ok',  v_proj.status::TEXT = 'approved',
    'status',    v_proj.status::TEXT,
    'aberta',    v_aberta.created_at IS NOT NULL,
    'em',        v_aberta.created_at
  );
END;
$$;

-- ── O pedido em si ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.solicitar_vistoria(_project_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     UUID := auth.uid();
  v_proj    RECORD;
  v_perfil  RECORD;
  v_dest    UUID;
  v_criadas INT := 0;
  v_titular TEXT;
  v_empresa TEXT;
  v_titulo  TEXT;
  v_desc    TEXT;
  v_prazo   INT := 3;   -- dias
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'sem_sessao');
  END IF;

  SELECT id, code, status, tenant_id, company_id INTO v_proj
    FROM projects WHERE id = _project_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'projeto_nao_encontrado');
  END IF;

  SELECT role, tenant_id, company_id, name INTO v_perfil FROM profiles WHERE id = v_uid;

  -- Só a empresa DONA do projeto (ou a equipe do mesmo tenant) pede vistoria.
  IF v_perfil.tenant_id IS DISTINCT FROM v_proj.tenant_id
     OR NOT (
       (v_perfil.role = 'company' AND v_perfil.company_id = v_proj.company_id)
       OR v_perfil.role IN ('admin','staff')
     ) THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  END IF;

  IF v_proj.status::TEXT <> 'approved' THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'etapa_invalida', 'status', v_proj.status::TEXT);
  END IF;

  -- Um pedido em aberto por vez: clicar de novo não empilha tarefa para a
  -- equipe (mesma regra das tarefas automáticas de etapa).
  IF EXISTS (
    SELECT 1 FROM tasks
     WHERE project_id = _project_id
       AND origin = 'vistoria_request'
       AND status IN ('pending','in_progress')
  ) THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'ja_solicitada');
  END IF;

  SELECT holder_name INTO v_titular FROM project_general_data WHERE project_id = _project_id;
  SELECT name INTO v_empresa FROM companies WHERE id = v_proj.company_id;

  v_titulo := 'Solicitar vistoria — ' || COALESCE(v_proj.code, '')
              || COALESCE(' · ' || v_titular, '');
  v_desc := COALESCE(v_empresa, 'A empresa') || ' pediu a solicitação de vistoria do projeto '
            || COALESCE(v_proj.code, '') || COALESCE(' (' || v_titular || ')', '')
            || ', que está na etapa Aprovado.';

  -- Admin do tenant + projetista(s) responsável(is) pelo projeto, sem repetir
  -- quem acumula os dois papéis.
  FOR v_dest IN
    SELECT p.id FROM profiles p
     WHERE p.tenant_id = v_proj.tenant_id AND p.role = 'admin'
    UNION
    SELECT a.staff_user_id FROM project_assignments a
     JOIN profiles pr ON pr.id = a.staff_user_id AND pr.tenant_id = v_proj.tenant_id
     WHERE a.project_id = _project_id
  LOOP
    INSERT INTO tasks
      (tenant_id, title, description, status, priority, due_date,
       project_id, created_by, assigned_to, origin)
    VALUES
      (v_proj.tenant_id, v_titulo, v_desc, 'pending', 'high',
       CURRENT_DATE + v_prazo, _project_id, v_uid, v_dest, 'vistoria_request');

    INSERT INTO notifications
      (tenant_id, user_id, title, message, type, project_id, read)
    VALUES
      (v_proj.tenant_id, v_dest, '🔎 Vistoria solicitada pela empresa',
       v_desc || ' Prazo: ' || to_char(CURRENT_DATE + v_prazo, 'DD/MM/YYYY') || '.',
       'task_assigned', _project_id, FALSE);

    v_criadas := v_criadas + 1;
  END LOOP;

  -- O pedido fica visível onde a equipe já olha: comentários e histórico.
  INSERT INTO comments (project_id, user_id, message, type)
  VALUES (_project_id, v_uid, '🔎 Solicitação de vistoria enviada pela empresa.', 'comment');

  INSERT INTO project_history (project_id, action, description, user_id, user_name)
  VALUES (_project_id, 'Vistoria solicitada',
          COALESCE(v_empresa, 'A empresa') || ' solicitou a vistoria pelo painel.',
          v_uid, COALESCE(v_perfil.name, 'Empresa'));

  RETURN jsonb_build_object('ok', true, 'tarefas', v_criadas);
END;
$$;

REVOKE ALL ON FUNCTION public.solicitar_vistoria(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.vistoria_status(UUID)   FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.solicitar_vistoria(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.vistoria_status(UUID)   TO authenticated;
