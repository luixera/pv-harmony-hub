-- Amostra para desenvolver e testar a Fase A sem a BDGD.
--
-- A distribuidora se chama AMOSTRA de propósito: aparece rotulada na tela, e
-- `delete from rede_distribuidora where sigla = 'AMOSTRA'` limpa tudo em
-- cascata. NÃO é dado real e não deve ser confundido com a CPFL.
--
-- Os 12 transformadores cobrem os quatro estados do semáforo, incluindo DOIS
-- casos de "sem dado" (carga nula e carga zero). Esses dois existem para
-- provar o ponto mais importante do cálculo: ausência de dado nunca pode
-- virar "folga".

DELETE FROM public.rede_distribuidora WHERE sigla = 'AMOSTRA';

WITH d AS (
  INSERT INTO public.rede_distribuidora (sigla, nome, uf, data_base)
  VALUES ('AMOSTRA', 'AMOSTRA — não é dado real', 'SP', '2025-12-31')
  RETURNING id
), se AS (
  INSERT INTO public.rede_subestacao (distribuidora_id, codigo, nome, tensao_kv, potencia_mva, geom)
  SELECT d.id, 'SE-AMOSTRA-01', 'Campinas Centro (amostra)', 138, 60,
         ST_SetSRID(ST_MakePoint(-47.0616, -22.9056), 4326)
    FROM d RETURNING id, distribuidora_id
), al AS (
  INSERT INTO public.rede_alimentador
    (distribuidora_id, subestacao_id, codigo, tensao_kv, carga_min_diurna_kw, gd_conectada_kw, geom)
  SELECT se.distribuidora_id, se.id, v.codigo, 13.8, v.carga, v.gd,
         ST_SetSRID(ST_GeomFromText(v.wkt), 4326)
    FROM se CROSS JOIN (VALUES
      ('CTMT-AM-01', 4200.0, 7900.0, 'MULTILINESTRING((-47.08 -22.90, -47.05 -22.91, -47.03 -22.93))'),
      ('CTMT-AM-02', 3100.0, 2200.0, 'MULTILINESTRING((-47.09 -22.88, -47.06 -22.87, -47.04 -22.86))'),
      ('CTMT-AM-03', 2800.0,  900.0, 'MULTILINESTRING((-47.02 -22.95, -47.00 -22.97, -46.98 -22.98))')
    ) AS v(codigo, carga, gd, wkt)
  RETURNING id, distribuidora_id, codigo
)
INSERT INTO public.rede_transformador
  (distribuidora_id, alimentador_id, codigo, potencia_nominal_kva, fases,
   tensao_primaria_kv, tensao_secundaria_v, carga_min_diurna_kw, gd_conectada_kw, geom)
SELECT al.distribuidora_id, al.id, v.codigo, v.kva, 3, 13.8, 220,
       v.carga, v.gd, ST_SetSRID(ST_MakePoint(v.lng, v.lat), 4326)
  FROM al JOIN (VALUES
    -- risco: GD muito acima da carga mínima
    ('CTMT-AM-01', 'TR-AM-0001', 75.0,  28.0, 52.4, -47.0700, -22.9020),
    ('CTMT-AM-01', 'TR-AM-0002', 112.5, 40.0, 61.0, -47.0650, -22.9080),
    ('CTMT-AM-01', 'TR-AM-0003', 45.0,  16.0, 29.5, -47.0520, -22.9140),
    -- atenção: entre 60% e 100% da margem
    ('CTMT-AM-02', 'TR-AM-0004', 75.0,  30.0, 19.0, -47.0880, -22.8810),
    ('CTMT-AM-02', 'TR-AM-0005', 112.5, 48.0, 32.0, -47.0620, -22.8740),
    ('CTMT-AM-02', 'TR-AM-0006', 45.0,  20.0, 13.0, -47.0410, -22.8660),
    -- folga
    ('CTMT-AM-03', 'TR-AM-0007', 75.0,  32.0,  5.0, -47.0180, -22.9480),
    ('CTMT-AM-03', 'TR-AM-0008', 112.5, 55.0, 10.0, -47.0020, -22.9690),
    ('CTMT-AM-03', 'TR-AM-0009', 150.0, 70.0,  0.0, -46.9830, -22.9820),
    ('CTMT-AM-03', 'TR-AM-0010', 45.0,  22.0,  3.0, -46.9950, -22.9750),
    -- sem dado: carga nula (NÃO pode virar folga) e carga zero
    ('CTMT-AM-02', 'TR-AM-0011', 75.0,  NULL, 12.0, -47.0750, -22.8900),
    ('CTMT-AM-02', 'TR-AM-0012', 75.0,   0.0,  8.0, -47.0500, -22.8950)
  ) AS v(alim, codigo, kva, carga, gd, lng, lat)
    ON v.alim = al.codigo;

INSERT INTO public.rede_importacao
  (distribuidora_id, data_base, arquivo_origem, linhas_por_camada, situacao, concluido_em)
SELECT id, '2025-12-31', 'amostra-local.sql',
       '{"subestacao":1,"alimentador":3,"transformador":12}'::jsonb,
       'concluida', now()
  FROM public.rede_distribuidora WHERE sigla = 'AMOSTRA';
