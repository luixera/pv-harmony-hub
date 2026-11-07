import { ASSINATURA_DA_COBRANCA, saudacao, textoPronto } from '@/lib/ludmillaCobranca';

/**
 * O PEDIDO DA TROCA DO RELÓGIO À ENEL — funções puras, sem React.
 *
 * Spec: docs/superpowers/specs/2026-11-06-ludmilla-pedido-troca-design.md. Quem decide se o pedido
 * está liberado, e monta o destinatário e o assunto, é o banco (`ludmilla_pedido_troca_rascunho`):
 * aqui nasce só o texto que a pessoa revisa, com as palavras dos pedidos reais da equipe.
 */

/** Uma linha de `ludmilla_pedido_troca_rascunho`. */
export interface PedidoTroca {
  liberado: boolean;
  /** por que não está liberado, em frase pronta para a tela */
  motivo: string | null;
  para: string | null;
  assunto: string | null;
  nt: string | null;
  titular: string | null;
  aprovacao_em: string | null;
  ja_pedido_em: string | null;
  pedido_situacao: string | null;
  pedido_erro: string | null;
  /** o texto da tentativa que falhou: é o rascunho da próxima */
  pedido_texto: string | null;
}

/** null = este item não é pedido da troca. */
export type PedidoDoDetalhe = PedidoTroca | 'carregando' | 'erro' | null;

export function montarEmailDoPedido(nt: string, agora: Date): string {
  const abertura = saudacao(agora) === 'bom dia' ? 'Bom dia' : 'Boa tarde';
  return [
    `${abertura} caro analista, a NT ${nt} passou pela etapa de vistoria, por gentileza seguir para a troca de relógio.`,
    '',
    'Atenciosamente,',
    ASSINATURA_DA_COBRANCA,
  ].join('\n');
}

/** O que a tela abre para editar: o texto da tentativa que falhou, senão o modelo. */
export function rascunhoDoPedido(p: PedidoTroca, agora: Date): string {
  if (p.pedido_texto?.trim()) return p.pedido_texto;
  return p.nt ? montarEmailDoPedido(p.nt, agora) : '';
}

/** A trava do Enviar na tela: as da cobrança, mais citar a NT. A do banco é a mesma. */
export function textoDoPedidoPronto(texto: string, nt: string | null): { ok: true; porque: null } | { ok: false; porque: string } {
  const geral = textoPronto(texto);
  if (!geral.ok) return geral;
  if (nt && !texto.includes(nt)) return { ok: false, porque: `O texto precisa citar a NT ${nt}.` };
  return { ok: true, porque: null };
}
