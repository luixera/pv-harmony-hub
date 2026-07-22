# Empresas — Regras de Negócio

- **RN-COMP-01** — Toda empresa pertence a um tenant (`tenant_id`). CNPJ único
  **por tenant** (`(tenant_id, cnpj)`), não global.
- **RN-COMP-02** — Cada empresa tem um `public_form_token` para o link público
  anônimo. O token expõe apenas o necessário (concessionárias do tenant, logo)
  via RPCs validando o token.
- **RN-COMP-03** — A empresa tem uma `pricing_type` que define como o valor de
  cada projeto dela é calculado (ver financial).
- **RN-COMP-04** — Logo da empresa: gravado em `companies.logo_url`, arquivo em
  `tenant-logos/company/{companyId}/logo.ext`. Pode ser enviado pelo admin do
  tenant (dono da empresa) ou pela própria empresa (autoatendimento).
- **RN-COMP-05** — Empresa inativa (`active=false`) não deveria receber novos
  projetos pelo link (validar no fluxo).
- **RN-COMP-06** — Reportagem financeira e projetos da empresa são filtrados por
  `company_id` **e** `tenant_id`.
