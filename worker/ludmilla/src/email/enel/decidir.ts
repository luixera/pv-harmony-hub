// worker/ludmilla/src/email/enel/decidir.ts
import { chaveProtocolo, comparavelTitular, type RegraEmail, type Veredito } from '../util.js';
import type { Classificacao } from './classificar.js';
import { mesmaEmpresaAbreviada, mesmoTitular, type Identificacao, type Sinal } from './identificar.js';

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
  // A troca que a ENEL diz já ter feito: o cartão sugere Concluído (decisão do usuário, 24/10/2026).
  // A agendada e a que falhou seguem sem etapa: uma é o pedido andando, a outra é aviso.
  if (c?.tipo === 'troca_relogio') return c.estado === 'realizada' ? 'completed' : null;
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
 * A sugestão cabe na etapa em que o projeto está? A primeira leitura traz 120 dias
 * de e-mails: uma Carta de aprovação de um projeto que já está em vistoria não
 * pode virar sugestão de voltar para Aprovado.
 */
export function recomendacaoCabe(recomendacao: string, statusAtual: string): boolean {
  if (recomendacao === statusAtual) return false;
  // Concluído é a ÚLTIMA etapa: cabe em qualquer outra, nunca é "para trás".
  if (recomendacao === 'completed') return true;
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

export const JANELA_MAXIMA_DIAS = 120;
/** Até quantos dias de idade o e-mail ainda toca o sino (decisão do usuário, 24/10/2026). */
export const DIAS_PARA_AVISAR = 30;
const DIA = 86_400_000;

/**
 * A janela é FIXA: os últimos 120 dias, em todo run. Uma janela "desde a última
 * varredura" fazia a mensagem pendente (IA sem cota por dias, por exemplo) e o
 * "Ler de novo" sumirem da busca sem aviso. O envelope é barato: a pendência
 * filtra as já concluídas e a IA só roda para as pendentes.
 */
export function janelaDeBusca(agora: Date): Date {
  return new Date(agora.getTime() - JANELA_MAXIMA_DIAS * DIA);
}

/**
 * A janela lê 120 dias de histórico, mas o sino só toca para e-mail de até 30:
 * o que é mais velho já foi resolvido pela equipe, e avisar de novo inundaria o
 * sino. O e-mail antigo é tratado, anexado e registrado do mesmo jeito; só o aviso
 * cala. Sem data (ou data ilegível), na dúvida, avisa. Exatamente 30 dias ainda avisa.
 */
export function deveAvisar(recebidoEm: Date | null, agora: Date): boolean {
  if (!recebidoEm || Number.isNaN(recebidoEm.getTime())) return true;
  return agora.getTime() - recebidoEm.getTime() <= DIAS_PARA_AVISAR * DIA;
}

/** A ressalva do histórico quando houve aviso a tocar e ele calou por idade. */
export const RESSALVA_AVISO_ANTIGO = `aviso não tocado: e-mail de mais de ${DIAS_PARA_AVISAR} dias`;

/** Os remetentes a procurar: os das regras, sem repetir, sem o comunicado (que é ignorado sem nem ser buscado). */
export function remetentesParaBuscar(regras: RegraEmail[]): string[] {
  const s = new Set<string>();
  for (const r of regras) {
    if (r.remetente && r.tipo_documento !== 'comunicado') s.add(r.remetente.trim().toLowerCase());
  }
  return [...s];
}

/**
 * Os remetentes do run, ou ERRO. Regras sem remetente nenhum (ou só de comunicado)
 * não podem virar um run "ok" com 0 lidos: a frase é a de "sem regras"
 * (`classificarErroEmail` → `sem_regras`), que a tela já explica.
 */
export function remetentesDoRun(regras: RegraEmail[]): string[] {
  const r = remetentesParaBuscar(regras);
  if (r.length === 0) {
    throw new Error('Esta concessionária não tem regras de e-mail cadastradas com remetente na tela da Ludmilla (a ENEL procura os e-mails pelo remetente).');
  }
  return r;
}

/** O que a troca de protocolo precisa da leitura do PDF. */
export interface LeituraDaCarta { ok: boolean; tipo: string | null; nt: string | null }

/** Todas as NTs reais vistas têm 9 dígitos. Mais que isso é número colado ("NT … (SF …)"). */
export const DIGITOS_DA_NT = 9;

/**
 * Os números de um campo do cadastro: os dígitos todos colados E cada pedaço
 * (`/\d+/g`), sem zeros à esquerda. "NT 391.000.001" é 391000001 (colado);
 * "391000777 / 391000001" traz os dois (pedaços).
 */
function numerosDoCampo(s: string | null | undefined): Set<string> {
  const pedacos = ((s ?? '').match(/\d+/g) ?? []).map(x => x.replace(/^0+/, ''));
  return new Set([chaveProtocolo(s ?? ''), ...pedacos].filter(x => x.length > 0));
}

export type TrocaDeProtocolo =
  | { tipo: 'nenhuma' }
  /** o cartão sugere gravar a NT */
  | { tipo: 'pedir'; nt: string }
  /** a Carta traz outra NT, mas o projeto já tem protocolo e está à frente: só a ressalva */
  | { tipo: 'conferir'; nt: string; doCadastro: string };

/**
 * A Carta sugere gravar a NT dela como protocolo do projeto?
 *
 * Na ENEL o protocolo do projeto É a NT, e a Carta traz a NT. Projeto achado pela
 * UC ou pelo nome, sem protocolo (no cadastro há texto, como "Sem protocolo") ou
 * com outro número, sai com o cartão sugerindo gravar a NT. SÓ a NT que a IA leu na
 * CARTA: número do assunto ou do corpo nunca vira protocolo (spec §6.1). Pede só se:
 *  1. a NT tem EXATAMENTE 9 dígitos sem os zeros à esquerda (a leitura cola os
 *     dígitos: "NT 391000001 (SF 01234)" vira 14);
 *  2. a NT não é a UC do próprio projeto (a IA às vezes troca os campos);
 *  3. a NT não é o protocolo que o cadastro já tem;
 *  4. se o projeto JÁ tem protocolo numérico de 9 dígitos E está à frente — a etapa
 *     lida foi barrada por isso (`etapaBarrada`) OU o projeto já passou da fase da
 *     Carta (status fora de `ANTES_DA_APROVACAO`, o que pega a Carta antiga SEM
 *     veredito, que não sugere etapa nenhuma) —, a Carta é antiga e a NT dela é a
 *     VELHA. Não pede: fica a conferência. Sem protocolo numérico, pede mesmo à
 *     frente (é o caso que motivou o pedido do usuário).
 *     Resíduo conhecido: Carta de pendência ANTIGA com o projeto ainda em `analysis` e
 *     a NT nova no cadastro pede a troca para a NT velha; separar exigiria a data da
 *     Carta contra a do protocolo, que a robô não tem.
 * CPF e CNPJ não estão em `ProjetoEnel`. Um CPF começado por "00" tem 9 dígitos sem
 * os zeros e passaria pela regra 1 se a IA o pusesse no campo `nt` (improvável: o
 * prompt pede a NT e o CPF não tem cara de NT). Nesse caso o banco recusa a gravação
 * (`ludmilla_email_registrar`, trava de 1a7cead: compara com a UC por pedaço e com o
 * CPF/CNPJ do titular do próprio projeto) e sobra um cartão sem sugestão — nada vai
 * para o cadastro.
 */
export function trocaDeProtocolo(
  p: LeituraDaCarta, projeto: { protocolo: string | null; uc: string | null; status: string }, etapaBarrada: boolean,
): TrocaDeProtocolo {
  if (!p.ok || p.tipo !== 'carta_projeto') return { tipo: 'nenhuma' };
  const nt = chaveProtocolo(p.nt ?? '');
  if (nt.length !== DIGITOS_DA_NT) return { tipo: 'nenhuma' };
  if (numerosDoCampo(projeto.uc).has(nt)) return { tipo: 'nenhuma' };
  const doCadastro = numerosDoCampo(projeto.protocolo);
  if (doCadastro.has(nt)) return { tipo: 'nenhuma' };
  const numerico = [...doCadastro].find(x => x.length === DIGITOS_DA_NT);
  const aFrente = etapaBarrada || !ANTES_DA_APROVACAO.has(projeto.status);
  if (numerico && aFrente) return { tipo: 'conferir', nt, doCadastro: numerico };
  return { tipo: 'pedir', nt };
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
 * Nome que não dá para comparar é FALTA DE DADO, nunca divergência — inclusive o
 * que não bate nem consigo mesmo ("LU SANTOS NETO", "ANA ME LTDA": sem dois nomes de
 * 3+ letras, `mesmoTitular(n, n)` é false e o próprio nome se bloqueava).
 *
 * Razão social CORTADA (decisão do usuário, 24/10/2026): o documento traz "Comercial Renova
 * Recuperadora De Pecas" e o cadastro "… ACESSÓRIOS PARA VEÍCULOS E AUTOMOTORES LTDA" — é a
 * mesma empresa, e a trava bloqueava (`mesmoTitular` quer o último nome igual). Só relaxa quando
 * o projeto foi achado por NÚMERO (`por` = protocolo ou UC: o documento é do projeto certo e só o
 * nome veio abreviado) e `mesmaEmpresaAbreviada` diz que um nome é o começo do outro. Achado pelo
 * nome, a trava segue inteira: aí o nome é a ÚNICA prova, e abreviá-lo prova menos ainda.
 * `por` ausente = como sempre.
 */
export function titularDeOutraPessoa(doSistema: string | null, doDocumento: string | null, por?: Sinal | null): boolean {
  if (!doSistema || !doDocumento) return false;
  if (!comparavelTitular(doSistema) || !comparavelTitular(doDocumento)) return false;
  if (!mesmoTitular(doSistema, doSistema) || !mesmoTitular(doDocumento, doDocumento)) return false;
  if (mesmoTitular(doSistema, doDocumento) || mesmoTitular(doDocumento, doSistema)) return false;
  if ((por === 'protocolo' || por === 'uc') && mesmaEmpresaAbreviada(doSistema, doDocumento)) return false;
  return true;
}
