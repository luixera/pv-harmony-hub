/**
 * Regras das unidades beneficiárias — as MESMAS que o portal da concessionária
 * aplica, conferidas antes de a Ludmilla começar (spec 2026-10-22, §1).
 *
 * Tudo aqui é conta pura, sem React e sem Supabase, para ter teste.
 *
 * - A UC é guardada só com dígitos; o formato (quantos dígitos) é por
 *   concessionária: a CPFL tem 12 (telas de 21/10/2026). As demais ficam em
 *   "só dígitos" até o usuário confirmar — travar um tamanho inventado
 *   impediria o envio de um projeto da COPEL.
 * - O percentual aceita o jeito brasileiro ("30,5", "30,0000%") e o
 *   americano ("30.5"), com até 4 casas, como o portal.
 * - A geradora NÃO é uma linha: fica com 100 − soma. A soma das beneficiárias
 *   nunca pode passar de 100.
 */

export const normalizarUc = (texto: string | null | undefined): string =>
  (texto ?? '').replace(/\D/g, '');

/** "126028303650" → "1.260.283.036-50" (jeito como a CPFL imprime). */
export function formatarUcCpfl(uc: string): string {
  const d = normalizarUc(uc);
  if (d.length !== 12) return d;
  return `${d[0]}.${d.slice(1, 4)}.${d.slice(4, 7)}.${d.slice(7, 10)}-${d.slice(10, 12)}`;
}

/** Dígitos que a UC tem em cada concessionária — só o que foi confirmado. */
const DIGITOS_POR_CONCESSIONARIA: { testa: RegExp; digitos: number; nome: string }[] = [
  { testa: /cpfl/i, digitos: 12, nome: 'CPFL' },
];

export interface ValidacaoUc {
  ok: boolean;
  /** só dígitos, pronto para gravar */
  uc: string;
  motivo?: string;
}

/**
 * Valida a UC para a concessionária do projeto. `concessionaria` é o nome
 * (como vem de `energy_concessionaires.name`); desconhecida = só dígitos.
 */
export function validarUc(texto: string, concessionaria: string | null | undefined): ValidacaoUc {
  const uc = normalizarUc(texto);
  if (!uc) return { ok: false, uc, motivo: 'Informe o número da UC.' };
  const regra = DIGITOS_POR_CONCESSIONARIA.find(r => r.testa.test(concessionaria ?? ''));
  if (regra && uc.length !== regra.digitos) {
    return {
      ok: false, uc,
      motivo: `A UC da ${regra.nome} tem ${regra.digitos} dígitos — este tem ${uc.length}. Confira na conta.`,
    };
  }
  return { ok: true, uc };
}

/**
 * Lê um percentual digitado por gente. Devolve null quando não dá para ler
 * ou está fora de (0, 100]. Arredonda em 4 casas (o portal tem 4).
 */
export function lerPercentual(texto: string | number | null | undefined): number | null {
  if (texto === null || texto === undefined) return null;
  if (typeof texto === 'number') return Number.isFinite(texto) && texto > 0 && texto <= 100 ? arred4(texto) : null;
  const limpo = texto.replace(/%/g, '').replace(/\s| /g, '');
  if (!limpo || !/^[\d.,]+$/.test(limpo)) return null;
  // vírgula = decimal brasileira; sem vírgula, o ponto é decimal (percentual
  // nunca tem milhar)
  const final = limpo.includes(',') ? limpo.replace(/\./g, '').replace(',', '.') : limpo;
  const n = Number(final);
  if (!Number.isFinite(n) || n <= 0 || n > 100) return null;
  return arred4(n);
}

const arred4 = (n: number) => Math.round(n * 10000) / 10000;

/** "30" → "30,0000%", como o portal mostra. */
export function formatarPercentual(n: number | null | undefined, casas = 4): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return n.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas }) + '%';
}

export interface RateioResumo {
  /** soma das beneficiárias, 4 casas */
  soma: number;
  /** o que fica com a geradora = 100 − soma (nunca negativo aqui: é erro) */
  geradora: number;
  /** a soma passou de 100 */
  estourou: boolean;
}

export function resumirRateio(percentuais: (number | null | undefined)[]): RateioResumo {
  const soma = arred4(percentuais.reduce<number>((s, p) => s + (p ?? 0), 0));
  const geradora = arred4(100 - soma);
  return { soma, geradora: geradora < 0 ? 0 : geradora, estourou: soma > 100 };
}

/** O documento lido na conta é o mesmo da geradora? Compara só dígitos. */
export function mesmoTitular(docGeradora: string | null | undefined, docLido: string | null | undefined): boolean | null {
  const a = normalizarUc(docGeradora);
  const b = normalizarUc(docLido);
  if (!a || !b) return null; // não dá para saber
  return a === b;
}
