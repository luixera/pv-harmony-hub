# Homologação — Banco de Dados

## Concessionárias
- **`energy_concessionaires`** (9 col.) — `id, name, tenant_id, is_active,
  created_by, created_at, updated_at, …`. Único `(tenant_id, name)`.
- **`concessionaire_documents`** — documentos de referência.
- **`concessionaire_templates`** (10 col.) — templates `.docx` (path no bucket
  `concessionaire-templates`), origem/versão (biblioteca).
- **`concessionaire_entry_rules`** (13 col.) — regras de padrão de entrada;
  coluna `extra` (jsonb) para colunas customizadas.

## Kanban / formulários
- **`kanban_models`**, **`kanban_columns`**, **`company_kanban_model`**.
- **`stage_checklists`** — itens por etapa (único por `(tenant_id, ...)`).
- **`form_configs`**, **`form_fields`**, **`form_field_rules`** — formulários
  configuráveis.

## Protocolos
- **`project_protocols`** (8 col.) — número, concessionária, projeto, data.

## RPCs
- `get_kanban_columns`, `get_company_kanban_model_id`,
  `get_concessionaires_for_token` (público), `tenant_library_status`,
  `concessionaire_version`, `set_entry_rule_tenant` (trigger de tenant),
  `match_emails_to_protocols(_tenant_id)` (casa por protocolo, UC ou titular e
  devolve `match_by`/`matched_value`), `project_emails(_project_id)`,
  `txt_norm(texto)`, `holder_name_regex(nome)`.

## Biblioteca (sync)
Edge `sync-library` copia concessionárias + regras + pacote + templates para o
tenant. `signup-tenant` chama no autocadastro.
