-- Add concessionaire_id field to form configuration
INSERT INTO form_fields (
  form_config_id,
  field_key,
  field_label,
  field_type,
  is_required,
  is_visible,
  helper_text,
  order_index,
  field_group
) VALUES (
  'a0000000-0000-0000-0000-000000000001',
  'concessionaire_id',
  'Concessionária de Energia',
  'select',
  true,
  true,
  'Selecione a concessionária de energia da unidade consumidora',
  10,
  'unidade_consumidora'
);