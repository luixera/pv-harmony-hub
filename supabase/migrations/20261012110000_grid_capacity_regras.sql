-- Grupo 13 do Motor de Engenharia: capacidade de rede e inversão de fluxo.
--
-- Spec §6. Princípio do ADR 0007: os VALORES vivem no banco, o código só
-- conhece as CHAVES, e regra desabilitada ou ausente cai num fallback neutro.
-- O histórico é automático pelo trigger log_engineering_rule_change.
--
-- tenant_id EXPLÍCITO, e não é detalhe: o default da coluna é
-- get_user_tenant_id(auth.uid()), que colocaria as regras no tenant de quem
-- rodou a migração em vez da biblioteca.
--
-- Idempotente pelo NOT EXISTS: reaplicar não duplica.

INSERT INTO public.engineering_rules
  (tenant_id, group_key, rule_key, label, description,
   value_default, value_min, value_max, unit, priority, source)
SELECT t.id, v.group_key, v.rule_key, v.label, v.description,
       v.value_default, v.value_min, v.value_max, v.unit, v.priority, v.source
  FROM public.tenants t
 CROSS JOIN (VALUES
   ('grid_capacity', 'generation_window_start',
    'Início da janela de geração',
    'Hora em que a conta passa a considerar que há sol. O mínimo de carga procurado é o desta janela.',
    9, 5, 12, 'h', 10, 'Regra interna'),
   ('grid_capacity', 'generation_window_end',
    'Fim da janela de geração',
    'Hora em que a janela de geração se encerra.',
    15, 13, 20, 'h', 20, 'Regra interna'),
   ('grid_capacity', 'safety_factor',
    'Fator de segurança sobre a carga mínima',
    'Multiplica a carga mínima diurna estimada antes de comparar com a geração. Abaixo de 1 deixa folga para o erro da estimativa.',
    0.80, 0.50, 1.00, '×', 30, 'Regra interna'),
   ('grid_capacity', 'attention_threshold',
    'Limiar de atenção',
    'A partir desta ocupação da margem o ponto fica âmbar.',
    60, 10, 99, '%', 40, 'Regra interna'),
   ('grid_capacity', 'risk_threshold',
    'Limiar de risco',
    'A partir desta ocupação a margem está esgotada e o ponto fica vermelho.',
    100, 50, 200, '%', 50, 'REN 1.000/2021 (art. 73)'),
   ('grid_capacity', 'power_factor',
    'Fator de potência para converter kVA em kW',
    'Usado quando só a potência aparente nominal do transformador é conhecida.',
    0.92, 0.70, 1.00, '×', 60, 'Regra interna')
 ) AS v(group_key, rule_key, label, description,
        value_default, value_min, value_max, unit, priority, source)
 WHERE t.is_library
   AND NOT EXISTS (
     SELECT 1 FROM public.engineering_rules e
      WHERE e.tenant_id = t.id AND e.group_key = v.group_key AND e.rule_key = v.rule_key
   );
