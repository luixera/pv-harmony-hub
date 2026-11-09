/**
 * O RELÓGIO DA LUDMILLA — funções puras, sem React.
 *
 * Brasília não tem horário de verão desde 2019: é UTC−3 o ano todo. O dia, a hora e o dia da semana
 * da página (o "chegou hoje" da fila, o "desde sexta" do recado, os dias do Diário, a próxima
 * leitura) saem daqui, sem depender do fuso do computador de quem abre a página nem do `Intl`.
 */

export const DIA_MS = 86_400_000;
export const HORA_MS = 3_600_000;
export const DESLOCAMENTO_DE_BRASILIA_MS = -3 * HORA_MS;

const p2 = (n: number) => String(n).padStart(2, '0');

/** A hora de parede de Brasília num Date "em UTC": leia com getUTC*. */
export function emBrasilia(ms: number): Date {
  return new Date(ms + DESLOCAMENTO_DE_BRASILIA_MS);
}

/** O número do dia em Brasília: dois instantes do mesmo dia de Brasília dão o mesmo número. */
export function diaEmBrasilia(ms: number): number {
  return Math.floor((ms + DESLOCAMENTO_DE_BRASILIA_MS) / DIA_MS);
}

/** Dias de calendário (Brasília) entre `iso` e `agora`: 0 = hoje, 1 = ontem. Data ilegível = 0. */
export function diasEntre(iso: string | null | undefined, agora: number): number {
  const t = Date.parse(iso ?? '');
  return Number.isFinite(t) ? diaEmBrasilia(agora) - diaEmBrasilia(t) : 0;
}

/** 00:00 de Brasília do dia de `ms`, como instante. */
export function inicioDoDia(ms: number): number {
  return diaEmBrasilia(ms) * DIA_MS - DESLOCAMENTO_DE_BRASILIA_MS;
}

export function horaEMinuto(ms: number): string {
  const d = emBrasilia(ms);
  return `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`;
}

/** "9/11", como a fatura escreve. */
export function diaEMes(ms: number): string {
  const d = emBrasilia(ms);
  return `${d.getUTCDate()}/${d.getUTCMonth() + 1}`;
}

/** "08:02" se foi hoje; "6/11 17:40" se foi antes. */
export function quandoCurto(ms: number, agora: number): string {
  return diaEmBrasilia(ms) === diaEmBrasilia(agora) ? horaEMinuto(ms) : `${diaEMes(ms)} ${horaEMinuto(ms)}`;
}

export const DIAS_DA_SEMANA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'] as const;

export function diaDaSemana(ms: number): (typeof DIAS_DA_SEMANA)[number] {
  return DIAS_DA_SEMANA[emBrasilia(ms).getUTCDay()];
}

export function maiuscula(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

export function saudacaoDaHora(ms: number): 'Bom dia' | 'Boa tarde' | 'Boa noite' {
  const h = emBrasilia(ms).getUTCHours();
  return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
}
