# Módulo: Permissões (RLS)

## Objetivo
Autorização do sistema: quem enxerga e altera o quê. A barreira principal é a
**RLS no Postgres**; o front apenas esconde/mostra controles.

## Mecanismos
- **RLS RESTRICTIVE `tenant_isolation`** em toda tabela de negócio: combina via
  `AND` com as políticas PERMISSIVE de papel — isolamento inquebrável por tenant.
- **Helpers** (`SECURITY DEFINER`, `search_path` fixo): `is_master`, `has_role`,
  `get_user_role`, `get_user_tenant_id`, `get_user_company_id`,
  `staff_can_access_project`, `tenant_has_access`.
- **RPCs master-only** para o console (`console_*`, `master_tenant_stats`,
  `master_companies_by_tenant`, `master_company_projects`) — gated por
  `is_master`. Ex.: o drill-down "Empresas e projetos" por tenant no `/painel`
  (aba Tenants) cruza tenants **apenas** por estas RPCs, mantendo o "sem bypass"
  de RLS em `companies`/`projects`.
- **Edge functions** com `service_role` (ignoram RLS) verificam o tenant do alvo.

## Papéis
Ver [../../project/permissions.md](../../project/permissions.md) (matriz completa).
`master`, `admin`, `staff` (com `staff_access_mode`), `company`.

## Regras
- **RN-PERM-01** — Sem bypass de master nas políticas de isolamento (ADR 0005).
- **RN-PERM-02** — Confiança só em `app_metadata` (ADR 0003).
- **RN-PERM-03** — Staff `assigned_only` só acessa projetos atribuídos; violação
  gera `forbidden_access`.
- **RN-PERM-04** — Storage: buckets privados (leitura autenticada, escrita
  admin/staff); logos públicos com escrita por política de caminho.

## Auditoria
`fn_audit_row` grava toda alteração sensível em `system_events`. Ver
[../../project/security.md](../../project/security.md).

## Exclusão de tenant (master)

Ação **irreversível**, só no console master (`/painel` → Tenants). Suspender
continua sendo o caminho reversível; excluir apaga de vez.

Camadas:

1. `master_tenant_delete_preview(_tenant_id)` — o que exatamente vai embora
   (projetos, empresas, usuários, documentos, concessionárias, diagramas,
   mensalidades). A UI mostra isso antes de liberar o botão.
2. `master_delete_tenant(_tenant_id, _confirm_name)` — apaga o SQL na ordem
   certa (logs → configurações → projetos → empresas → concessionárias →
   perfis → tenant) e devolve os ids de usuário e os caminhos dos arquivos.
   Recusa: quem não é master, o tenant **biblioteca**, o **próprio tenant** do
   usuário e confirmação com nome diferente.
3. Edge function `delete-tenant` — chama a RPC com o JWT do master e, com a
   service role, apaga os **usuários no Auth** e os **arquivos no Storage**
   (`project-documents` pelos caminhos devolvidos, `tenant-logos/{id}/`).
   O que não puder ser removido volta em `warnings`.

A UI exige o **nome do tenant digitado igual** — o mesmo nome é reconferido no
servidor, então não adianta burlar o campo.

Detalhe de implementação: o gatilho de auditoria (`fn_audit_row`) gravava o
evento de DELETE de `tenants` apontando para o próprio tenant, o que violava a
FK e tornava a exclusão impossível. No DELETE de `tenants` o evento agora vai
sem `tenant_id` (o id continua em `entity_id`).

## Projetista ligado a EMPRESAS (ago/2026)

Além de `staff_access_mode` (`global` / `assigned_only`) e `hide_company_name`,
o projetista pode ser **ligado a empresas** (`staff_companies`, N:N).

**Regra**: quem é `assigned_only` enxerga os projetos atribuídos a ele
**MAIS** todos os projetos das empresas ligadas a ele — incluindo os que
chegarem depois. É um vínculo permanente, não uma atribuição em lote: a dor era
"não ter que ficar atribuindo projeto a projeto" (pedido do usuário).

- No modo `global` o vínculo é ignorado (ele já vê tudo) e não é gravado.
- O projetista **não tem empresa própria**: `profiles.company_id` continua
  sendo do papel `company`. O vínculo é uma tabela à parte.
- **As demais permissões não mudaram**: Financeiro, Relatórios e E-mails
  seguem como estavam. O vínculo só amplia o que já era filtrado por
  `assigned_only`.

**Onde é aplicado**
- **RLS: as 11 políticas de leitura do projetista restrito** — `projects`,
  `documents`, `comments`, `financials`, `project_equipment`,
  `project_financials`, `project_general_data`, `project_history`,
  `project_revisions`, `revision_equipment`, `revision_general_data`. Cada uma
  ganhou um `OR public.staff_ligado_ao_projeto(auth.uid(), …)` (nas de revisão,
  `staff_ligado_a_revisao`), **preservando o corpo antigo literalmente** — ele é
  lido de `pg_get_expr` e só recebe o OR, nunca é redigitado.
  Em `projects` o ramo novo repete `is_deleted = false`, senão projeto excluído
  voltaria a aparecer.
- ⚠️ **`staff_can_access_project` não é usada por política nenhuma.** Foi a
  armadilha desta implementação: o vínculo estava gravado, a função já devolvia
  `true`, e o projetista não via nada — porque as políticas checam
  `project_assignments` no próprio corpo. A função (e sua `_base`) continua
  existindo para uso em código; **ao mexer no acesso do projetista, mexa nas
  políticas**, não só nela.
- A checagem do vínculo mora em função `SECURITY DEFINER`: dentro de uma
  política, subconsulta a outra tabela com RLS reavalia a RLS daquela tabela — e
  em `projects` daria recursão.
- `useProjects` — lista/Kanban/mapa: `id IN (atribuídos) OR company_id IN (empresas)`.
- `useCompanies` — projetista restrito só enxerga as empresas dele. Como criar
  projeto passa por "ver como empresa" na tela de Empresas, isso é também o que
  limita **para quais empresas ele cria projeto**.

**Conflito com "ocultar nome da empresa"**: as duas funções valem juntas. Com o
nome oculto o sistema mostra "Cliente" em tudo — então, com **2+ empresas
ligadas e nome oculto**, o projetista não consegue escolher a empresa e **não
cria projeto** (decisão do usuário). Com uma empresa só, cria normalmente. A
tela de usuários avisa quando essa combinação é escolhida.

**Leitura tolerante a falha**: as consultas a `staff_companies` devolvem lista
vazia se a tabela não existir ou o RLS negar. Sem vínculo, o comportamento é o
de antes — uma falha aqui nunca ABRE acesso.
