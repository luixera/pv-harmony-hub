# 📋 Prioridades — o que arrumar e em que ordem

Auditoria fez **6 agentes em paralelo** (segurança frontend, segurança Supabase/RLS, performance/deps, UI/UX, arquitetura, completude). Achado **~80 problemas** no total. Aqui está priorizado.

---

## 🔴 BLOQUEADORES DE PRODUÇÃO — aplicar antes de qualquer cliente real

> Sem isso, qualquer usuário pode virar admin com 1 linha no console do navegador, e qualquer pessoa do mundo pode baixar tua base completa de clientes (CNPJ + emails + tokens). Ataque trivial.

1. **`sql/001_security_critical.sql`** — Aplica e testa antes de qualquer outra coisa
   - Fecha escalação via `UPDATE profiles SET role='admin'`
   - Bloqueia anon `SELECT *` em `companies` (atualmente vazando base inteira)
   - Hardenia trigger `handle_new_user` (signup hijack)
   - `create_first_revision` com `SET search_path`
   - Cria policies storage do bucket `avatars` (estava sem)

2. **Hook `useUpdateUser`** (em `src/hooks/useUsers.ts`)
   - Atualmente permite mudança de `role`, `company_id`, `active` via frontend
   - Mesmo com o SQL acima fechando RLS, é boa prática mover essas mutations pra Edge Function
   - Não tem SQL patch pronto — é refactor de código

3. **Aplicar validação MIME/sanitização nos 5 fluxos de upload**
   - Hoje só `useDocuments.ts` valida. Estes pulam:
     - `pages/NewProject.tsx` (linha ~203)
     - `pages/PublicProjectForm.tsx` (linha ~184)
     - `pages/Profile.tsx` (avatar upload)
     - `hooks/useConcessionaireDocuments.ts`
     - `hooks/useConcessionaireTemplates.ts`
   - Substituir os `uploadDocument` reimplementados pelo hook `useUploadDocument` existente
   - Adicionar captcha + rate-limit no PublicProjectForm

---

## 🟠 ALTA — corrigir em até 30 dias após produção

4. **`sql/002_security_high.sql`** — fecha buracos secundários de RLS
   - Comments UPDATE/DELETE sem `WITH CHECK`
   - Revisions read/insert sem restrição de empresa
   - Policies usando `profiles.role` (devem usar `has_role()`)

5. **Decidir destino das tabelas financeiras** — `sql/003_database_cleanup.sql`
   - Sistema mantém `project_financials` E `financials` em paralelo, com dados não sincronizados
   - Admin escreve em uma, company lê de outra → **valores divergem entre painéis**
   - Patch unifica em `project_financials` e dropa `financials`
   - **ATENÇÃO**: se já tem dados em produção em `financials`, faça backup específico antes

6. **Criar tabelas `notifications`, `stage_checklists`, `payment_history`** — também em `003_database_cleanup.sql`
   - Código já tenta usar essas 3 tabelas (em hooks com mesmo nome)
   - Como não existem, o sino fica vazio, o checklist quebra, o histórico de pagamento não carrega
   - Patch cria as 3 com schemas mínimos + RLS

7. **`sql/004_performance_indexes.sql`** — índices em FKs órfãos
   - DELETE/UPDATE em tabelas pai (companies, profiles) faz seq scan nas filhas
   - 15+ FKs sem índice no schema atual

8. **Configurações no Supabase Dashboard** — ver `supabase-config.md`
   - Limits MIME/tamanho nos buckets
   - Redirect URLs do Auth
   - Desabilitar signup público (default vem ON)

---

## 🟡 MÉDIA — correção contínua

### Estrutura de código
9. Habilitar `tsconfig strict: true` gradualmente
10. Quebrar `ProjectDetail.tsx` (1378 linhas) e `ProjectModal.tsx` (1376 linhas) em sub-componentes
11. Extrair `useCreateProject()` (NewProject e PublicProjectForm duplicam ~140 linhas)
12. Deprecar `src/types/index.ts` (usar `Database['public']['Tables']['xxx']['Row']` do Supabase types)

### UX / Frontend
13. Habilitar dark mode (next-themes está instalado mas sem ThemeProvider)
14. Remover toast duplicado (shadcn + sonner rodando juntos no App.tsx)
15. Adicionar `<ErrorBoundary>` global
16. `queryClient.clear()` no logout
17. `defaultOptions: { staleTime, refetchOnWindowFocus: false }` no QueryClient
18. Sanitizar HTML do `mammoth` com DOMPurify (XSS via template `.docx`)
19. Migrar todos os forms pra `react-hook-form` + Zod (já instalados, não usados)
20. Validação real de CPF/CNPJ (com dígito verificador)
21. Autofill de endereço via ViaCEP

### Performance
22. `React.lazy` em todas as rotas (bundle inicial -250 KB)
23. Remover `RevisionBadge` chamando `useProjectRevisions` por card (N+1 catastrófico no Kanban)
24. Embed `revision_count` na query principal do `useProjects`
25. `manualChunks` no `vite.config.ts` (charts/maps/dnd/motion separados)
26. Mover agregações de `useFinancialDashboard` e `useReports` pra RPCs Postgres
27. Filtrar Realtime channels por `user_id`/`company_id`
28. Remover `html2pdf.js` (duplica `jspdf` no bundle — usar `jspdf+html2canvas` direto)

### Rotas quebradas
29. Rota `/settings` referenciada no Sidebar/Topbar mas não existe → 404
30. Rota `/notifications` mobile bottom nav idem
31. Tela `PublicFormSuccess` promete "receberá email" mas sistema não tem email

---

## 🟢 BAIXA — refinamento e SaaS sério

### Features faltantes prometidas no produto
32. Email transacional (Edge Function + template)
33. Notificações reais (popular `createNotification()` que está morto)
34. Tracking público com `tracking_token` no project (cliente final acompanha sem login)
35. Reset de senha pelo admin
36. Audit log global pro admin (não só por projeto)
37. Stage times reais nos relatórios (calcular de `project_history`)
38. Cadastro estruturado de UCs beneficiárias quando `has_beneficiaries` (caso real comum)

### Mentiras visíveis no UI
39. KPIs hardcoded no `DashboardAdmin.tsx` ("Taxa de Aprovação 98%", "+12%", etc.)
40. `stageTimes` no `useReports.ts` linhas 438-444 hardcoded "2/5/8/12/3 dias"
41. `metaProgress: 89` hardcoded
42. Form público é JSX estático mas existe `/admin/form-config` que finge configurar
43. Filtro de concessionária no Kanban hardcoded (deveria vir de `energy_concessionaires`)

### Compliance / Maturidade
44. LGPD básico (consentimento, política, exclusão de dados)
45. 2FA pra admin
46. Idle timeout
47. Logs de acesso visíveis
48. Testes automatizados (Vitest unit + Playwright E2E)
49. CI/CD (lint, typecheck, build em PRs)
50. Pre-commit hooks

---

## Estatísticas

| Severidade | Quantidade |
|---|---|
| 🔴 Crítico | 9 |
| 🟠 Alto | 19 |
| 🟡 Médio | 23 |
| 🟢 Baixo | 19+ |
| **Total** | **~70** |

## Tempo estimado

| Pacote | Esforço |
|---|---|
| Aplicar `001_security_critical.sql` + testes | 1 hora |
| Aplicar `002_security_high.sql` + testes | 1 hora |
| Refactor uploads (item 3) | 4 horas |
| Aplicar `003_database_cleanup.sql` + migrar dados | 4-6 horas |
| Aplicar `004_performance_indexes.sql` | 30 min |
| Configurações Supabase Dashboard | 30 min |
| Itens médios (frontend) | 1-2 semanas |
| Features faltantes prometidas | 2-3 semanas |
| **Tudo** | **6-8 semanas full-time** |

A maior parte do impacto fica nas primeiras **8 horas** (críticos + altos de RLS + configs Supabase). Depois é refinamento.
