# ADR 0003 — Confiança de papel/tenant só em `app_metadata`

**Status:** Aceito · jul/2026

## Contexto
Bug grave: fundadores de tenant eram criados como `company` em vez de `admin`.
Causa: o trigger `handle_new_user` tentava usar `auth.role() = 'service_role'`
(que **nunca** é verdade em inserts do GoTrue) e/ou `user_metadata` (controlado
pelo próprio usuário).

## Decisão
Papel (`role`) e `tenant_id` são gravados em `raw_app_meta_data` (`app_metadata`)
pelo servidor (edge functions `create-user`/`signup-tenant`). O trigger e toda
autorização leem **apenas** `app_metadata`. `user_metadata` nunca decide acesso.

## Consequências
- Um usuário não consegue se auto-promover mexendo em `user_metadata`.
- Edge functions que criam usuários **precisam** passar `app_metadata`.
- Fluxo público (signUp) não escreve `app_metadata` — por isso o autocadastro
  passa pela edge function `signup-tenant`, que define o papel.
