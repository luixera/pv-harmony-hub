// Single source of truth — status, labels e colors do sistema.
// Antes desta centralização, projectStatusLabels estava redeclarado em 5 arquivos
// e paymentStatusLabels em 3. Qualquer mudança de texto exigia caçar em N lugares.

// Status aceitos pelo banco projects.status — IDÊNTICOS aos status_key do Kanban.
// `pendencia` e `vistoria_solicitada` são status_keys customizados do Kanban
// que podem coexistir com o enum (kanban_columns.status_key é text livre).
export const VALID_PROJECT_STATUSES = [
  'pending',
  'analysis',
  'documentation',
  'approval',
  'approved',
  'rejected',
  'pendencia',
  'vistoria_solicitada',
  'completed',
] as const

export function toProjectStatus(statusKey: string): string | null {
  if ((VALID_PROJECT_STATUSES as readonly string[]).includes(statusKey)) {
    return statusKey
  }
  console.warn(`Status '${statusKey}' não reconhecido.`)
  return null
}

export function isValidProjectStatus(status: string): boolean {
  return (VALID_PROJECT_STATUSES as readonly string[]).includes(status)
}

// ── Project status labels ──────────────────────────────────────────────────
export const projectStatusLabels: Record<string, string> = {
  pending:             'Aguardando',
  analysis:            'Em Análise',
  documentation:       'Documentação',
  approval:            'Aprovação',
  approved:            'Aprovado',
  rejected:            'Reprovado',
  pendencia:           'Pendência',
  vistoria_solicitada: 'Vistoria Solicitada',
  completed:           'Concluído',
}

// ── Payment status labels + colors ─────────────────────────────────────────
export const paymentStatusLabels: Record<string, string> = {
  pending: 'Pendente',
  partial: 'Parcialmente Pago',
  paid:    'Pago',
}

// Versão curta usada em tabelas estreitas (Receivables, financial cards).
export const paymentStatusLabelsShort: Record<string, string> = {
  pending: 'Pendente',
  partial: 'Parcial',
  paid:    'Pago',
}

export const paymentStatusColors: Record<string, string> = {
  pending: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
  partial: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
  paid:    'bg-green-500/10 text-green-500 border-green-500/20',
}

// ── Document type labels ───────────────────────────────────────────────────
export const documentTypeLabels: Record<string, string> = {
  energy_bill_generator:     'Conta de energia — Geradora',
  energy_bill_beneficiaries: 'Contas de energia — Beneficiárias',
  holder_document:           'Documento do titular',
  entrance_standard_photo:   'Foto do padrão de entrada',
  breaker_photo:             'Foto do disjuntor',
  other_photos:              'Outras fotos',
}
