# Segurança

## Modelo de autorização
- **RLS é a barreira principal.** Toda tabela de negócio tem RLS ligada, com
  políticas PERMISSIVE por papel combinadas a políticas RESTRICTIVE de
  isolamento por tenant (`tenant_isolation`). RESTRICTIVE aplica `AND` — nenhuma
  política de papel consegue furar o isolamento.
- **RPCs `SECURITY DEFINER`** só onde é preciso privilégio controlado
  (agregações do console, tokens públicos, cálculo de valor). Todas fixam
  `search_path` e checam `is_master`/tenant quando aplicável.
- **Edge functions com `service_role`** verificam o tenant do alvo antes de
  agir (ex.: `create/update/delete-user`).

## Confiança de identidade
- Papel e tenant vêm de `raw_app_meta_data` (`app_metadata`), gravado pelo
  servidor. `user_metadata` (controlado pelo usuário) **nunca** decide acesso.
- `handle_new_user` lê `app_metadata` — não `auth.role()` (que nunca é
  `service_role` em inserts do GoTrue) nem `user_metadata`.

## Histórico de correções (auditoria jul/2026)
- **Fundadores criados como `company`** em vez de `admin` → trigger passou a ler
  `app_metadata`.
- **Cross-tenant em `update-user`/`delete-user`** → adicionada verificação de
  tenant do alvo (403 comprovado em ataque real).
- **`energy_concessionaires.name` UNIQUE global** → trocado para
  `(tenant_id, name)`; mesmo padrão em `agent_config`, `email_updates`,
  `projects.code`, `companies.cnpj`, `stage_checklists`.
- **View `agent_config_safe` vazava** o Gmail do GD Manager → recriada com
  `security_invoker=true`.
- **`match_emails_to_protocols()`** cruzava e-mails × projetos sem filtro de
  tenant → adicionado `tenant_id` e parâmetro.
- **Master via dados de todos os tenants no painel comum** → removido o bypass
  `is_master OR ...` de 35 políticas RESTRICTIVE.
- **`project_general_data_address_backup` sem RLS** (criada via `CREATE TABLE
  AS`) → RLS ligada e privilégios revogados de `anon`/`authenticated`.

## Buckets de storage
- Públicos: `avatars`, `tenant-logos` (logos precisam ser lidos sem login, ex.:
  form público e PDF). Escrita restrita por política de caminho.
- Privados: `project-documents`, `concessionaire-documents`,
  `concessionaire-templates`, `equipment-documents`. Leitura por usuário
  autenticado; escrita por admin/staff.
- **`project-documents/public/` não é público.** O prefixo só marca "veio do
  formulário público"; a leitura passa por `documents`→`projects` e confere
  tenant (admin/staff) ou empresa (company). O upload anônimo continua liberado
  — é o que faz o formulário funcionar.

## Auditoria de sigilo entre tenants — ago/2026

Varredura empírica (não só leitura de política): simulando a sessão de um admin
de outro tenant, contando o que cada um dos **58 objetos** de `public` devolve.

- **26 tabelas com `tenant_id`: zero linhas de outro tenant.**
- **32 demais tabelas e views: zero linhas visíveis** para quem não é do tenant
  (inclusive as filhas de projeto, que se isolam indiretamente).
- Compartilhado **de propósito**: `equipment_catalog` (biblioteca central),
  `plans`, `installer_package_presets` (sem `tenant_id`, é global).
- 65 funções `SECURITY DEFINER` expostas ao usuário logado; uma sem checagem:
  `should_hide_company_name(_user_id)` aceita o id de qualquer usuário e
  devolve um booleano. Vaza só isso — sem prioridade, mas fica anotado.

**Achado grave, corrigido**: a política `Anonymous can view public uploads` em
`storage.objects` era `for select to PUBLIC` sobre
`project-documents/public/**` — ou seja, **qualquer pessoa, sem login**, lia os
anexos do formulário público (conta de energia, documento com CPF) de **todos os
tenants**. Medido antes de mexer: 38 arquivos de 2 tenants, visíveis para
visitante anônimo e para o admin de outro tenant. Política removida
(`20260810130000_storage_fecha_leitura_anonima.sql`); depois: anônimo 0, outro
tenant 0, tenant dono 32 (os 6 restantes são do outro tenant — cujo trial,
aliás, está vencido, então ele não acessa nada mesmo).

Fora de escopo desta varredura (é **dentro** do tenant, não entre tenants):
projetista `assigned_only` consegue dar `UPDATE` em projeto não atribuído
(política `Admin/Staff can update projects`) e ler no storage documentos de
projeto não atribuído.

## Monitoramento
- Tabela `system_events` (kind: `error`, `security`, `audit`, `signup`,
  `deploy`) alimenta a aba **Monitoramento** do console (master-only). Captura
  login falhado, acesso negado, erros de front (ErrorBoundary + handlers
  globais), auditoria por trigger, cadastros e deploys.
- Edge function `log-event` aceita eventos não autenticados (login falhado ainda
  não tem sessão), mas só de uma **lista fechada** de ações e com limite de 60
  eventos por IP a cada 10 min. Deploy exige `DEPLOY_LOG_TOKEN`.

## Pendências de segurança
- **Proteção de senha vazada** do Supabase Auth: habilitar no painel.
- **Listagem pública de buckets** `avatars`/`tenant-logos`: revisar se a
  listagem (não só leitura por caminho) deve ficar aberta.
- Ver [roadmap.md](roadmap.md).
