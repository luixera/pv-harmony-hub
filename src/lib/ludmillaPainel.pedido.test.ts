import { describe, expect, it, vi } from 'vitest';
import { itensDaCaixa, type ItemDaCaixa } from '@/lib/ludmillaCaixa';
import { CONTAS_DE_EXEMPLO, F_VISTORIA, nomeDaContaDeExemplo, rotuloDeExemplo } from '@/lib/ludmillaCaixa.fixtures';
import {
  acoesDoItem, argumentosDaDecisao, executarDecisao, textoDaDecisao, visibilidadeDoDetalhe, type AcoesDaDecisao,
} from '@/lib/ludmillaPainel';
import { montarEmailDoPedido, type PedidoTroca } from '@/lib/ludmillaPedidoTroca';

const NT = '391000010';
const TEXTO = montarEmailDoPedido(NT, new Date('2026-11-09T13:00:00Z'));
const LIBERADO: PedidoTroca = {
  liberado: true, motivo: null, para: 'canalgd.sp@br.enel.com', assunto: `TROCA DE RELÓGIO - FULANA - NT ${NT}`, nt: NT,
  titular: 'Fulana', aprovacao_em: '2026-11-03T20:11:39Z', ja_pedido_em: null,
  pedido_situacao: null, pedido_erro: null, pedido_texto: null,
};
const JA_PEDIDO: PedidoTroca = { ...LIBERADO, liberado: false, motivo: 'A ENEL já respondeu sobre a troca em 04/11/2026: o pedido já foi feito.', ja_pedido_em: '2026-11-04T14:53:25Z' };

const itens = itensDaCaixa({
  updates: [], afazeres: [F_VISTORIA, { ...F_VISTORIA, id: 'f-aviso', tipo: 'aviso' }], contas: CONTAS_DE_EXEMPLO,
  nomeDaConta: nomeDaContaDeExemplo, rotuloEtapa: rotuloDeExemplo,
});
const item = (chave: string): ItemDaCaixa => {
  const i = itens.find(x => x.chave === chave);
  if (!i) throw new Error(`sem ${chave}`);
  return i;
};
const VISTORIA = item('f:f-vistoria');

describe('os botões do A fazer de vistoria aprovada', () => {
  it('liberado: Enviar e, ao lado, Marcar como feito', () => {
    const a = acoesDoItem(VISTORIA, null, TEXTO, LIBERADO);
    expect(a.principal).toEqual({ acao: 'enviar_pedido', rotulo: 'Enviar', habilitada: true, porque: null });
    expect(a.secundaria).toEqual({ acao: 'feito', rotulo: 'Marcar como feito' });
  });

  it('texto sem a NT desliga o Enviar e diz por quê', () => {
    const a = acoesDoItem(VISTORIA, null, 'Bom dia caro analista, a NT 111111111 passou pela vistoria.', LIBERADO);
    expect(a.principal?.habilitada).toBe(false);
    expect(a.principal?.porque).toContain(NT);
  });

  it('já pedido: sem Enviar, só Marcar como feito', () => {
    const a = acoesDoItem(VISTORIA, null, TEXTO, JA_PEDIDO);
    expect(a.principal).toEqual({ acao: 'feito', rotulo: 'Marcar como feito', habilitada: true, porque: null });
    expect(a.secundaria).toBeNull();
  });

  it('carregando: o Enviar fica desligado até conferir, e dá para marcar como feito', () => {
    const a = acoesDoItem(VISTORIA, null, '', 'carregando');
    expect(a.principal?.acao).toBe('enviar_pedido');
    expect(a.principal?.habilitada).toBe(false);
    expect(a.secundaria?.acao).toBe('feito');
  });

  it('não conseguiu conferir: nunca oferece o Enviar', () => {
    const a = acoesDoItem(VISTORIA, null, TEXTO, 'erro');
    expect(a.principal?.acao).toBe('feito');
    expect(a.secundaria).toBeNull();
  });

  it('sem dados do pedido, tudo como antes', () => {
    expect(acoesDoItem(VISTORIA, null).principal?.acao).toBe('feito');
  });

  it('outro A fazer não ganha Enviar, mesmo se vier um pedido', () => {
    expect(acoesDoItem(item('f:f-aviso'), null, TEXTO, LIBERADO).principal?.acao).toBe('feito');
  });

  it('A fazer já decidido não tem botões', () => {
    expect(acoesDoItem({ ...VISTORIA, situacao: 'aplicada' }, null, TEXTO, LIBERADO).principal).toBeNull();
  });
});

describe('a decisão do pedido', () => {
  it('leva o id do A fazer e o texto exato da tela', () => {
    expect(argumentosDaDecisao(VISTORIA, 'enviar_pedido', null, `  ${TEXTO}  `)).toEqual({ acao: 'enviar_pedido', afazerId: 'f-vistoria', texto: `  ${TEXTO}  ` });
  });

  it('chama enviarPedido, e a recusa do banco rejeita para a linha voltar', async () => {
    const acoes = {
      aplicar: vi.fn(), ignorar: vi.fn(), feito: vi.fn(), enviarCobranca: vi.fn(), dispensarCobranca: vi.fn(),
      enviarPedido: vi.fn().mockRejectedValue(new Error('recusou')),
    } as unknown as AcoesDaDecisao;
    await expect(executarDecisao(acoes, { acao: 'enviar_pedido', afazerId: 'f-vistoria', texto: TEXTO })).rejects.toThrow('recusou');
    expect(acoes.enviarPedido).toHaveBeenCalledWith('f-vistoria', TEXTO);
  });

  it('o aviso com Desfazer diz o que vai acontecer', () => {
    expect(textoDaDecisao(VISTORIA, 'enviar_pedido', null, rotuloDeExemplo)).toContain('pedido da troca do relógio vai para a ENEL');
  });
});

describe('o que o painel mostra', () => {
  it('a seção do pedido só aparece no A fazer de vistoria aprovada pendente', () => {
    expect(visibilidadeDoDetalhe(VISTORIA).pedido).toBe(true);
    expect(visibilidadeDoDetalhe({ ...VISTORIA, situacao: 'aplicada' }).pedido).toBe(false);
    expect(visibilidadeDoDetalhe(item('f:f-aviso')).pedido).toBe(false);
  });
});
