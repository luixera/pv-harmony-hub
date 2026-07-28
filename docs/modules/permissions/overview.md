# Módulo: Permissões (RLS)

## Objetivo
Autorização do sistema: quem enxerga e altera o quê. A barreira principal é a
**RLS no Postgres**; o front apenas esconde/mostra controles.

## Mecanismos
- **RLS RESTRICTIVE `tenant_isolation`** em toda tabela de negócio: combina via
  `AND` com as políticas PERMISSIVE de papel — isolamento inquebrável por tenant.
- **Helpers** (`SECURITY DEFINER`, `search_path` fixo): `is_master`, `has_role`,
  `get_user_role`, `get_user_tenant_id`, `get_user_company_id`,
  `staff_can_access_project`, `tenant_has_access`.
- **RPCs master-only** para o console (`console_*`, `master_tenant_stats`,
  `master_companies_by_tenant`, `master_company_projects`) — gated por
  `is_master`. Ex.: o drill-down "Empresas e projetos" por tenant no `/painel`
  (aba Tenants) cruza tenants **apenas** por estas RPCs, mantendo o "sem bypass"
  de RLS em `companies`/`projects`.
- **Edge functions** com `service_role` (ignoram RLS) verificam o tenant do alvo.

## Papéis
Ver [../../project/permissions.md](../../project/permissions.md) (matriz completa).
`master`, `admin`, `staff` (com `staff_access_mode`), `company`.

## Regras
- **RN-PERM-01** — Sem bypass de master nas políticas de isolamento (ADR 0005).
- **RN-PERM-02** — Confiança só em `app_metadata` (ADR 0003).
- **RN-PERM-03** — Staff `assigned_only` só acessa projetos atribuídos; violação
  gera `forbidden_access`.
- **RN-PERM-04** — Storage: buckets privados (leitura autenticada, escrita
  admin/staff); logos públicos com escrita por política de caminho.

## Auditoria
`fn_audit_row` grava toda alteração sensível em `system_events`. Ver
[../../project/security.md](../../project/security.md).

## Exclusão de tenant (master)

Ação **irreversível**, só no console master (`/painel` → Tenants). Suspender
continua sendo o caminho reversível; excluir apaga de vez.

Camadas:

1. `master_tenant_delete_preview(_tenant_id)` — o que exatamente vai embora
   (projetos, empresas, usuários, documentos, concessionárias, diagramas,
   mensalidades). A UI mostra isso antes de liberar o botão.
2. `master_delete_tenant(_tenant_id, _confirm_name)` — apaga o SQL na ordem
   certa (logs → configurações → projetos → empresas → concessionárias →
   perfis → tenant) e devolve os ids de usuário e os caminhos dos arquivos.
   Recusa: quem não é master, o tenant **biblioteca**, o **próprio tenant** do
   usuário e confirmação com nome diferente.
3. Edge function `delete-tenant` — chama a RPC com o JWT do master e, com a
   service role, apaga os **usuários no Auth** e os **arquivos no Storage**
   (`project-documents` pelos caminhos devolvidos, `tenant-logos/{id}/`).
   O que não puder ser removido volta em `warnings`.

A UI exige o **nome do tenant digitado igual** — o mesmo nome é reconferido no
servidor, então não adianta burlar o campo.

Detalhe de implementação: o gatilho de auditoria (`fn_audit_row`) gravava o
evento de DELETE de `tenants` apontando para o próprio tenant, o que violava a
FK e tornava a exclusão impossível. No DELETE de `tenants` o evento agora vai
sem `tenant_id` (o id continua em `entity_id`).
