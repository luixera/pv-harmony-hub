# ADR 0001 — Isolamento multi-tenant via RLS RESTRICTIVE

**Status:** Aceito · jul/2026

## Contexto
O produto virou SaaS multi-tenant: várias empresas (BELLATI, CALZETTA, Projeto
Energia, …) usam a mesma base. Precisamos garantir que nenhum dado vaze entre
tenants, sem confiar no cliente.

## Decisão
Toda tabela de negócio recebe `tenant_id` e uma política **RLS RESTRICTIVE**
`tenant_isolation` que exige `tenant_id = get_user_tenant_id(auth.uid())`.
Políticas por papel (PERMISSIVE) combinam via `AND`, então nenhuma consegue
furar o isolamento. Helpers: `get_user_tenant_id`, `is_master`, `has_role`,
`tenant_has_access`.

## Consequências
- Segurança forte por padrão: esquecer um filtro no cliente não vaza dados.
- RPCs `SECURITY DEFINER` que agregam entre tenants (console master) precisam ser
  explicitamente `is_master`-gated.
- Edge functions com `service_role` **ignoram RLS** — devem checar tenant do
  alvo manualmente (ver ADR 0003 e security.md).
