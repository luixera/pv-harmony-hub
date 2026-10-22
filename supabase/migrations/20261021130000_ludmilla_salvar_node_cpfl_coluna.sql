-- Criação na CPFL: o número do projeto (node) não era gravado no cadastro.
--
-- `ludmilla_salvar_node_cpfl` (20260916120000) ordena as execuções por
-- `portal_sync_runs.created_at`, coluna que NÃO existe nessa tabela. As colunas
-- de tempo dela são `pedido_em`, `iniciado_em` e `terminado_em`. O PL/pgSQL só
-- é planejado na hora de rodar, então o defeito ficou escondido até a primeira
-- criação REAL: o robô cria o projeto na CPFL inteiro (passos 0 a 6 "ok") e só
-- então chama esta função, que estoura com "column psr.created_at does not
-- exist". O run vira erro e `projects.cpfl_node_id` fica vazio. Aconteceu nas
-- 4 criações reais de 19 a 21/10/2026 (PRJ-82544, PRJ-35486, PRJ-05964,
-- PRJ-42661).
--
-- Corpo copiado do `prosrc` vivo (md5 8dc13c708ff6d81b53f9d1fa8231fc9f, igual à
-- migração de origem). A ÚNICA mudança é `psr.created_at` → `psr.pedido_em`.
-- REVOKE/GRANT como estavam: só `service_role` executa.

CREATE OR REPLACE FUNCTION public.ludmilla_salvar_node_cpfl(
  p_project_id UUID,
  p_node_id    TEXT
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  UPDATE public.projects
  SET    cpfl_node_id = p_node_id
  WHERE  id = p_project_id
    AND  tenant_id = (
      SELECT pa.tenant_id
      FROM   public.portal_sync_runs psr
      JOIN   public.portal_accounts  pa ON pa.id = psr.account_id
      WHERE  psr.dados->>'project_id' = p_project_id::TEXT
      ORDER  BY psr.pedido_em DESC
      LIMIT  1
    );
END;
$$;

REVOKE ALL ON FUNCTION public.ludmilla_salvar_node_cpfl(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ludmilla_salvar_node_cpfl(UUID, TEXT)
  TO service_role;
