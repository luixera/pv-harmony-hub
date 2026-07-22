# Empresas — Banco de Dados

## `companies` (19 colunas)
`id, name, cnpj, contact_name, contact_email, contact_phone, public_form_token,
active, created_at, updated_at, tenant_id, logo_url,` + precificação:
`pricing_type` (enum), `pricing_fixed_value`, `pricing_kwp_rate`,
`pricing_tiers` (jsonb), `pricing_monthly_value`, `pricing_monthly_limit`,
`pricing_excess_value`.

- `pricing_type`: `manual | fixed | per_kwp | tiered_kwp | tiered_flat | monthly`.
- `pricing_tiers` guarda dois formatos conforme o tipo:
  - `tiered_kwp`: `[{ up_to, rate }]`
  - `tiered_flat`: `[{ from, to, price }]`

## Constraint
- Único `(tenant_id, cnpj)`.

## Relacionadas
- `company_kanban_model` — modelo de Kanban por empresa.
- `projects.company_id` → `companies.id`.

## RLS
- Isolamento por `tenant_id`. CRUD por admin; empresa lê a própria.

## Storage
- Logo em `tenant-logos/company/{companyId}/logo.ext` (bucket público, escrita
  por política de caminho: admin/staff do tenant dono, ou a própria empresa).
