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

## Marca e modelo em lista condicional (24/09/2026)

Pedido do usuário: ao trocar o equipamento de um projeto, escolher a **marca**
numa lista e ver em **modelo** só os modelos daquela marca — para inversor e
para módulos.

Como estava: o campo **Modelo** já era combobox do catálogo filtrado pela marca
(`EquipmentModelCombobox`, `brand={...}`) tanto no NewProject quanto no modal
do projeto; a **Marca** era texto livre nos dois. O formulário **público**
segue manual de propósito (decisão antiga: a empresa cliente não cadastra
catálogo).

O que mudou: `EquipmentBrandCombobox` — marca como lista do catálogo
compartilhado, com busca, contagem de modelos por marca e digitação livre
(o catálogo não é exaustivo: marca nova não trava o projeto, só avisa que está
fora do catálogo). Escolher OUTRA marca limpa modelo e potência, porque eram do
fabricante anterior — e a lista de modelos já abre certa. Usado no
`ProjectModal` (bloco de equipamentos em edição) e no `NewProject`; o modo
"Preencher manualmente" continua devolvendo os campos de texto.

A regra das listas virou função pura em `src/components/equipment/catalogoFiltros.ts`
(`marcasDoCatalogo`, `filtrarMarcas`, `modelosDaMarca`), usada pelos dois
comboboxes e coberta por 11 testes (vitest): marca repetida com caixa/espaço
diferentes conta uma vez só, ordem pt-BR, marca fora do catálogo volta a listar
tudo em vez de lista vazia. Catálogo hoje: 20 marcas/73 modelos de inversor,
22/41 de módulo.
