// worker/ludmilla/src/email/enel/classificar.ts
import { semAcento } from '../util.js';

/**
 * O que o CORPO de um e-mail da ENEL diz — por texto, sem IA. As frases vêm de
 * e-mails reais (spec §8):
 *  · tecnico.*: "a vistoria do sistema de microgeração fotovoltaica está APROVADA"
 *  · canalgd:   "Nota de serviço criada … para a troca do medidor bidirecional,
 *               com o prazo de execução de até N dias úteis"
 *  · canalgd:   "a tentativa de troca do medidor no dia … não foi executada pelo
 *               seguinte motivo: …" (ou "… não sendo executada …", ou, no
 *               reenvio da nota, "Motivo da rejeição: …")
 * Só vale a parte NOVA da mensagem: a citação traz o histórico (inclusive o
 * nosso pedido, "a NT … foi aprovada na etapa de vistoria").
 *
 * O texto chega ACHATADO (caixa.ts troca todo \s+ por um espaço): nada aqui pode
 * depender de quebra de linha, e nada pode ser quadrático.
 */

export type Classificacao =
  | { tipo: 'resultado_vistoria'; aprovada: boolean }
  | { tipo: 'troca_relogio'; estado: 'agendada'; prazoDias: number | null }
  | { tipo: 'troca_relogio'; estado: 'nao_executada'; motivo: string | null }
  | null;

/**
 * Onde começa uma citação. Todas funcionam em texto de UMA linha só (sem `^` e
 * sem a flag `m`: sobre muitas linhas em branco isso fica quadrático).
 *  · "-----Mensagem original-----" / "-----Original Message-----"
 *  · "Em qua., 10 de set. de 2026 às 10:00, Fulano <x@y> escreveu:" — o "Em"
 *    mais PERTO do "escreveu:" (um "Em" da parte nova não pode ser o começo)
 *  · cabeçalho do Outlook: "De: … Enviado(a) (em): …" e "From: … Sent: …", com os
 *    dois rótulos a no máximo 200 caracteres um do outro
 *  · o marcador de resposta ">" cercado de espaços (ou no começo do texto)
 */
const MARCAS_DE_CITACAO = [
  /-{5,}\s*(?:Mensagem original|Original Message)/i,
  /\bEm (?:(?!\bEm )[^\n]){0,160}?escreveu:/,
  /\bDe:\s(?:(?!\bDe:\s)[\s\S]){0,200}?\bEnviad[oa](?:\(a\))?(?:\s+em)?\s*:/,
  /\bFrom:\s(?:(?!\bFrom:\s)[\s\S]){0,200}?\bSent:/,
  /(?:^|\s)>\s/,
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

/**
 * Sem acento, minúsculo e com os espaços colapsados — mais, para cada posição do
 * texto normalizado, onde ela começa no ORIGINAL. Serve para devolver o motivo
 * da falha com as maiúsculas e os acentos de quem escreveu.
 */
function normalizarComMapa(s: string): { t: string; origem: number[] } {
  let t = '';
  const origem: number[] = [];
  let pos = 0;
  let noEspaco = false;
  for (const ch of s) {
    const aqui = pos;
    pos += ch.length;
    if (/\s/.test(ch)) {
      if (!noEspaco) { t += ' '; origem.push(aqui); }
      noEspaco = true;
      continue;
    }
    noEspaco = false;
    const n = semAcento(ch).toLowerCase();
    for (let k = 0; k < n.length; k++) origem.push(aqui);
    t += n;
  }
  origem.push(s.length); // o fim do texto também é uma posição
  return { t, origem };
}

// ── A troca do relógio que FALHOU ─────────────────────────────────────────────
// Três redações reais: "não foi executada", "não sendo executada" e, no reenvio
// da nota de serviço, "Motivo da rejeição". A resposta de falha também traz o
// "nota de serviço … troca do medidor" do reenvio, por isso a falha vem antes.
const FALHA_DA_TROCA = /\bnao (?:foi|sendo) executad[ao]\b|\bmotivo da rejeicao\b/;
// "não foi executada" sozinho pode ser de outra coisa (uma visita, uma vistoria).
const FALA_DA_TROCA = /\b(?:troca|medidor|nota de servico)\b/;

const INICIO_DO_MOTIVO = /(?:pelo seguinte motivo|motivo da rejeicao)\s*:?\s*/;
// O motivo termina onde a frase termina (ponto que não é de data), na data que o
// segue ("… Execução 21.08.2026", "… Medição em 14.05.2026") ou onde a frase
// seguinte começa.
const FIM_DO_MOTIVO = /\.(?!\d)|…|\b(?:em |no dia |na data de )?\d{1,2}[./]\d{1,2}\b|\b(?:reenviamos|realizamos|protocolo)\b|nota de servi/;
const MAX_MOTIVO = 80;

function extrairMotivo(t: string, origem: number[], original: string): string | null {
  const inicio = INICIO_DO_MOTIVO.exec(t);
  if (!inicio) return null;
  const de = inicio.index + inicio[0].length;
  const janela = t.slice(de, de + MAX_MOTIVO);
  const fim = FIM_DO_MOTIVO.exec(janela);
  let ate = fim ? fim.index : janela.length;
  if (!fim && de + MAX_MOTIVO < t.length) {
    // estourou o limite sem a frase acabar: não corta a palavra ao meio
    const espaco = janela.lastIndexOf(' ');
    if (espaco > 0) ate = espaco;
  }
  const motivo = original.slice(origem[de], origem[de + ate]).trim().replace(/[\s,;:–-]+$/, '');
  return motivo.length >= 3 ? motivo : null;
}

// ── O resultado da vistoria ───────────────────────────────────────────────────
// O verbo tem de ser da VISTORIA: entre "vistoria" e "está/foi aprovada" não pode
// haver outra "vistoria" (vale a mais perto), negação, outro verbo ("foi
// registrada e o projeto foi aprovado"), conjunção que abre outra oração nem
// ponto. Na dúvida é null: a robô só anota — o erro caro é dizer "aprovada" de
// uma vistoria que não foi.
const PALAVRAS_QUE_QUEBRAM = 'vistoria|nao|nem|ainda|nunca|jamais|sem|foi|esta|estao|sera|serao|e|ou|mas|porem|que';
const VISTORIA_COM_RESULTADO = new RegExp(
  String.raw`\bvistoria\b(?:(?!\b(?:${PALAVRAS_QUE_QUEBRAM})\b)[^.]){0,160}?\b(?:esta|foi)\s+(aprovad[ao]|reprovad[ao])\b`,
);
const NEGACAO = /\b(?:nao|nem|nunca|jamais)\b/;

export function classificarCorpo(corpo: string | null | undefined): Classificacao {
  const util = semCitacao(corpo ?? '');
  const { t, origem } = normalizarComMapa(util);
  if (!t.trim()) return null;

  // A falha vem antes: a resposta de falha também fala em "nota de serviço".
  if (FALA_DA_TROCA.test(t) && FALHA_DA_TROCA.test(t)) {
    return { tipo: 'troca_relogio', estado: 'nao_executada', motivo: extrairMotivo(t, origem, util) };
  }
  if (/nota de servico[^.]{0,160}troca do medidor/.test(t)) {
    const m = /prazo (?:de|para) execucao (?:e )?de ate (\d+) dias/.exec(t);
    return { tipo: 'troca_relogio', estado: 'agendada', prazoDias: m ? Number(m[1]) : null };
  }
  const v = VISTORIA_COM_RESULTADO.exec(t);
  if (v) {
    // negação ANTES da vistoria, na mesma frase: "não foi possível confirmar que a vistoria foi aprovada"
    const antes = t.slice(Math.max(0, v.index - 80), v.index);
    const frase = antes.slice(Math.max(antes.lastIndexOf('.'), antes.lastIndexOf(';'), antes.lastIndexOf('!'), antes.lastIndexOf('?')) + 1);
    if (NEGACAO.test(frase)) return null;
    return { tipo: 'resultado_vistoria', aprovada: v[1].startsWith('aprovad') };
  }
  return null;
}

/**
 * O resultado da vistoria que a ENEL põe no ASSUNTO dos avisos do
 * atendimento.edsp: "Comunicado técnico sobre a nota: <NT> - Vistoria aprovada".
 * Padrão estrito, do começo ao fim do assunto (o observado em 24 de 24 e-mails):
 * só casa o assunto INTEIRO. Assunto da própria equipe ("VISTORIA - <NOME> -
 * NT …", "RE: VISTORIA …") não casa; "RE: Comunicado …" e "… aprovada com
 * ressalvas" também não — a robô só anota.
 */
export function classificarAssunto(assunto: string | null | undefined): Classificacao {
  const t = normalizar(assunto ?? '').trim();
  const m = /^comunicado tecnico sobre a nota:\s*\d+\s*-\s*vistoria\s+(aprovad[ao]|reprovad[ao])\s*$/.exec(t);
  return m ? { tipo: 'resultado_vistoria', aprovada: m[1].startsWith('aprovad') } : null;
}
