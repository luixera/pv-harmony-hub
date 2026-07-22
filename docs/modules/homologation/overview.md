# Módulo: Homologação

## Objetivo
Conduzir o projeto pelas **etapas** de aprovação junto à concessionária, do
recebimento à conclusão. Reúne o Kanban, as concessionárias, as regras de padrão
de entrada, os templates de documento e os protocolos.

## Funcionalidades
- **Kanban** de etapas (drag-and-drop) — `/projects`.
- **Concessionárias** (`/admin/energy-concessionaires`) — cadastro, documentos,
  templates, regras de padrão de entrada, biblioteca importável.
- **Padrão de entrada** — categorias por fase + disjuntor (`concessionaire_entry_rules`),
  com colunas customizáveis que viram variáveis de template.
- **Templates .docx** — editor com raio-X de tags, prévia, correção.
- **Protocolos** (`project_protocols`) — número do processo na concessionária.
- **Checklists por etapa** (`stage_checklists`).
- Configuração do Kanban (`/admin/kanban-config`) e formulários (`/admin/form-config`).

## Banco
`energy_concessionaires`, `concessionaire_documents`, `concessionaire_templates`,
`concessionaire_entry_rules`, `kanban_models`, `kanban_columns`,
`company_kanban_model`, `stage_checklists`, `project_protocols`,
`form_configs`, `form_fields`, `form_field_rules`.

## Estados do projeto
`pending → analysis → documentation → approval → approved`, desvios `pendencia`
e `vistoria_solicitada`, fim `completed`. Ver [business-rules.md](business-rules.md).

## Regras / fluxos
Ver [business-rules.md](business-rules.md) · [flow.md](flow.md) ·
[database.md](database.md) · [api.md](api.md).
