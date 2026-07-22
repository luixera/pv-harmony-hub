# ADR 0002 — Back-end serverless no Supabase

**Status:** Aceito

## Contexto
Time pequeno, necessidade de entregar rápido, sem manter infraestrutura de
servidor de aplicação.

## Decisão
Não há back-end próprio. O Supabase provê Postgres + Auth + Storage + Edge
Functions. A lógica de servidor vive em **RPCs SQL** (`SECURITY DEFINER`) e
**Edge Functions (Deno)**. O front é uma SPA estática servida por Nginx na VPS.

## Consequências
- Menos código de infra; RLS centraliza autorização.
- Lógica sensível precisa ir para o banco (triggers/RPCs) ou edge functions —
  não pode ficar só no cliente.
- Dependência forte do Supabase; migrações versionam o schema.
- Deploy do front (VPS) e das funções (Supabase) são passos separados no CI.
