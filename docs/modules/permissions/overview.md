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
- **RPCs master-only** para o console (`console_*`, `master_tenant_stats`) —
  gated por `is_master`.
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
