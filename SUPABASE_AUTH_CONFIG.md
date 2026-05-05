# Configuração do Supabase Auth — GD Manager Energy

## Para o fluxo "Esqueci minha senha" funcionar corretamente

---

## 1. Authentication → URL Configuration

No Supabase Dashboard:
**Authentication → URL Configuration**

| Campo | Valor |
|-------|-------|
| **Site URL** | `http://localhost:8080` (dev) ou `https://seudominio.com` (prod) |
| **Redirect URLs** | Adicionar todas as URLs abaixo |

**Redirect URLs a adicionar:**
```
http://localhost:8080/reset-password
http://localhost:5173/reset-password
https://seudominio.com/reset-password
```

> ⚠️ Sem essa configuração, o link de redefinição no e-mail não funcionará.

---

## 2. Authentication → Email Templates

**Authentication → Email Templates → Reset Password**

Verifique se o template está ativo e que o link de redirecionamento no corpo do e-mail usa a variável `{{ .ConfirmationURL }}`.

Exemplo de template mínimo:
```html
<h2>Redefinir sua senha</h2>
<p>Clique no botão abaixo para redefinir sua senha:</p>
<a href="{{ .ConfirmationURL }}">Redefinir senha</a>
<p>Este link expira em 1 hora.</p>
<p>Se você não solicitou a redefinição, ignore este e-mail.</p>
```

---

## 3. Storage — Bucket de Avatares

Criar um bucket público chamado `avatars`:

**Opção A — Via Dashboard:**
1. Supabase Dashboard → **Storage**
2. **New bucket**
3. Nome: `avatars`
4. Marcar como **Public bucket** (ON)
5. Salvar

**Opção B — Via SQL Editor:**
```sql
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;
```

Depois, adicionar as políticas RLS de storage (no SQL Editor):
```sql
-- Usuários podem fazer upload do próprio avatar
CREATE POLICY "Users can upload own avatar"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'avatars'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Usuários podem atualizar o próprio avatar
CREATE POLICY "Users can update own avatar"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'avatars'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Leitura pública (bucket público — automático)
-- Não é necessária policy adicional para leitura em bucket público.
```

---

## 4. Migration de banco de dados

Aplicar a migration `20260420000000_add_profile_phone_avatar.sql` que adiciona:
- `profiles.phone TEXT` — telefone do usuário
- `profiles.avatar_url TEXT` — URL pública do avatar (já existia, migration idempotente)
- `profiles.last_sign_in_at TIMESTAMPTZ` — último acesso (informativo)

**Via Supabase MCP ou SQL Editor:**
```sql
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS last_sign_in_at TIMESTAMPTZ;
```

---

## 5. Variáveis de ambiente (.env)

Confirmar que o `.env` contém:
```env
VITE_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

> O `redirectTo` no código usa `window.location.origin` automaticamente,
> então não é necessário configurar a URL de produção no código.

---

## Rotas adicionadas

| Rota | Página | Acesso |
|------|--------|--------|
| `/forgot-password` | ForgotPassword.tsx | Pública |
| `/reset-password` | ResetPassword.tsx | Pública |
| `/profile` | Profile.tsx | Autenticado (todos os roles) |

---

*Configurado em 2026-04-20*
