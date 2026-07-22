# Homologação — Frontend

## Telas
- `src/pages/Projects.tsx` — Kanban (drag-and-drop `@hello-pangea/dnd`).
- `src/pages/admin/EnergyConcessionaires.tsx` — lista redesenhada
  (avatar colorido, badges, ações), banners de biblioteca.
- `src/pages/admin/KanbanConfig.tsx` — configuração das colunas/etapas.
- `src/pages/admin/FormConfig.tsx` — formulários configuráveis.

## Componentes
- `concessionaires/ConcessionaireTemplatesDialog.tsx` — upload/raio-X de tags,
  troca de versão com confirmação de exclusão.
- `concessionaires/TemplateEditorDialog.tsx` — prévia com tags destacadas,
  correção, inserção por seleção, aba "Campos".
- `concessionaires/EntryRulesDialog.tsx` — tabela de padrão de entrada com
  adicionar linha/coluna.
- `concessionaires/LibraryImportDialog.tsx` — importar/atualizar da biblioteca.

## Labels
`src/lib/statusMapping.ts` (`PROJECT_STATUS_LABELS`, `projectStatusLabel`).
