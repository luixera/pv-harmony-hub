// worker/ludmilla/src/email/enel/decidir.ts
import { chaveProtocolo, comparavelTitular, type RegraEmail, type Veredito } from '../util.js';
import type { Classificacao } from './classificar.js';
import { MIN_DIGITOS, mesmoTitular, type Identificacao } from './identificar.js';

/**
 * As decisões do run da ENEL que não precisam de banco nem de rede: ler o PDF
 * (pagar a IA)?, que etapa sugerir, a sugestão cabe?, que aviso tocar, que janela
 * de busca, quais remetentes, que NT vira protocolo e quando o titular bloqueia.
 */

/** O que interessa da leitura do PDF para decidir. */
export interface LeituraParaDecidir { ok: boolean; tipo: string | null; veredito: Veredito | null }

/**
 * A IA (US$ ~0,10 por PDF) só é chamada em dois casos (spec §6.3):
 *  1. o texto não identificou o projeto — o PDF pode dizer;
 *  2. a regra espera um veredito e o texto não trouxe — as Cartas chegam com o
 *     corpo vazio, tudo está no PDF.
 * Conflito ou projeto inativo no texto: ler não resolve, então não paga.
 */
export function precisaLerPdf(regra: RegraEmail, idTexto: Identificacao, c: Classificacao, temPdf: boolean): boolean {
  if (!regra.ler_pdf || !temPdf) return false;
  if (idTexto.tipo === 'conflito' || idTexto.tipo === 'inativo') return false;
  if (idTexto.tipo === 'nenhum') return true;
  const esperaVeredito = regra.tipo_documento === 'carta_projeto' || regra.tipo_documento === 'resultado_vistoria';
  return esperaVeredito && c === null;
}

/** Mapa de etapas (spec §8). O texto vale antes do PDF; sem leitura ok, não há sugestão do PDF. */
export function recomendacaoEnel(c: Classificacao, p: LeituraParaDecidir): string | null {
  if (c?.tipo === 'resultado_vistoria') return c.aprovada ? null : 'vistoria_reprovada';
  if (c?.tipo === 'troca_relogio') return null;
  if (!p.ok) return null;
  if (p.tipo === 'carta_projeto') {
    // "aprovado, porém solicitamos observar…" também é favorável (os itens vão na ressalva)
    if (p.veredito === 'favoravel') return 'approved';
    if (p.veredito === 'pendencia') return 'pendencia';
    return null;
  }
  if (p.tipo === 'resultado_vistoria') return p.veredito === 'pendencia' ? 'vistoria_reprovada' : null;
  return null;
}

const ANTES_DA_APROVACAO = new Set(['pending', 'analysis', 'documentation', 'approval', 'pendencia']);

/**
 * A sugestão cabe na etapa em que o projeto está? A primeira leitura traz 30 dias
 * de e-mails: uma Carta de aprovação de um projeto que já está em vistoria não
 * pode virar sugestão de voltar para Aprovado.
 */
export function recomendacaoCabe(recomendacao: string, statusAtual: string): boolean {
  if (recomendacao === statusAtual) return false;
  if (recomendacao === 'approved' || recomendacao === 'pendencia') return ANTES_DA_APROVACAO.has(statusAtual);
  if (recomendacao === 'vistoria_reprovada') return statusAtual === 'approved' || statusAtual === 'vistoria_solicitada';
  return true;
}

export interface Aviso { titulo: string; mensagem: string }

/** Os três momentos que pedem ação de uma pessoa (spec §10). A robô só lembra. */
export function avisosEnel(
  tipoDaRegra: string, c: Classificacao, p: LeituraParaDecidir | null, projeto: { codigo: string } | null,
): Aviso[] {
  const sobre = projeto ? ` do projeto ${projeto.codigo}` : '';
  if (tipoDaRegra === 'devolucao') {
    // A devolução de 30/09 chegou no MESMO minuto da resposta automática da ENEL:
    // quem não recebeu foi outro destinatário. Dizer "a ENEL não recebeu" mandaria
    // reenviar o que a ENEL já tem.
    return [{
      titulo: '📡 Um e-mail nosso voltou',
      mensagem: `Um dos destinatários de um e-mail${sobre} não recebeu a mensagem (devolução do servidor). Confira se a ENEL recebeu — a resposta automática dela costuma chegar no mesmo minuto.`,
    }];
  }
  const videoOk = (c?.tipo === 'resultado_vistoria' && c.aprovada)
    || (c === null && p?.ok && p.tipo === 'resultado_vistoria' && p.veredito === 'favoravel');
  if (videoOk) {
    return [{ titulo: '📡 Vistoria virtual aprovada na ENEL', mensagem: `A ENEL aprovou o vídeo de anti-ilhamento${sobre}. É hora de pedir a troca do relógio.` }];
  }
  if (c?.tipo === 'troca_relogio' && c.estado === 'nao_executada') {
    return [{ titulo: '📡 A ENEL não trocou o relógio', mensagem: `A tentativa de troca do relógio${sobre} não foi executada${c.motivo ? `: ${c.motivo}` : ''}.` }];
  }
  return [];
}

export const JANELA_MAXIMA_DIAS = 30;
const DIA = 86_400_000;

/** 30 dias na primeira leitura; depois, desde a última verificação menos 2 dias — nunca mais que 30. */
export function janelaDeBusca(ultimaVarreduraEm: string | null, agora: Date): Date {
  const limite = new Date(agora.getTime() - JANELA_MAXIMA_DIAS * DIA);
  if (!ultimaVarreduraEm) return limite;
  const desde = new Date(new Date(ultimaVarreduraEm).getTime() - 2 * DIA);
  return desde > limite ? desde : limite;
}

/** Os remetentes a procurar: os das regras, sem repetir, sem o comunicado (que é ignorado sem nem ser buscado). */
export function remetentesParaBuscar(regras: RegraEmail[]): string[] {
  const s = new Set<string>();
  for (const r of regras) {
    if (r.remetente && r.tipo_documento !== 'comunicado') s.add(r.remetente.trim().toLowerCase());
  }
  return [...s];
}

/** O que a troca de protocolo precisa da leitura do PDF. */
export interface LeituraDaCarta { ok: boolean; tipo: string | null; nt: string | null }

/**
 * A NT que o cartão sugere gravar como protocolo do projeto, ou null.
 *
 * Na ENEL o protocolo do projeto É a NT (9 dígitos), e a Carta traz a NT. Projeto
 * achado pela UC ou pelo nome, sem protocolo (no cadastro há texto, como "Sem
 * protocolo") ou com outro número, sai com o cartão sugerindo gravar a NT.
 *
 * SÓ a NT que a IA leu na CARTA. Número do assunto ou do corpo nunca vira protocolo
 * (princípio "nossos números", spec §6.1): o e-mail traz protocolo de atendimento,
 * nota de serviço e número SF, e qualquer um deles gravado no cadastro seria pior
 * que o cadastro vazio. Comparação por dígitos, sem zeros à esquerda; protocolo
 * sem dígito conta como vazio. O banco trava de novo (`ludmilla_email_registrar`).
 */
export function ntParaGravar(p: LeituraDaCarta, protocoloDoCadastro: string | null): string | null {
  if (!p.ok || p.tipo !== 'carta_projeto') return null;
  const nt = chaveProtocolo(p.nt ?? '');
  if (nt.length < MIN_DIGITOS) return null;
  return nt === chaveProtocolo(protocoloDoCadastro ?? '') ? null : nt;
}

/**
 * O titular do DOCUMENTO é outra pessoa? É o único bloqueio do anexo.
 *
 * O projeto já foi achado por um NÚMERO (ou pelo nome no assunto): a trava existe
 * para pegar uma PESSOA DIFERENTE. Um nome que é o outro com nomes do meio omitidos
 * é a mesma pessoa, de qualquer um dos lados — por isso `mesmoTitular` nos DOIS
 * sentidos ("CELINA MOURAO" × "CELINA DE FARIAS PRUDENTE MOURAO" passa). Mesmo
 * primeiro e último nome com o do meio trocado é outra pessoa e bloqueia: era o que
 * `casaTitular` (só primeiro e último) deixava entrar no card errado.
 * Nome que não dá para comparar é FALTA DE DADO, nunca divergência.
 */
export function titularDeOutraPessoa(doSistema: string | null, doDocumento: string | null): boolean {
  if (!doSistema || !doDocumento) return false;
  if (!comparavelTitular(doSistema) || !comparavelTitular(doDocumento)) return false;
  return !mesmoTitular(doSistema, doDocumento) && !mesmoTitular(doDocumento, doSistema);
}
