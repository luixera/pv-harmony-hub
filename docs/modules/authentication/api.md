# Autenticação — API / Endpoints

## supabase-js
- `supabase.auth.signInWithPassword({ email, password })` — login.
- `supabase.auth.signOut()` — logout.
- `supabase.auth.getSession()` / `onAuthStateChange` — sessão.
- `supabase.auth.resetPasswordForEmail(...)` — recuperação.

## Edge Functions
- `signup-tenant` (POST, público) — cria tenant + fundador `admin` +
  `app_metadata`; semeia a biblioteca. Protegido por Turnstile.
- `log-session` (POST, JWT) — grava sessão de acesso (IP + geo).
- `verify-turnstile` (POST, público) — valida o token do CAPTCHA.
- `log-event` (POST, público, lista fechada) — recebe `login_failed`.

## RPCs relevantes
- `has_role`, `get_user_role`, `get_user_tenant_id`, `get_user_company_id`,
  `is_master` — usadas por políticas e pela app.
