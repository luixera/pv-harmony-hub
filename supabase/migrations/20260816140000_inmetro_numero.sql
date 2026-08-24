-- ═══════════════════════════════════════════════════════════════════════════
-- NÚMERO DO REGISTRO INMETRO (pedido do usuário, ago/2026)
--
-- O catálogo já guardava o CERTIFICADO (arquivo), mas não o NÚMERO — e é o
-- número que vai escrito no memorial e nos formulários da concessionária
-- ("INMETRO: 008649/2024"). Sem campo próprio, era digitado à mão em cada
-- documento.
--
-- Fica no catálogo, e não no projeto: o registro é do MODELO do equipamento,
-- então preencher uma vez serve a todos os projetos que o usarem.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.equipment_catalog
  add column if not exists inmetro_number text;

comment on column public.equipment_catalog.inmetro_number is
  'Nº do registro/portaria INMETRO do modelo (ex.: 008649/2024). Alimenta as tags {inmetro_modulo} e {inmetro_inversor}.';

select 'equipment_catalog.inmetro_number' as item,
       (select data_type from information_schema.columns
         where table_schema='public' and table_name='equipment_catalog'
           and column_name='inmetro_number') as detalhe;
