-- Validação das RPCs de eletropostos com leituras sintéticas (fontes 'teste' e
-- 'teste2'), limpas no fim do arquivo. A API do `db query` nem sempre devolve
-- resultado dentro de BEGIN/ROLLBACK, por isso a limpeza é explícita.
--   npx -y supabase db query --linked -f supabase/eletropostos-validacao.sql
--
-- Cenário em 01/10/2026 (quinta), 24 janelas a partir de 10:00 BRT, local
-- "Posto Monte Carlo" (DC, 60 kW), conectores A e B:
--   A: 6 ocupado, 6 livre, 6 ocupado, 2 fora, 4 livre → 1 h, 2 sessões,
--      ocupação 12/22 = 0,5455, horas_fora 0,1667
--   B: 24 ocupado → 2 h, 1 sessão
--   local: 3 h · ocupação 36/46 = 0,7826 · 3 sessões · kWh 108–144 (60×0,6 / 60×0,8)
--   perfil quinta 10h: (6 + 12) / 24 = 0,75
SELECT set_config('request.jwt.claims',
  json_build_object('sub', (SELECT id FROM public.profiles WHERE is_master LIMIT 1), 'role', 'authenticated')::text, false);

DO $$
DECLARE i int; _slot timestamptz; _t uuid := public.eletropostos_tenant(); st text;
BEGIN
  INSERT INTO public.eletroposto_fonte_local (tenant_id, fonte, local_fonte, nome, lat, lng, local_id, visto_em)
  SELECT _t, 'teste', 'T1', 'Monte Carlo (teste)', lat, lng, id, now() FROM public.eletroposto_local WHERE nome = 'Posto Monte Carlo';
  UPDATE public.eletroposto_local SET potencia_kw = 60 WHERE nome = 'Posto Monte Carlo';
  FOR i IN 0..23 LOOP
    _slot := ('2026-10-01 10:00'::timestamp AT TIME ZONE 'America/Sao_Paulo') + make_interval(mins => 5 * i);
    st := CASE WHEN i BETWEEN 0 AND 5 THEN 'ocupado' WHEN i BETWEEN 6 AND 11 THEN 'livre'
               WHEN i BETWEEN 12 AND 17 THEN 'ocupado' WHEN i IN (18, 19) THEN 'fora' ELSE 'livre' END;
    INSERT INTO public.eletroposto_leitura (tenant_id, ts_utc, slot, fonte, local_fonte, local_nome, conector, potencia_kw, status_bruto, status)
    VALUES (_t, _slot, _slot, 'teste', 'T1', 'Monte Carlo (teste)', 'A', 60, st, st),
           (_t, _slot, _slot, 'teste', 'T1', 'Monte Carlo (teste)', 'B', 60, 'Charging', 'ocupado');
  END LOOP;
  INSERT INTO public.eletroposto_varredura (tenant_id, fonte, ok, n) VALUES (_t, 'teste', true, 48);
END $$;

-- vínculo automático: par novo a ~30 m do Posto Monte Carlo deve casar (leitura cai na janela de agora, fora do período testado)
SELECT public.eletropostos_gravar_interno('teste2',
  jsonb_build_array(jsonb_build_object('local_fonte', 'X9', 'local_nome', 'perto do Monte Carlo',
    'lat', -20.814 + 0.00027, 'lng', -49.482, 'conector', '1', 'potencia_kw', 40, 'status_bruto', 'Available', 'status', 'livre')), NULL);

SELECT public.eletropostos_premissas_salvar('{"preco_kwh_padrao": "2.50", "xpto": 1}'::jsonb);

CREATE TEMP TABLE _r AS
WITH r AS (SELECT public.eletropostos_resumo('2026-10-01', '2026-10-01') j),
     d AS (SELECT public.eletropostos_detalhe((SELECT id FROM public.eletroposto_local WHERE nome = 'Posto Monte Carlo'), '2026-10-01', '2026-10-01') j),
     loc AS (SELECT x FROM r, jsonb_array_elements(r.j->'locais') x WHERE x->>'nome' = 'Posto Monte Carlo')
SELECT 'locais no resumo' AS item, (r.j->'kpis'->>'locais') AS valor, '72' AS esperado FROM r
UNION ALL SELECT 'monitorados', r.j->'kpis'->>'monitorados', '1' FROM r
UNION ALL SELECT 'kpis.sessoes', r.j->'kpis'->>'sessoes', '3' FROM r
UNION ALL SELECT 'kpis.ocupacao_media', round((r.j->'kpis'->>'ocupacao_media')::numeric, 4)::text, '0.7826' FROM r
UNION ALL SELECT 'local.horas_ocupado', round((x->>'horas_ocupado')::numeric, 3)::text, '3.000' FROM loc
UNION ALL SELECT 'local.ocupacao', round((x->>'ocupacao')::numeric, 4)::text, '0.7826' FROM loc
UNION ALL SELECT 'local.sessoes', x->>'sessoes', '3' FROM loc
UNION ALL SELECT 'local.kwh_min', round((x->>'kwh_min')::numeric, 1)::text, '108.0' FROM loc
UNION ALL SELECT 'local.kwh_max', round((x->>'kwh_max')::numeric, 1)::text, '144.0' FROM loc
UNION ALL SELECT 'local.receita_max (2.50)', round((x->>'receita_max')::numeric, 1)::text, '360.0' FROM loc
UNION ALL SELECT 'local.agora.ocupado', x->'agora'->>'ocupado', '1' FROM loc
UNION ALL SELECT 'local.agora.livre', x->'agora'->>'livre', '1' FROM loc
UNION ALL SELECT 'detalhe.conectores', jsonb_array_length(d.j->'conectores')::text, '2' FROM d
UNION ALL SELECT 'detalhe.A.horas_fora', round((c->'m'->>'horas_fora')::numeric, 4)::text, '0.1667' FROM d, jsonb_array_elements(d.j->'conectores') c WHERE c->>'conector' = 'A'
UNION ALL SELECT 'detalhe.A.sessoes', c->'m'->>'sessoes', '2' FROM d, jsonb_array_elements(d.j->'conectores') c WHERE c->>'conector' = 'A'
UNION ALL SELECT 'detalhe.A.ocupacao', round((c->'m'->>'ocupacao')::numeric, 4)::text, '0.5455' FROM d, jsonb_array_elements(d.j->'conectores') c WHERE c->>'conector' = 'A'
UNION ALL SELECT 'detalhe.A.kwh_min', round((c->'m'->>'kwh_min')::numeric, 1)::text, '36.0' FROM d, jsonb_array_elements(d.j->'conectores') c WHERE c->>'conector' = 'A'
UNION ALL SELECT 'detalhe.diario[0].horas_ocupado', round((d.j->'diario'->0->>'horas_ocupado')::numeric, 2)::text, '3.00' FROM d
UNION ALL SELECT 'detalhe.diario[0].dia', d.j->'diario'->0->>'dia', '2026-10-01' FROM d
UNION ALL SELECT 'detalhe.perfil quinta 10h', round((d.j->'perfil'->3->10)::text::numeric, 4)::text, '0.7500' FROM d
UNION ALL SELECT 'detalhe.perfil segunda 10h é null', ((d.j->'perfil'->0->10) = 'null'::jsonb)::text, 'true' FROM d
UNION ALL SELECT 'detalhe.linha_do_tempo chaves', (SELECT count(*)::text FROM jsonb_object_keys(d.j->'linha_do_tempo')), '2' FROM d
UNION ALL SELECT 'vinculo automático (30 m)', (SELECT (local_id IS NOT NULL)::text FROM public.eletroposto_fonte_local WHERE fonte = 'teste2'), 'true'
UNION ALL SELECT 'nao_vinculados', jsonb_array_length(r.j->'nao_vinculados')::text, '0' FROM r
UNION ALL SELECT 'coleta.fontes', jsonb_array_length(public.eletropostos_coleta()->'fontes')::text, '2'
UNION ALL SELECT 'coleta.total_leituras', public.eletropostos_coleta()->>'total_leituras', '49'
UNION ALL SELECT 'premissas_salvar preco', public.eletropostos_premissas()->>'preco_kwh_padrao', '2.50'
UNION ALL SELECT 'premissas_salvar ignora xpto', (public.eletropostos_premissas() ? 'xpto')::text, 'false';

SELECT item, valor, esperado, CASE WHEN valor = esperado THEN 'OK' ELSE 'DIFERENTE' END AS resultado FROM _r;

-- limpeza
DELETE FROM public.eletroposto_leitura WHERE fonte IN ('teste', 'teste2');
DELETE FROM public.eletroposto_varredura WHERE fonte IN ('teste', 'teste2');
DELETE FROM public.eletroposto_fonte_local WHERE fonte IN ('teste', 'teste2');
UPDATE public.eletroposto_local SET potencia_kw = NULL WHERE nome = 'Posto Monte Carlo';
UPDATE public.eletroposto_premissas SET valores = '{}'::jsonb;
DROP TABLE _r;
