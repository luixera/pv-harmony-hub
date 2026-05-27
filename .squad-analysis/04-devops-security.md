# DevOps, Infraestrutura & Segurança — GD Manager Energy

**Auditoria:** 2026-05-26
**Escopo:** CI/CD, topologia de deploy, Edge Functions, banco operacional, secrets, observabilidade, performance, segurança (além do já corrigido em SECURITY_REPORT.md de 2026-04-20) e LGPD.
**Tom:** SRE pragmático. Foco no que **ainda não foi tratado**.

---

## Executive Summary

A postura básica de segurança da aplicação (RLS, validação de upload, sanitização, signed URLs curtas, lockdown de `switchRole`) está sólida graças à auditoria de abril/2026 — mas a camada **operacional** está significativamente atrás do nível de maturidade do código. O deploy é um rsync direto em VPS single-node, sem rollback automatizado, sem preview deploys, sem observabilidade (zero Sentry/Datadog/uptime), sem CSP/HSTS em produção, sem auditoria de ações sensíveis no banco, sem 2FA para admins, e sem qualquer artefato LGPD (privacy policy, fluxo de exclusão de dados, DPO). O serviço corre em `root@72.61.223.82` com `nginx`, o que significa que **um deploy ruim derruba produção** e **um host comprometido entrega tudo**. Existem 3 vulnerabilidades acionáveis nas Edge Functions (`test-gmail` é endpoint aberto que aceita credenciais IMAP arbitrárias, `verify-turnstile` faz fail-open se secret faltar, `scan-emails`/`test-gmail` deployados com `--no-verify-jwt`). Recomendação: priorizar nas próximas 4 semanas (a) migrar o frontend para Cloudflare Pages/Vercel, (b) instrumentar Sentry + UptimeRobot, (c) corrigir o trio de Edge Functions, e (d) publicar Privacy Policy + Termos para fechar o gap LGPD antes do próximo onboarding de cliente B2B.

---

## Risk Matrix

| Severidade | Itens | Resumo |
|------------|-------|--------|
| **Critical** | I-01, I-02, I-03 | `test-gmail` aberto + fail-open Turnstile + secrets dependendo de `current_setting` no pg_cron |
| **High**     | I-04, I-05, I-06, I-07 | Sem observabilidade, sem rollback, sem CSP em produção, sem 2FA admin |
| **Medium**   | I-08, I-09, I-10, I-11, I-12 | LGPD gaps, sem audit log, sem code splitting, sem backup test, pg_cron único ponto |
| **Low**      | I-13, I-14, I-15 | `lovable-tagger` resíduo, smoke test fraco, sem `.dockerignore`/lockfile dual (npm+bun) |

---

## Findings

### I-01 — `test-gmail` é endpoint público que aceita qualquer email/app-password (CRITICAL)
**Onde:** `supabase/functions/test-gmail/index.ts` + `supabase/config.toml` (sem `verify_jwt` → default era false na migração; workflow força `--no-verify-jwt`).
**Risco:** Qualquer pessoa na internet pode POSTar `{email, appPassword}` para o endpoint e a função tenta conectar IMAP no Gmail. Isso transforma a Edge Function em um **oráculo de credenciais Gmail** (atacante valida pares email/app-password contra Gmail usando a infra do projeto e ainda gravando o resultado em `agent_config`). Acesso público + integração que escreve no banco = abuso garantido.
**Fix:** Adicionar `verify_jwt = true` no `config.toml` para `test-gmail` e validar `profile.role === 'admin'` no início da função, idêntico ao padrão de `create-user`. Remover `--no-verify-jwt` do workflow.

---

### I-02 — `verify-turnstile` faz fail-open quando `TURNSTILE_SECRET_KEY` não está setado (CRITICAL)
**Onde:** `supabase/functions/verify-turnstile/index.ts` linhas 47-51 (`console.warn('... pulando verificação (modo dev)')`).
**Risco:** Se o secret expirar/for removido/nunca for setado no projeto Supabase, a verificação CAPTCHA é silenciosamente pulada e o rate-limit por IP também não roda (está dentro do mesmo `else`). Resultado: spam ilimitado via `PublicProjectForm` sem nenhum sinal de alarme.
**Fix:** Fail-closed em produção — retornar 503 se `TURNSTILE_SECRET_KEY` for nulo. Para dev local usar `ENV === 'development'` explicitamente. Bonus: emitir log estruturado + criar alerta no Supabase Logs.

---

### I-03 — Bypass de RLS via `gte('company_id', '')` no rate-limit (CRITICAL/edge case)
**Onde:** `supabase/functions/verify-turnstile/index.ts` linha 92 (`.eq('company_id', companyId ?? '')`).
**Risco:** Se o caller chamar sem `companyId` (frontend bug ou request manual), faz `eq('company_id', '')` que retorna 0 sempre. Pior: o rate-limit conta por **company_id** e não por **IP**, então um atacante simplesmente alterna companies/tokens para escapar do limite de 3/hora. Não há proteção real por IP, apesar do comentário "Rate-limit por IP".
**Fix:** Criar tabela `public_form_rate_limits (ip, company_id, ts)` com índice composto e contar por IP nos últimos 60 min. Rejeitar se `companyId` for falsy.

---

### I-04 — Zero observabilidade (HIGH)
**Onde:** ausente — sem `sentry`, `posthog`, `datadog`, `logRocket` no `package.json`. Edge Functions só `console.log/error`. Sem UptimeRobot/StatusCake nem health endpoint.
**Risco:** Bugs em produção só aparecem quando usuário liga reclamando. Crashes do React não são reportados. Site offline pode passar horas sem ninguém notar. Já houve outages? Não há como saber.
**Fix:**
- Adicionar `@sentry/react` no frontend (free tier 5k events/mês) com `Sentry.ErrorBoundary` no `App.tsx`.
- Logar erros das Edge Functions via `Sentry.captureException` (Sentry SDK funciona em Deno).
- Configurar UptimeRobot grátis (5 min interval) em `https://homologamanager.com.br/` e endpoint `/healthz` (criar).
- Webhook para Discord/Slack/Telegram nos alertas.

---

### I-05 — Sem rollback automatizado e sem deploy atômico (HIGH)
**Onde:** `.github/workflows/deploy.yml` linhas 75-78 (`rsync --delete dist/ ...`).
**Risco:** Deploy é destrutivo: `rsync --delete` apaga arquivos do servidor enquanto sobe os novos → janela de ~5-30s onde o `index.html` aponta para chunks que ainda não existem (404 nos `index-[hash].js`). Pior: se `npm run build` quebrar parcialmente um chunk, **não há rollback** — precisa esperar o próximo push. Smoke test (linha 89) só checa HTTP 200 na `/`, não verifica que os assets carregam.
**Fix opção A (rápido):** Deploy para `/var/www/pv-harmony-hub/releases/$SHA/`, symlink atômico `current -> releases/$SHA`, manter últimos 5 releases para `ln -sfn` rollback em <1s.
**Fix opção B (recomendado):** Migrar frontend estático para **Cloudflare Pages** ou **Vercel Hobby** (grátis). Ganhos: zero-downtime, preview URL por PR, CDN global, SSL automático, rollback 1-click no dashboard. VPS some completamente. Backend Supabase já está na nuvem, então não há servidor pra manter.

---

### I-06 — Headers de segurança configurados só no Vite dev (HIGH)
**Onde:** `vite.config.ts` linhas 11-17 — headers só aplicam ao dev server. Em produção o `nginx` no VPS provavelmente NÃO replica esses headers (SECURITY_REPORT linha 96 já alertava "Ação manual necessária"). Sem CSP, HSTS, COOP, COEP.
**Risco:** clickjacking, MIME sniffing, mixed content, XSS injection se algum dia entrar `dangerouslySetInnerHTML`. Não bate em PCI/SOC2 baselines.
**Fix:** Adicionar bloco no `nginx.conf` (e versionar fora do servidor em `infra/nginx.conf` ou similar):
```nginx
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "DENY" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=(self)" always;
add_header Content-Security-Policy "default-src 'self'; script-src 'self' https://challenges.cloudflare.com https://maps.googleapis.com; connect-src 'self' https://*.supabase.co https://challenges.cloudflare.com https://maps.googleapis.com; img-src 'self' data: blob: https:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; frame-src https://challenges.cloudflare.com" always;
```
Se migrar para Cloudflare Pages, basta `_headers` file.

---

### I-07 — Sem 2FA para admins (HIGH)
**Onde:** `SUPABASE_AUTH_CONFIG.md` não menciona MFA. Sem hook que cheque `aal2`.
**Risco:** Conta admin (que pode criar/excluir usuários, ver todos os documentos via service_role indireto) protegida apenas por senha. Phishing simples = take-over total.
**Fix:**
1. Habilitar TOTP no Supabase Auth → Settings → MFA.
2. Adicionar componente `MfaEnrollment.tsx` no `/profile` para roles `admin`/`staff`.
3. Middleware/route guard que verifica `session.aal === 'aal2'` antes de liberar `/dashboard/admin*` para admins.

---

### I-08 — Zero artefatos de LGPD (MEDIUM)
**Onde:** ausente — sem rota `/privacy`, sem `/terms`, sem fluxo de "exportar meus dados", sem fluxo de "excluir minha conta", sem banner de consentimento, sem DPO no rodapé.
**Risco:** GD Manager é SaaS B2B brasileiro lidando com **CPF/CNPJ de pessoas físicas** (titulares de UC, donos da casa onde fica o gerador). Isso é dado pessoal nos termos da LGPD (Art. 5º). Sem privacy policy o app está em descumprimento direto do Art. 9º (transparência), Art. 18 (direitos do titular) e Art. 41 (DPO). Multa pode chegar a 2% do faturamento.
**Fix:**
- Criar páginas estáticas `src/pages/Privacy.tsx` e `src/pages/Terms.tsx` (rotas públicas).
- Botão "Exportar meus dados" no `/profile` que chama Edge Function `export-my-data` → JSON ZIP com tudo do user.
- Botão "Excluir minha conta" → Edge Function que chama `delete-user` para o próprio uid (com confirmação por email).
- Rodapé global com link Privacy + email DPO (mesmo que seja o admin atual: `dpo@homologamanager.com.br`).
- Cookie banner: como o app não usa cookies de terceiros pesados (só auth do Supabase, que é "estritamente necessário"), basta um banner simples ou pular se confirmar zero analytics.

---

### I-09 — Sem audit log de ações sensíveis (MEDIUM)
**Onde:** existe `project_history` (linhas 155-164 de `useProjects.ts`) mas é apenas para mudanças de status de projeto, não para **download de documento**, **mudança de role**, **exclusão de usuário**, **mudança de financeiro**.
**Risco:** Em incidente de segurança ou disputa contratual, não há trilha "quem baixou esse boletim de UC no dia X". O `SECURITY_REPORT.md` já recomendou isso em "Recomendações Adicionais #3" e ainda não foi feito.
**Fix:** Criar tabela `audit_log (id, user_id, action, resource_type, resource_id, metadata jsonb, ip, user_agent, created_at)` com policy `admin-only SELECT`. Trigger automático em `documents` (após `SELECT` via RPC wrapper, ou logar no `useDocumentUrl` mutation). Inserir em `delete-user`, `update-user` quando `role` muda.

---

### I-10 — Sem code splitting / bundle analysis (MEDIUM)
**Onde:** `vite.config.ts` não tem `build.rollupOptions.output.manualChunks`. Dependências pesadas no `package.json`:
- `@react-google-maps/api` (~400 KB)
- `recharts` (~350 KB)
- `framer-motion` (~150 KB)
- `html2canvas` + `jspdf` + `html2pdf.js` (~600 KB combinado)
- `mammoth` + `docxtemplater` + `pizzip` (~500 KB)
- `@hello-pangea/dnd` (~120 KB)

Tudo isso provavelmente cai num único `index-[hash].js` enviado para **todo usuário no primeiro load**, inclusive o usuário `company` que nunca vai ver o kanban ou gerar PDF.
**Fix:** `React.lazy()` nas rotas grandes (`/dashboard/admin/reports`, `/dashboard/admin/kanban`, geradores de PDF/docx). Adicionar `vite-bundle-visualizer` como devDep, rodar e fazer split por feature.

---

### I-11 — Sem teste documentado de restore de backup do Supabase (MEDIUM)
**Onde:** `RESTORE_POINT_2026-05-19.md` linha 200 menciona "Supabase mantém backups automáticos diários" — verdadeiro **só no plano Pro** (não no Free). Não há registro de **restore drill** já executado.
**Risco:** Backup que nunca foi testado não é backup. Se o projeto está no plano Free, backup é Point-in-Time só com upgrade, e mesmo no Pro a restauração apaga dados pós-snapshot (linha 203 confirma).
**Fix:**
- Confirmar tier atual do Supabase no Dashboard → Settings → Billing.
- Se Free, planejar upgrade (US$ 25/mês Pro) **antes** que algum cliente entre.
- Trimestralmente: restaurar backup em projeto Supabase staging, validar 5 queries-chave, documentar tempo de RTO/RPO.

---

### I-12 — `pg_cron` depende de `current_setting('app.service_role_key')` (MEDIUM)
**Onde:** `supabase/cron-setup.sql` linhas 19-25.
**Risco:** Esses settings (`app.supabase_url`, `app.service_role_key`) precisam ser definidos manualmente via `ALTER DATABASE postgres SET app.service_role_key = '...'` ou similar. Não está documentado onde nem como, e se o projeto Supabase for restaurado o cron quebra silenciosamente. Service role key armazenada como GUC = qualquer extension consegue ler.
**Fix:**
- Documentar o setup em `supabase/cron-setup.sql` no topo (já há um comentário, mas falta o `ALTER DATABASE`).
- Alternativa robusta: usar **Supabase Cron** (recurso oficial do Dashboard, GA em 2025) que injeta auth automaticamente sem GUC.
- Adicionar monitor: se `email_scan_runs` ficar >24h sem nova linha, alerta.

---

### I-13 — `lovable-tagger` ainda no devDeps em produção (LOW)
**Onde:** `package.json` linha 87 + `vite.config.ts` linha 4 (`mode === "development" && componentTagger()`).
**Risco:** Resíduo do Lovable que dá fingerprinting. Embora condicional para dev, ainda existe no `node_modules` da CI e fica em `package.json` público (já que `index.html` foi limpo, mas atacante pode olhar dependencies).
**Fix:** `npm uninstall lovable-tagger` + remover import do `vite.config.ts`.

---

### I-14 — Smoke test pós-deploy é trivial (LOW)
**Onde:** `.github/workflows/deploy.yml` linhas 86-95 — só `curl -o /dev/null -w "%{http_code}"` na raiz.
**Risco:** Index HTML pode retornar 200 mesmo com bundle quebrado, ou pior, servir versão velha enquanto chunks novos não estão lá.
**Fix:** Pegar o asset principal do `index.html` e validar HTTP 200 nele também. Ou rodar Playwright `await page.goto('/login'); await page.waitForSelector('input[type=email]')` (10 segundos extra no CI).

---

### I-15 — Lockfile duplicado e gerenciador inconsistente (LOW)
**Onde:** repo tem **`bun.lockb` (198 KB)** + **`package-lock.json` (275 KB)**. Workflow usa `npm ci` (linha 56 do deploy.yml).
**Risco:** Duas fontes de verdade para resolução de dependências. Se alguém roda `bun install` localmente fica diferente do CI. Pode introduzir bug "funciona na minha máquina".
**Fix:** Escolher um (recomendo `npm` já que o CI usa) e remover o outro. Adicionar `engines.npm` no `package.json` + `.nvmrc`.

---

## Hardening Roadmap

### 30 dias (do urgente ao não-negociável)
1. **Corrigir I-01, I-02, I-03** (Edge Functions críticas) — 1 dia.
2. **Sentry frontend + Edge Functions** (I-04 parcial) — 1 dia.
3. **UptimeRobot** monitorando `/` e nova rota `/healthz` (I-04 parcial) — 30 min.
4. **CSP/HSTS no nginx de produção** (I-06) — 1 dia (testando que não quebra Google Maps/Turnstile).
5. **Publicar Privacy Policy + Termos + rodapé com DPO** (I-08 mínimo viável) — 2 dias.
6. **Confirmar tier Supabase, ligar PITR se Pro** (I-11) — 30 min.
7. **`.nvmrc` + remover `bun.lockb`** (I-15) — 15 min.

### 60 dias (estabilidade operacional)
8. **Deploy atômico** com `releases/$SHA` + symlink + rollback script (I-05 opção A) — 1 dia.
9. **2FA TOTP para admin** com middleware AAL2 (I-07) — 3 dias.
10. **Audit log table** + triggers/inserts nos pontos sensíveis (I-09) — 2 dias.
11. **Fluxo "Exportar/Excluir meus dados"** (I-08 LGPD completo) — 3 dias.
12. **Restore drill documentado** (I-11) — 1 dia (incluindo runbook).
13. **Migração `pg_cron` → Supabase Cron oficial** (I-12) — 1 dia.

### 90 dias (excelência)
14. **Migrar frontend para Cloudflare Pages** (I-05 opção B) — 2 dias, com janela de cutover; ganhos de CDN, preview deploys, zero VPS.
15. **Code splitting + lazy routes + bundle visualizer no CI** (I-10) — 2 dias.
16. **WAF na frente do Supabase Functions** (Cloudflare Workers Proxy) com rate-limit global — 2 dias.
17. **Penetration test externo** (alguém de fora do time roda Burp/ZAP) — contratar, ~1 semana.
18. **Backup encriptado off-site** (`supabase db dump` semanal → S3/R2) — 1 dia.
19. **Runbook de incidentes**: quem é on-call, como reverter, como restaurar banco, contatos de cliente — 1 dia.

---

## Quick Wins this week

1. **Trocar `--no-verify-jwt` por `verify_jwt = true`** e adicionar check de admin em `test-gmail` — 30 min, fecha CVE-like crítico.
2. **Fail-closed no `verify-turnstile`** se `TURNSTILE_SECRET_KEY` faltar — 15 min, fecha bypass de CAPTCHA.
3. **Instalar Sentry no frontend** (`@sentry/react` + DSN no `.env`) e envolver `App.tsx` com `Sentry.ErrorBoundary` — 1h.
4. **Cadastrar `homologamanager.com.br/` no UptimeRobot grátis** com webhook Discord/Slack — 15 min.
5. **Adicionar bloco de headers de segurança no nginx do VPS** (CSP, HSTS, X-Frame-Options) e dar `nginx -t && systemctl reload nginx` — 30 min.

---

## Arquivos referenciados

- `/Users/carloshenriqueborges/Documents/VPS/projetos/pv-harmony-hub/.github/workflows/deploy.yml`
- `/Users/carloshenriqueborges/Documents/VPS/projetos/pv-harmony-hub/supabase/config.toml`
- `/Users/carloshenriqueborges/Documents/VPS/projetos/pv-harmony-hub/supabase/cron-setup.sql`
- `/Users/carloshenriqueborges/Documents/VPS/projetos/pv-harmony-hub/supabase/functions/test-gmail/index.ts`
- `/Users/carloshenriqueborges/Documents/VPS/projetos/pv-harmony-hub/supabase/functions/verify-turnstile/index.ts`
- `/Users/carloshenriqueborges/Documents/VPS/projetos/pv-harmony-hub/supabase/functions/create-user/index.ts`
- `/Users/carloshenriqueborges/Documents/VPS/projetos/pv-harmony-hub/supabase/functions/update-user/index.ts`
- `/Users/carloshenriqueborges/Documents/VPS/projetos/pv-harmony-hub/supabase/functions/delete-user/index.ts`
- `/Users/carloshenriqueborges/Documents/VPS/projetos/pv-harmony-hub/supabase/functions/scan-emails/index.ts`
- `/Users/carloshenriqueborges/Documents/VPS/projetos/pv-harmony-hub/vite.config.ts`
- `/Users/carloshenriqueborges/Documents/VPS/projetos/pv-harmony-hub/package.json`
- `/Users/carloshenriqueborges/Documents/VPS/projetos/pv-harmony-hub/src/lib/utils.ts`
- `/Users/carloshenriqueborges/Documents/VPS/projetos/pv-harmony-hub/src/hooks/useDocuments.ts`
- `/Users/carloshenriqueborges/Documents/VPS/projetos/pv-harmony-hub/SECURITY_REPORT.md`
- `/Users/carloshenriqueborges/Documents/VPS/projetos/pv-harmony-hub/RESTORE_POINT_2026-05-19.md`
- `/Users/carloshenriqueborges/Documents/VPS/projetos/pv-harmony-hub/SUPABASE_AUTH_CONFIG.md`

---

*Auditoria conduzida em 2026-05-26. Próxima revisão recomendada após implementação dos Quick Wins (1 semana).*
