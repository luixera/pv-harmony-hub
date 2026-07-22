# Autenticação — Frontend

## Contexto
`src/contexts/AuthContext.tsx` expõe `useAuth()`:
`{ user, session, isAuthenticated, isLoading, login, logout, refreshUser }`.

`UserProfile`: `id, email, name, role, companyId, avatar, isActive, isMaster,
tenantId, staffAccessMode`.

`fetchUserProfile(userId)` lê `profiles` e monta o `UserProfile`. `onAuthStateChange`
faz o fetch com `setTimeout(0)` para evitar deadlock do GoTrue.

## Telas
- `Login.tsx` — e-mail/senha; mostra erros amigáveis.
- `ForgotPassword.tsx` / `ResetPassword.tsx`.
- `Cadastro.tsx` — autocadastro de tenant (Turnstile → `signup-tenant`).

## Guarda de rotas
As rotas checam `useAuth()` (autenticado + papel). A barreira real é a RLS; o
front só decide o que exibir.
