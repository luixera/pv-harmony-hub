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
