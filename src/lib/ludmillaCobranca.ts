/**
 * A COBRANÇA DA TROCA DO RELÓGIO NA ENEL — funções puras, sem React.
 *
 * Spec: docs/superpowers/specs/2026-10-24-ludmilla-enel-cobranca-troca-design.md §3.3 e §5.
 * O texto que a pessoa revisa e aprova nasce AQUI. O robô só troca o "bom dia"/"boa tarde"
 * da primeira linha na hora do envio (worker/ludmilla/src/email/enel/cobranca.ts,
 * `ajustarSaudacao`), e só se ninguém mexeu nela — o resto sai como a pessoa aprovou.
 */

/** A assinatura (aprovada pelo usuário em 24/10/2026: "Pode ser, ótimo"). Trocar AQUI, e só aqui. */
export const ASSINATURA_DA_COBRANCA = 'Equipe GD Manager';

/** O que falta no cadastro vira uma destas no texto. Enquanto houver uma, nada sai (tela e banco). */
export const LACUNAS = ['[NÚMERO DA NOTA]', '[UC]', '[TITULAR]', '[NT]'] as const;

/** O mesmo teto de `ludmilla_cobranca_aprovar`. */
export const TAMANHO_MAXIMO_DO_TEXTO = 5000;
const TAMANHO_MINIMO_DO_TEXTO = 20;

export type SituacaoDaCobranca = 'agendada' | 'aguardando_envio' | 'enviando' | 'encerrada' | 'dispensada';

type DadosGerais = { holder_name?: string | null; uc_number?: string | null } | null | undefined;

/** O embed `cobranca:cobranca_id(...)` do A fazer (`SELECT_AFAZER`, useLudmillaDecidir.ts). */
export interface CobrancaDoAfazer {
  id: string;
  /** como o banco guarda: 12 dígitos, com um zero à esquerda (a tela mostra `notaNaTela`) */
  nota_servico: string | null;
  data_nota: string;
  prazo_dias: number | null;
  para: string;
  assunto: string;
  situacao: SituacaoDaCobranca;
  enviadas: number;
  ultima_enviada_em: string | null;
  ultimo_texto_enviado: string | null;
  texto_aprovado: string | null;
  erro: string | null;
  motivo_encerramento: string | null;
  vence_em: string;
  projeto?: { protocol_number: string | null; project_general_data?: DadosGerais | DadosGerais[] } | null;
}

const FUSO = 'America/Sao_Paulo';
const limpo = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

/**
 * A nota na tela e no texto do e-mail: SEM o zero à esquerda, como a ENEL escreve. O banco
 * guarda 12 dígitos (`0` + os 11 da ENEL) para que "70706589202" e "070706589202" sejam a
 * mesma nota; quem lê a ENEL nunca viu o zero. Fora dessa forma, devolve como veio.
 */
export function notaNaTela(nota: string | null | undefined): string | null {
  const n = limpo(nota);
  if (n === null) return null;
  return /^0\d{11}$/.test(n) ? n.slice(1) : n;
}

/**
 * O mesmo, dentro de um texto corrido: o título e a mensagem que `ludmilla_cobranca_abrir_afazer`
 * grava trazem a nota com o zero. Só mexe em 12 dígitos soltos com zero na frente (a UC, de 10
 * dígitos, e a data não casam). Sem lookbehind: o app roda em Safari antigo, onde ele não existe.
 */
export function textoComNotaNaTela(texto: string): string {
  return texto.replace(/(^|\D)0(\d{11})(?!\d)/g, '$1$2');
}

/** dd/mm/aaaa no horário de Brasília. */
export function dataBr(d: string | Date): string {
  const x = typeof d === 'string' ? new Date(d) : d;
  return new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, day: '2-digit', month: '2-digit', year: 'numeric' }).format(x);
}

/** A hora (0–23) em Brasília. */
export function horaEmBrasilia(agora: Date): number {
  const partes = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, hour: '2-digit', hourCycle: 'h23' }).formatToParts(agora);
  return Number(partes.find(p => p.type === 'hour')?.value ?? '0');
}

/** "bom dia" até 11:59 de Brasília; "boa tarde" a partir do meio-dia. */
export function saudacao(agora: Date): 'bom dia' | 'boa tarde' {
  return horaEmBrasilia(agora) < 12 ? 'bom dia' : 'boa tarde';
}

export interface DadosDoEmail { nota: string; dataDaNota: string; uc: string; titular: string; nt: string }

/** O que preenche o modelo. NT = o protocolo do cadastro com 9 dígitos (na ENEL o protocolo É a NT). */
export function dadosDoEmail(c: CobrancaDoAfazer): DadosDoEmail {
  const bruto = c.projeto?.project_general_data;
  const g = Array.isArray(bruto) ? bruto[0] : bruto;
  const nt = (c.projeto?.protocol_number ?? '').replace(/\D/g, '').replace(/^0+/, '');
  return {
    nota: notaNaTela(c.nota_servico) ?? '[NÚMERO DA NOTA]',
    dataDaNota: dataBr(c.data_nota),
    uc: limpo(g?.uc_number) ?? '[UC]',
    titular: limpo(g?.holder_name) ?? '[TITULAR]',
    nt: /^\d{9}$/.test(nt) ? nt : '[NT]',
  };
}

/** "> " em cada linha: a cobrança anterior, que o "retomando o e-mail abaixo" promete. */
const citar = (texto: string): string => texto.split(/\r?\n/).map(l => (l ? `> ${l}` : '>')).join('\n');

/**
 * O e-mail da cobrança (spec §5). A 1ª abre com a saudação da hora; da 2ª em diante, com
 * "Prezados, retomando o e-mail abaixo:" — e a cobrança anterior vai citada embaixo.
 */
export function montarEmailDeCobranca(c: CobrancaDoAfazer, agora: Date): string {
  const d = dadosDoEmail(c);
  const corpo = [
    c.enviadas > 0 ? 'Prezados, retomando o e-mail abaixo:' : `Prezados, ${saudacao(agora)}.`,
    '',
    `Referente à nota de serviço nº ${d.nota}, aberta em ${d.dataDaNota} para a troca do medidor da instalação ${d.uc} — titular ${d.titular}, NT ${d.nt}:`,
    '',
    'poderiam, por gentileza, confirmar se a troca já foi executada? Caso tenha sido reprogramada, pedimos a gentileza de nos informar a nova data.',
    '',
    'Atenciosamente,',
    ASSINATURA_DA_COBRANCA,
  ].join('\n');
  const anterior = c.enviadas > 0 ? limpo(c.ultimo_texto_enviado) : null;
  if (!anterior) return corpo;
  const cabecalho = c.ultima_enviada_em
    ? `Em ${dataBr(c.ultima_enviada_em)}, ${ASSINATURA_DA_COBRANCA} escreveu:`
    : `Na cobrança anterior, ${ASSINATURA_DA_COBRANCA} escreveu:`;
  return `${corpo}\n\n${cabecalho}\n${citar(anterior)}`;
}

/** O que a tela abre para editar: o texto já aprovado que não saiu (falha), senão o modelo. */
export function rascunhoDaCobranca(c: CobrancaDoAfazer, agora: Date): string {
  return limpo(c.texto_aprovado) ?? montarEmailDeCobranca(c, agora);
}

/** A trava do Enviar na tela. A do banco (`ludmilla_cobranca_aprovar`) é a mesma. */
export function textoPronto(texto: string): { ok: true; porque: null } | { ok: false; porque: string } {
  const t = texto.trim();
  if (t.length < TAMANHO_MINIMO_DO_TEXTO) return { ok: false, porque: 'Escreva o texto do e-mail.' };
  if (t.length > TAMANHO_MAXIMO_DO_TEXTO) return { ok: false, porque: `O texto passou de ${TAMANHO_MAXIMO_DO_TEXTO} caracteres.` };
  const falta = LACUNAS.filter(l => t.includes(l));
  if (falta.length > 0) return { ok: false, porque: `Complete no texto: ${falta.join(', ')}.` };
  return { ok: true, porque: null };
}

/** Uma frase sobre onde a cobrança está — para a linha já decidida. */
export function resumoDaCobranca(c: CobrancaDoAfazer): string {
  switch (c.situacao) {
    case 'aguardando_envio':
      return c.erro ? `O último envio não saiu: ${c.erro}` : 'Esperando alguém da equipe revisar e enviar.';
    case 'enviando':
      return 'Saindo agora pela caixa da Ludmilla.';
    case 'agendada':
      return c.enviadas > 0
        ? `Enviada ${c.enviadas}× (a última em ${dataBr(c.ultima_enviada_em ?? c.vence_em)}). Próxima cobrança em ${dataBr(c.vence_em)}, se a ENEL não responder.`
        : `Agendada para ${dataBr(c.vence_em)}.`;
    case 'encerrada':
      return c.motivo_encerramento ? `Encerrada: ${c.motivo_encerramento}` : 'Encerrada.';
    case 'dispensada':
      return 'Dispensada pela equipe: não sai mais cobrança desta nota.';
  }
}
