-- ============================================================================
-- LUDMILLA — a NT que ela já aprendeu (ENEL) e as regras de leitura da EDP (02/11/2026)
--
-- O CASO (dados de produção de 02/11/2026): o e-mail de vistoria aprovada do PRJ-67567 chegou do
-- tecnico.abc com a NT no assunto ("VISTORIA GD 392812955 - <endereço>") e foi registrado como "não
-- reconheci de qual projeto…". O projeto está com protocol_number NULL: o cartão da Carta que manda gravar a
-- NT está pendente desde 24/10. A Ludmilla JÁ conhecia essa NT — a IA a leu na Carta, e dois e-mails já ligados
-- ao projeto têm "NT 392812955" no assunto. O mesmo vale para 3 resultados de vistoria do atendimento.edsp
-- (PRJ-52440, PRJ-61098, PRJ-75158). Em 02/11: 27 NTs em protocol_number, 4 em cartões de Carta e 13 em
-- assuntos de e-mails ligados; nenhuma NT aponta para dois projetos.
--
-- 1. ludmilla_email_nts_conhecidas(p_account_id): as NTs que a Ludmilla já viu em cada projeto, além do
--    protocolo do cadastro. O robô (worker/ludmilla/src/fila.ts, `projetosDaEnel`) as junta a cada projeto e o
--    "por protocolo" passa a casar com protocolo ∪ NTs. Duas fontes:
--      · 'carta' — portal_updates da conta com atualizar_protocolo = TRUE e situacao = 'pendente' (o cartão que
--        manda gravar a NT). O banco já trava essa NT (ludmilla_email_registrar); aqui ainda se exige 9 dígitos;
--      · 'email' — o número logo depois do TOKEN "NT" no ASSUNTO de um e-mail da conta já ligado a um projeto
--        (project_id não nulo): o padrão dos assuntos que a NOSSA equipe escreve ("… - NOME - NT 391747683").
--        Exatamente 9 dígitos, sem dígito antes nem depois; "NT" como token (nem letra nem dígito antes dele:
--        "DOCUMENT 391…" não conta); sem diferenciar maiúsculas. Número solto, sem o token, não conta.
--    Escopo: o MESMO de ludmilla_email_projetos (mesmo tenant e mesma concessionária da conta, sem os apagados).
--    Uma linha por par projeto/NT; a mesma NT nas duas fontes sai uma vez, como 'carta'.
--    Só o robô (service_role): guarda no WHERE, como a irmã, e EXECUTE só para service_role.
--    NÃO mexe em ludmilla_email_projetos: a EDP também a usa.
--
-- 2. EDP (conta 8a099c4c-2d46-4354-a6a7-65059fb2ee0c, dado, não código — decisão do usuário, 02/11/2026):
--    · "NOTA -": tipo 'nota' → 'parecer' e ler_pdf → TRUE. É a única forma de recomendacaoDoVeredito sugerir
--      etapa (favoravel → approved, pendencia → pendencia): a carta vem às vezes aprovada, às vezes reprovada;
--    · "CARTA DE OBRAS" (edpdocumentoporemail): ler_pdf → TRUE, tipo continua 'carta_obras' (veredito e resumo
--      no cartão, SEM sugestão de etapa: o usuário não definiu o que ela significa).
--    O UPDATE só pega a regra que ainda está como estava (tipo e ler_pdf de antes): edição feita pela tela vence.
--
-- NÃO mexe em nenhuma função existente nem nos crons (da Ludmilla só ludmilla-08h e ludmilla-17h).
-- md5 do prosrc VIVO, medidos antes e conferidos depois, iguais:
--   ludmilla_agendar_varreduras 3d0d2d0f1e7455ec701230bc925e1bde · ludmilla_aplicar_update 6183edef6c3f93810282039bdd565a26
--   ludmilla_email_registrar 5d5375a0cb842209b6fb5f82327ee579 · ludmilla_email_projetos 038773e9dc1ae5b6e078a099c2affa32
--   ludmilla_email_avisar ddf2aa830438465f4913b16a190114ba · ludmilla_agendar_email 03dae8f9f1a05c2e93bb5043b5948e9c
--   ludmilla_cobranca_* e ludmilla_cobrancas_abrir_vencidas: os 11 corpos, iguais (lista no relatório da entrega).
-- ============================================================================

-- ── 1. As NTs que a Ludmilla já aprendeu ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ludmilla_email_nts_conhecidas(p_account_id UUID)
RETURNS TABLE (project_id UUID, nt TEXT, fonte TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  WITH escopo AS (
    -- o critério de ludmilla_email_projetos: mesmo tenant e mesma concessionária da conta
    SELECT p.id
      FROM public.portal_accounts a
      JOIN public.projects p
        ON p.concessionaire_id = a.concessionaire_id AND p.tenant_id = a.tenant_id
     WHERE a.id = p_account_id
       AND (SELECT auth.role()) = 'service_role'
       AND NOT p.is_deleted
  ),
  achadas AS (
    -- a NT do cartão da Carta que ainda espera o "Aplicar"
    SELECT u.project_id, u.protocolo AS nt, 'carta'::text AS fonte
      FROM public.portal_updates u
      JOIN escopo e ON e.id = u.project_id
     WHERE u.account_id = p_account_id
       AND u.atualizar_protocolo
       AND u.situacao = 'pendente'
       AND u.protocolo ~ '^[0-9]{9}$'
    UNION ALL
    -- o número depois do token NT no assunto de um e-mail já ligado ao projeto
    SELECT m.project_id, (x.achado)[1], 'email'::text
      FROM public.portal_email_mensagens m
      JOIN escopo e ON e.id = m.project_id
     CROSS JOIN LATERAL regexp_matches(
             coalesce(m.assunto, ''),
             '(?<![0-9A-Z])NT[^0-9A-Z]{0,3}([0-9]{9})(?![0-9])',
             'gi') AS x(achado)
     WHERE m.account_id = p_account_id
       AND m.project_id IS NOT NULL
  )
  SELECT a.project_id, a.nt, min(a.fonte)
    FROM achadas a
   GROUP BY a.project_id, a.nt
   ORDER BY a.project_id, a.nt;
$$;
REVOKE ALL ON FUNCTION public.ludmilla_email_nts_conhecidas(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ludmilla_email_nts_conhecidas(UUID) TO service_role;

-- ── 2. EDP: as regras de leitura (dado, não código) ─────────────────────────
UPDATE public.portal_email_regras
   SET tipo_documento = 'parecer', ler_pdf = TRUE
 WHERE account_id = '8a099c4c-2d46-4354-a6a7-65059fb2ee0c'
   AND assunto = 'NOTA -'
   AND tipo_documento = 'nota' AND ler_pdf = FALSE;

UPDATE public.portal_email_regras
   SET ler_pdf = TRUE
 WHERE account_id = '8a099c4c-2d46-4354-a6a7-65059fb2ee0c'
   AND assunto = 'CARTA DE OBRAS'
   AND tipo_documento = 'carta_obras' AND ler_pdf = FALSE;

NOTIFY pgrst, 'reload schema';
