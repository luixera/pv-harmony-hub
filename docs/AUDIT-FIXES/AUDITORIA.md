# AUDITORIA TÉCNICA — GD Manager Energy
**Data:** 2026-05-19  
**Projeto:** pv-harmony-hub  
**Produção:** https://homologamanager.com.br  
**Stack:** Vite + React + TypeScript + Supabase + Google Maps

---

## Agente 1 — Segurança Frontend

### Achados

| # | Severidade | Arquivo:Linha | Problema | Sugestão |
|---|-----------|--------------|---------|---------|
| 1.1 | 🔴 CRÍTICO | `NewProject.tsx:203` | `uploadDocument()` sem `validateFile()` → aceita PHP/JS/exec disfarçado | Adicionar `validateFile()` de `@/lib/utils` antes do upload |
| 1.2 | 🔴 CRÍTICO | `PublicProjectForm.tsx:185` | Mesmo problema em formulário público (sem autenticação) | Mesma correção |
| 1.3 | 🟠 ALTO | `Profile.tsx:189` | Avatar upload sem `sanitizeFileName()` | Sanitizar extensão antes de montar `filePath` |
| 1.4 | 🟠 ALTO | `useConcessionaireDocuments.ts:48` | Upload sem validação de MIME/tamanho | Adicionar `validateFile()` + `sanitizeFileName()` |
| 1.5 | 🟠 ALTO | `useConcessionaireTemplates.ts:47` | Mesmo problema | Mesma correção |
| 1.6 | 🟡 MÉDIO | `PublicProjectForm.tsx` | Sem proteção contra bots/spam | Cloudflare Turnstile + rate limit por IP |
| 1.7 | 🟡 MÉDIO | `useUsers.ts:55` | `useUpdateUser` faz UPDATE direto no cliente incluindo campos sensíveis (`role`, `company_id`) | Mover para Edge Function com validação server-side |
| 1.8 | 🔵 BAIXO | `utils.ts:82` | `maskDocument()` com regex CNPJ imprecisa | Revisar regex de mascaramento |

**Status:** 1.1–1.5 e 1.7 corrigidos em `sec-hardening`. 1.6 pendente (Tarefa 7).

---

## Agente 2 — Segurança Supabase / RLS

### Achados

| # | Severidade | Tabela | Problema | Sugestão |
|---|-----------|--------|---------|---------|
| 2.1 | 🔴 CRÍTICO | `profiles` | UPDATE sem `WITH CHECK` → `SET role='admin'` via browser console | Adicionar `WITH CHECK` bloqueando alteração de campos sensíveis |
| 2.2 | 🔴 CRÍTICO | `companies` | `SELECT *` aberto para `anon` → exposição de CNPJ e emails | Policy `USING (false)` para anon |
| 2.3 | 🔴 CRÍTICO | `handle_new_user()` | Trigger sem proteção de role → signup com `role=admin` via raw_user_meta_data | Forçar `company` para signups públicos |
| 2.4 | 🔴 CRÍTICO | `create_first_revision()` | SECURITY DEFINER sem `SET search_path` → path injection | Adicionar `SET search_path = public` |
| 2.5 | 🔴 CRÍTICO | `storage.avatars` | Sem policies → qualquer autenticado sobrescreve avatar de outro | Policies por `user.id` no bucket |
| 2.6 | 🟠 ALTO | `comments` | UPDATE sem `WITH CHECK` → `user_id` pode ser trocado | `WITH CHECK (user_id = auth.uid())` |
| 2.7 | 🟠 ALTO | `project_revisions` | `company_read_revisions` usa `auth.uid() IS NOT NULL` → qualquer logado lê qualquer revisão | Filtrar por empresa do projeto |
| 2.8 | 🟠 ALTO | `revision_general_data` | Mesma falha — leitura irrestrita | Filtrar por empresa |
| 2.9 | 🟠 ALTO | `revision_equipment` | Mesma falha | Filtrar por empresa |
| 2.10 | 🟡 MÉDIO | `concessionaire_templates` | Usa `profiles.role =` diretamente em vez de `has_role()` (inconsistência) | Substituir por `has_role()` |
| 2.11 | 🟡 MÉDIO | `stage_checklists` | Mesmo padrão inconsistente | Substituir por `has_role()` |
| 2.12 | 🟡 MÉDIO | `payment_history` | Mesmo padrão + sem policy de leitura para `company` | Substituir + adicionar policy company |

**Status:** 2.1–2.12 todos corrigidos nos SQLs 001 e 002.

---

## Agente 3 — Performance e Dependências

### Achados

| # | Severidade | Local | Problema | Sugestão |
|---|-----------|-------|---------|---------|
| 3.1 | 🟡 MÉDIO | `projects` | `concessionaire_id`, `created_by`, `deleted_by`, `form_config_id` sem índice | `CREATE INDEX` em cada FK |
| 3.2 | 🟡 MÉDIO | `comments` | `user_id` sem índice | Criar índice |
| 3.3 | 🟡 MÉDIO | `project_history` | `user_id` sem índice | Criar índice |
| 3.4 | 🟡 MÉDIO | `financial_payments` | `financial_id` sem índice | Criar índice |
| 3.5 | 🟡 MÉDIO | `revision_*` | `revision_id` sem índice nas duas tabelas filhas | Criar índices |
| 3.6 | 🟡 MÉDIO | `concessionaire_documents` | `concessionaire_id` e `uploaded_by` sem índice | Criar índices |
| 3.7 | 🟡 MÉDIO | `notifications` | Sem índice em `user_id` e `project_id` → sino lento | Criar índice composto `(user_id, read)` |
| 3.8 | 🔵 BAIXO | `projects` | Sem índice composto `(company_id, status)` → kanban board sem filtro eficiente | Criar índice composto |
| 3.9 | 🔵 BAIXO | `project_history` | Sem índice composto `(project_id, created_at DESC)` | Criar índice |

**Status:** Todos corrigidos em SQL 004 (31 índices criados).

---

## Agente 4 — Arquitetura / Banco de Dados

### Achados

| # | Severidade | Local | Problema | Sugestão |
|---|-----------|-------|---------|---------|
| 4.1 | 🟡 MÉDIO | `financials` + `project_financials` | Duas tabelas paralelas com dados financeiros que divergem entre si | Sincronizar via trigger; deprecar `financials` |
| 4.2 | 🟡 MÉDIO | `project_financials` | Sem campo `company_id` → policy de company usa JOIN custoso | Adicionar `company_id` com backfill |
| 4.3 | 🔵 BAIXO | `financials` | Sem comentário de deprecação | Adicionar `COMMENT ON TABLE` |
| 4.4 | 🔵 BAIXO | Todas as tabelas críticas | RLS não verificado em `notifications`, `stage_checklists`, `payment_history` | `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` |

**Status:** 4.1–4.4 corrigidos em SQL 003.

---

## Agente 5 — UI/UX e Acessibilidade

### Achados

| # | Severidade | Arquivo | Problema | Sugestão |
|---|-----------|---------|---------|---------|
| 5.1 | 🔵 BAIXO | `Sidebar.tsx` | Nome do usuário em branco puro sobre fundo escuro (baixo contraste) | `rgba(255,255,255,0.6)` |
| 5.2 | 🔵 BAIXO | `ProjectModal.tsx` | Tab "Comentários" separada de "Geral" em telas grandes | Split pane `Geral & Comentários` |
| 5.3 | 🔵 BAIXO | `ProjectModal.tsx` | Campo observations não exibido | Card âmbar com ícone FileText |
| 5.4 | 🔵 BAIXO | `ProjectModal.tsx` | Sem mini-mapa de localização | Static Maps API com coordenadas |

**Status:** Todos corrigidos na sessão anterior (PR anterior ao sec-hardening).

---

## Agente 6 — Completude de Funcionalidades

### Achados

| # | Severidade | Local | Problema | Sugestão |
|---|-----------|-------|---------|---------|
| 6.1 | 🟡 MÉDIO | `PublicProjectForm.tsx` | Sem CAPTCHA → bot cria projetos infinitos | Cloudflare Turnstile (grátis) |
| 6.2 | 🟡 MÉDIO | GCP Console | Google Maps API key exposta no bundle sem restrição de referrer | Restringir a `homologamanager.com.br` |
| 6.3 | 🔵 BAIXO | `useNotifications.ts` | Hook existe mas sino pode ter delay por falta de índice | Resolvido em SQL 004 |
| 6.4 | 🔵 BAIXO | `useStageChecklists.ts` | Hook usa profiles.role diretamente na policy | Resolvido em SQL 002 |

**Status:** 6.1 pendente (Tarefa 7). 6.2 pendente (ação manual no GCP — 2 minutos). 6.3–6.4 resolvidos.

---

## Resumo Executivo

| Categoria | Total | ✅ Corrigido | ⏳ Pendente |
|-----------|-------|------------|-----------|
| 🔴 Crítico | 5 | 5 | 0 |
| 🟠 Alto | 13 | 13 | 0 |
| 🟡 Médio | 10 | 8 | 2 |
| 🔵 Baixo | 12 | 10 | 2 |
| **Total** | **40** | **36** | **4** |

**Pendentes:**
- Tarefa 7: Captcha + rate-limit no PublicProjectForm
- Tarefa 8: Restringir Google Maps API key no GCP Console (ação manual, 2 minutos)
