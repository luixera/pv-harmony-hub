# Homologação — API / Hooks

## Hooks
- `useEnergyConcessionaires` / `usePublicConcessionaires(token)`.
- `useConcessionaireTemplates`, `useConcessionaireDocuments`,
  `useConcessionaireLibrary`.
- `useEntryRules` — regras de padrão de entrada (`matchEntryRule`,
  `entryRuleValues`, `entryRuleCustomColumns`).
- `useKanbanConfig` — modelos/colunas do Kanban.
- `useStageChecklists`, `useProjectProtocol`/`useRegisterProtocol`.
- `useFormConfig`.

## Utilitários de template
- `src/utils/docxGenerator.ts` — `detectTemplateFields`, `insertTagsInFields`,
  `renameTagsInDocx`, `generateDocxFromTemplate`, `cleanPlaceholderStyling`.
- Editor: `src/components/concessionaires/TemplateEditorDialog.tsx`,
  `ConcessionaireTemplatesDialog.tsx`, `EntryRulesDialog.tsx`,
  `LibraryImportDialog.tsx`.

## RPCs
`get_kanban_columns`, `get_concessionaires_for_token`, `tenant_library_status`,
`match_emails_to_protocols`, `project_emails(_project_id)` (e-mails deste
projeto, vinculados + sugeridos — ver [modules/ocr](../ocr/overview.md)).
