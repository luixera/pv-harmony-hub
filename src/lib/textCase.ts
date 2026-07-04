/**
 * Padronização de caixa alta nos dados de projeto.
 *
 * Regra de negócio: todo texto digitado em formulários de projeto é gravado
 * em MAIÚSCULAS. E-mails são a exceção (gravados em minúsculas). Campos de
 * sistema (enums, coordenadas, status) não são tocados.
 */

const SKIP_KEYS = new Set([
  'coordinates',
  'phase_type',
  'phaseType',
  'source',
  'status',
  'payment_status',
  'claudinho_data', // JSON serializado — não alterar
  'observations',   // texto livre — preserva a caixa digitada pelo usuário
]);

const isEmailKey = (key: string) => /email/i.test(key);
const isIdKey = (key: string) => key === 'id' || /_id$|Id$/.test(key);

/** Converte para caixa alta os valores string de um objeto (raso), exceto e-mails e campos de sistema. */
export function upperizeStrings<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = { ...obj };
  for (const [key, value] of Object.entries(out)) {
    if (typeof value !== 'string' || SKIP_KEYS.has(key) || isIdKey(key)) continue;
    out[key] = isEmailKey(key) ? value.toLowerCase() : value.toUpperCase();
  }
  return out as T;
}
