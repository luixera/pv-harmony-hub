# Empresas — Frontend

## Telas / componentes
- `src/pages/admin/Companies.tsx` — lista + dialog de cadastro/edição. Inclui
  `CompanyPricingFields` (precificação) e `LogoUpload` (logo, só ao editar).
- `src/components/admin/CompanyPricingFields.tsx` — seletor de tipo de preço e
  campos por tipo (faixas kWp, faixas fixas de/até, mensalidade).
- `src/components/common/LogoUpload.tsx` — upload reutilizável (bucket
  `tenant-logos`).
- `src/pages/admin/ViewAsCompany.tsx` — admin navega como uma empresa.
- Área da empresa: `/company/projects`, `/company/financial`, e a aba
  "Empresa" no `/profile` (logo próprio).

## Estado
Formulário em estado local; precificação via `PricingState`. Logo persiste
imediatamente ao trocar.
