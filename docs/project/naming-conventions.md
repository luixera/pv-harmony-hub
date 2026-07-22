# Convenções de Nomenclatura

## Banco de dados
- Tabelas: `snake_case`, plural quando coleção (`projects`, `companies`,
  `notification_rules`). Dados 1:1 de projeto usam prefixo `project_`
  (`project_general_data`, `project_equipment`, `project_financials`).
- Colunas: `snake_case`. Chaves estrangeiras: `<entidade>_id` (`tenant_id`,
  `company_id`, `project_id`).
- Funções/RPCs: `snake_case`; helpers de segurança com prefixo claro
  (`is_master`, `has_role`, `get_user_tenant_id`); triggers `fn_*`
  (`fn_set_project_value`, `fn_audit_row`, `fn_set_tenant_id`).
- Enums: `snake_case` singular (`user_role`, `pricing_type`, `document_type`).

## Front-end
- Componentes React: `PascalCase` (`ProjectModal`, `CompanyPricingFields`).
- Hooks: `camelCase` iniciando por `use` (`useProjects`, `useEntryRules`).
- Funções utilitárias: `camelCase` (`buildProjectValues`, `formatCpfCnpj`).
- Constantes de módulo: `SCREAMING_SNAKE` (`TEMPLATE_VARIABLES`,
  `PROJECT_STATUS_LABELS`, `DOC_TYPE_LABELS`).
- Arquivos de página: `PascalCase.tsx` batendo com a tela.

## Storage (caminhos)
- `equipment-documents`: `{equipmentId}/{datasheet|inmetro|afci}/{NOME}.pdf`.
  Nome padronizado `TIPO_MARCA_MODELO`.
- `tenant-logos`: `{tenantId}/logo.{ext}` (tenant) e
  `company/{companyId}/logo.{ext}` (empresa).
- `project-documents`: por projeto/tipo.

## Tags de template (.docx)
- `{snake_case}` em minúsculas. Endereço usa família com prefixo:
  `{endereco}` (junção completa), `{endereco_rua}`, `{endereco_numero}`,
  `{endereco_complemento}`, `{endereco_bairro}`, `{endereco_cep}`,
  `{endereco_cidade}`, `{endereco_estado}`. Catálogo completo em
  `src/utils/projectValues.ts` (`TEMPLATE_VARIABLES`).

## Git
- Branch principal: `main` (deploy automático).
- Mensagens de commit: `tipo(escopo): descrição` em português
  (`feat(titular): ...`, `fix(ci): ...`, `chore(ci): ...`).
- Tags de restauração: `restauracao/AAAA-MM-DD`.
