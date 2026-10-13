/**
 * Validação do corpo da API de status da Ludmilla (`POST /ludmilla-status`).
 *
 * Módulo PURO (sem Deno.*): roda nos testes do front (vitest) e na edge
 * function. A regra de quem pode mandar e o que acontece depois mora no banco
 * (`ludmilla_api_status_registrar`); aqui só se garante que o que chega tem a
 * forma que aquele trilho espera — a mesma dos conectores da varredura:
 * `{ protocolo, status, titular? }`.
 */

export const CONECTORES = ['cpfl', 'elektro', 'edp'] as const;
export type Conector = typeof CONECTORES[number];

export interface ProtocoloRecebido {
  protocolo: string;
  status: string;
  titular: string;
  raw: Record<string, string>;
}

export type CorpoValidado =
  | { ok: true; connector: Conector; protocolos: ProtocoloRecebido[] }
  | { ok: false; erro: string; detalhe: string };

const MAX_ITENS = 500;

/** "ELEKTRO", "CPFL Paulista", "edp " → o conector; o que não se conhece vira null. */
export function conectorDe(nome: unknown): Conector | null {
  if (typeof nome !== 'string') return null;
  const n = nome.trim().toLowerCase();
  if (!n) return null;
  for (const c of CONECTORES) if (n === c || n.startsWith(c + ' ') || n.startsWith(c + '-')) return c;
  return null;
}

const texto = (v: unknown, max: number): string =>
  typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '';

export function validarCorpo(body: unknown): CorpoValidado {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, erro: 'corpo_invalido', detalhe: 'Envie um objeto JSON.' };
  }
  const b = body as Record<string, unknown>;
  const connector = conectorDe(b.connector ?? b.concessionaria);
  if (!connector) {
    return {
      ok: false, erro: 'concessionaria_invalida',
      detalhe: `Informe "concessionaria" (ou "connector") como uma de: ${CONECTORES.join(', ')}.`,
    };
  }
  if (!Array.isArray(b.protocolos)) {
    return { ok: false, erro: 'protocolos_invalidos', detalhe: 'Envie "protocolos" como lista.' };
  }
  if (b.protocolos.length === 0) {
    return { ok: false, erro: 'protocolos_invalidos', detalhe: 'A lista veio vazia.' };
  }
  if (b.protocolos.length > MAX_ITENS) {
    return { ok: false, erro: 'protocolos_invalidos', detalhe: `No máximo ${MAX_ITENS} itens por chamada.` };
  }

  // último vence: quem manda a mesma linha duas vezes quis corrigir a primeira
  const porProtocolo = new Map<string, ProtocoloRecebido>();
  for (const [i, item] of (b.protocolos as unknown[]).entries()) {
    if (!item || typeof item !== 'object') {
      return { ok: false, erro: 'protocolos_invalidos', detalhe: `Item ${i + 1} não é um objeto.` };
    }
    const it = item as Record<string, unknown>;
    const protocolo = texto(it.protocolo, 60);
    const status = texto(it.status, 200);
    if (!protocolo || !status) {
      return {
        ok: false, erro: 'protocolos_invalidos',
        detalhe: `Item ${i + 1}: "protocolo" e "status" são obrigatórios.`,
      };
    }
    porProtocolo.set(protocolo, {
      protocolo, status,
      titular: texto(it.titular, 200),
      // guardado cru, como a varredura faz — serve de auditoria no cartão
      raw: { origem: 'api', ...(typeof it.observacao === 'string' ? { observacao: texto(it.observacao, 500) } : {}) },
    });
  }
  return { ok: true, connector, protocolos: [...porProtocolo.values()] };
}
