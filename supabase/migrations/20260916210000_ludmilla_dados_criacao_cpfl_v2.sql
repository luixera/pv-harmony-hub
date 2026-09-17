-- Ludmilla — dados para criar o projeto na CPFL, versão completa.
--
-- O roteiro real do formulário "60 - Microgeração Distribuída BT" (gravado em
-- 16/09/2026) pede, além de UC e titular: telefone/e-mail, módulos e inversores
-- com fabricante/modelo, e o padrão de entrada (categoria, fases, cabos,
-- caixa, disjuntor, demanda). A categoria segue a MESMA regra do front
-- (resolveEntryRule): a escolhida à mão vence; senão, menor disjuntor da
-- classe que comporta o do projeto; senão, o maior da classe.

DROP FUNCTION IF EXISTS public.ludmilla_dados_criacao_cpfl(UUID, UUID);

CREATE OR REPLACE FUNCTION public.ludmilla_dados_criacao_cpfl(
  p_run_id     UUID,
  p_project_id UUID
) RETURNS TABLE (
  uc_number          TEXT,
  coordinates        TEXT,
  customer_name      TEXT,
  customer_cpf       TEXT,
  customer_email     TEXT,
  customer_phone     TEXT,
  project_title      TEXT,
  is_rural           BOOLEAN,
  concessionaire     TEXT,
  entry_phase        TEXT,
  entry_breaker      TEXT,
  module_brand       TEXT,
  module_model       TEXT,
  module_quantity    INTEGER,
  module_power_wp    NUMERIC,
  inverter_brand     TEXT,
  inverter_model     TEXT,
  inverter_quantity  INTEGER,
  inverter_power_kw  NUMERIC,
  rule_categoria     TEXT,
  rule_num_fases     SMALLINT,
  rule_bitola        TEXT,
  rule_disjuntor     INTEGER,
  rule_caixa         TEXT,
  rule_extra         JSONB
)
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  WITH base AS (
    SELECT p.id, p.code, p.title, p.concessionaire_id,
           pgd.uc_number, pgd.coordinates, pgd.holder_name, pgd.holder_cpf_cnpj, pgd.holder_email, pgd.holder_phone,
           pgd.is_rural, pgd.phase_type, pgd.circuit_breaker_current, pgd.entry_rule_id,
           CASE lower(coalesce(pgd.phase_type, ''))
             WHEN 'monofasico' THEN 1 WHEN 'bifasico' THEN 2 WHEN 'trifasico' THEN 3 ELSE NULL END AS fases,
           NULLIF(regexp_replace(coalesce(pgd.circuit_breaker_current, ''), '\D', '', 'g'), '')::INTEGER AS amps
      FROM public.portal_sync_runs psr
      JOIN public.projects p ON p.id = p_project_id
      JOIN public.project_general_data pgd ON pgd.project_id = p.id
     WHERE psr.id = p_run_id
       AND (SELECT auth.role()) = 'service_role'
     LIMIT 1
  ),
  regra AS (
    SELECT r.*
      FROM base b
      JOIN public.concessionaire_entry_rules r ON r.id = b.entry_rule_id
    UNION ALL
    SELECT r.*
      FROM base b
      JOIN LATERAL (
        SELECT r.* FROM public.concessionaire_entry_rules r
         WHERE r.concessionaire_id = b.concessionaire_id
           AND b.entry_rule_id IS NULL
           AND (b.fases IS NULL OR r.num_fases = b.fases)
         ORDER BY
           CASE WHEN b.amps IS NULL OR r.disjuntor >= b.amps THEN 0 ELSE 1 END,
           CASE WHEN b.amps IS NULL OR r.disjuntor >= b.amps THEN r.disjuntor ELSE -r.disjuntor END
         LIMIT 1
      ) r ON TRUE
    LIMIT 1
  )
  SELECT
    b.uc_number, b.coordinates, b.holder_name, b.holder_cpf_cnpj, b.holder_email, b.holder_phone,
    COALESCE(NULLIF(trim(b.title), ''), 'UFV ' || b.holder_name, b.code),
    COALESCE(b.is_rural, FALSE),
    ec.name,
    b.phase_type, b.circuit_breaker_current,
    pe.module_brand, pe.module_model, pe.module_quantity, pe.module_power,
    pe.inverter_brand, pe.inverter_model, pe.inverter_quantity, pe.inverter_power,
    r.categoria, r.num_fases, r.bitola, r.disjuntor, r.caixa_medicao, r.extra
  FROM base b
  LEFT JOIN public.project_equipment pe ON pe.project_id = b.id
  LEFT JOIN public.energy_concessionaires ec ON ec.id = b.concessionaire_id
  LEFT JOIN regra r ON TRUE
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.ludmilla_dados_criacao_cpfl(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ludmilla_dados_criacao_cpfl(UUID, UUID)
  TO service_role;
