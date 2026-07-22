# Módulo: Autenticação

## Objetivo
Autenticar usuários, resolver seu perfil (papel, tenant, empresa) e sustentar a
sessão em toda a SPA. É a base para permissões e isolamento multi-tenant.

## Funcionalidades
- Login por e-mail/senha (Supabase Auth / GoTrue).
- Recuperação e redefinição de senha (`/forgot-password`, `/reset-password`).
- Autocadastro público de tenant (`/cadastro` → edge `signup-tenant`).
- Perfil do usuário em memória via `AuthContext` (papel, tenant, empresa,
  `staffAccessMode`, master).
- Registro de sessão de acesso (IP + geo) no login (`log-session`).
- Captura de login falhado no painel de monitoramento (`log-event`).

## Componentes / arquivos
- `src/contexts/AuthContext.tsx` — provider, `useAuth()`, `login`, `logout`,
  `refreshUser`, `fetchUserProfile`.
- `src/pages/Login.tsx`, `ForgotPassword.tsx`, `ResetPassword.tsx`, `Cadastro.tsx`.
- Edge: `signup-tenant`, `log-session`, `verify-turnstile`.

## Telas
- `/login`, `/cadastro`, `/forgot-password`, `/reset-password`.

## Integrações
- Supabase Auth; Turnstile (CAPTCHA no cadastro/público); ip-api (geo no login).

## Limitações
- Proteção de senha vazada do Supabase ainda **não habilitada** (ver security).

## Melhorias futuras
- MFA; SSO por tenant. Ver [../../project/roadmap.md](../../project/roadmap.md).

Ver: [business-rules.md](business-rules.md) · [database.md](database.md) ·
[api.md](api.md) · [frontend.md](frontend.md) · [flow.md](flow.md).
