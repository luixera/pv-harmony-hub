/**
 * Hierarquia de z-index da aplicação.
 *
 * Camadas (de baixo para cima):
 *  40  — sidebar / topbar
 *  50  — dropdowns / tooltips (shadcn padrão)
 * 1000 — overlay do ProjectModal (fundo escuro)
 * 1001 — conteúdo do ProjectModal
 * 1100 — dialogs/modais abertos DENTRO do ProjectModal
 *         (GenerateDocumentDialog, StaffAssignmentDialog,
 *          DeleteProjectDialog, NewRevisionDialog, etc.)
 * 9999 — toasts (Sonner)
 *
 * REGRA: nunca abrir um dialog shadcn sem garantir que seu
 * z-index (overlay + content) é maior que o modal pai.
 * O arquivo src/components/ui/dialog.tsx já aplica z-[1100].
 */
export const Z_INDEX = {
  sidebar:           40,
  topbar:            40,
  dropdown:          50,
  modalOverlay:    1000,   // ProjectModal overlay
  modal:           1001,   // ProjectModal content
  subModal:        1100,   // dialogs inside ProjectModal
  toast:           9999,
} as const;
