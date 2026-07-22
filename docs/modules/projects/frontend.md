# Projetos — Frontend

## Telas
- `src/pages/NewProject.tsx` — formulário interno (3 passos: Titular,
  Equipamentos, Anexos). CPF/CNPJ com tipo de pessoa, lat/long, anexos extras.
- `src/pages/PublicProjectForm.tsx` — formulário público (mesma estrutura,
  anônimo, com Turnstile).
- `src/pages/Projects.tsx` — Kanban (drag-and-drop entre etapas).
- `src/pages/ProjectsMap.tsx` — mapa (Google Maps).

## Componentes-chave
- `src/components/projects/ProjectModal.tsx` — modal central do projeto; abas de
  dados, equipamentos (`EquipmentBlock` com combobox), documentos, histórico,
  financeiro, tarefas, protocolo, revisões.
- `GenerateDocumentDialog.tsx` — gera documento de template.
- `InstallerPackageDialog.tsx` — monta e baixa o pacote do projetista.
- `src/components/equipment/EquipmentModelCombobox.tsx` — busca no catálogo,
  filtra por marca.
- `src/components/forms/DocumentUploadField.tsx` — upload (imagem/pdf/word/excel).

## Estado
Formulários grandes usam estado local; React Query para dados de servidor. O
`ProjectModal` tem guarda de acesso para staff `assigned_only`.
