# Projetos — Banco de Dados

## Tabela principal
- **`projects`** (19 col.) — `id, code, title, status, company_id, tenant_id,
  concessionaire_id, kanban_model_id, form_config_id, created_by, created_at,
  updated_at, is_deleted, deleted_by, last_status_change, source, …`.
  `source`: `public_form | company_login | admin`.

## Satélites 1:1
- **`project_general_data`** (26 col.) — titular (`holder_name`,
  `holder_cpf_cnpj`, `holder_email`, `holder_phone`), endereço quebrado
  (`address, address_number, address_complement, neighborhood, cep, city,
  state`), `uc_number`, `utility_company`, `phase_type`,
  `circuit_breaker_current`, `coordinates`, `is_rural`, `has_beneficiaries`,
  flags do Claudinho.
  ⚠️ `utility_company` é texto livre gravado como `'A definir'` na criação
  (`NewProject.tsx`/`PublicProjectForm.tsx`) e **não é atualizado em nenhum
  outro fluxo** — não é a concessionária real do projeto. A concessionária de
  verdade é `projects.concessionaire_id` → `energy_concessionaires.name`
  (exposto como `concessionaireName` em `useProjects()`). Um filtro/relatório
  que precisar da concessionária do projeto deve usar `concessionaire_id`,
  nunca `utility_company` (bug corrigido no filtro do Kanban em jul/2026 — ver
  [frontend.md](frontend.md)).
- **`project_equipment`** (14 col.) — `inverter_brand/model/power/quantity`,
  `module_brand/model/power/quantity`, `total_installed_power`,
  `inverter_catalog_id`, `module_catalog_id`.
- **`project_financials`** — valores do projeto (ver financial).

## Relacionadas
- `documents` — anexos (enum `document_type`; ver ocr/reports).
- `project_history` (7 col.) — trilha de ações/etapas com autor.
- `project_assignments` — projetistas atribuídos (`staff_user_id`).
- `project_protocols` — protocolos na concessionária.
- `project_revisions` + `revision_general_data` + `revision_equipment`.
- `comments`, `tasks`, `stage_checklists`.
- Backup: `project_general_data_address_backup` (do split de endereço).

## RLS
Isolamento por `tenant_id`. `staff_can_access_project(...)` respeita
`assigned_only`. `soft_delete_project(...)` para exclusão lógica.
