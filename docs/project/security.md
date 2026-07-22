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
