# Projetos — Frontend

## Telas
- `src/pages/NewProject.tsx` — formulário interno (3 passos: Titular,
  Equipamentos, Anexos). CPF/CNPJ com tipo de pessoa, lat/long, anexos extras.
- `src/pages/PublicProjectForm.tsx` — formulário público (mesma estrutura,
  anônimo, com Turnstile).
- `src/pages/ProjectsKanban.tsx` — Kanban (drag-and-drop entre etapas). Filtros
  por empresa (`company_id`) e por concessionária (`concessionaire_id`, via
  `useEnergyConcessionaires()` — lista real do tenant, não texto livre; ver
  nota em [database.md](database.md) sobre `utility_company`).
- `src/pages/ProjectsMap.tsx` — mapa (Google Maps).

## Componentes-chave
- `src/components/projects/ProjectModal.tsx` — modal central do projeto; abas de
  dados, equipamentos (`EquipmentBlock` com combobox), documentos, histórico,
  financeiro, tarefas, protocolo, revisões, notificações e unifilar.
- `src/components/projects/ProjectEmailsTab.tsx` — aba **Notificações**
  (admin/staff): os e-mails da concessionária que citam este projeto, pela RPC
  `project_emails`. Somente leitura, com atalho para `/email-updates`. Regras do
  casamento em [modules/ocr](../ocr/overview.md) (RN-OCR-02 e RN-OCR-06).
- `GenerateDocumentDialog.tsx` — gera documento de template.
- `InstallerPackageDialog.tsx` — monta e baixa o pacote do projetista.
- `src/components/equipment/EquipmentModelCombobox.tsx` — busca no catálogo,
  filtra por marca.
- `src/components/forms/DocumentUploadField.tsx` — upload (imagem/pdf/word/excel).

## Estado
Formulários grandes usam estado local; React Query para dados de servidor. O
`ProjectModal` tem guarda de acesso para staff `assigned_only`.
