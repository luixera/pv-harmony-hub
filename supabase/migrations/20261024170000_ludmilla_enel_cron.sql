-- ============================================================================
-- LUDMILLA — os crons da ENEL (24/10/2026). APLICAR SÓ NA TASK 10 do plano
-- docs/superpowers/plans/2026-10-24-ludmilla-enel-cobranca-troca.md, depois de o robô
-- (enviar_cobranca) e a tela (Enviar/Dispensar) estarem no ar.
--
-- Seg–sex, das 8h às 18h de Brasília = 11h–21h UTC (sem horário de verão desde 2019).
--   ludmilla-enel-email  :00 → lê a caixa da ENEL (ludmilla_agendar_email)
--   ludmilla-cobrancas   :05 → abre o A fazer das cobranças vencidas
-- Os crons da CPFL (ludmilla-08h, ludmilla-17h) NÃO são tocados.
-- Desligar: SELECT cron.unschedule('ludmilla-enel-email'); SELECT cron.unschedule('ludmilla-cobrancas');
-- ============================================================================
SELECT cron.unschedule('ludmilla-enel-email') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ludmilla-enel-email');
SELECT cron.unschedule('ludmilla-cobrancas') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ludmilla-cobrancas');
SELECT cron.schedule('ludmilla-enel-email', '0 11-21 * * 1-5', $cron$ SELECT public.ludmilla_agendar_email(); $cron$);
SELECT cron.schedule('ludmilla-cobrancas', '5 11-21 * * 1-5', $cron$ SELECT public.ludmilla_cobrancas_abrir_vencidas(); $cron$);
