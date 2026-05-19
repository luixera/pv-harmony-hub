# APLICADOS — Registro de Execução
Checklist de tudo que foi aplicado em produção. Atualizado em 2026-05-19.

---

## ✅ Tarefa 1 — SQL 001: Segurança Crítica
**Data:** 2026-05-19  
**Branch/commit:** `sec-hardening`

- [x] Fix 1: `profiles` UPDATE com `WITH CHECK` — role/company_id/active imutáveis pelo usuário
- [x] Fix 2: Policy `Anon cannot select companies directly` — `USING (false)` para anon
- [x] Fix 3: `handle_new_user()` reescrita — força `company` em signups públicos
- [x] Fix 4: `create_first_revision()` com `SET search_path = public`
- [x] Fix 5: Bucket `avatars` com policies restritas por `user.id`

**Testado:** Login ✅ | Criar projeto ✅ | Upload avatar ✅

---

## ✅ Tarefa 2 — SQL 002: Segurança Alta
**Data:** 2026-05-19  
**Aplicado via:** MCP (migration `002_security_high`)

- [x] `comments` UPDATE com `WITH CHECK (user_id = auth.uid())` — previne hijack
- [x] `project_revisions` — 4 policies novas (admin/staff-global/staff-restrito/company-própria)
- [x] `revision_general_data` — policies por empresa (substituiu `auth.uid() IS NOT NULL`)
- [x] `revision_equipment` — idem
- [x] `concessionaire_templates` — substituído `profiles.role =` por `has_role()`
- [x] `stage_checklists` — idem
- [x] `payment_history` — idem + adicionada policy de leitura para `company`

---

## ✅ Tarefa 3 — SQL 003: Limpeza do Banco
**Data:** 2026-05-19  
**Aplicado via:** MCP (migration `003_database_cleanup`)

- [x] `project_financials` — coluna `company_id` adicionada + backfill dos dados de `projects`
- [x] Dados de `financials` migrados para `project_financials` (sem duplicatas)
- [x] Trigger `trg_sync_financials` criado — mantém tabelas sincronizadas
- [x] Policy `Company can view own financials` otimizada (usa `company_id` direto, sem JOIN)
- [x] RLS habilitado em `notifications`, `stage_checklists`, `payment_history`, `project_financials`, `financials`, `financial_payments`
- [x] `COMMENT ON TABLE` adicionado em `financials` (deprecated) e `project_financials`

---

## ✅ Tarefa 4 — SQL 004: Índices de Performance
**Data:** 2026-05-19  
**Aplicado via:** MCP (migrations `004_performance_indexes_sem_financials` + fim do 003)

31 índices criados (todos `CREATE INDEX IF NOT EXISTS`):

**projects:** `concessionaire_id`, `created_by`, `deleted_by` (partial), `form_config_id` (partial)  
**documents:** `uploaded_by` (partial)  
**comments:** `user_id`, `(project_id, created_at DESC)`  
**project_history:** `user_id` (partial), `(project_id, created_at DESC)`  
**financials:** `company_id`  
**financial_payments:** `financial_id`  
**form_configs:** `created_by` (partial)  
**form_field_rules:** `field_id`  
**project_assignments:** `assigned_by` (partial)  
**kanban_models:** `created_by` (partial)  
**company_kanban_model:** `assigned_by` (partial), `kanban_model_id`  
**energy_concessionaires:** `created_by` (partial)  
**concessionaire_documents:** `concessionaire_id`, `uploaded_by` (partial)  
**concessionaire_templates:** `concessionaire_id`, `uploaded_by` (partial)  
**project_revisions:** `created_by` (partial)  
**revision_general_data:** `revision_id`  
**revision_equipment:** `revision_id`  
**project_financials:** `company_id`  
**notifications:** `user_id`, `project_id`, `(user_id, created_at DESC) WHERE read=false`  
**payment_history:** `project_id`, `registered_by`  
**projects (composto):** `(company_id, status) WHERE is_deleted=false`  
**notifications (unread):** `(user_id, created_at DESC) WHERE read=false`

---

## ✅ Tarefa 5 — Refatoração de Uploads
**Data:** 2026-05-19  
**Branch:** `sec-hardening`

- [x] `src/pages/NewProject.tsx` — `uploadDocument()` agora chama `validateFile()` + `sanitizeFileName()`
- [x] `src/pages/PublicProjectForm.tsx` — idem (formulário público)
- [x] `src/pages/Profile.tsx` — avatar upload usa `sanitizeFileName()` na extensão
- [x] `src/hooks/useConcessionaireDocuments.ts` — `validateFile()` + `sanitizeFileName()` adicionados
- [x] `src/hooks/useConcessionaireTemplates.ts` — idem

**Tipos bloqueados:** PHP, JS, executáveis, arquivos > 10 MB  
**Permitidos:** PDF, JPEG, PNG, WebP, GIF, DOCX, XLSX, DOC, XLS

---

## ✅ Tarefa 6 — Edge Function `update-user`
**Data:** 2026-05-19  
**Deploy:** Supabase Edge Functions (ID: `870d0524-a3e0-471e-b58c-23360d95c1f3`)

- [x] `supabase/functions/update-user/index.ts` criado
  - Valida JWT do solicitante
  - Verifica `role = 'admin'` no servidor (não confia no cliente)
  - Whitelist de campos: `name, role, company_id, active, staff_access_mode, hide_company_name, phone`
  - Valida valores de `role` e `staff_access_mode`
  - Usa `service_role` para bypass de RLS controlado
  - Sincroniza `user_roles` quando `role` muda
- [x] `src/hooks/useUsers.ts` — `useUpdateUser` agora chama `supabase.functions.invoke('update-user', ...)`

---

## ⏳ Tarefa 7 — CAPTCHA + Rate-limit (PublicProjectForm)
**Status:** Pendente  
**Responsável:** Dev frontend  

- [ ] `npm install @marsidev/react-turnstile`
- [ ] Criar site key em [dash.cloudflare.com/turnstile](https://dash.cloudflare.com/turnstile)
- [ ] Embed Turnstile em `PublicProjectForm.tsx`
- [ ] Validar token no insert via Edge Function
- [ ] Rate-limit: máx 3 inserts/hora por IP

---

## ⏳ Tarefa 8 — Restringir Google Maps API Key
**Status:** Pendente (ação manual — 2 minutos)  
**Quem:** Bruno (acesso ao Google Cloud Console)

1. GCP → APIs & Services → Credentials → key "gd manager"
2. Application restrictions → HTTP referrers
3. Adicionar:
   - `https://homologamanager.com.br/*`
   - `https://*.homologamanager.com.br/*`
   - `http://localhost:5173/*`
   - `http://localhost:8080/*`
4. API restrictions → Maps JavaScript API, Geocoding API, Static Maps API
5. Save

---

## Verificação pós-deploy

Execute após cada deploy para confirmar que nada quebrou:

```bash
# 1. Site online?
curl -s -o /dev/null -w "%{http_code}" https://homologamanager.com.br/

# 2. Login funciona? (teste manual)
# 3. Criar projeto funciona? (teste manual)
# 4. Upload de documento funciona? (teste manual)
# 5. Visualização de avatar funciona? (teste manual)
```

```sql
-- 6. Confirmar que admin esquecido não existe
SELECT id, email, created_at FROM auth.users WHERE email LIKE '%admin%' OR email LIKE '%test%';

-- 7. Confirmar RLS ativo em todas as tabelas
SELECT tablename, rowsecurity FROM pg_tables
WHERE schemaname = 'public' AND rowsecurity = false;
```
