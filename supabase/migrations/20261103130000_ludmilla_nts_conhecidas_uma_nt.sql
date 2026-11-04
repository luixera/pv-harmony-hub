-- ============================================================================
-- LUDMILLA — a NT aprendida do assunto de e-mail: só a de mensagem com UMA NT, e nunca a de outro projeto
-- (03/11/2026, correção da revisão independente de 2edf4d6)
--
-- O FALSO POSITIVO (latente): a fonte 'email' de ludmilla_email_nts_conhecidas aprendia TODAS as NTs que vêm
-- depois do token "NT" no assunto de um e-mail ligado a um projeto. Cenário: o e-mail E1 "RE: TROCA DE
-- RELÓGIO - NT 391000010 / NT 391000020" casa no projeto A (protocolo 391000010); o projeto B (dono de
-- 391000020) ainda não tem a NT no cadastro → a função devolvia (A, 391000020, 'email') → um e-mail posterior
-- só com 391000020 (a vistoria aprovada de B) cairia em A.
--
-- A correção, só na fonte 'email' (a fonte 'carta' não muda):
--   (a) aprende só de mensagem cujo assunto tem exatamente UMA NT distinta (a mesma NT repetida conta uma vez):
--       com duas, não dá para saber qual é a deste projeto;
--   (b) descarta a NT que já é o protocolo do cadastro de OUTRO projeto do escopo (por pedaço de dígitos ou
--       pelos dígitos colados, sem zeros à esquerda) ou a NT do cartão da Carta pendente de OUTRO projeto.
-- Escopo, guarda de service_role, SECURITY DEFINER, search_path '', REVOKE/GRANT: os mesmos.
--
-- Copiado do prosrc VIVO (md5 d2da533a25ea61d76e8a43b6eb7e12e6, medido em 03/11/2026 antes de aplicar), mudando
-- só: `escopo` passa a levar o protocol_number; a Carta vira o CTE `cartas` (mesmo filtro); a fonte 'email'
-- passa por `nts_do_email` → `de_uma_nt` (a) → `emails` (b). A saída, a ordem e o desempate ('carta' vence) iguais.
--
-- NÃO mexe em nenhuma outra função nem nos crons (da Ludmilla só ludmilla-08h e ludmilla-17h, comando md5
-- 82e94731…). md5 do prosrc VIVO, medidos antes e conferidos depois, iguais:
--   ludmilla_agendar_varreduras 3d0d2d0f1e7455ec701230bc925e1bde · ludmilla_aplicar_update 6183edef6c3f93810282039bdd565a26
--   ludmilla_email_registrar 5d5375a0cb842209b6fb5f82327ee579 · ludmilla_email_projetos 038773e9dc1ae5b6e078a099c2affa32
--   ludmilla_email_avisar ddf2aa830438465f4913b16a190114ba · ludmilla_agendar_email 03dae8f9f1a05c2e93bb5043b5948e9c
--   ludmilla_cobranca_abrir_afazer a883a238e5920c972ff9eb16497fbd50 · ludmilla_cobranca_agendar 699c36efb3d8dd292ba1b5f20b5450d9
--   ludmilla_cobranca_aprovar 50b9da0ec4fb9c14991b7f8b8e795370 · ludmilla_cobranca_dispensar 85127ea1cd1a0071164b777866b375ed
--   ludmilla_cobranca_encerrar_por_troca 620285db0ff0ce064edd2dded58e8678 · ludmilla_cobranca_enviada 8e3584795efd5fc1506eee947b9b831e
--   ludmilla_cobranca_falhou ced7c0c7bc9b441267d684d7a403e3d4 · ludmilla_cobranca_fechar_afazer c6fc2deeabe6dbd007a4e789d19bcbbe
--   ludmilla_cobranca_iniciar_envio 74ded66fb23b009d4f2def8ae612d386 · ludmilla_cobranca_sem_confirmacao d6dc814131d03d626b17792bff292f36
--   ludmilla_cobrancas_abrir_vencidas 4dce38fd1bb35cf6c6f5b2abf2e0e67e
-- ============================================================================

CREATE OR REPLACE FUNCTION public.ludmilla_email_nts_conhecidas(p_account_id UUID)
RETURNS TABLE (project_id UUID, nt TEXT, fonte TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  WITH escopo AS (
    -- o critério de ludmilla_email_projetos: mesmo tenant e mesma concessionária da conta
    SELECT p.id, p.protocol_number
      FROM public.portal_accounts a
      JOIN public.projects p
        ON p.concessionaire_id = a.concessionaire_id AND p.tenant_id = a.tenant_id
     WHERE a.id = p_account_id
       AND (SELECT auth.role()) = 'service_role'
       AND NOT p.is_deleted
  ),
  cartas AS (
    -- a NT do cartão da Carta que ainda espera o "Aplicar"
    SELECT u.project_id, u.protocolo AS nt
      FROM public.portal_updates u
      JOIN escopo e ON e.id = u.project_id
     WHERE u.account_id = p_account_id
       AND u.atualizar_protocolo
       AND u.situacao = 'pendente'
       AND u.protocolo ~ '^[0-9]{9}$'
  ),
  nts_do_email AS (
    -- o número depois do token NT no assunto de um e-mail já ligado ao projeto (uma linha por mensagem e NT)
    SELECT m.id AS mensagem, m.project_id, (x.achado)[1] AS nt
      FROM public.portal_email_mensagens m
      JOIN escopo e ON e.id = m.project_id
     CROSS JOIN LATERAL regexp_matches(
             coalesce(m.assunto, ''),
             '(?<![0-9A-Z])NT[^0-9A-Z]{0,3}([0-9]{9})(?![0-9])',
             'gi') AS x(achado)
     WHERE m.account_id = p_account_id
       AND m.project_id IS NOT NULL
  ),
  de_uma_nt AS (
    -- (a) só a mensagem cujo assunto traz UMA NT distinta: com duas, qual é a deste projeto?
    SELECT d.project_id, min(d.nt) AS nt
      FROM nts_do_email d
     GROUP BY d.mensagem, d.project_id
    HAVING count(DISTINCT d.nt) = 1
  ),
  emails AS (
    -- (b) nunca a NT que já é de OUTRO projeto: o protocolo do cadastro ou a Carta pendente dele
    SELECT u.project_id, u.nt
      FROM de_uma_nt u
     WHERE NOT EXISTS (
             SELECT 1
               FROM escopo o
              CROSS JOIN LATERAL (
                      SELECT (r.pedaco)[1] AS num
                        FROM regexp_matches(coalesce(o.protocol_number, ''), '[0-9]+', 'g') AS r(pedaco)
                      UNION ALL
                      SELECT regexp_replace(coalesce(o.protocol_number, ''), '[^0-9]', '', 'g')
                    ) n
              WHERE o.id <> u.project_id
                AND ltrim(n.num, '0') = ltrim(u.nt, '0'))
       AND NOT EXISTS (
             SELECT 1
               FROM cartas c
              WHERE c.project_id <> u.project_id
                AND ltrim(c.nt, '0') = ltrim(u.nt, '0'))
  ),
  achadas AS (
    SELECT c.project_id, c.nt, 'carta'::text AS fonte FROM cartas c
    UNION ALL
    SELECT e.project_id, e.nt, 'email'::text FROM emails e
  )
  SELECT a.project_id, a.nt, min(a.fonte)
    FROM achadas a
   GROUP BY a.project_id, a.nt
   ORDER BY a.project_id, a.nt;
$$;
REVOKE ALL ON FUNCTION public.ludmilla_email_nts_conhecidas(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ludmilla_email_nts_conhecidas(UUID) TO service_role;

NOTIFY pgrst, 'reload schema';
