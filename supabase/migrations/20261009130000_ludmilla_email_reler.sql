-- supabase/migrations/20261009130000_ludmilla_email_reler.sql
-- Ludmilla (e-mail): a ação "ler de novo" da tela /ludmilla.
--
-- POR QUE PRECISA EXISTIR. O acompanhamento por e-mail distingue "já vi esta
-- mensagem" de "já terminei de tratar esta mensagem" (colunas `concluida` e
-- `tentativas`, teto de 5). Isso conserta a perda silenciosa de documento, mas
-- cria duas situações que só a pessoa resolve:
--   · a robô desistiu depois de 5 tentativas;
--   · nenhuma regra reconheceu o e-mail — o usuário corrige a regra na tela, e
--     os e-mails antigos continuariam invisíveis.
-- Nos dois casos a recuperação é zerar o contador e reabrir a mensagem.
--
-- E POR QUE UMA RPC, E NÃO UM UPDATE DO APLICATIVO. `portal_email_mensagens`
-- tem só política PERMISSIVE de SELECT (`equipe_le_email_mensagens`), mais a
-- RESTRICTIVE de tenant. Um `update()` do cliente não dá erro: afeta ZERO
-- linhas, em silêncio. Numa tela cujo propósito é tirar coisas do silêncio,
-- esse é o pior resultado possível. Conferido em pg_policies antes de escrever.
--
-- LEVANTA EXCEÇÃO QUANDO NÃO ENCONTRA, de propósito: o front
-- (`useRelerEmail`, src/hooks/useLudmilla.ts) só olha `error` e mostra sucesso
-- quando não há erro. Função silenciosa faria o usuário ler "marcada para ser
-- lida de novo" sem nada ter mudado.
CREATE OR REPLACE FUNCTION public.ludmilla_email_reler(p_mensagem_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _tenant UUID; _achou UUID;
BEGIN
  -- Mesmo portão das outras tabelas portal_* da Ludmilla: equipe (admin/staff)
  -- de um tenant de biblioteca. Não basta ser autenticado.
  IF NOT public.ludmilla_equipe_ok() THEN
    RAISE EXCEPTION 'permission denied: só a equipe da Ludmilla pode reabrir uma mensagem';
  END IF;

  -- Tenant pela função irmã, não por claim do JWT: 11 dos 19 usuários (inclusive
  -- o único admin) não têm tenant_id em raw_app_meta_data, e a política viraria
  -- `tenant_id = NULL`, negando tudo sem erro. É o padrão das tabelas irmãs.
  _tenant := public.get_user_tenant_id((SELECT auth.uid()));
  IF _tenant IS NULL THEN
    RAISE EXCEPTION 'não consegui identificar o seu tenant';
  END IF;

  UPDATE public.portal_email_mensagens
     SET concluida = FALSE, tentativas = 0
   WHERE id = p_mensagem_id
     AND tenant_id = _tenant
  RETURNING id INTO _achou;

  IF _achou IS NULL THEN
    -- Mesma frase para "não existe" e "é de outro tenant": quem sonda não
    -- aprende se o id existe.
    RAISE EXCEPTION 'mensagem não encontrada';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.ludmilla_email_reler(UUID) IS
  'Reabre uma mensagem de e-mail para a Ludmilla tratar na próxima leitura da '
  'caixa (concluida=false, tentativas=0). Não move card e não mexe em anexo já '
  'enviado. Levanta exceção se a mensagem não for do tenant de quem chamou.';

REVOKE ALL ON FUNCTION public.ludmilla_email_reler(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ludmilla_email_reler(UUID) TO authenticated;
