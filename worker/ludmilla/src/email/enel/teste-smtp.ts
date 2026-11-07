// worker/ludmilla/src/email/enel/teste-smtp.ts
import { pathToFileURL } from 'node:url';
import { contaDaEnel, credencialDaCaixa } from '../../fila.js';
import { conferirNosEnviados, type Conferencia, type ProcuraNosEnviados } from '../enviados.js';
import { enviarPorSmtp, falhaDoEnvio, novoMessageId, verificarSmtp, type EmailDeSaida } from '../smtp.js';

/**
 * Teste do SMTP da caixa da Ludmilla, na VPS, pelo workflow `ludmilla-worker.yml`
 * (entrada `smtp`, lista fechada) → `/usr/local/bin/ludmilla-teste-smtp`:
 *   --verificar                    conecta e autentica; NÃO manda nada
 *   --enviar-para-a-propria-caixa  UM e-mail de teste com de = para = a caixa da Ludmilla,
 *                                  e depois confere a pasta Enviados
 * Não existe opção de destinatário: o teste nunca escreve para ninguém de fora. A saída é
 * UMA linha JSON, sem a senha e sem o endereço da caixa.
 *
 * A conferência é a defesa contra cobrar em dobro (decisão do usuário de 27/10/2026), e ela
 * casa por Message-ID OU por destinatário + assunto + hora. Duas procuras separadas, cada
 * uma só podendo casar por um caminho, dizem o que funciona de verdade no Gmail. Se o Gmail
 * trocar o Message-ID, a busca por destinatário ainda protege, e o teste passa dizendo isso.
 */

export type ModoDoTeste = 'verificar' | 'enviar';
type Caixa = { email: string; senha: string };

export function modoDoTeste(argv: readonly string[]): ModoDoTeste | null {
  if (argv.length !== 1) return null;
  if (argv[0] === '--verificar') return 'verificar';
  if (argv[0] === '--enviar-para-a-propria-caixa') return 'enviar';
  return null;
}

export function emailDeTeste(caixa: string, agora: Date): EmailDeSaida {
  return {
    de: caixa,
    para: caixa,
    assunto: 'Teste de envio da Ludmilla (pode apagar)',
    texto: `Teste do SMTP da caixa da Ludmilla em ${agora.toISOString()}. Nenhuma concessionária recebeu esta mensagem.`,
    inReplyTo: null,
    referencias: [],
    messageId: novoMessageId(caixa),
  };
}

/** Domínio reservado (RFC 2606): nenhuma mensagem de verdade casa com estes valores. */
const NINGUEM = 'ninguem@ludmilla.invalid';
const ID_INEXISTENTE = '<nao-existe@ludmilla.invalid>';

export function procurasDaProva(m: EmailDeSaida, inicio: Date): { porMessageId: ProcuraNosEnviados; porEnvelope: ProcuraNosEnviados } {
  return {
    porMessageId: { messageId: m.messageId, para: NINGUEM, assunto: 'nao-e-este-assunto', inicio },
    porEnvelope: { messageId: ID_INEXISTENTE, para: m.para, assunto: m.assunto, inicio },
  };
}

export interface DepsDoTeste {
  lerCaixa: () => Promise<Caixa>;
  verificar: (c: Caixa) => Promise<{ porta: number }>;
  enviar: (c: Caixa, m: EmailDeSaida) => Promise<string>;
  conferir: (c: Caixa, p: ProcuraNosEnviados) => Promise<Conferencia>;
  agora: () => Date;
  escrever: (o: Record<string, unknown>) => void;
}

/** Roda o teste e devolve o código de saída. Nunca envia mais de um e-mail. */
export async function rodarTeste(modo: ModoDoTeste, deps: DepsDoTeste): Promise<number> {
  let caixa: Caixa;
  try {
    caixa = await deps.lerCaixa();
  } catch {
    deps.escrever({ msg: 'teste do smtp falhou', razao: 'não consegui ler o acesso à caixa (conta da ENEL / agent_config)' });
    return 1;
  }
  try {
    if (modo === 'verificar') {
      const { porta } = await deps.verificar(caixa);
      deps.escrever({ msg: 'smtp ok: conectou e autenticou, nada foi enviado', porta });
      return 0;
    }
    const inicio = deps.agora();
    const email = emailDeTeste(caixa.email, inicio);
    await deps.enviar(caixa, email);
    const { porMessageId, porEnvelope } = procurasDaProva(email, inicio);
    const pelaId = await deps.conferir(caixa, porMessageId);
    const pelaBusca = await deps.conferir(caixa, porEnvelope);
    const codigo = pelaId.codigo ?? pelaBusca.codigo;
    deps.escrever({
      msg: 'teste enviado para a própria caixa da Ludmilla',
      pelo_message_id: pelaId.resultado,
      pelo_destinatario: pelaBusca.resultado,
      ...(codigo ? { codigo } : {}),
    });
    return pelaId.resultado === 'achou' || pelaBusca.resultado === 'achou' ? 0 : 1;
  } catch (e) {
    deps.escrever({ msg: 'teste do smtp falhou', razao: falhaDoEnvio(e) });
    return 1;
  }
}

const DEPS_REAIS: DepsDoTeste = {
  lerCaixa: async () => credencialDaCaixa(await contaDaEnel()),
  verificar: c => verificarSmtp(c),
  enviar: (c, m) => enviarPorSmtp(c, m),
  conferir: (c, p) => conferirNosEnviados(c, p),
  agora: () => new Date(),
  escrever: o => console.log(JSON.stringify({ t: new Date().toISOString(), ...o })),
};

// só quando rodado como comando (importar no teste não executa)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const modo = modoDoTeste(process.argv.slice(2));
  if (!modo) {
    DEPS_REAIS.escrever({ msg: 'uso: --verificar | --enviar-para-a-propria-caixa' });
    process.exit(2);
  }
  void rodarTeste(modo, DEPS_REAIS).then(c => process.exit(c));
}
