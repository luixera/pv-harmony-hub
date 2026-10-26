// worker/ludmilla/src/email/enel/cobranca.ts
import type { MensagemLida } from '../caixa.js';
import { semAcento } from '../util.js';
import { textoNovo, type Classificacao } from './classificar.js';

/**
 * A COBRANÇA DA TROCA DO RELÓGIO NA ENEL — o que não precisa de banco nem de rede.
 * Spec: docs/superpowers/specs/2026-10-24-ludmilla-enel-cobranca-troca-design.md.
 *
 * Duas pontas:
 *  · na LEITURA (run `varredura_email`): o e-mail que abre ou reabre uma nota de serviço
 *    vira os dados de uma cobrança agendada (`cobrancaDaMensagem`);
 *  · no ENVIO (run `enviar_cobranca`): as travas que valem ANTES de qualquer byte sair
 *    (`podeEnviar`) e a saudação na hora do envio (`ajustarSaudacao`).
 * As travas existem TAMBÉM no banco (migração 20261025120000, que corrigiu a 20261024150000);
 * testes conferem que a expressão do destinatário e os limites de References são os mesmos nas
 * duas pontas. Nada aqui manda e-mail.
 */

export const DIAS_ENTRE_COBRANCAS = 7;
const DIA = 86_400_000;
const FUSO = 'America/Sao_Paulo';

/**
 * O destinatário: UM endereço, já minúsculo, @enel.com ou @br.enel.com. A MESMA expressão
 * de `public.ludmilla_endereco_da_enel` (o teste lê a migração 20261025120000; o `%` foi
 * tirado dela na revisão, porque `x%evil.com@enel.com` passava). Sem a flag `i` de propósito:
 * o endereço chega normalizado por `enderecoDoRemetente`, e maiúscula aqui é sinal de que
 * ele não passou por lá.
 */
export const REGEX_DESTINATARIO_ENEL = /^[a-z0-9][a-z0-9._+-]*@(br\.)?enel\.com$/;

/**
 * Um Message-ID de verdade: `<algo@algo>`, sem espaço, quebra de linha nem caractere de
 * controle (C0, DEL e C1: os mesmos que o banco recusa). O tamanho tem teto (998, o limite de
 * linha do RFC 5322): o Message-ID vem de um e-mail de fora, e sem o teto uma sequência
 * enorme de `@` faria o `+@+` do padrão recomeçar a cada `@` (quadrático).
 */
const ID_DE_MENSAGEM = /^<[^<>\s\u0000-\u001f\u007f-\u009f]+@[^<>\s\u0000-\u001f\u007f-\u009f]+>$/;
const MAX_ID_DE_MENSAGEM = 998;
const ehIdDeMensagem = (x: unknown): x is string =>
  typeof x === 'string' && x.length <= MAX_ID_DE_MENSAGEM && ID_DE_MENSAGEM.test(x);

/** O limite do `References`: no máximo 20 ids e 2000 caracteres (juntos por espaço), como no banco. */
export const MAX_REFERENCIAS = 20;
export const MAX_CARACTERES_REFERENCIAS = 2000;

/**
 * O número da nota de serviço, como a ENEL escreve nos e-mails:
 *  · 11 dígitos (`707…`), a forma mais comum; ou
 *  · 12 dígitos com um zero à esquerda (`0707…`).
 * Vem logo depois do termo "nota de serviço", "nota" ou "ordem [de serviço]" (até 40
 * caracteres SEM dígito no meio, para "criada nº"). Só a parte NOVA do e-mail, com as
 * entidades decodificadas. A forma canônica é a de 12 dígitos com zero (`padStart`): a que o
 * CHECK do banco aceita, e que faz os dois jeitos de escrever virarem a MESMA nota.
 *
 * A NT tem 9 dígitos e nunca casa ("nota 391…" é a NT). 12 dígitos sem o zero na frente também
 * não: qualquer outra coisa é null. Dois números diferentes = ambíguo = null: a cobrança nasce
 * sem número e a tela pede "confira o número da nota" (spec §6).
 *
 * O `\b` dos dois lados do termo evita "notamos", "anotou" e "denota" (o termo curto "nota"
 * existe porque a ENEL às vezes escreve só "através da nota …").
 */
const NOTA = /\b(?:nota de servico|nota|ordem(?: de servico)?)\b\D{0,40}?(?<!\d)(0?\d{11})(?!\d)/g;
export function notaDeServico(corpo: string | null | undefined): string | null {
  const t = semAcento(textoNovo(corpo)).toLowerCase();
  const achadas = new Set([...t.matchAll(NOTA)].map(m => m[1].padStart(12, '0')));
  return achadas.size === 1 ? [...achadas][0] : null;
}

/**
 * O endereço do remetente, minúsculo: o que está entre `<>` ("Canal GD <x@y>") ou o
 * endereço sozinho. Mais de um endereço, espaço ou quebra de linha = null (não há para
 * quem responder com segurança).
 */
export function enderecoDoRemetente(remetente: string | null | undefined): string | null {
  const t = (remetente ?? '').trim();
  if (!t || /[\r\n]/.test(t)) return null;
  const entre = [...t.matchAll(/<([^<>]*)>/g)].map(x => x[1].trim());
  let e: string;
  if (entre.length > 1) return null;
  if (entre.length === 1) e = entre[0];
  else {
    if (/[\s,;]/.test(t)) return null;
    e = t;
  }
  e = e.toLowerCase();
  return e === '' || /[\s,;<>]/.test(e) ? null : e;
}

/** A trava do destinatário (a mesma do banco). */
export function destinatarioDaEnel(endereco: string | null | undefined): boolean {
  return typeof endereco === 'string' && REGEX_DESTINATARIO_ENEL.test(endereco);
}

/**
 * "RE: " + o assunto da nota, uma vez só, sem caractere de controle (C0, DEL e C1, como o
 * banco), até 300.
 */
export function assuntoDaResposta(assunto: string | null | undefined): string {
  const limpo = (assunto ?? '').replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').replace(/\s+/g, ' ').trim();
  const base = limpo || 'TROCA DE RELÓGIO';
  return (/^(re|res)\s*:/i.test(base) ? base : `RE: ${base}`).slice(0, 300);
}

/**
 * Os cabeçalhos que põem a resposta NA conversa da nota: `In-Reply-To` = o Message-ID da
 * nota; `References` = as referências dela + o Message-ID dela, no fim (RFC 5322 §3.6.4).
 * Só ids de verdade; sem o da nota (`imap-uid-N`, envelope sem Message-ID), não há a quem
 * ligar e o e-mail vai só com o "RE:".
 *
 * O `References` tem limite (o do banco): no máximo 20 ids e 2000 caracteres no total. O que
 * passa disso sai pelo lado das MAIS ANTIGAS (a nota, no fim, fica); se nada couber, a lista
 * vai vazia e o e-mail sai sem `References`.
 */
export function cabecalhosDaResposta(messageId: string, referencias: readonly string[] = []): {
  inReplyTo: string | null; referencias: string[];
} {
  const inReplyTo = ehIdDeMensagem(messageId) ? messageId : null;
  const lista = [...new Set([...referencias.filter(x => ehIdDeMensagem(x) && x !== inReplyTo), ...(inReplyTo ? [inReplyTo] : [])])]
    .slice(-MAX_REFERENCIAS);
  while (lista.length > 0 && lista.join(' ').length > MAX_CARACTERES_REFERENCIAS) lista.shift();
  return { inReplyTo, referencias: lista };
}

/** A cobrança vence 7 dias depois da base (o e-mail da nota, ou o último envio). */
export function vencimento(base: Date): Date {
  return new Date(base.getTime() + DIAS_ENTRE_COBRANCAS * DIA);
}

/** dd/mm/aaaa no horário de Brasília ('' se a data for ilegível: nunca derruba o run). */
export function dataBr(d: Date | string): string {
  const x = typeof d === 'string' ? new Date(d) : d;
  if (!Number.isFinite(x.getTime())) return '';
  return new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, day: '2-digit', month: '2-digit', year: 'numeric' }).format(x);
}

/** A hora (0–23) em Brasília. */
export function horaEmBrasilia(agora: Date): number {
  const partes = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, hour: '2-digit', hourCycle: 'h23' }).formatToParts(agora);
  return Number(partes.find(p => p.type === 'hour')?.value ?? '0');
}

/** "bom dia" até 11:59 de Brasília; "boa tarde" a partir do meio-dia (spec §5). */
export function saudacaoNaHora(agora: Date): 'bom dia' | 'boa tarde' {
  return horaEmBrasilia(agora) < 12 ? 'bom dia' : 'boa tarde';
}

/**
 * Na hora do envio, a 1ª linha do modelo ("Prezados, bom dia." / "Prezados, boa tarde.")
 * passa a dizer a saudação certa. Se a pessoa mexeu nessa linha, ela fica como está — o
 * robô nunca reescreve o que alguém aprovou.
 */
const PRIMEIRA_LINHA_DO_MODELO = /^Prezados, (?:bom dia|boa tarde)\.(?=\r?\n|$)/;
export function ajustarSaudacao(texto: string, agora: Date): string {
  return texto.replace(PRIMEIRA_LINHA_DO_MODELO, `Prezados, ${saudacaoNaHora(agora)}.`);
}

export interface DadosDaCobranca {
  /** a nota na forma canônica (12 dígitos, com zero à esquerda), ou null se não deu para ler */
  nota: string | null;
  /** ISO: a data do e-mail da nota (sem data, a hora da leitura) */
  dataNota: string;
  prazoDias: number | null;
  para: string;
  assunto: string;
  inReplyTo: string | null;
  referencias: string[];
}

export type NotaDaMensagem =
  | { tipo: 'nenhuma' }
  /** o e-mail fala de uma nota, mas o remetente não é da ENEL: não há para quem cobrar */
  | { tipo: 'fora_da_enel' }
  | { tipo: 'nota'; dados: DadosDaCobranca };

/**
 * Este e-mail abre (ou reabre) uma nota de serviço? A troca AGENDADA sempre; a troca que
 * FALHOU só quando traz o número da nota (é o "Reenviamos a nota de serviço …", a
 * reprogramação). A troca (ou reprogramação) JÁ FEITA não abre nada: ela ENCERRA
 * (`trocaFoiRealizada`). O remetente é quem recebe a cobrança, e tem de passar na trava.
 */
export function cobrancaDaMensagem(
  c: Classificacao,
  m: Pick<MensagemLida, 'messageId' | 'assunto' | 'remetente' | 'recebidoEm' | 'texto'> & { referencias?: string[] },
  agora: Date,
): NotaDaMensagem {
  if (c?.tipo !== 'troca_relogio') return { tipo: 'nenhuma' };
  if (c.estado !== 'agendada' && c.estado !== 'nao_executada') return { tipo: 'nenhuma' };
  const nota = notaDeServico(m.texto);
  if (c.estado === 'nao_executada' && nota === null) return { tipo: 'nenhuma' };
  const para = enderecoDoRemetente(m.remetente);
  if (para === null || !destinatarioDaEnel(para)) return { tipo: 'fora_da_enel' };
  const prazo = c.estado === 'agendada' ? c.prazoDias : null;
  const { inReplyTo, referencias } = cabecalhosDaResposta(m.messageId, m.referencias ?? []);
  const recebido = m.recebidoEm && Number.isFinite(m.recebidoEm.getTime()) ? m.recebidoEm : agora;
  return {
    tipo: 'nota',
    dados: {
      nota,
      dataNota: recebido.toISOString(),
      prazoDias: prazo !== null && prazo >= 1 && prazo <= 365 ? prazo : null,
      para,
      assunto: assuntoDaResposta(m.assunto),
      inReplyTo,
      referencias,
    },
  };
}

/**
 * A ENEL disse que a troca foi feita — ou que a reprogramação do medidor foi feita, que
 * quando o medidor já é bidirecional é o fim do serviço. A classificação vem da frente "troca
 * realizada → Concluído" (`{ tipo: 'troca_relogio'; estado: 'realizada' }`): este é o ÚNICO
 * ponto da cobrança que conhece o nome desse estado.
 */
export function trocaFoiRealizada(c: Classificacao): boolean {
  return c?.tipo === 'troca_relogio' && c.estado === 'realizada';
}

export interface EstadoDoEnvio {
  situacaoAnterior: string | null;
  aprovadaPor: string | null;
  ultimaEnviadaEm: string | null;
  para: string | null;
  texto: string | null;
}

/**
 * A trava do envio NO WORKER, independente do banco (spec §3.4: "verificadas no worker
 * E no banco"). Data ilegível do último envio = não envia (na dúvida, nada sai).
 */
export function podeEnviar(c: EstadoDoEnvio, agora: Date): { ok: true } | { ok: false; motivo: string } {
  if (c.situacaoAnterior !== 'aguardando_envio') {
    return { ok: false, motivo: `a cobrança não estava esperando envio (${c.situacaoAnterior ?? 'sem situação'})` };
  }
  if (!c.aprovadaPor) return { ok: false, motivo: 'a cobrança não foi aprovada por uma pessoa da equipe' };
  if (!destinatarioDaEnel(c.para)) return { ok: false, motivo: 'o destinatário não é um endereço @enel.com ou @br.enel.com' };
  if (c.ultimaEnviadaEm !== null) {
    const t = Date.parse(c.ultimaEnviadaEm);
    if (!Number.isFinite(t) || agora.getTime() - t < DIAS_ENTRE_COBRANCAS * DIA) {
      return { ok: false, motivo: 'já saiu uma cobrança desta nota há menos de 7 dias' };
    }
  }
  if (!(c.texto ?? '').trim()) return { ok: false, motivo: 'a cobrança está sem texto' };
  return { ok: true };
}
