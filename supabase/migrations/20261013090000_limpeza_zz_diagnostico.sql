-- Remove as funções de diagnóstico `zz_*`.
--
-- Elas nasceram fora de migração, durante a investigação de uma instabilidade
-- do servidor MCP na execução da Fase A da capacidade de rede (12/10/2026):
-- eram SECURITY DEFINER, sem verificação de permissão e com EXECUTE público
-- por padrão. O acesso foi revogado na hora; esta migração apaga as funções e
-- deixa a limpeza versionada.
--
-- Lição registrada: função de diagnóstico não se cria SECURITY DEFINER, e
-- nada criado fora de migração deve sobreviver ao fim da investigação.

DROP FUNCTION IF EXISTS public.zz_del();
DROP FUNCTION IF EXISTS public.zz_ins();
DROP FUNCTION IF EXISTS public.zz_teste_plpgsql();
DROP FUNCTION IF EXISTS public.zz_teste2();
DROP FUNCTION IF EXISTS public.zz_teste3();
