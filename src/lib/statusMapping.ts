// Status aceitos pelo enum projects.status no Postgres.
// Mantém alinhamento 1-para-1 com os valores de Kanban (status_key).
// Se o admin criar uma coluna com status_key fora desta lista,
// o INSERT/UPDATE em projects falha com "invalid input value for enum".

export const VALID_PROJECT_STATUSES = [
  'pending',
  'analysis',
  'documentation',
  'approval',
  'approved',
  'rejected',
  'completed',
] as const;

export type ProjectStatusKey = typeof VALID_PROJECT_STATUSES[number];

export function toProjectStatus(statusKey: string): ProjectStatusKey | null {
  if ((VALID_PROJECT_STATUSES as readonly string[]).includes(statusKey)) {
    return statusKey as ProjectStatusKey;
  }
  console.warn(`Status '${statusKey}' não reconhecido.`);
  return null;
}

export function isValidProjectStatus(status: string): status is ProjectStatusKey {
  return (VALID_PROJECT_STATUSES as readonly string[]).includes(status);
}
