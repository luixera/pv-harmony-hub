-- supabase/migrations/20261019120000_ludmilla_email_anexo_chave.sql
-- Ludmilla — a CHAVE do anexo de e-mail separada do TEXTO do comentário.
-- Plano: docs/superpowers/plans/2026-10-13-ludmilla-enel-email.md (Task 6, rodada de correção 2, M-7).
--
-- O problema: `p_protocolo` de `ludmilla_email_anexo_novo` fazia DUAS coisas.
--   1. entrava na chave `portal_anexos.id_arquivo` (mensagem#protocolo#arquivo), cuja
--      UNIQUE (account_id, id_arquivo) é o que impede o documento de subir duas vezes;
--   2. ia para `portal_anexos.protocolo`, que `ludmilla_anexo_enviado` usa no comentário
--      do card ("📡 Anexo emitido pela ENEL para o protocolo <p_protocolo> …",
--      `ludmilla_anexo_frase`) e que o registro da Ludmilla mostra.
-- Na ENEL o protocolo do projeto MUDA (o cartão sugere gravar a NT da Carta). Com a
-- chave presa ao protocolo, o "Ler de novo" depois da troca subia o documento de novo.
-- Com a chave presa ao código do projeto, o comentário diria "para o protocolo GD-…".
--
-- A saída: `p_chave TEXT DEFAULT NULL`, que entra SÓ na chave (coalesce(nullif(p_chave,''),
-- p_protocolo)). `p_protocolo` continua indo para `portal_anexos.protocolo` e, portanto,
-- para o comentário. A ENEL manda `p_chave = project_id` (estável, nunca na tela).
-- A EDP não manda `p_chave`: o DEFAULT faz a chave ser a de sempre, byte a byte.
-- A unicidade é a UNIQUE (account_id, id_arquivo) da tabela (conferida no banco em
-- 19/10/2026), não um índice sobre `protocolo`: não há mudança de esquema.
-- Em 19/10/2026 havia 0 linhas de anexo da conta ENEL: a mudança de chave não deixa
-- nenhuma linha antiga com a chave velha.
--
-- De onde veio o corpo: `prosrc` do BANCO (não de migração), md5 conferido antes de
-- copiar = 9540d4b331977d211945034c9f0bb1cb (ludmilla_email_anexo_novo de 7 parâmetros,
-- 3034 bytes; idêntico ao de 20261012120000). Mudou SÓ:
--   · o parâmetro novo `p_chave` (o 8º, com DEFAULT);
--   · a montagem de `_chave` usa coalesce(nullif(p_chave, ''), p_protocolo);
--   · na retomada (ON CONFLICT … DO UPDATE de linha pendente/erro), `protocolo` passa a
--     ser o `p_protocolo` desta chamada, para o comentário dizer o protocolo atual. Para
--     a EDP é no-op: lá a chave contém o próprio p_protocolo, então conflito implica o
--     mesmo protocolo.
-- `ludmilla_anexo_enviado`, `ludmilla_anexo_frase` e `ludmilla_email_id_arquivo` NÃO mudam.
--
-- A assinatura muda (7 → 8 parâmetros): `CREATE OR REPLACE` criaria uma SEGUNDA função
-- ao lado da antiga, então a antiga sai (mesmo padrão de p_ocorrencia e p_referencia).
-- Numa transação só: se o CREATE falhar, a função antiga NÃO some.
-- Re-executável: DROP … IF EXISTS das duas assinaturas, depois CREATE.

BEGIN;

DROP FUNCTION IF EXISTS public.ludmilla_email_anexo_novo(UUID, TEXT, UUID, TEXT, TEXT, TEXT, INTEGER);
DROP FUNCTION IF EXISTS public.ludmilla_email_anexo_novo(UUID, TEXT, UUID, TEXT, TEXT, TEXT, INTEGER, TEXT);

CREATE FUNCTION public.ludmilla_email_anexo_novo(
  p_account_id UUID, p_protocolo TEXT, p_project_id UUID,
  p_message_id TEXT, p_nome_arquivo TEXT, p_conferido_por TEXT,
  p_ocorrencia INTEGER DEFAULT 1,
  p_chave TEXT DEFAULT NULL
) RETURNS TABLE (abertura TEXT, anexo_id UUID, projeto_id UUID, company_id UUID, codigo TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  _conta public.portal_accounts%ROWTYPE;
  _proj  public.projects%ROWTYPE;
  _id    UUID;
  _dono  UUID;
  _chave TEXT;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'permission denied: só o robô registra anexos de e-mail';
  END IF;
  SELECT * INTO _conta FROM public.portal_accounts WHERE id = p_account_id;
  -- Conta que não existe NÃO é "projeto que não existe": sem esta linha a
  -- resposta `projeto_inexistente` mentiria sobre a causa (mesma frase de
  -- `ludmilla_email_tentativa`, que o worker chama antes).
  IF _conta.id IS NULL THEN
    RAISE EXCEPTION 'conta % não existe', p_account_id;
  END IF;
  SELECT * INTO _proj  FROM public.projects WHERE id = p_project_id AND tenant_id = _conta.tenant_id;
  IF _proj.id IS NULL THEN
    -- apagado entre a listagem e o registro, ou não é desta conta
    RETURN QUERY SELECT 'projeto_inexistente'::TEXT, NULL::UUID, NULL::UUID, NULL::UUID, NULL::TEXT;
    RETURN;
  END IF;

  -- A CHAVE do arquivo: `p_chave` quando vem (ENEL: o project_id, que nunca muda com a
  -- troca de protocolo); sem ela, o protocolo, como sempre (EDP). O TEXTO que o
  -- comentário mostra é sempre `p_protocolo` (gravado em portal_anexos.protocolo).
  _chave := public.ludmilla_email_id_arquivo(p_message_id, coalesce(nullif(p_chave, ''), p_protocolo), p_nome_arquivo, p_ocorrencia);

  -- A linha que ficou `pendente` (run que morreu antes de subir o arquivo) ou
  -- `erro` (storage recusou) volta para `pendente` e é devolvida para nova
  -- tentativa — sem isso a correção C1 não se completa, porque a mensagem volta
  -- a ser tratada mas o arquivo nunca sobe. Linha `enviado`/`bloqueado` responde
  -- `ja_resolvido`: aí não há o que refazer.
  --
  -- `x.project_id = excluded.project_id` é a guarda do D1: NUNCA devolver linha
  -- de outro projeto, nem que a chave um dia volte a colidir.
  INSERT INTO public.portal_anexos AS x
    (tenant_id, account_id, protocolo, project_id, id_arquivo, nome_arquivo, situacao, conferido_por)
  VALUES
    (_conta.tenant_id, p_account_id, p_protocolo, p_project_id,
     _chave, p_nome_arquivo, 'pendente', p_conferido_por)
  ON CONFLICT (account_id, id_arquivo) DO UPDATE
     SET situacao = 'pendente', motivo = NULL, conferido_por = excluded.conferido_por,
         protocolo = excluded.protocolo
   WHERE x.situacao IN ('pendente', 'erro')
     AND x.project_id = excluded.project_id
  RETURNING x.id, x.project_id INTO _id, _dono;

  IF _id IS NULL THEN
    -- Nada devolvido pelo INSERT tem dois significados, e tratar os dois como
    -- "já resolvido" é o defeito: ou a linha está `enviado`/`bloqueado` NO MESMO
    -- projeto (não há o que refazer), ou ela é de OUTRO projeto — e aí "já
    -- resolvido no card" seria mentira sobre o card de outro cliente.
    SELECT x.project_id INTO _dono
      FROM public.portal_anexos x
     WHERE x.account_id = p_account_id AND x.id_arquivo = _chave;
    IF _dono IS NOT NULL AND _dono IS DISTINCT FROM p_project_id THEN
      RAISE EXCEPTION 'anexo de e-mail já registrado em OUTRO projeto (% em vez de %): não anexo no card errado', _dono, p_project_id;
    END IF;
    RETURN QUERY SELECT 'ja_resolvido'::TEXT, NULL::UUID, p_project_id, NULL::UUID, NULL::TEXT;
    RETURN;
  END IF;

  RETURN QUERY SELECT 'aberto'::TEXT, _id, _dono, _proj.company_id, _proj.code;
END;
$$;

COMMENT ON FUNCTION public.ludmilla_email_anexo_novo(UUID, TEXT, UUID, TEXT, TEXT, TEXT, INTEGER, TEXT) IS
  'Abre (ou retoma) a linha do anexo de e-mail. Responde SEMPRE uma linha: abertura = aberto (suba o arquivo; traz anexo_id, projeto_id, company_id, codigo), ja_resolvido (a linha está enviado/bloqueado neste projeto) ou projeto_inexistente. O worker confere o projeto_id da LINHA contra o projeto pedido; linha de outro projeto estoura, nunca é devolvida. p_ocorrencia desambigua arquivos de mesmo nome na mesma mensagem. p_chave (ENEL: o project_id) entra SÓ na chave id_arquivo; sem ela vale p_protocolo (EDP). p_protocolo é o texto do comentário do card (portal_anexos.protocolo).';

REVOKE ALL ON FUNCTION public.ludmilla_email_anexo_novo(UUID, TEXT, UUID, TEXT, TEXT, TEXT, INTEGER, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ludmilla_email_anexo_novo(UUID, TEXT, UUID, TEXT, TEXT, TEXT, INTEGER, TEXT) TO service_role;

COMMIT;

-- o PostgREST relê as funções (a assinatura mudou)
NOTIFY pgrst, 'reload schema';

SELECT p.oid::regprocedure::text AS funcao, md5(p.prosrc) AS md5_corpo
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'ludmilla_email_anexo_novo';
