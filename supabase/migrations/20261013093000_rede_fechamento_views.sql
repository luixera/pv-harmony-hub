-- Fecha duas brechas abertas pela Fase A da capacidade de rede.
--
-- Encontradas pelo linter de segurança do Supabase em 13/10/2026, DEPOIS de a
-- Fase A ser dada por pronta. Vale registrar o erro de método: eu verifiquei os
-- GRANTs com `has_function_privilege` só nas funções que lembrava ter revogado,
-- em vez de varrer todas as novas. A varredura é que achou.
--
-- ── Brecha 1: views SECURITY DEFINER (ERROR no linter) ─────────────────────
-- No Postgres, uma view sem `security_invoker` roda com os direitos de QUEM A
-- CRIOU. As quatro views `rede_*` foram criadas pelo owner das tabelas, que por
-- ser owner NÃO passa pela RLS. Resultado: a RLS "só master" de
-- rede_transformador era contornável por qualquer um — inclusive anônimo —
-- lendo `rede_ponto_no_mapa` pela API REST. Reproduzido antes de corrigir:
-- `set local role anon; select count(*) from public.rede_ponto_no_mapa` → 12.
--
-- `security_invoker = true` faz a view aplicar a RLS de quem consulta. As RPCs
-- continuam funcionando porque são SECURITY DEFINER do owner das tabelas.
ALTER VIEW public.rede_ponto_no_mapa      SET (security_invoker = true);
ALTER VIEW public.rede_celula_no_mapa     SET (security_invoker = true);
ALTER VIEW public.rede_celula_calculada   SET (security_invoker = true);
ALTER VIEW public.rede_celula_pronta      SET (security_invoker = true);

-- Em profundidade: estas views são peças internas das RPCs. Ninguém de fora
-- precisa delas, então nem o SELECT fica de pé.
REVOKE ALL ON public.rede_ponto_no_mapa, public.rede_celula_no_mapa,
              public.rede_celula_calculada, public.rede_celula_pronta
  FROM anon, authenticated;

-- ── Brecha 2: os REVOKEs do cálculo nunca chegaram a rodar ────────────────
-- 20261012120000_rede_calculo.sql termina com estes REVOKEs, mas as funções
-- foram aplicadas em pedaços durante a instabilidade do servidor MCP e o bloco
-- final ficou para trás. Consequência: `anon` podia chamar
-- rede_celula_limpar() (DELETE sem gate) e rede_aplicar_trafos() (UPDATE sem
-- gate, com limiares escolhidos por quem chama) — primitivas de escrita não
-- autenticadas sobre a base de rede.
--
-- Detalhe que explica por que "revogar do PUBLIC" não basta: o Supabase concede
-- EXECUTE a anon/authenticated NOMINALMENTE, por ALTER DEFAULT PRIVILEGES. Tem
-- de revogar dos papéis pelo nome.
REVOKE ALL ON FUNCTION public.rede_regras()                                  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rede_aplicar_trafos(NUMERIC,NUMERIC,NUMERIC)        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rede_aplicar_alimentadores(NUMERIC,NUMERIC,NUMERIC) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rede_celula_limpar()                           FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rede_celula_inserir()                          FROM PUBLIC, anon, authenticated;

-- As duas RPCs de entrada seguem chamáveis por authenticated: o gate de master
-- está dentro delas.
REVOKE EXECUTE ON FUNCTION public.rede_celula_recalcular()   FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.grid_capacity_recalcular() FROM PUBLIC, anon;

-- ── O que fica aberto de propósito ────────────────────────────────────────
-- rede_classificar/rede_margem/rede_ocupacao continuam executáveis por
-- authenticated e anon. São SECURITY INVOKER, IMMUTABLE, recebem e devolvem
-- números: não leem tabela, não têm o que vazar. Também é por isso que NÃO
-- levam `SET search_path` (o linter avisa): `SET` impede o inlining da função
-- SQL, e elas rodam por linha num UPDATE de centenas de milhares de trafos.
-- Tudo que referenciam é qualificado por schema, e pg_catalog é consultado
-- antes do search_path para operadores — não há o que sombrear.
