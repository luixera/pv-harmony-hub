import { describe, expect, it } from 'vitest';
import { FILTRO_INICIAL, filtrarItens, itensDaCaixa, type ItemDaCaixa } from '@/lib/ludmillaCaixa';
import { acoesDoItem, situacaoDecidida, textoDaDecisao, visibilidadeDoDetalhe } from '@/lib/ludmillaPainel';
import { montarEmailDeCobranca } from '@/lib/ludmillaCobranca';
import { CONTAS_DE_EXEMPLO, F_VISTORIA, nomeDaContaDeExemplo, rotuloDeExemplo } from '@/lib/ludmillaCaixa.fixtures';
import {
  AFAZERES_DE_COBRANCA, COBRANCA_BASE, F_COBRANCA, F_COBRANCA_SEM_NOTA, cobrancaAfazer,
} from '@/lib/ludmillaCobranca.fixtures';

const itens = itensDaCaixa({
  updates: [], afazeres: [...AFAZERES_DE_COBRANCA, F_VISTORIA], contas: CONTAS_DE_EXEMPLO,
  nomeDaConta: nomeDaContaDeExemplo, rotuloEtapa: rotuloDeExemplo,
});
const item = (chave: string): ItemDaCaixa => {
  const i = itens.find(x => x.chave === chave);
  if (!i) throw new Error(`sem ${chave}`);
  return i;
};
const MANHA = new Date('2026-10-24T13:00:00Z');
const PRONTO = montarEmailDeCobranca(COBRANCA_BASE, MANHA);

describe('a cobrança na lista', () => {
  it('é um A fazer pendente com o selo "cobrar a ENEL"', () => {
    const i = item('f:f-cob');
    expect(i.situacao).toBe('pendente');
    expect(i.tipos).toEqual(['afazer']);
    expect(i.selos).toEqual([{ texto: 'A fazer: cobrar a ENEL', tom: 'afazer' }]);
  });
  it('a busca acha pela nota, escrita com ou sem o zero da forma guardada', () => {
    expect(COBRANCA_BASE.nota_servico).toBe('070700000123');
    for (const termo of ['70700000123', '070700000123']) {
      const achados = filtrarItens(itens, { ...FILTRO_INICIAL, busca: termo }).map(i => i.chave);
      expect(achados, termo).toContain('f:f-cob');
      expect(achados, termo).not.toContain('f:f-vistoria');
    }
  });
  it('o título e o texto do A fazer chegam à tela com a nota sem o zero; os outros A fazer não mudam', () => {
    expect(item('f:f-cob').afazer?.titulo).toBe('📡 Cobrar a ENEL — troca do relógio do PRJ-20001 (nota 70700000123)');
    expect(item('f:f-cob-falhou').afazer?.titulo).toBe('📡 A cobrança da nota 70700000123 não saiu');
    expect(item('f:f-cob-sem').afazer?.titulo).toBe('📡 Cobrar a ENEL — troca do relógio do PRJ-20001 (nota sem número)');
    expect(item('f:f-vistoria').afazer).toBe(F_VISTORIA);
  });
  it('a linha guarda a cobrança do banco como veio (a nota continua canônica nos dados)', () => {
    expect(item('f:f-cob').afazer?.cobranca?.nota_servico).toBe('070700000123');
    expect(item('f:f-cob').afazer?.id).toBe(F_COBRANCA.id);
  });
});

describe('acoesDoItem — Enviar e Dispensar, nunca "Marcar como feito"', () => {
  it('texto pronto: Enviar habilitado e Dispensar', () => {
    expect(acoesDoItem(item('f:f-cob'), null, PRONTO)).toEqual({
      principal: { acao: 'enviar_cobranca', rotulo: 'Enviar', habilitada: true, porque: null },
      secundaria: { acao: 'dispensar_cobranca', rotulo: 'Dispensar' },
    });
  });
  it('texto com lacuna: Enviar desligado, dizendo o que falta', () => {
    const texto = montarEmailDeCobranca(F_COBRANCA_SEM_NOTA.cobranca!, MANHA);
    expect(acoesDoItem(item('f:f-cob-sem'), null, texto).principal)
      .toMatchObject({ acao: 'enviar_cobranca', habilitada: false, porque: 'Complete no texto: [NÚMERO DA NOTA].' });
  });
  it('texto vazio: Enviar desligado', () => {
    expect(acoesDoItem(item('f:f-cob'), null, '').principal?.habilitada).toBe(false);
  });
  it('sem o texto (o terceiro argumento é opcional): Enviar desligado, nunca ligado', () => {
    expect(acoesDoItem(item('f:f-cob'), null).principal).toMatchObject({ acao: 'enviar_cobranca', habilitada: false });
  });
  it('a cobrança já saiu da espera (outra pessoa aprovou): Enviar desligado', () => {
    const outra = itensDaCaixa({
      updates: [], afazeres: [cobrancaAfazer('f-x', { id: 'c-x', situacao: 'enviando' })], contas: CONTAS_DE_EXEMPLO,
      nomeDaConta: nomeDaContaDeExemplo, rotuloEtapa: rotuloDeExemplo,
    })[0];
    expect(acoesDoItem(outra, null, PRONTO).principal).toMatchObject({ habilitada: false, porque: 'Esta cobrança não está mais esperando envio.' });
  });
  it('sem a cobrança carregada: Enviar desligado', () => {
    const sem = itensDaCaixa({
      updates: [], afazeres: [cobrancaAfazer('f-y', {}, { cobranca: null })], contas: CONTAS_DE_EXEMPLO,
      nomeDaConta: nomeDaContaDeExemplo, rotuloEtapa: rotuloDeExemplo,
    })[0];
    expect(acoesDoItem(sem, null, PRONTO).principal).toMatchObject({ habilitada: false, porque: 'Não consegui carregar a cobrança.' });
  });
  it('decidida: sem botões', () => {
    expect(acoesDoItem(item('f:f-cob-ok'), null, PRONTO)).toEqual({ principal: null, secundaria: null });
  });
  it('o A fazer comum continua com "Marcar como feito"', () => {
    expect(acoesDoItem(item('f:f-vistoria'), null).principal).toMatchObject({ acao: 'feito', rotulo: 'Marcar como feito' });
  });
});

describe('textoDaDecisao — o aviso com Desfazer diz para onde vai (tela só da equipe)', () => {
  it('Enviar e Dispensar, com a nota sem o zero', () => {
    expect(textoDaDecisao(item('f:f-cob'), 'enviar_cobranca', null, rotuloDeExemplo))
      .toBe('PRJ-20001: cobrança da nota 70700000123 vai para canalgd.sp@br.enel.com');
    expect(textoDaDecisao(item('f:f-cob'), 'dispensar_cobranca', null, rotuloDeExemplo))
      .toBe('PRJ-20001: cobrança da nota 70700000123 dispensada');
    expect(textoDaDecisao(item('f:f-cob-sem'), 'enviar_cobranca', null, rotuloDeExemplo))
      .toBe('PRJ-20001: cobrança sem número de nota vai para canalgd.sp@br.enel.com');
  });
});

describe('situacaoDecidida — quem decidiu a cobrança', () => {
  it('aprovada, dispensada, ou encerrada pela Ludmilla', () => {
    expect(situacaoDecidida(item('f:f-cob-ok'))).toEqual({ rotulo: 'Aprovada', em: '2026-10-22T13:59:00Z', por: 'Bia Exemplo' });
    expect(situacaoDecidida(item('f:f-cob-disp'))).toMatchObject({ rotulo: 'Dispensada', por: 'Bia Exemplo' });
    expect(situacaoDecidida(item('f:f-cob-enc'))).toMatchObject({ rotulo: 'Encerrada', por: null });
  });
  it('pendente: nada decidido', () => {
    expect(situacaoDecidida(item('f:f-cob'))).toBeNull();
  });
});

describe('visibilidadeDoDetalhe — a seção do e-mail só na cobrança', () => {
  it('cobrança: seção do e-mail, sem sugestão de etapa, com a linha do tempo do projeto', () => {
    expect(visibilidadeDoDetalhe(item('f:f-cob'))).toMatchObject({ cobranca: true, sugestao: false, seletor: false, linhaDoTempo: true });
  });
  it('o A fazer comum não tem a seção', () => {
    expect(visibilidadeDoDetalhe(item('f:f-vistoria')).cobranca).toBe(false);
  });
  it('a fixture do A fazer da cobrança é a mesma da lista', () => {
    expect(F_COBRANCA.cobranca?.para).toBe('canalgd.sp@br.enel.com');
  });
});
