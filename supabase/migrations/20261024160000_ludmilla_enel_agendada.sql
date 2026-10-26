-- ============================================================================
-- LUDMILLA — a leitura da ENEL fica automática (24/10/2026)
-- Spec: docs/superpowers/specs/2026-10-24-ludmilla-enel-cobranca-troca-design.md §3.1
--
-- Função NOVA, ao lado do agendador da CPFL. `ludmilla_agendar_varreduras` NÃO muda
-- (md5 do prosrc 3d0d2d0f1e7455ec701230bc925e1bde antes e depois): ela só enfileira
-- conta com login e secret_id, e é essa "proteção acidental" que mantém a varredura de
-- PORTAL longe das contas de e-mail (docs/modules/integrations/ludmilla.md).
--
-- Esta enfileira `varredura_email` para conta de e-mail que parte do REMETENTE (hoje só
-- a ENEL), ligada, fora da estação local, sem run aberto. A EDP (protocolo no assunto)
-- continua manual: o primeiro run dela ainda está pendente.
--
-- O cron entra em OUTRO arquivo (20261024170000), aplicado só depois de o robô e a tela
-- da cobrança estarem no ar.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.ludmilla_agendar_email()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _n INTEGER := 0; _a RECORD;
BEGIN
  FOR _a IN SELECT a.id, a.tenant_id FROM public.portal_accounts a
             WHERE a.enabled AND a.acompanhamento = 'email' AND a.identificacao = 'remetente'
               AND coalesce(a.modo, 'vps') <> 'local' LOOP
    IF NOT EXISTS (SELECT 1 FROM public.portal_sync_runs r
                    WHERE r.account_id = _a.id AND r.situacao IN ('na_fila', 'rodando')) THEN
      INSERT INTO public.portal_sync_runs (tenant_id, account_id, tipo) VALUES (_a.tenant_id, _a.id, 'varredura_email');
      _n := _n + 1;
    END IF;
  END LOOP;
  RETURN _n;
END;
$$;
REVOKE ALL ON FUNCTION public.ludmilla_agendar_email() FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION public.ludmilla_agendar_email() IS
  'Enfileira varredura_email para as contas de e-mail por remetente (ENEL), ligadas, fora da estação local e sem run aberto. Chamada pelo cron ludmilla-enel-email (seg–sex, 8h–18h de Brasília). Não é o agendador da CPFL.';
