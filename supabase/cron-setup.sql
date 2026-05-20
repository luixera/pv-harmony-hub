-- ══════════════════════════════════════════════════════════
-- CRON JOB — Email Agent (varredura 2x/dia)
-- Execute este arquivo no Supabase SQL Editor
-- ══════════════════════════════════════════════════════════

-- Habilitar extensões necessárias
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Remover jobs anteriores (idempotente)
SELECT cron.unschedule('scan-emails-morning')   WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'scan-emails-morning');
SELECT cron.unschedule('scan-emails-afternoon') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'scan-emails-afternoon');

-- 08h BRT = 11h UTC (varredura matinal)
SELECT cron.schedule(
  'scan-emails-morning',
  '0 11 * * *',
  $$
  SELECT net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/scan-emails',
    headers := json_build_object(
      'Authorization', 'Bearer ' || current_setting('app.service_role_key'),
      'Content-Type',  'application/json'
    )::jsonb,
    body    := '{}'::jsonb
  )
  $$
);

-- 17h BRT = 20h UTC (varredura vespertina)
SELECT cron.schedule(
  'scan-emails-afternoon',
  '0 20 * * *',
  $$
  SELECT net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/scan-emails',
    headers := json_build_object(
      'Authorization', 'Bearer ' || current_setting('app.service_role_key'),
      'Content-Type',  'application/json'
    )::jsonb,
    body    := '{}'::jsonb
  )
  $$
);

-- Verificar jobs criados
SELECT jobid, jobname, schedule, active
FROM cron.job
WHERE jobname IN ('scan-emails-morning', 'scan-emails-afternoon');
