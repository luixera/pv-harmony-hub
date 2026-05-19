# 🔄 Ponto de Restauração — GD Manager Energy
**Data:** 2026-05-19  
**Git Tag:** `restauracao/2026-05-19` (commit `4c20b0f`)  
**Site em produção:** https://homologamanager.com.br  
**Status:** ✅ Sistema estável e seguro

---

## 1. CÓDIGO FONTE (Git)

| Item | Valor |
|------|-------|
| Repositório | https://github.com/luixera/pv-harmony-hub |
| Branch principal | `main` |
| Tag de restauração | `restauracao/2026-05-19` |
| Commit | `4c20b0f` |
| Último commit | `ci: adicionar workflow de deploy automático no main` |

### Como restaurar o código
```bash
git clone https://github.com/luixera/pv-harmony-hub.git
cd pv-harmony-hub
git checkout restauracao/2026-05-19
npm install
npm run dev
```

---

## 2. INFRAESTRUTURA

| Item | Valor |
|------|-------|
| VPS Host | 72.61.223.82 |
| VPS User | root |
| Pasta no servidor | /var/www/pv-harmony-hub/dist |
| Web server | nginx |
| Deploy automático | GitHub Actions → .github/workflows/deploy.yml |

### Como redeploy manual (emergência)
```bash
npm run build
rsync -avz --delete dist/ root@72.61.223.82:/var/www/pv-harmony-hub/dist/
```

---

## 3. SUPABASE — BANCO DE DADOS

| Item | Valor |
|------|-------|
| Project ID | `yqsqrdndvsnhbsoaoilf` |
| Region | us-west-2 |
| URL | https://yqsqrdndvsnhbsoaoilf.supabase.co |
| Dashboard | https://supabase.com/dashboard/project/yqsqrdndvsnhbsoaoilf |

### 3.1 Migrações Aplicadas (20 total)

| # | Versão | Nome |
|---|--------|------|
| 1 | 20260112122354 | *(schema inicial)* |
| 2 | 20260112122442 | *(schema inicial)* |
| 3 | 20260112122806 | *(schema inicial)* |
| 4 | 20260112124448 | *(schema inicial)* |
| 5 | 20260112125625 | *(schema inicial)* |
| 6 | 20260112134832 | *(schema inicial)* |
| 7 | 20260112174133 | *(schema inicial)* |
| 8 | 20260112175226 | *(schema inicial)* |
| 9 | 20260112220531 | *(schema inicial)* |
| 10 | 20260112223207 | *(schema inicial)* |
| 11 | 20260113001106 | *(schema inicial)* |
| 12 | 20260113002532 | *(schema inicial)* |
| 13 | 20260115022648 | *(schema inicial)* |
| 14 | 20260115034045 | *(schema inicial)* |
| 15 | 20260115035542 | *(schema inicial)* |
| 16 | 20260415005529 | add_notifications_and_stage_checklists |
| 17 | 20260415012516 | add_payment_history |
| 18 | 20260415181533 | add_due_date_and_backfill_project_financials |
| 19 | 20260420041818 | comments_type_coordinates |
| 20 | 20260504190233 | add_pendencia_vistoria_to_project_status_enum |

### 3.2 Tabelas (schema public)

| Tabela | RLS | Linhas |
|--------|-----|--------|
| profiles | ✅ | — |
| companies | ✅ | — |
| user_roles | ✅ | — |
| projects | ✅ | — |
| project_general_data | ✅ | — |
| project_equipment | ✅ | — |
| project_financials | ✅ | — |
| project_history | ✅ | 13 |
| project_assignments | ✅ | — |
| project_revisions | ✅ | 6 |
| revision_general_data | ✅ | 6 |
| revision_equipment | ✅ | 6 |
| documents | ✅ | — |
| comments | ✅ | 6 |
| financials | ✅ | — |
| financial_payments | ✅ | — |
| payment_history | ✅ | — |
| form_configs | ✅ | — |
| form_fields | ✅ | — |
| form_field_rules | ✅ | — |
| kanban_models | ✅ | — |
| kanban_columns | ✅ | 1 |
| company_kanban_model | ✅ | — |
| energy_concessionaires | ✅ | — |
| concessionaire_documents | ✅ | — |
| concessionaire_templates | ✅ | — |
| notifications | ✅ | — |
| stage_checklists | ✅ | — |

### 3.3 Storage Buckets

| Bucket | Público | Limite | MIME types |
|--------|---------|--------|------------|
| `project-documents` | ❌ | — | pdf, imagens |
| `concessionaire-documents` | ❌ | — | — |
| `concessionaire-templates` | ❌ | — | — |
| `avatars` | ✅ | 2 MB | jpeg, png, webp |

### 3.4 Enums do Banco

| Enum | Valores |
|------|---------|
| `user_role` | admin, staff, company |
| `project_status` | pending, analysis, documentation, approval, approved, completed, pendencia, vistoria_solicitada |
| `project_source` | company_login, public_form, admin |
| `document_type` | energy_bill_generator, energy_bill_beneficiaries, holder_document, entrance_standard_photo, breaker_photo, other_photos |
| `payment_status` | pending, partial, paid |
| `staff_access_mode` | global, assigned_only |
| `field_type` | text, number, email, phone, cpf, cnpj, cep, select, radio, checkbox, textarea, file, date |
| `condition_operator` | equals, not_equals, contains, is_checked, is_not_checked, is_empty, is_not_empty |
| `field_action` | show, hide, require, optional |

### 3.5 Funções Críticas

| Função | SECURITY | search_path |
|--------|----------|-------------|
| `handle_new_user()` | DEFINER | ✅ public |
| `create_first_revision()` | DEFINER | ✅ public |
| `has_role()` | — | — |
| `get_user_company_id()` | — | — |

---

## 4. VARIÁVEIS DE AMBIENTE (.env)

```env
VITE_SUPABASE_URL=https://yqsqrdndvsnhbsoaoilf.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<ver secrets do GitHub>
VITE_GOOGLE_MAPS_API_KEY=<ver secrets do GitHub>
```

> ⚠️ Os valores reais estão nos **GitHub Secrets** do repositório.
> Nunca commitar o arquivo .env (está no .gitignore).

---

## 5. INTEGRAÇÕES E APIs

| Serviço | Uso | Configuração |
|---------|-----|--------------|
| **Supabase Auth** | Login, reset de senha, sessões | Auth → Settings → Signup desativado |
| **Supabase Storage** | Documentos de projetos, avatares, templates | 4 buckets (ver 3.3) |
| **Google Maps API** | Mapa de projetos, geocodificação, seletor de local | Restrito a homologamanager.com.br |
| **GitHub Actions** | Deploy automático no push para main | .github/workflows/deploy.yml |
| **nginx (VPS)** | Serve o dist/ estático + HTTPS | /etc/nginx/sites-enabled/ |

---

## 6. SEGURANÇA — FIXES APLICADOS (2026-05-19)

- ✅ **Fix 1:** Bloqueio de escalação de privilégio via `UPDATE profiles` (role/company_id imutáveis pelo usuário)
- ✅ **Fix 2:** Anon não pode fazer SELECT direto em `companies`
- ✅ **Fix 3:** `handle_new_user` sempre cria usuários como `company` via signup público
- ✅ **Fix 4:** `create_first_revision` com `SET search_path = public`
- ✅ **Fix 5:** Bucket `avatars` com policies restritas por `user.id`

---

## 7. COMO RESTAURAR (passo a passo)

### 7.1 Restaurar código para esta versão
```bash
git fetch --tags
git checkout restauracao/2026-05-19
npm install && npm run build
```

### 7.2 Redeploy manual para VPS
```bash
rsync -avz --delete dist/ root@72.61.223.82:/var/www/pv-harmony-hub/dist/
ssh root@72.61.223.82 "chown -R www-data:www-data /var/www/pv-harmony-hub/dist"
```

### 7.3 Restaurar banco de dados
O Supabase mantém **backups automáticos diários**.
Para restaurar: Dashboard → Database → Backups → escolher data → Restore.

> ⚠️ Atenção: restaurar o banco apaga dados inseridos após a data do backup.
> Use apenas em último caso.

---

## 8. CONTATOS E ACESSOS

| Recurso | Acesso |
|---------|--------|
| GitHub repo | github.com/luixera/pv-harmony-hub |
| Supabase Dashboard | supabase.com (login com conta do projeto) |
| VPS / nginx | Bruno (admin da infraestrutura) |
| Google Cloud Console | Bruno (restrição da Maps API Key) |

---

*Ponto de restauração gerado automaticamente em 2026-05-19.*
