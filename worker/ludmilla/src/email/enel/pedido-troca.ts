// worker/ludmilla/src/email/enel/pedido-troca.ts
import {
  iniciarEnvioDePedido, pedidoEnviado, pedidoFalhou, pedidoSemConfirmacao, type CobrancaParaEnviar, type Run,
} from '../../fila.js';
import { saudacaoNaHora } from './cobranca.js';
import { DEPS_ENVIO, executarEnvioDeCobranca, type DepsEnvio, type ResultadoDoEnvio } from './enviar.js';

/**
 * Run `enviar_pedido_troca`: pede à ENEL a troca do relógio, depois que UMA PESSOA clicou em Enviar no
 * A fazer de vistoria aprovada. Usa o MESMO fluxo de `enviar.ts` (travas, SMTP, conferência na pasta
 * Enviados, um reenvio no máximo), trocando só o banco e o e-mail: aqui é um e-mail NOVO, sem "RE:" e
 * sem conversa, com o assunto que o banco montou. Spec: 2026-11-06-ludmilla-pedido-troca-design.md.
 */

const ASSUNTO_DO_MODELO = /^TROCA DE RELÓGIO - .+ - NT (\d{9})$/;
const ABERTURA_DO_MODELO = /^(?:Bom dia|Boa tarde) caro analista,/;

/** A trava do robô, independente do banco: o assunto tem a forma do modelo e o texto cita a NT dele. */
export function travaDoPedido(c: Pick<CobrancaParaEnviar, 'assunto' | 'texto'>): string | null {
  const nt = ASSUNTO_DO_MODELO.exec(c.assunto ?? '')?.[1];
  if (!nt) return 'o assunto não está na forma do pedido da troca';
  if (!(c.texto ?? '').includes(nt)) return 'o texto não cita a NT do assunto';
  return null;
}

/** "Bom dia" ou "Boa tarde" na hora do envio. Abertura que a pessoa mudou fica como ela deixou. */
export function ajustarSaudacaoDoPedido(texto: string, agora: Date): string {
  const hora = saudacaoNaHora(agora) === 'bom dia' ? 'Bom dia' : 'Boa tarde';
  return texto.replace(ABERTURA_DO_MODELO, `${hora} caro analista,`);
}

/** O motivo vai para a tela: `enviar.ts` e `podeEnviar` falam em cobrança, e aqui é um pedido. */
export function falaDePedido(motivo: string): string {
  return motivo
    .replace(/a cobrança não foi aprovada/g, 'o pedido não foi aprovado')
    .replace(/a cobrança/g, 'o pedido');
}

export const DEPS_ENVIO_PEDIDO: DepsEnvio = {
  ...DEPS_ENVIO,
  iniciarEnvio: iniciarEnvioDePedido,
  enviada: pedidoEnviado,
  falhou: (runId, erro) => pedidoFalhou(runId, falaDePedido(erro)),
  semConfirmacao: (runId, erro) => pedidoSemConfirmacao(runId, falaDePedido(erro)),
  travaExtra: travaDoPedido,
  montarSaida: (c, instante) => ({ assunto: c.assunto ?? '', texto: ajustarSaudacaoDoPedido(c.texto ?? '', instante) }),
};

export function executarEnvioDePedido(run: Run): Promise<ResultadoDoEnvio> {
  return executarEnvioDeCobranca(run, DEPS_ENVIO_PEDIDO);
}
