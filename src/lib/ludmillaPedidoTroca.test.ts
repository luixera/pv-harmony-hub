import { describe, expect, it } from 'vitest';
import { montarEmailDoPedido, rascunhoDoPedido, textoDoPedidoPronto, type PedidoTroca } from '@/lib/ludmillaPedidoTroca';

const MANHA = new Date('2026-11-09T13:00:00Z');
const TARDE = new Date('2026-11-09T18:00:00Z');
const NT = '391000010';

const PEDIDO: PedidoTroca = {
  liberado: true, motivo: null, para: 'canalgd.sp@br.enel.com', assunto: `TROCA DE RELÓGIO - FULANA - NT ${NT}`, nt: NT,
  titular: 'Fulana', aprovacao_em: '2026-11-03T20:11:39Z', ja_pedido_em: null,
  pedido_situacao: null, pedido_erro: null, pedido_texto: null,
};

describe('o e-mail do pedido', () => {
  it('é o modelo da equipe, com a NT, a saudação da hora e a assinatura', () => {
    expect(montarEmailDoPedido(NT, MANHA)).toBe(
      `Bom dia caro analista, a NT ${NT} passou pela etapa de vistoria, por gentileza seguir para a troca de relógio.\n\nAtenciosamente,\nEquipe GD Manager`,
    );
    expect(montarEmailDoPedido(NT, TARDE)).toMatch(/^Boa tarde caro analista,/);
  });

  it('o rascunho nasce do modelo, ou do texto da tentativa que falhou', () => {
    expect(rascunhoDoPedido(PEDIDO, MANHA)).toBe(montarEmailDoPedido(NT, MANHA));
    const falhou = { ...PEDIDO, pedido_situacao: 'falhou', pedido_erro: 'nada saiu', pedido_texto: 'O texto que a pessoa editou, com a NT 391000010.' };
    expect(rascunhoDoPedido(falhou, MANHA)).toBe(falhou.pedido_texto);
  });

  it('sem NT não há rascunho: quem manda é o motivo que a tela mostra', () => {
    expect(rascunhoDoPedido({ ...PEDIDO, liberado: false, nt: null, motivo: 'Falta a NT' }, MANHA)).toBe('');
  });
});

describe('a trava do Enviar', () => {
  it('passa com o modelo', () => {
    expect(textoDoPedidoPronto(montarEmailDoPedido(NT, MANHA), NT)).toEqual({ ok: true, porque: null });
  });
  it('recusa texto sem a NT do pedido', () => {
    const r = textoDoPedidoPronto('Bom dia caro analista, a NT 111111111 passou pela etapa de vistoria.', NT);
    expect(r.ok).toBe(false);
    expect(r.porque).toContain(NT);
  });
  it('recusa lacuna e texto curto, como a cobrança', () => {
    expect(textoDoPedidoPronto(`${montarEmailDoPedido(NT, MANHA)} [NT]`, NT).ok).toBe(false);
    expect(textoDoPedidoPronto('curto', NT).ok).toBe(false);
  });
});
