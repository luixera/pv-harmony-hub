# PRIORIDADES — Auditoria GD Manager Energy

Problemas identificados, agrupados por severidade. Atualizado em 2026-05-19.

## 🔴 CRÍTICO — Corrigir antes de dormir

| # | Problema | Tabela/Arquivo | Fix |
|---|---------|----------------|-----|
| 1 | UPDATE profiles sem WITH CHECK → escalação de privilégio via console | `profiles` | ✅ SQL 001 |
| 2 | SELECT em companies aberto para anon → exposição de CNPJ e emails | `companies` | ✅ SQL 001 |
| 3 | handle_new_user permite hijack de role admin em signup público | `functions` | ✅ SQL 001 |
| 4 | create_first_revision sem SET search_path → vetor SQL injection | `functions` | ✅ SQL 001 |
| 5 | Bucket avatars sem policies → qualquer um sobrescreve foto de outro | `storage` | ✅ SQL 001 |

## 🟠 ALTO — Corrigir esta semana

| # | Problema | Tabela/Arquivo | Fix |
|---|---------|----------------|-----|
| 6 | comments UPDATE sem WITH CHECK → hijack de user_id | `comments` | ✅ SQL 002 |
| 7 | project_revisions leitura aberta a qualquer autenticado (cross-company) | `project_revisions` | ✅ SQL 002 |
| 8 | revision_general_data leitura irrestrita | `revision_general_data` | ✅ SQL 002 |
| 9 | revision_equipment leitura irrestrita | `revision_equipment` | ✅ SQL 002 |
| 10 | concessionaire_templates usa profiles.role direto em vez de has_role() | `concessionaire_templates` | ✅ SQL 002 |
| 11 | stage_checklists usa profiles.role direto | `stage_checklists` | ✅ SQL 002 |
| 12 | payment_history usa profiles.role direto + sem acesso de company | `payment_history` | ✅ SQL 002 |
| 13 | uploadDocument em NewProject.tsx sem validateFile() → PHP disfarçado de PDF | `NewProject.tsx:203` | ✅ Tarefa 5 |
| 14 | uploadDocument em PublicProjectForm.tsx sem validateFile() | `PublicProjectForm.tsx:185` | ✅ Tarefa 5 |
| 15 | Avatar upload em Profile.tsx sem sanitizeFileName() | `Profile.tsx:189` | ✅ Tarefa 5 |
| 16 | useConcessionaireDocuments sem validateFile() + sanitizeFileName() | `useConcessionaireDocuments.ts:48` | ✅ Tarefa 5 |
| 17 | useConcessionaireTemplates sem validateFile() + sanitizeFileName() | `useConcessionaireTemplates.ts:47` | ✅ Tarefa 5 |
| 18 | useUpdateUser faz UPDATE direto em profiles via cliente (role, company_id, active) | `useUsers.ts:55` | ✅ Tarefa 6 |

## 🟡 MÉDIO — Próximo sprint

| # | Problema | Tabela/Arquivo | Status |
|---|---------|----------------|--------|
| 19 | financials e project_financials duplicadas e não sincronizadas | DB | ✅ SQL 003 |
| 20 | 30+ FKs sem índice → table scans em queries frequentes | DB | ✅ SQL 004 |
| 21 | PublicProjectForm sem captcha → spam de projetos fantasma | `PublicProjectForm.tsx` | ⏳ Tarefa 7 |
| 22 | Google Maps API key sem restrição de domínio | GCP Console | ⏳ Tarefa 8 (manual) |
| 23 | Notificações sem índice em user_id (sino lento) | `notifications` | ✅ SQL 004 |
| 24 | company_read_revisions usa auth.uid() IS NOT NULL (qualquer logado lê tudo) | `project_revisions` | ✅ SQL 002 |
| 25 | Sem rate-limit nas Edge Functions | `functions` | ⏳ Futuro |

## 🔵 BAIXO / MELHORIA — Backlog

| # | Problema | Arquivo | Status |
|---|---------|---------|--------|
| 26 | Nome do usuário no sidebar em branco puro (legibilidade) | `Sidebar.tsx` | ✅ Corrigido |
| 27 | Sem AUDITORIA.md referenciado no README | `docs/AUDIT-FIXES/` | ✅ Tarefa 9 |
| 28 | financials sem trigger de sincronização | DB | ✅ SQL 003 |
| 29 | project_financials sem company_id | DB | ✅ SQL 003 |
| 30 | Falta índice composto projects(company_id, status) para kanban | DB | ✅ SQL 004 |
| 31 | Índice parcial em projetos deletados ausente | DB | ✅ SQL 004 |
| 32 | useConcessionaireDocuments sem error handling tipado | `useConcessionaireDocuments.ts` | ⏳ Refactor futuro |
| 33 | Sem CAPTCHA no formulário público | `PublicProjectForm.tsx` | ⏳ Tarefa 7 |
| 34 | Edge Functions sem monitoramento de erros (Sentry/Logflare) | `functions/` | ⏳ Futuro |
| 35 | maskDocument() não mascara CNPJ corretamente para staff | `utils.ts` | ⏳ Futuro |
