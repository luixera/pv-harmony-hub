-- O atendimento.edsp não é comunicado em massa: manda aviso POR PROJETO com a NT
-- e o resultado no assunto ("… nota: <NT> - Vistoria aprovada|reprovada").
-- Como 'comunicado' ele nem seria procurado (remetentesParaBuscar o exclui).
UPDATE public.portal_email_regras r
   SET tipo_documento = 'resultado_vistoria', anexar = TRUE, ler_pdf = FALSE
  FROM public.portal_accounts a
 WHERE a.id = r.account_id AND a.connector = 'enel'
   AND r.remetente = 'atendimento.edsp@enel.com'
   AND r.tipo_documento = 'comunicado';   -- só se ninguém mexeu na regra pela tela
