// worker/ludmilla/src/email/enel/enviar.ts
import {
  cobrancaEnviada, cobrancaFalhou, cobrancaSemConfirmacao, credencialDaCaixa, iniciarEnvioDeCobranca,
  type CobrancaParaEnviar, type Run,
} from '../../fila.js';
import { conferirNosEnviados, piorCasoDaConferenciaMs, type Conferencia, type ProcuraNosEnviados } from '../enviados.js';
import {
  PORTAS_DO_SMTP, codigoDaFalha, enviarPorSmtp, falhaDoEnvio, novoMessageId, piorCasoDeUmaOperacaoSmtpMs, podeTerSaido,
  type EmailDeSaida,
} from '../smtp.js';
import { ajustarSaudacao, assuntoDaResposta, cabecalhosDaResposta, podeEnviar } from './cobranca.js';

/**
 * Run `enviar_cobranca`: manda a cobrança que UMA PESSOA aprovou na aba Decidir.
 *  1. o banco "pega" a cobrança (`iniciarEnvio`: confere as travas e a deixa `enviando`);
 *     recusou = nada sai, e a frase do banco volta para a equipe (`falhou`);
 *  2. o worker confere as travas DE NOVO (`podeEnviar`), sem confiar no banco: destinatário
 *     @enel.com/@br.enel.com, aprovada por pessoa, 7 dias desde o último envio, texto presente;
 *  3. só então lê a senha da caixa e manda por SMTP, na conversa da nota (os cabeçalhos e o
 *     assunto do banco passam de novo pela trava do worker), com um Message-ID NOSSO;
 *  4. `enviada` (histórico, card, próxima em 7 dias) — ou `falhou` (volta para a equipe).
 *
 * A QUEDA NO MEIO DO ENVIO (decisão do usuário, 27/10/2026): caiu depois do `verify`, sem
 * resposta de recusa do servidor, não se sabe se saiu. Então a Ludmilla confere a pasta
 * Enviados (enviados.ts, IMAP só leitura, a mesma caixa):
 *  · achou → `enviada`, como num envio normal;
 *  · conferiu e não achou → reenvia UMA vez, o MESMO e-mail (o mesmo Message-ID): a aprovação
 *    da pessoa vale, porque é o mesmo e-mail. Caiu de novo → confere de novo; não achou de novo
 *    → `falhou` "não saiu: conferido na pasta Enviados, 2 tentativas". NUNCA uma 3ª;
 *  · não deu para conferir → NÃO reenvia e NÃO devolve: `semConfirmacao` (o banco faz na hora o
 *    reset conservador — possivelmente enviada, próxima em 7 dias, A fazer "Confira se a
 *    cobrança da nota N saiu"). Revisão da Task 5 (I-1): `falhou` aqui devolvia a cobrança com
 *    o botão Enviar, e o e-mail podia sair em dobro.
 * Recusa do servidor (4xx/5xx, EAUTH, EENVELOPE, EMESSAGE) é "nada foi enviado", sem conferir.
 * Recusa do banco com a cobrança `enviando`: ela está saindo por outro caminho — só o log.
 *
 * Depois que saiu (ou que pode ter saído), NADA chama `falhou`: devolver a cobrança faria
 * alguém reenviar. O registro que falha é REPETIDO (mesmo run, mesmo Message-ID), e o
 * sem-confirmação também; se ainda falhar, o reset de 30 min do banco trata o envio como
 * possivelmente feito. Run preso é do banco também. Nunca lança (o laço principal não tem
 * try). Log: o run, a cobrança, a fase, o código, o resultado da conferência e o endereço da
 * ENEL — nunca o texto, o assunto, o titular, a nota, a caixa ou a senha.
 * Pior caso de um run: `piorCasoDoEnvioMs()` (≤ 12 min, abaixo do reset de 30 min do `enviando`).
 */

const log = (msg: string, extra: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ t: new Date().toISOString(), msg, ...extra }));

type CaixaDeEmail = { email: string; senha: string };

export interface DepsEnvio {
  iniciarEnvio: (runId: string) => Promise<CobrancaParaEnviar>;
  credencialDaCaixa: (accountId: string) => Promise<CaixaDeEmail>;
  enviar: (c: CaixaDeEmail, m: EmailDeSaida) => Promise<string>;
  enviada: (runId: string, messageId: string) => Promise<void>;
  falhou: (runId: string, erro: string) => Promise<void>;
  /** não deu para saber se saiu: o reset conservador do banco, na hora (nunca `falhou`) */
  semConfirmacao: (runId: string, erro: string) => Promise<void>;
  /** a pausa antes de repetir o registro (ou o sem-confirmação) */
  esperar: (ms: number) => Promise<void>;
  /** depois de uma queda no meio do envio: o e-mail está na pasta Enviados? (com as esperas dela) */
  conferirEnviados: (c: CaixaDeEmail, p: ProcuraNosEnviados) => Promise<Conferencia>;
  /** o assunto e o texto que saem; sem isto, os da cobrança ("RE:" e a saudação do modelo dela) */
  montarSaida?: (c: CobrancaParaEnviar, instante: Date) => { assunto: string; texto: string };
  /** uma trava a mais, deste tipo de e-mail: devolve o motivo da recusa, ou null */
  travaExtra?: (c: CobrancaParaEnviar) => string | null;
}
export const DEPS_ENVIO: DepsEnvio = {
  iniciarEnvio: iniciarEnvioDeCobranca,
  credencialDaCaixa,
  enviar: (c, m) => enviarPorSmtp(c, m),
  enviada: cobrancaEnviada,
  falhou: cobrancaFalhou,
  semConfirmacao: cobrancaSemConfirmacao,
  esperar: ms => new Promise(r => setTimeout(r, ms)),
  conferirEnviados: (c, p) => conferirNosEnviados(c, p),
};

/** O registro de um e-mail que saiu (e o sem-confirmação): duas tentativas, com uma pausa curta entre elas. */
const TENTATIVAS_DO_REGISTRO = 2;
const PAUSA_DO_REGISTRO_MS = 3_000;
/** O envio e, só depois de conferir que não saiu, UM reenvio do mesmo e-mail. Nunca uma 3ª. */
const TENTATIVAS_DE_ENVIO = 2;

/**
 * O pior caso de um run, somando os tetos que o código usa de verdade:
 *  · cada envio = `verify` na 465 + `verify` na 587 + o `sendMail` numa conexão nova, cada um
 *    com `piorCasoDeUmaOperacaoSmtpMs` (conexão + um silêncio);
 *  · cada conferência = `piorCasoDaConferenciaMs` (30 s antes, 4 × (busca + logout), 3 × 30 s);
 *  · 2 envios e 2 conferências, e uma pausa do registro (ou do sem-confirmação).
 * As chamadas ao banco (alguns décimos de segundo cada) ficam fora da conta.
 */
export function piorCasoDoEnvioMs(): number {
  const umEnvio = (PORTAS_DO_SMTP.length + 1) * piorCasoDeUmaOperacaoSmtpMs();
  return TENTATIVAS_DE_ENVIO * (umEnvio + piorCasoDaConferenciaMs()) + PAUSA_DO_REGISTRO_MS;
}

export type ResultadoDoEnvio = 'enviada' | 'enviada_sem_registro' | 'sem_confirmacao' | 'recusada' | 'falhou';

/** O que se sabe do e-mail neste ponto: nada saiu, pode ter saído, ou saiu. */
type Saida = { situacao: 'nao' | 'talvez' | 'sim' };

const naoDeuParaConferir = (codigoSmtp: string, codigoImap: string | null) =>
  `a conexão caiu no meio do envio${codigoSmtp ? ` (${codigoSmtp})` : ''} e não deu para conferir se o e-mail saiu`
  + ` (IMAP ${codigoImap ?? 'sem código'}); confira a pasta Enviados do Gmail antes de enviar de novo`;

/**
 * Pode ter saído e não deu para conferir: o banco faz o reset conservador na hora. A RPC que
 * falha é repetida UMA vez depois da pausa; se falhar de novo, fica com o reset de 30 min do
 * banco (que também trata como possivelmente enviada). NUNCA `falhou`, NUNCA outro envio.
 */
async function deixarSemConfirmacao(run: Run, deps: DepsEnvio, motivo: string, cobranca: string | null): Promise<ResultadoDoEnvio> {
  for (let tentativa = 1; ; tentativa++) {
    try {
      await deps.semConfirmacao(run.id, motivo);
      log('cobrança sem confirmação: o banco a trata como possivelmente enviada (NÃO reenviar)', { nivel: 'falha', run: run.id, cobranca, tentativa });
      return 'sem_confirmacao';
    } catch {
      log('não consegui registrar o envio sem confirmação', { nivel: 'falha', run: run.id, cobranca, tentativa });
    }
    if (tentativa >= TENTATIVAS_DO_REGISTRO) break;
    await Promise.resolve().then(() => deps.esperar(PAUSA_DO_REGISTRO_MS)).catch(() => undefined);
  }
  log('sem confirmação e sem registro: fica com o reset de 30 min do banco (NÃO reenviar)', { nivel: 'falha', run: run.id, cobranca });
  return 'sem_confirmacao';
}

export async function executarEnvioDeCobranca(
  run: Run, deps: DepsEnvio = DEPS_ENVIO, agora: () => Date = () => new Date(),
): Promise<ResultadoDoEnvio> {
  const estado: Saida = { situacao: 'nao' };
  try {
    return await enviarCobranca(run, deps, agora, estado);
  } catch (e) {
    // nada acima deveria lançar; se lançou, a regra continua: depois que saiu (ou que pode ter
    // saído), nunca `falhou`
    log('o envio da cobrança caiu', { nivel: 'falha', run: run.id, classe: e instanceof Error ? e.name : typeof e, saida: estado.situacao });
    if (estado.situacao === 'sim') return 'enviada_sem_registro';
    if (estado.situacao === 'talvez') return deixarSemConfirmacao(run, deps, naoDeuParaConferir('', 'FALHA_INTERNA'), null);
    await deps.falhou(run.id, 'falha inesperada no robô: nada foi enviado').catch(() => undefined);
    return 'falhou';
  }
}

async function enviarCobranca(run: Run, deps: DepsEnvio, agora: () => Date, estado: Saida): Promise<ResultadoDoEnvio> {
  log('envio de cobrança iniciado', { run: run.id });
  const fechar = async (r: 'recusada' | 'falhou', motivo: string, cobranca: string | null = null): Promise<ResultadoDoEnvio> => {
    log(r === 'recusada' ? 'cobrança não enviada: a trava recusou' : 'cobrança não enviada: falhou',
      { nivel: 'falha', run: run.id, cobranca, motivo });
    await deps.falhou(run.id, motivo).catch(() => log('não consegui fechar o envio no banco', { nivel: 'falha', run: run.id }));
    return r;
  };

  let c: CobrancaParaEnviar;
  try {
    c = await deps.iniciarEnvio(run.id);
  } catch {
    return fechar('falhou', 'não consegui ler a cobrança no banco: nada foi enviado');
  }
  if (c.recusa) {
    // a cobrança está `enviando`: está saindo por OUTRO caminho. `falhou` aqui a devolveria
    // para a equipe no meio desse envio. Só o log; o run fica com o banco (run preso, 2 h).
    if (c.situacaoAnterior === 'enviando') {
      log('cobrança não enviada: ela já está saindo por outro caminho (não mexo nela)',
        { nivel: 'aviso', run: run.id, cobranca: c.cobrancaId, recusa: c.recusa });
      return 'recusada';
    }
    // as outras recusas do banco (inclusive "a aprovação não é de uma pessoa ativa da equipe
    // deste tenant") são tratadas igual: nada sai, a frase dele volta para a equipe
    return fechar('recusada', c.recusa, c.cobrancaId);
  }

  // a trava do WORKER, independente do banco (spec §3.4)
  const instante = agora();
  const pode = podeEnviar(
    { situacaoAnterior: c.situacaoAnterior, aprovadaPor: c.aprovadaPor, ultimaEnviadaEm: c.ultimaEnviadaEm, para: c.para, texto: c.texto },
    instante,
  );
  if (!pode.ok) return fechar('recusada', `${pode.motivo}: nada foi enviado`, c.cobrancaId);
  const barrada = deps.travaExtra?.(c) ?? null;
  if (barrada) return fechar('recusada', `${barrada}: nada foi enviado`, c.cobrancaId);

  // os cabeçalhos guardados no banco passam de novo pela trava (ids de verdade, ≤ 20, ≤ 2000)
  const cabecalhos = cabecalhosDaResposta(c.inReplyTo ?? '', c.referencias);

  // a senha só é lida agora, com tudo conferido
  let caixa: CaixaDeEmail;
  try {
    caixa = await deps.credencialDaCaixa(run.account_id);
  } catch {
    return fechar('falhou', 'não consegui ler o acesso à caixa de e-mail: nada foi enviado', c.cobrancaId);
  }

  const doEmail = deps.montarSaida
    ? deps.montarSaida(c, instante)
    : { assunto: assuntoDaResposta(c.assunto), texto: ajustarSaudacao(c.texto ?? '', instante) };
  const saida: EmailDeSaida = {
    de: caixa.email,
    para: c.para ?? '',
    assunto: doEmail.assunto,
    texto: doEmail.texto,
    inReplyTo: cabecalhos.inReplyTo,
    referencias: cabecalhos.referencias,
    // NOSSO, sabido antes do envio: é por ele que a pasta Enviados é conferida, e o reenvio leva o MESMO
    messageId: novoMessageId(caixa.email),
  };
  const procura: ProcuraNosEnviados = { messageId: saida.messageId, para: saida.para, assunto: saida.assunto, inicio: instante };

  const registrar = async (id: string): Promise<ResultadoDoEnvio> => {
    estado.situacao = 'sim';
    // SAIU. Registrar — e, se o banco não responder, REPETIR com o mesmo run e o mesmo
    // Message-ID (a RPC é idempotente e aceita a confirmação atrasada). Nunca `falhou`.
    for (let tentativa = 1; ; tentativa++) {
      try {
        await deps.enviada(run.id, id);
        log('cobrança enviada à ENEL', { run: run.id, cobranca: c.cobrancaId, para: saida.para, tentativa });
        return 'enviada';
      } catch {
        log('o e-mail SAIU, mas não consegui registrar no banco', { nivel: 'falha', run: run.id, cobranca: c.cobrancaId, tentativa });
      }
      if (tentativa >= TENTATIVAS_DO_REGISTRO) break;
      await deps.esperar(PAUSA_DO_REGISTRO_MS).catch(() => undefined);
    }
    log('o e-mail SAIU sem registro: o banco trata em 30 min como possivelmente enviado (NÃO reenviar)',
      { nivel: 'falha', run: run.id, cobranca: c.cobrancaId, para: saida.para });
    return 'enviada_sem_registro';
  };

  for (let envio = 1; envio <= TENTATIVAS_DE_ENVIO; envio++) {
    const fase = envio === 1 ? 'envio' : 'reenvio';
    let id: string;
    estado.situacao = 'talvez';
    try {
      id = await deps.enviar(caixa, saida);
    } catch (e) {
      if (!podeTerSaido(e)) {
        // nem conectou, ou o servidor respondeu que recusou: nada saiu (e, no reenvio, a 1ª
        // tentativa já foi conferida na pasta Enviados)
        estado.situacao = 'nao';
        return fechar('falhou', envio === 1 ? falhaDoEnvio(e) : `reenvio depois de conferir a pasta Enviados: ${falhaDoEnvio(e)}`, c.cobrancaId);
      }
      // caiu no meio: pode ter saído. Antes de qualquer coisa, a pasta Enviados.
      const codigo = codigoDaFalha(e);
      const conferencia: Conferencia = await Promise.resolve()
        .then(() => deps.conferirEnviados(caixa, procura))
        .catch(() => ({ resultado: 'nao_conferiu', buscas: 0, codigo: 'FALHA_INTERNA' }) as Conferencia);
      log('queda no meio do envio: conferi a pasta Enviados', {
        nivel: 'falha', run: run.id, cobranca: c.cobrancaId, fase, codigo,
        resultado: conferencia.resultado, buscas: conferencia.buscas, codigoImap: conferencia.codigo,
      });
      if (conferencia.resultado === 'achou') return registrar(saida.messageId);
      // não deu para conferir: pode ter saído — nem reenvio, nem `falhou`
      if (conferencia.resultado !== 'nao_achou') return deixarSemConfirmacao(run, deps, naoDeuParaConferir(codigo, conferencia.codigo), c.cobrancaId);
      // conferido: NÃO está na pasta Enviados
      estado.situacao = 'nao';
      if (envio >= TENTATIVAS_DE_ENVIO) {
        return fechar('falhou', `não saiu: conferido na pasta Enviados, ${TENTATIVAS_DE_ENVIO} tentativas`, c.cobrancaId);
      }
      // reenvia UMA vez o MESMO e-mail (o mesmo Message-ID), com a porta escolhida pelo verify de novo
      continue;
    }
    return registrar(id || saida.messageId);
  }
  // não chega aqui (o laço sempre devolve); por segurança, nada de reenviar
  return fechar('falhou', `não saiu: conferido na pasta Enviados, ${TENTATIVAS_DE_ENVIO} tentativas`, c.cobrancaId);
}
