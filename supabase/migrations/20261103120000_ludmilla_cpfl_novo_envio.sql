-- ============================================================================
-- LUDMILLA — "Novo envio" à CPFL num clique (03/11/2026)
--
-- O PEDIDO (usuário, 03/11/2026): quando a CPFL REPROVA, a equipe refaz o envio — e "o reenvio nada
-- mais é do que criar o projeto novamente, a mesma coisa que o primeiro passo". Um clique só: o botão
-- "Novo envio" do modal já manda a Ludmilla criar de novo, sem etapa intermediária de correção.
--
-- O QUE IMPEDE HOJE: `projects.cpfl_node_id` preenchido. O robô (worker/ludmilla/src/criacao/index.ts)
-- RECUSA criar quando ele existe, e é isso que protege contra criar dois projetos no portal por engano.
-- Esta função não mexe no robô: ela guarda o número antigo no histórico, LIMPA o número e enfileira um
-- run `criar_projeto` igual ao do primeiro envio (com `reenvio_de` = número anterior). Quando o robô
-- salvar, `ludmilla_salvar_node_cpfl` grava o número novo. Os prints de cada envio já ficam por run
-- (`portal_criacao_passos` + bucket `ludmilla/{tenant}/criacao/{run_id}/`) e nada os apaga: a tela lista
-- "Envio 1, Envio 2…" a partir dos runs.
--
-- public.ludmilla_cpfl_novo_envio(p_account_id, p_project_id, p_node_atual) RETURNS uuid (o run novo)
--   1. só a equipe da Ludmilla (auth.uid() + ludmilla_equipe_ok()), senão "Sem acesso à Ludmilla.";
--   2. projeto do MESMO tenant de quem pede (e não apagado) e conta de portal do mesmo tenant com
--      conector cpfl; senão erro genérico, sem dizer se o id existe noutro tenant;
--   3. trava a linha do projeto (FOR UPDATE): dois cliques ao mesmo tempo se enfileiram aqui;
--   4. run `criar_projeto` do projeto na fila ou rodando → "Já há um envio deste projeto em andamento."
--      (conferido ANTES do número: o segundo clique, depois de o primeiro limpar o número, recebe esta
--      mensagem, que é a verdadeira, e não "ainda não tem envio");
--   5. número nulo → "use Criar na CPFL"; número diferente do que a tela mostrava → recusa com o número
--      de agora (a tela estava velha);
--   6. histórico do projeto com o número anterior e o autor, como as outras RPCs da Ludmilla;
--   7. UPDATE projects SET cpfl_node_id = NULL. Gatilhos de projects conferidos em 03/11/2026: as tarefas
--      automáticas só disparam em UPDATE OF status, last_status_change só muda se o status mudar; o único
--      efeito é updated_at = now(). Sem gatilho em project_history nem em portal_sync_runs;
--   8. enfileira por ludmilla_pedir_run (mesma checagem de equipe e de conta, mesma fila) e devolve o id.
--
-- NÃO mexe em nenhuma função existente nem nos crons (da Ludmilla só ludmilla-08h e ludmilla-17h).
-- md5 do prosrc VIVO, medidos antes de aplicar (03/11/2026):
--   ludmilla_pedir_run ea840f9c24fd4dd90019e3a2deca2501 · ludmilla_salvar_node_cpfl 3a918d7df86ec5e5a7895630c6e50f5f
--   ludmilla_registrar_passo_criacao fcf01128077210d15076de8c272eb603
--   ludmilla_dados_criacao_cpfl e2017d538b7b38e09e3902a837571524
--   ludmilla_agendar_varreduras 3d0d2d0f1e7455ec701230bc925e1bde
-- ============================================================================

CREATE OR REPLACE FUNCTION public.ludmilla_cpfl_novo_envio(
  p_account_id UUID,
  p_project_id UUID,
  p_node_atual TEXT
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  _uid    UUID := (SELECT auth.uid());
  _tenant UUID;
  _node   TEXT;
  _nome   TEXT;
  _run    UUID;
BEGIN
  IF _uid IS NULL OR NOT public.ludmilla_equipe_ok() THEN
    RAISE EXCEPTION 'Sem acesso à Ludmilla.';
  END IF;

  _tenant := public.get_user_tenant_id(_uid);

  IF NOT EXISTS (
    SELECT 1 FROM public.portal_accounts
     WHERE id = p_account_id AND tenant_id = _tenant AND connector = 'cpfl'
  ) THEN
    RAISE EXCEPTION 'Conta de portal não encontrada.';
  END IF;

  -- a trava: o segundo clique espera o primeiro terminar e enxerga o que ele fez
  SELECT p.cpfl_node_id INTO _node
    FROM public.projects p
   WHERE p.id = p_project_id
     AND p.tenant_id = _tenant
     AND p.is_deleted IS NOT TRUE
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Projeto não encontrado.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.portal_sync_runs r
     WHERE r.tipo = 'criar_projeto'
       AND r.situacao IN ('na_fila', 'rodando')
       AND r.dados->>'project_id' = p_project_id::TEXT
  ) THEN
    RAISE EXCEPTION 'Já há um envio deste projeto em andamento.';
  END IF;

  IF _node IS NULL THEN
    RAISE EXCEPTION 'Este projeto ainda não tem envio na CPFL — use Criar na CPFL.';
  END IF;

  IF _node IS DISTINCT FROM p_node_atual THEN
    RAISE EXCEPTION 'O número da CPFL mudou desde que a tela abriu (agora é %). Feche e abra o projeto.', _node;
  END IF;

  SELECT name INTO _nome FROM public.profiles WHERE id = _uid;
  INSERT INTO public.project_history (project_id, action, description, user_id, user_name)
  VALUES (p_project_id, 'Novo envio à CPFL',
          coalesce(_nome, 'A equipe') || ' pediu um novo envio à CPFL. O projeto nº ' || _node
          || ' no portal fica guardado aqui; a Ludmilla vai criar outro com os dados de hoje.',
          _uid, coalesce(_nome, 'Equipe'));

  -- é isto que deixa o robô criar de novo, sem mudar o robô
  UPDATE public.projects SET cpfl_node_id = NULL WHERE id = p_project_id;

  _run := public.ludmilla_pedir_run(
    p_account_id,
    'criar_projeto',
    jsonb_build_object('project_id', p_project_id, 'reenvio_de', _node)
  );

  RETURN _run;
END;
$$;

REVOKE ALL ON FUNCTION public.ludmilla_cpfl_novo_envio(UUID, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ludmilla_cpfl_novo_envio(UUID, UUID, TEXT) TO authenticated, service_role;

COMMENT ON FUNCTION public.ludmilla_cpfl_novo_envio(UUID, UUID, TEXT) IS
  'Novo envio à CPFL (reprovação): guarda o nº anterior no histórico, limpa projects.cpfl_node_id e enfileira criar_projeto com reenvio_de. Só a equipe da Ludmilla, mesmo tenant. 20261103120000.';
