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

## Certificado digital
Módulo [Assinatura digital](../modules/signatures/overview.md): o **certificado
A1 (`.pfx`) do engenheiro** fica guardado no sistema e é usado por um robô na
VPS. É o segredo mais sensível da plataforma — ele assina em nome de uma pessoa
física. Regras (detalhe em [business-rules](../modules/signatures/business-rules.md)):

- **Bucket `certificados` sem policy de leitura.** Privado, com uma única policy,
  de `INSERT` (admin, na pasta do próprio tenant). Sem `SELECT`/`UPDATE`/`DELETE`:
  **nem o admin baixa o `.pfx` depois de subir**. Só o `service_role` alcança.
- **Senha no Vault** (`vault.create_secret`), no padrão das credenciais da
  Ludmilla. Nenhuma função a devolve a `authenticated`; a única que a lê,
  `certificado_do_robo`, é `service_role`. No robô, `.pfx` e senha vivem **só em
  memória**. No front, a mutação do cadastro tem `gcTime: 0` e é limpa ao fim,
  porque o React Query guardaria a senha por ~5 min. O assistente (Claude)
  nunca digita nem manipula a senha.
- **Leitura só por `service_role`**, e a service role **só existe no segredo do
  GitHub e em `/etc/gdm-assinador/env` (600, root)** na VPS. No deploy ela vai
  pelo **stdin** do `ssh`, não na linha de comando (que ficaria legível em
  `/proc/<pid>/cmdline`). O usuário do serviço (`gdmassinador`) é o mais exposto
  da máquina — roda LibreOffice sobre arquivo enviado por cliente —, por isso a
  unit é endurecida (`NoNewPrivileges`, `PrivateTmp`, `ProtectSystem=full`,
  código `root:root` e `ReadOnlyPaths`). Isso **diverge do padrão da Ludmilla**,
  cujo deploy ainda passa a chave na linha de comando.
- **Privilégio por coluna em `documents.assinavel_id`.** A coluna que autoriza
  assinar está fora de todo `GRANT`, e **ninguém tem `UPDATE`** em `documents`.
  Só as funções `documento_para_assinar` e `documento_marcar_assinavel` a
  gravam. Sem isso a tela poderia marcar qualquer anexo como assinável e
  anular a tranca. Coluna nova em `documents` precisa entrar nos `GRANT INSERT`.
- **Validação de caminho.** O robô baixa `file_url` com a service role, que
  ignora RLS. O caminho tem de começar por `<company_id do projeto>/<project_id>/`
  e o resto só pode ter `[A-Za-z0-9._-]` em segmentos, sem `.`/`..` — **allowlist**,
  porque o `fetch` normaliza `..`, `%2e%2e` e `..\` e remove tab/quebra de
  linha, e uma lista de proibidos tem furo. Vale nas duas portas, pois o
  `INSERT` comum aceita `file_url` arbitrário.
- **Registro de quem pediu e quem liberou.** `assinaturas.pedida_por`,
  `aprovada_por`, `liberada_por`, o certificado e os hashes (original, aprovado,
  assinado) ficam gravados; comentário no card e `project_history` a cada
  assinatura; recado do Zé a cada uso do certificado. O staff assina com o e-CPF
  do engenheiro por **decisão consciente**: o controle é rastrear, não impedir.
- **O Zé não libera sozinho.** A liberação de exceção exige, **no banco**, que o
  "Libero?" tenha chegado ao gestor e que ele tenha falado depois. O texto de
  terceiros (nome de arquivo, motivo da triagem) é sanitizado antes de ir ao
  prompt.
- **Não usar `node-forge` para verificar assinatura nem cadeia** (advisory na
  verificação RSA PKCS#1 v1.5). Só para ler o `.pfx`; para verificar, `node:crypto`.
- A função `assinatura-triagem` e o modo `recado` da `ze-brain` só aceitam o
  robô, conferido por `ASSINADOR_WORKER_KEY` (ou a service role). Falha fechada.

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
