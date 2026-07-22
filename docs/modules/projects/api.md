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
- `staff_can_access_project`, `soft_delete_project`, `get_kanban_columns`,
  `should_hide_company_name`.

## Realtime/side-effects
- `dispatchNotification('projeto_recebido', ...)` no fluxo de criação.
- Trigger `fn_set_project_value` calcula o valor.
