// Status aceitos pelo banco projects.status
// São IDÊNTICOS aos status_key do Kanban
// NÃO fazer conversão — usar direto

export const VALID_PROJECT_STATUSES = [
  'pending',
  'analysis',
  'documentation',
  'approval',
  'approved',
  'pendencia',
  'vistoria_solicitada',
  'completed',
]

export function toProjectStatus(
  statusKey: string
): string | null {
  if (VALID_PROJECT_STATUSES.includes(statusKey)) {
    return statusKey
  }
  console.warn(
    `Status '${statusKey}' não reconhecido.`
  )
  return null
}

export function isValidProjectStatus(
  status: string
): boolean {
  return VALID_PROJECT_STATUSES.includes(status)
}

/** Nome amigável da etapa, para exibir ao usuário (histórico, avisos, e-mails). */
export const PROJECT_STATUS_LABELS: Record<string, string> = {
  pending: 'Projetos Recebidos',
  analysis: 'Em Análise',
  documentation: 'Documentação',
  approval: 'Aguardando Aprovação',
  approved: 'Aprovado',
  pendencia: 'Pendência',
  vistoria_solicitada: 'Vistoria Solicitada',
  completed: 'Concluído',
}

/** Rótulo da etapa; cai no próprio código se for um status customizado. */
export function projectStatusLabel(status: string | null | undefined): string {
  if (!status) return '—'
  return PROJECT_STATUS_LABELS[status] ?? status
}
