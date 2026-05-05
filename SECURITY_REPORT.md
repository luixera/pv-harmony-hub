# Relatório de Segurança — GD Manager Energy
## Data: 2026-04-20
## Executado por: Auditoria automatizada + revisão de código

---

## Resumo Executivo

| Categoria | Qtd |
|-----------|-----|
| ❌ Críticas — corrigidas | 3 |
| ⚠️ Atenção — corrigidas | 6 |
| ⚠️ Atenção — ação manual necessária | 2 |
| ✅ OK (sem ação) | 7 |
| 📦 Dependências vulneráveis corrigidas | 14 |
| 📦 Dependências pendentes (breaking change) | 2 |

---

## ❌ Vulnerabilidades Críticas — CORRIGIDAS

### C1 — `.env` não protegido pelo `.gitignore`
**Arquivo:** `.gitignore`
**Risco:** Credenciais Supabase e Google Maps API key poderiam ser
commitadas acidentalmente no repositório Git, expondo-as publicamente.
**Correção aplicada:** Adicionadas entradas `.env`, `.env.local`,
`.env.production`, `.env.staging`, `.env*.local`, `*.env` ao `.gitignore`.

---

### C2 — `switchRole` permitia escalação de privilégio no frontend
**Arquivo:** `src/contexts/AuthContext.tsx`
**Risco:** A função `switchRole` alterava o role do usuário diretamente
na memória do React sem validação no servidor. Um atacante com acesso
ao console do browser poderia chamar `switchRole('admin')` e obter
acesso visual a áreas restritas. Embora o RLS do banco bloqueasse os
dados reais, a UX poderia expor estruturas internas.
**Correção aplicada:** Função `switchRole` completamente removida da
interface `AuthContextType` e da implementação. Confirmado que não havia
chamadas externas a essa função.

---

### C3 — Signed URLs com expiração de 1 hora (3600s)
**Arquivo:** `src/hooks/useDocuments.ts`
**Risco:** URLs assinadas de documentos sensíveis dos projetos tinham
validade de 1 hora. Se uma URL fosse interceptada ou vazada (logs,
histórico do browser), o documento ficaria acessível por muito mais
tempo do que necessário.
**Correção aplicada:** Expiração reduzida de `3600` para `300` segundos
(5 minutos). `staleTime` do React Query ajustado para 4 minutos para
garantir refresh automático antes do vencimento.

---

## ⚠️ Pontos de Atenção — CORRIGIDOS

### A1 — Ausência de validação de tipo MIME e tamanho no upload
**Arquivos:** `src/hooks/useDocuments.ts`, `src/components/forms/DocumentUploadField.tsx`
**Risco:** Qualquer tipo de arquivo poderia ser enviado, incluindo
executáveis, scripts ou arquivos maliciosos. Sem limite de tamanho,
era possível um ataque de negação de serviço por upload de arquivos
muito grandes.
**Correção aplicada:**
- Nova função `validateFile()` em `src/lib/utils.ts` verifica tipo MIME
  (lista branca de tipos permitidos) e tamanho máximo de 10 MB.
- `useDocuments.ts`: validação executada antes de qualquer upload.
- `DocumentUploadField.tsx`: validação no processamento de arquivos
  selecionados pelo usuário.

---

### A2 — Nome de arquivo sem sanitização (path traversal)
**Arquivo:** `src/hooks/useDocuments.ts`
**Risco:** Nomes de arquivo com caracteres especiais como `../`, `..\\`
ou caracteres Unicode poderiam, dependendo da implementação do storage,
causar path traversal ou sobrescrita de arquivos.
**Correção aplicada:** Nova função `sanitizeFileName()` em `src/lib/utils.ts`
remove caracteres especiais, elimina sequências `..` e limita o nome
a 100 caracteres. Aplicada antes de construir o `filePath` no storage.

---

### A3 — Headers de segurança HTTP ausentes
**Arquivo:** `vite.config.ts`
**Risco:** Sem headers como `X-Frame-Options`, `X-Content-Type-Options`
e `X-XSS-Protection`, o app ficava vulnerável a clickjacking,
MIME-sniffing e ataques de script refletido.
**Correção aplicada:** Adicionados headers no servidor de desenvolvimento:
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `X-XSS-Protection: 1; mode=block`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=()`

> **Ação manual necessária:** Esses mesmos headers devem ser configurados
> no servidor de produção (Nginx, Vercel, Netlify ou Supabase Edge).

---

### A4 — Metadata do `index.html` com referência à plataforma de origem
**Arquivo:** `index.html`
**Risco:** Título e meta tags referenciavam "Lovable App", revelando
a plataforma de desenvolvimento e podendo ser usados para fingerprinting.
**Correção aplicada:** Atualizado para "GD Manager Energy" com metadata
correto de título, descrição, og:* e twitter:*.

---

### A5 — 14 vulnerabilidades em dependências npm
**Arquivo:** `package.json` / `node_modules`
**Severidade encontrada:** 10 high, 6 moderate
**Correção aplicada:** Executado `npm audit fix` — 14 vulnerabilidades
corrigidas automaticamente (incluindo `rollup` com path traversal GHSA-mw96
e `yaml` com stack overflow GHSA-48c2).

---

### A6 — Helpers de segurança ausentes em `utils.ts`
**Arquivo:** `src/lib/utils.ts`
**Correção aplicada:** Adicionadas funções:
- `validateFile(file)` — valida MIME e tamanho
- `sanitizeFileName(name)` — previne path traversal
- `sanitizeInput(input)` — escapa HTML (para uso com `innerHTML`)
- `maskDocument(doc, role)` — mascara CPF/CNPJ por role

---

## ⚠️ Ações Manuais Necessárias (não automáticas)

### M1 — Google Maps API Key sem restrição de domínio
**Evidência:** `VITE_GOOGLE_MAPS_API_KEY=AIzaSyATYfWF...` em `.env`
**Risco:** A chave pode ser usada por qualquer domínio para fazer
requisições na conta, gerando custos inesperados.
**Ação:** Acessar Google Cloud Console → APIs & Services → Credentials
→ selecionar a chave → adicionar restrição HTTP referer para o domínio
de produção do app.

---

### M2 — 2 vulnerabilidades npm pendentes (breaking change)
**Pacote:** `esbuild ≤ 0.24.2` / `vite ≤ 6.4.1`
**Severidade:** Moderada (dev server exposto)
**Motivo pendente:** A correção requer atualizar Vite de 6.x para 8.x,
o que pode quebrar a build. Recomendado testar em branch separado.
**Ação:** `npm audit fix --force` em ambiente de staging, testar a
aplicação e — se OK — aplicar em produção.

---

## ✅ Itens Verificados e OK

| Item | Detalhe |
|------|---------|
| **RLS ativo em todas as tabelas** | 25/25 tabelas com `rowsecurity = true` confirmado via SQL |
| **Sem credenciais hardcoded** | Nenhuma senha, token ou API key no código fonte |
| **Sem service_role key no frontend** | `.env` contém apenas `VITE_SUPABASE_PUBLISHABLE_KEY` (anon key) |
| **Edge Function valida role admin** | `create-user/index.ts` verifica `profiles.role = 'admin'` antes de agir |
| **`logout` limpa sessão completamente** | `supabase.auth.signOut()` + reset de `user` e `session` no estado |
| **XSS via JSX** | React escapa automaticamente — nenhum `dangerouslySetInnerHTML` encontrado |
| **`PublicProjectForm` valida token** | `useCompanyByToken(token)` via RPC com `eq('is_active', true)` |
| **Compressão de imagens no upload** | Imagens redimensionadas para máx. 1200px antes do envio |

---

## Recomendações Adicionais

1. **Content Security Policy (CSP):** Implementar header CSP no servidor
   de produção para bloquear scripts inline não autorizados.

2. **Rotação de tokens públicos:** Adicionar funcionalidade de regenerar
   o `public_token` das empresas (para invalidar links antigos se
   necessário).

3. **Auditoria de acesso a documentos:** Adicionar log de acesso a
   documentos sensíveis (quem baixou, quando) para fins de compliance.

4. **2FA para administradores:** Supabase Auth suporta TOTP/2FA — habilitar
   para contas com `role = 'admin'` via Supabase Dashboard.

5. **Monitoramento de anomalias:** Configurar alertas no Supabase para
   picos de requisições suspeitas (muitos logins falhos, muitos uploads).

6. **Mascaramento de CPF/CNPJ:** A função `maskDocument()` foi adicionada
   a `utils.ts`. Aplicar nos campos que exibem CPF/CNPJ para usuários
   com role `staff` ou `company`.

---

## Arquivos Modificados

| Arquivo | Tipo de mudança |
|---------|----------------|
| `.gitignore` | ➕ Entradas para .env |
| `index.html` | ✏️ Metadata corrigido |
| `vite.config.ts` | ➕ Security headers |
| `src/lib/utils.ts` | ➕ validateFile, sanitizeFileName, sanitizeInput, maskDocument |
| `src/contexts/AuthContext.tsx` | 🗑️ Removido switchRole |
| `src/hooks/useDocuments.ts` | ✏️ Expiry 300s, validação e sanitização no upload |
| `src/components/forms/DocumentUploadField.tsx` | ➕ Validação de arquivo |
| `supabase/SECURITY_AUDIT_SUPABASE.sql` | ➕ Queries de auditoria do banco |
| `SECURITY_REPORT.md` | ➕ Este relatório |

---

*Auditoria realizada em 2026-04-20. Próxima revisão recomendada: 90 dias.*
