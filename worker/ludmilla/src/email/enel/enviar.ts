// worker/ludmilla/src/email/enel/enviar.ts
import {
  cobrancaEnviada, cobrancaFalhou, credencialDaCaixa, iniciarEnvioDeCobranca, type CobrancaParaEnviar, type Run,
} from '../../fila.js';
import { conferirNosEnviados, type Conferencia, type ProcuraNosEnviados } from '../enviados.js';
import { codigoDaFalha, enviarPorSmtp, falhaDoEnvio, novoMessageId, podeTerSaido, type EmailDeSaida } from '../smtp.js';
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
 *  · não deu para conferir → NÃO reenvia: `falhou` pedindo para conferir a pasta Enviados.
 * Recusa do servidor (4xx/5xx, EAUTH, EENVELOPE, EMESSAGE) é "nada foi enviado", sem conferir.
 *
 * Depois que saiu (ou que a conferência achou), NADA chama `falhou`: devolver a cobrança faria
 * alguém reenviar. O registro que falha é REPETIDO (mesmo run, mesmo Message-ID); se ainda
 * falhar, o reset de 30 min do banco trata o envio como possivelmente feito. Run preso é do
 * banco também. Nunca lança (o laço principal não tem try). Log: o run, a cobrança, a fase, o
 * código, o resultado da conferência e o endereço da ENEL — nunca o texto, o assunto, o
 * titular, a nota, a caixa ou a senha.
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
  /** a pausa antes de repetir o registro de um e-mail que já saiu */
  esperar: (ms: number) => Promise<void>;
  /** depois de uma queda no meio do envio: o e-mail está na pasta Enviados? (com as esperas dela) */
  conferirEnviados: (c: CaixaDeEmail, p: ProcuraNosEnviados) => Promise<Conferencia>;
}
export const DEPS_ENVIO: DepsEnvio = {
  iniciarEnvio: iniciarEnvioDeCobranca,
  credencialDaCaixa,
  enviar: (c, m) => enviarPorSmtp(c, m),
  enviada: cobrancaEnviada,
  falhou: cobrancaFalhou,
  esperar: ms => new Promise(r => setTimeout(r, ms)),
  conferirEnviados: (c, p) => conferirNosEnviados(c, p),
};

/** O registro de um e-mail que saiu: duas tentativas, com uma pausa curta entre elas. */
const TENTATIVAS_DO_REGISTRO = 2;
const PAUSA_DO_REGISTRO_MS = 3_000;
/** O envio e, só depois de conferir que não saiu, UM reenvio do mesmo e-mail. Nunca uma 3ª. */
const TENTATIVAS_DE_ENVIO = 2;

export type ResultadoDoEnvio = 'enviada' | 'enviada_sem_registro' | 'recusada' | 'falhou';

/** O que se sabe do e-mail neste ponto: nada saiu, pode ter saído, ou saiu. */
type Saida = { situacao: 'nao' | 'talvez' | 'sim' };

const naoDeuParaConferir = (codigoSmtp: string, codigoImap: string | null) =>
  `a conexão caiu no meio do envio${codigoSmtp ? ` (${codigoSmtp})` : ''} e não deu para conferir se o e-mail saiu`
  + ` (IMAP ${codigoImap ?? 'sem código'}); confira a pasta Enviados do Gmail antes de enviar de novo`;

export async function executarEnvioDeCobranca(
  run: Run, deps: DepsEnvio = DEPS_ENVIO, agora: () => Date = () => new Date(),
): Promise<ResultadoDoEnvio> {
  const estado: Saida = { situacao: 'nao' };
  try {
    return await enviarCobranca(run, deps, agora, estado);
  } catch (e) {
    // nada acima deveria lançar; se lançou, a regra continua: depois que saiu, nunca `falhou`
    log('o envio da cobrança caiu', { nivel: 'falha', run: run.id, classe: e instanceof Error ? e.name : typeof e, saida: estado.situacao });
    if (estado.situacao === 'sim') return 'enviada_sem_registro';
    const motivo = estado.situacao === 'talvez'
      ? naoDeuParaConferir('', 'FALHA_INTERNA')
      : 'falha inesperada no robô: nada foi enviado';
    await deps.falhou(run.id, motivo).catch(() => undefined);
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
  // a recusa do banco (inclusive "a aprovação não é de uma pessoa ativa da equipe deste
  // tenant") é tratada igual a todas: nada sai, a frase dele volta para a equipe
  if (c.recusa) return fechar('recusada', c.recusa, c.cobrancaId);

  // a trava do WORKER, independente do banco (spec §3.4)
  const instante = agora();
  const pode = podeEnviar(
    { situacaoAnterior: c.situacaoAnterior, aprovadaPor: c.aprovadaPor, ultimaEnviadaEm: c.ultimaEnviadaEm, para: c.para, texto: c.texto },
    instante,
  );
  if (!pode.ok) return fechar('recusada', `${pode.motivo}: nada foi enviado`, c.cobrancaId);

  // os cabeçalhos guardados no banco passam de novo pela trava (ids de verdade, ≤ 20, ≤ 2000)
  const cabecalhos = cabecalhosDaResposta(c.inReplyTo ?? '', c.referencias);

  // a senha só é lida agora, com tudo conferido
  let caixa: CaixaDeEmail;
  try {
    caixa = await deps.credencialDaCaixa(run.account_id);
  } catch {
    return fechar('falhou', 'não consegui ler o acesso à caixa de e-mail: nada foi enviado', c.cobrancaId);
  }

  const saida: EmailDeSaida = {
    de: caixa.email,
    para: c.para ?? '',
    assunto: assuntoDaResposta(c.assunto),
    texto: ajustarSaudacao(c.texto ?? '', instante),
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
      if (conferencia.resultado !== 'nao_achou') return fechar('falhou', naoDeuParaConferir(codigo, conferencia.codigo), c.cobrancaId);
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
