# Empresas — API / Hooks

## Hooks (`src/hooks/useCompanies.ts`)
- `useCompanies()` — lista as empresas do tenant.
- `useCompany(id)` — uma empresa (com dados de precificação/logo).
- `useCompanyByToken(token)` — resolve a empresa pelo token público (form).
- `createCompany`, `updateCompany` — mutations.

## RPCs (público, por token)
- `get_company_by_public_token(_token)` — dados básicos da empresa.
- `get_company_id_by_token(_token)`.
- `get_company_tenant_logo(_token)` — logo do tenant para o form público.
- `get_concessionaires_for_token(_token)` — concessionárias do tenant.
- `should_hide_company_name(...)` — regra de exibição.

## Precificação
`pricingToPayload`/`pricingFromCompany` em
`src/components/admin/CompanyPricingFields.tsx` convertem estado ↔ colunas.
