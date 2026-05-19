# 🔐 Configurações que precisam ser feitas no Dashboard Supabase

Não dá pra automatizar via SQL — são configs do painel. Tempo total: ~10 minutos.

Acesse `https://supabase.com/dashboard` → seu projeto.

---

## 1. Desabilitar signup público (CRÍTICO)

**Por quê:** mesmo depois de aplicarmos o `001_security_critical.sql`, se signup público estiver habilitado, atacante pode chamar `POST /auth/v1/signup` diretamente com a anon key e criar usuário. O trigger `handle_new_user` agora força role='company' nesse caso (não vira admin), mas ainda assim seria poluição de usuários.

**Onde:** Authentication → **Providers** → Email
- Desmarcar: **"Allow new users to sign up"** (ou similar — nome muda conforme versão)

Usuários novos passam a ser criados **apenas** via Edge Function `create-user` (que valida que quem chamou é admin).

---

## 2. URL Configuration (já feito se seguiu o passo do texto que mandei)

**Onde:** Authentication → URL Configuration

| Campo | Valor |
|---|---|
| **Site URL** | `https://homologamanager.com.br` |
| **Redirect URLs** | `https://homologamanager.com.br/**`<br>`https://staging.homologamanager.com.br/**`<br>`http://localhost:8080/**`<br>`http://localhost:5173/**` |

> Sem isso, login/reset-senha falham com "URL não autorizada".

---

## 3. Email Templates (recomendado)

**Onde:** Authentication → Email Templates

Personalize ao menos o template **Reset Password** com o nome da empresa. Default vem em inglês "Supabase" — substitua por "Homologa Manager":

```html
<h2>Redefinir senha — Homologa Manager</h2>
<p>Olá,</p>
<p>Recebemos uma solicitação para redefinir sua senha. Se foi você, clique no link:</p>
<p><a href="{{ .ConfirmationURL }}">Redefinir minha senha</a></p>
<p>Este link expira em 1 hora. Se não foi você, ignore este email.</p>
<p>— Equipe Homologa Manager</p>
```

Faça o mesmo para: **Confirm signup**, **Magic Link**, **Change Email Address**.

---

## 4. Limites e MIME types dos buckets (CRÍTICO)

Hoje os buckets aceitam qualquer arquivo de qualquer tamanho — atacante anônimo pode subir `.exe` ou arquivo de 50 GB pelo formulário público e zerar tua cota de storage.

### 4.1 Bucket `avatars`

**Já configurado se aplicou `001_security_critical.sql`.** Verifica:
- Storage → bucket `avatars` → Settings
- File size limit: `2 MB`
- Allowed MIME types: `image/jpeg, image/png, image/webp`

### 4.2 Bucket `project-documents`

**Onde:** Storage → bucket `project-documents` → ⋯ → Edit bucket

| Campo | Valor |
|---|---|
| **File size limit** | `10 MB` |
| **Allowed MIME types** | `application/pdf, image/jpeg, image/png, image/webp` |

### 4.3 Bucket `concessionaire-documents`

**Onde:** Storage → bucket `concessionaire-documents` → ⋯ → Edit bucket

| Campo | Valor |
|---|---|
| **File size limit** | `10 MB` |
| **Allowed MIME types** | `application/pdf, image/jpeg, image/png, image/webp, application/vnd.openxmlformats-officedocument.wordprocessingml.document` |

(O último é o MIME do `.docx` — necessário para templates da concessionária.)

---

## 5. Auth Rate Limiting (recomendado)

**Onde:** Authentication → **Rate Limits** (ou Settings → Auth → Rate Limits, depende da versão)

| Endpoint | Sugestão |
|---|---|
| **Sign up** | `5 / 5min / IP` |
| **Sign in** | `10 / 5min / IP` |
| **Password recovery** | `3 / 5min / IP` |
| **Token refresh** | manter default |

Sem isso, atacante pode forçar bruta as senhas ou floodar emails de "esqueci a senha" (custo na conta SMTP).

---

## 6. Database Backups (verificar)

**Onde:** Database → Backups

- **Daily backups** estão habilitados? (Plano Free só guarda 7 dias)
- Configurar para você (ou amigo) baixar um backup completo **antes** de aplicar qualquer um dos SQLs deste pacote

---

## 7. Auth → Advanced (verificar)

**Onde:** Authentication → Settings

| Setting | Valor sugerido |
|---|---|
| **JWT expiry** | `3600` (1 hora — default OK) |
| **Refresh token rotation** | ✅ Ativado |
| **Reuse interval** | `10` segundos |
| **Auto Confirm** | ❌ Desligado (forçar verificação de email) |

---

## 8. Pra produção séria (opcional, pode deixar pra depois)

- **MFA (2FA)** no Authentication → habilitar para admins
- **Captcha** (hCaptcha ou Turnstile) na Auth → adicionar nas operações sensíveis (signup, signin, reset)
- **Webhooks** pra integrar com sistema de email customizado se ficar caro o SMTP nativo

---

## Checklist final

Depois de aplicar tudo:

- [ ] Signup público desabilitado
- [ ] Site URL = `https://homologamanager.com.br`
- [ ] Redirect URLs incluem prod + staging + localhost
- [ ] Email templates traduzidos
- [ ] 3 buckets com file_size_limit + allowed_mime_types corretos
- [ ] Rate limits aplicados
- [ ] Backup recente baixado
- [ ] Auto Confirm desligado (se quiser verificar email)

Testes pra fazer no app:
- [ ] Cadastro novo via Edge Function admin funciona
- [ ] Cadastro via signup público está bloqueado (deve retornar erro)
- [ ] Login funciona
- [ ] Reset de senha envia email e redireciona pra `https://homologamanager.com.br/reset-password`
- [ ] Upload de avatar de 3 MB falha (limit 2 MB)
- [ ] Upload de avatar PDF falha (MIME não permitido)
- [ ] Upload de documento de projeto PDF 5 MB funciona
