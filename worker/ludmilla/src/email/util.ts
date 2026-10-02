/**
 * Utilitários puros do acompanhamento por e-mail — sem rede, sem banco.
 * Tudo o que é comparação ou conta vive aqui; o roteiro só orquestra.
 */

export interface RegraEmail {
  id: string;
  /** trecho do remetente; null = qualquer remetente */
  remetente: string | null;
  /** trecho do assunto que identifica o documento */
  assunto: string;
  tipo_documento: string;
  anexar: boolean;
  ler_pdf: boolean;
}

export type Veredito = 'favoravel' | 'pendencia' | 'inconclusivo';

export const semAcento = (s: string): string =>
  (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Só os dígitos, sem zeros à esquerda: o protocolo do sistema tem um zero a mais que a nota. */
export const chaveProtocolo = (s: string): string =>
  (s ?? '').replace(/\D/g, '').replace(/^0+/, '');

/** Protocolos com menos de 8 dígitos não casam: evita colar e-mail por número de rua ou CEP. */
export function casaProtocolo(a: string, b: string): boolean {
  const x = chaveProtocolo(a);
  return x.length >= 8 && x === chaveProtocolo(b);
}

/** Acha, entre os protocolos dos projetos, aquele que aparece no assunto. */
export function protocoloDoAssunto(assunto: string, candidatos: string[]): string | null {
  const numeros = (assunto.match(/\d[\d.\-/]{6,}/g) ?? []).map(chaveProtocolo);
  return candidatos.find(c => numeros.some(n => casaProtocolo(c, n))) ?? null;
}

/** Primeira regra ativa cujo assunto (e remetente, quando a regra tiver) casa. */
export function regraQueCasa(regras: RegraEmail[], assunto: string, remetente: string): RegraEmail | null {
  const a = semAcento(assunto).toUpperCase();
  const r = semAcento(remetente).toLowerCase();
  return regras.find(x =>
    a.includes(semAcento(x.assunto).toUpperCase())
    && (!x.remetente || r.includes(semAcento(x.remetente).toLowerCase()))
  ) ?? null;
}

const palavras = (s: string): string[] =>
  semAcento(s).toUpperCase().split(/[^A-Z0-9]+/).filter(p => p.length > 2);

/** Compara primeiro e último nome, sem acento e sem caixa. Exige pelo menos duas palavras do sistema. */
export function casaTitular(doSistema: string, doEmail: string): boolean {
  const a = palavras(doSistema);
  const b = palavras(doEmail);
  if (a.length < 2 || b.length === 0) return false;
  return b.includes(a[0]) && b.includes(a[a.length - 1]);
}

export const normalizarEndereco = (s: string): string =>
  semAcento(s).toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();

/** Rua (palavras com mais de 3 letras) e número têm de aparecer no endereço do e-mail. */
export function casaEndereco(doSistema: string, doEmail: string): boolean {
  const a = normalizarEndereco(doSistema);
  const b = normalizarEndereco(doEmail);
  if (!a || !b) return false;
  const numeros = a.match(/\b\d+\b/g) ?? [];
  const numero = numeros.length > 0 ? numeros[numeros.length - 1] : undefined;
  const rua = a.replace(/\b\d+\b/g, '').split(' ').filter(p => p.length > 3);
  if (rua.length === 0) return false;
  const ruaSet = new Set(b.split(' '));
  return rua.every(p => ruaSet.has(p)) && (!numero || new RegExp(`\\b${numero}\\b`).test(b));
}

/** Etapa recomendada para o card. Null = só avisa que o documento chegou. */
export function recomendacaoDoVeredito(tipo: string, v: Veredito | null): string | null {
  if (tipo !== 'parecer') return null;
  if (v === 'favoravel') return 'approved';
  if (v === 'pendencia') return 'pendencia';
  return null;
}
