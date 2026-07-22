# Autenticação — Banco de Dados

## Tabelas
- **`auth.users`** (schema `auth`, gerenciado pelo Supabase) — credenciais,
  `raw_app_meta_data` (papel/tenant confiáveis), `raw_user_meta_data`.
- **`profiles`** (16 colunas) — espelho do usuário no schema `public`:
  `id` (=`auth.users.id`), `email`, `name`, `role` (`admin|staff|company`),
  `company_id`, `tenant_id`, `is_master`, `active`, `avatar_url`,
  `staff_access_mode` (`global|assigned_only`), `onboarding_completed_at`, …
- **`user_roles`** — mapa auxiliar de papéis (usado por `has_role`).

## Funções / triggers
- `handle_new_user()` — trigger em `auth.users`: cria `profiles` a partir de
  `raw_app_meta_data`.
- `has_role(uuid, user_role)`, `get_user_role(uuid)`, `get_user_tenant_id(uuid)`,
  `get_user_company_id(uuid)`, `is_master(uuid)` — helpers de autorização
  (`SECURITY DEFINER`).

## RLS
- `profiles`: o usuário lê/edita o próprio; admin lê os do seu tenant; master via
  RPCs. Isolamento por `tenant_id`.
