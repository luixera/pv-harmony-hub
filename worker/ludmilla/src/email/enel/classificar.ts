// worker/ludmilla/src/email/enel/classificar.ts
import { semAcento } from '../util.js';

/**
 * O que o CORPO de um e-mail da ENEL diz — por texto, sem IA. As frases vêm de
 * e-mails reais (spec §8):
 *  · tecnico.*: "a vistoria do sistema de microgeração fotovoltaica está APROVADA"
 *  · canalgd:   "Nota de serviço criada … para a troca do medidor bidirecional,
 *               com o prazo de execução de até N dias úteis"
 *  · canalgd:   "a tentativa de troca do medidor no dia … não foi executada pelo
 *               seguinte motivo: …"
 * Só vale a parte NOVA da mensagem: a citação traz o histórico (inclusive o
 * nosso pedido, "a NT … foi aprovada na etapa de vistoria").
 */

export type Classificacao =
  | { tipo: 'resultado_vistoria'; aprovada: boolean }
  | { tipo: 'troca_relogio'; estado: 'agendada'; prazoDias: number | null }
  | { tipo: 'troca_relogio'; estado: 'nao_executada'; motivo: string | null }
  | null;

const MARCAS_DE_CITACAO = [
  /-{5,}\s*Mensagem original/i,
  /\bEm [^\n]{0,160}escreveu:/i,
  /^\s*De:\s/im,
  /^\s*From:\s/im,
  /^>/m,
];

/** Corta no começo da primeira citação. */
export function semCitacao(corpo: string): string {
  let fim = corpo.length;
  for (const re of MARCAS_DE_CITACAO) {
    const m = re.exec(corpo);
    if (m && m.index < fim) fim = m.index;
  }
  return corpo.slice(0, fim);
}

const normalizar = (s: string): string => semAcento(s).toLowerCase().replace(/\s+/g, ' ');

export function classificarCorpo(corpo: string | null | undefined): Classificacao {
  const t = normalizar(semCitacao(corpo ?? ''));
  if (!t.trim()) return null;

  // A falha vem antes: a resposta de falha também fala em "nota de serviço".
  if (/tentativa de troca do medidor[^.]{0,80}nao foi executada/.test(t)) {
    const m = /pelo seguinte motivo:\s*([^.]{3,120})/.exec(t);
    return { tipo: 'troca_relogio', estado: 'nao_executada', motivo: m ? m[1].trim() : null };
  }
  if (/nota de servico[^.]{0,160}troca do medidor/.test(t)) {
    const m = /prazo (?:de|para) execucao (?:e )?de ate (\d+) dias/.exec(t);
    return { tipo: 'troca_relogio', estado: 'agendada', prazoDias: m ? Number(m[1]) : null };
  }
  const v = /vistoria[^.]{0,160}?\b(?:esta|foi)\s+(aprovad[ao]|reprovad[ao])/.exec(t);
  if (v) return { tipo: 'resultado_vistoria', aprovada: v[1].startsWith('aprovad') };
  return null;
}

/**
 * O resultado da vistoria que a ENEL põe no ASSUNTO dos avisos do
 * atendimento.edsp: "Comunicado técnico sobre a nota: <NT> - Vistoria aprovada".
 * Padrão estrito (o observado em 21 de 21 e-mails): só casa "nota: <dígitos> -
 * vistoria aprovada|reprovada". Assunto da própria equipe ("VISTORIA - <NOME> -
 * NT …", "RE: VISTORIA …") não casa.
 */
export function classificarAssunto(assunto: string | null | undefined): Classificacao {
  const t = normalizar(assunto ?? '');
  const m = /\bnota:\s*\d+\s*-\s*vistoria\s+(aprovad[ao]|reprovad[ao])\b/.exec(t);
  return m ? { tipo: 'resultado_vistoria', aprovada: m[1].startsWith('aprovad') } : null;
}
