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

## Diálogo que some junto com quem o renderiza

`DeleteProjectDialog` é renderizado **pelo card do projeto** (Kanban, modal,
detalhe). No instante em que a exclusão dá certo, o projeto sai de `useProjects`
(que filtra `is_deleted = false`), o card desmonta e leva o diálogo **aberto**
junto. O Radix trava o `<body>` em `pointer-events: none` enquanto um modal está
aberto e só libera no fechamento controlado — desmontado no meio, a tela inteira
para de receber clique: era o "sistema trava ao excluir" (jul/2026).

Duas defesas, porque uma só não basta:

1. `useDeleteProject` invalida as queries num `setTimeout(…, 0)`, dando ao
   diálogo a chance de fechar antes de a lista recarregar;
2. `DeleteProjectDialog` restaura `document.body.style.pointerEvents` no
   desmonte — rede de segurança para qualquer outro caminho que desmonte o
   diálogo aberto.

Vale a regra geral: **diálogo modal renderizado dentro de um item de lista que
pode sumir** precisa desta rede, ou ser içado para fora da lista.

### Confirmação tem de ficar ACIMA dos modais próprios

Os modais deste projeto são feitos à mão, com `zIndex` até **9999**
(`ProjectModal`, `TaskDialog`, `AgentConfigDialog`, `ProtocolDialog`). O padrão
do shadcn para `AlertDialog` é `z-50`, e o Radix leva o diálogo pro `<body>` via
portal — então a confirmação de exclusão abria **atrás** do modal do projeto.
Ela estava lá, funcionando, mas invisível e inalcançável; e como o Radix
desativa o resto da página enquanto está aberta, o modal na frente também
parava de responder.

`src/components/ui/alert-dialog.tsx` fixa `z-[10050]` no overlay e no conteúdo
(constante `Z_ACIMA_DOS_MODAIS`). Uma confirmação é, por definição, o que está
mais à frente. **Ao criar um modal próprio novo, não passe de 9999** — ou suba
essa constante junto.
