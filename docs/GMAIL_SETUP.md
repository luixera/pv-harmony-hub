# Configurar Gmail API — GD Manager

## 1. Google Cloud Console

1. Acesse [console.cloud.google.com](https://console.cloud.google.com)
2. Selecione o projeto do GD Manager (ou crie um novo)
3. Menu lateral → **APIs e serviços** → **Biblioteca**
4. Buscar **"Gmail API"** → Ativar

## 2. Criar credenciais OAuth2

1. **APIs e serviços** → **Credenciais**
2. **+ Criar credenciais** → **ID do cliente OAuth 2.0**
3. Tipo de aplicativo: **Aplicativo Web**
4. Nome: `GD Manager Email Agent`
5. URIs de redirecionamento autorizados — adicionar:
   ```
   https://developers.google.com/oauthplayground
   ```
6. Clicar em **Criar**
7. Copiar **Client ID** e **Client Secret**

## 3. Obter Refresh Token

1. Acesse: [developers.google.com/oauthplayground](https://developers.google.com/oauthplayground)
2. Clique na **engrenagem** (⚙) no canto superior direito
3. Marque **"Use your own OAuth credentials"**
4. Cole **Client ID** e **Client Secret**
5. No campo de escopo (Step 1), cole:
   ```
   https://www.googleapis.com/auth/gmail.readonly
   ```
6. Clique em **"Authorize APIs"** → faça login com a conta do Gmail a ser monitorada
7. Na Step 2, clique em **"Exchange authorization code for tokens"**
8. Copie o **Refresh token** exibido

> ⚠️ O Refresh Token **não expira** (a menos que a conta seja desconectada).
> Guarde-o com segurança — ele dá acesso de leitura ao Gmail.

## 4. Configurar no sistema

1. Acesse `/email-updates` → botão **"Configurar"** (apenas admin)
2. Cole as credenciais nos campos:
   - **Email Gmail**: e-mail da conta monitorada
   - **Client ID**: do passo 2
   - **Client Secret**: do passo 2
   - **Refresh Token**: do passo 3
3. Clique em **"Testar conexão"** — aguarde o resultado
4. Se o teste passar ✅, clique em **"Salvar"**

## 5. Configurar Secrets no Supabase

Acesse o **Supabase Dashboard** → **Edge Functions** → **Secrets** e adicione:

| Secret | Valor |
|--------|-------|
| `ANTHROPIC_API_KEY` | Chave da API do Claude (Anthropic) |
| `SUPABASE_SERVICE_ROLE_KEY` | Chave service role do projeto Supabase |

> As credenciais Gmail também podem ser configuradas como secrets (fallback),
> mas prefira o painel `/email-updates` para gerenciamento centralizado.

## 6. Deploy das Edge Functions

```bash
supabase functions deploy scan-emails
supabase functions deploy test-gmail
```

## 7. Configurar Cron Job

Execute o arquivo `supabase/cron-setup.sql` no Supabase SQL Editor para
agendar as varreduras automáticas às 08h e 17h (horário de Brasília).

## Solução de Problemas

| Erro | Causa provável | Solução |
|------|---------------|---------|
| `invalid_client` | Client ID/Secret incorretos | Verificar credenciais no Google Console |
| `invalid_grant` | Refresh Token expirado/revogado | Gerar novo Refresh Token |
| `insufficient_scope` | Escopo incorreto | Refazer autorização com escopo `gmail.readonly` |
| Nenhum email encontrado | Protocolo sem emails nos últimos 3 dias | Normal — varredura procura apenas `newer_than:3d` |
