# Módulo: Projetos

## Objetivo
Núcleo do sistema. Um **projeto** é uma solicitação de homologação de um sistema
fotovoltaico: titular, endereço, unidade consumidora, equipamentos, documentos e
o andamento pelas etapas até a aprovação.

## Funcionalidades
- Criação por formulário interno (`/new-project`) e público (`/public-form/:token`).
- Modal do projeto (`ProjectModal`) — dados gerais, equipamentos, documentos,
  histórico, financeiro, comentários, tarefas, revisões, protocolos.
- Equipamentos com combobox do catálogo (filtra por marca) e cadastro rápido.
- Geração de documentos (templates .docx) e Pacote do Projetista (ZIP).
- Revisões do projeto (quando reprovado) — `project_revisions`.
- Atribuição de projetistas (`project_assignments`).
- Mapa de projetos (`/projects-map`).

## Banco
Principais: `projects`, `project_general_data`, `project_equipment`,
`documents`, `project_history`, `project_assignments`, `project_protocols`,
`project_revisions` (+ `revision_general_data`, `revision_equipment`),
`project_financials`, `comments`, `tasks`. Ver [database.md](database.md).

## Hooks
`useProjects`, `useProjectRevisions`, `useProjectAssignments`,
`useProjectProtocol`, `useDocuments`, `useComments`, `useHistory`,
`useStageChecklists`, `useTasks`, `useInstallerPackage`.

## Telas
`/projects` (Kanban), `/company/projects`, `/project/:id`, `/new-project`,
`/projects-map`.

## Permissões
admin/staff (conforme `staff_access_mode`); company vê os próprios.

## Regras / fluxos / API
Ver [business-rules.md](business-rules.md) · [flow.md](flow.md) ·
[api.md](api.md). Etapas em [homologation](../homologation/overview.md).
