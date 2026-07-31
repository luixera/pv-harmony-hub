# Projetos — API / Hooks

## Hooks
- `useProjects` — lista (filtrada por tenant e papel), `useProject(id)`,
  `useCreateProject`, `useUpdateProjectStatus`, `useUpdateProjectData`.
- `useDocuments` — anexos (upload/download; bucket `project-documents`).
- `useHistory` / `useProjectHistory` — trilha do projeto.
- `useProjectAssignments` — atribuição de projetistas.
- `useProjectProtocol` / `useRegisterProtocol`.
- `useProjectRevisions` — revisões.
- `useComments`, `useTasks`, `useStageChecklists`.
- `useInstallerPackage` — montagem do pacote do projetista.

## Utilitários de documento
- `src/utils/projectValues.ts` — `buildProjectValues(project, overrides?)`
  (fonte única de variáveis de template).
- `src/utils/docxGenerator.ts` — detecção de tags, geração `.docx`.
- `src/utils/resumoPdf.ts` — cartilha RESUMO (PDF) com logo do tenant.
- `src/utils/installerPackage.ts` — resolve itens → blobs → ZIP.

## RPCs
- `soft_delete_project(_project_id, _reason)` — exclusão é **lógica**
  (`is_deleted`), registra autor/motivo e grava no histórico. Só o **master** ou
  o **admin do MESMO tenant** do projeto. A checagem compara com
  `profiles.tenant_id` e exige que ele não seja nulo: usar
  `get_user_tenant_id` deixava passar, porque ele devolve NULL quando o tenant
  está sem acesso e `NOT (admin AND tenant = NULL)` é NULL, não `true`
  (jul/2026 — antes disso não havia checagem de tenant nenhuma).
- `staff_can_access_project`, `get_kanban_columns`,
  `should_hide_company_name`.

## Realtime/side-effects
- `dispatchNotification('projeto_recebido', ...)` no fluxo de criação.
- Trigger `fn_set_project_value` calcula o valor.
