import { describe, expect, it, vi } from 'vitest';
import { FILTRO_INICIAL, filtrarItens, itensDaCaixa, type ItemDaCaixa } from '@/lib/ludmillaCaixa';
import {
  acoesDoItem, argumentosDaDecisao, executarDecisao, idDoPorqueDoBotao, situacaoDecidida, textoDaDecisao, visibilidadeDoDetalhe,
  type AcoesDaDecisao,
} from '@/lib/ludmillaPainel';
import { montarEmailDeCobranca } from '@/lib/ludmillaCobranca';
import { CONTAS_DE_EXEMPLO, F_VISTORIA, U_CPFL, nomeDaContaDeExemplo, rotuloDeExemplo } from '@/lib/ludmillaCaixa.fixtures';
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

  // O rótulo é do A fazer, não da cobrança de hoje: dois ciclos da mesma nota (c-8) têm autores diferentes.
  it('1º ciclo aprovado pela Bia, 2º dispensado pelo Carlos: cada A fazer mostra o SEU autor', () => {
    expect(situacaoDecidida(item('f:f-cob-ciclo1'))).toMatchObject({ rotulo: 'Aprovada', por: 'Bia Exemplo' });
    expect(situacaoDecidida(item('f:f-cob-ciclo2'))).toMatchObject({ rotulo: 'Dispensada', por: 'Carlos Exemplo' });
    // os dois A fazer são da MESMA cobrança, hoje dispensada
    expect(item('f:f-cob-ciclo1').afazer?.cobranca?.situacao).toBe('dispensada');
    expect(item('f:f-cob-ciclo2').afazer?.cobranca?.situacao).toBe('dispensada');
  });
  it('dispensa simples: o A fazer fechado junto com a cobrança é "Dispensada por …"', () => {
    expect(situacaoDecidida(item('f:f-cob-disp'))).toEqual({ rotulo: 'Dispensada', em: '2026-10-21T10:00:00Z', por: 'Bia Exemplo' });
  });
  it('encerrado pela Ludmilla (sem autor) continua "Encerrada", mesmo se a equipe dispensou a cobrança depois', () => {
    expect(situacaoDecidida(item('f:f-cob-enc-disp'))).toEqual({ rotulo: 'Encerrada', em: '2026-10-24T09:00:00Z', por: null });
  });
  it('o mesmo instante vale em qualquer formato de data (compara o instante, não o texto)', () => {
    const itemCom = (feito_em: string, atualizado_em: string) => itensDaCaixa({
      updates: [], contas: CONTAS_DE_EXEMPLO, nomeDaConta: nomeDaContaDeExemplo, rotuloEtapa: rotuloDeExemplo,
      afazeres: [cobrancaAfazer('f-fmt', { id: 'c-fmt', situacao: 'dispensada', atualizado_em }, { feito_por: 'pessoa-2', feito_em, feito: { name: 'Bia Exemplo' } })],
    })[0];
    // 10:30 UTC = 07:30 em Brasília; microssegundos do banco = milissegundos do JavaScript
    expect(situacaoDecidida(itemCom('2026-10-25T07:30:00.123-03:00', '2026-10-25T10:30:00.123456+00:00'))?.rotulo).toBe('Dispensada');
    expect(situacaoDecidida(itemCom('2026-10-25T10:30:00Z', '2026-10-25T10:30:00.123456+00:00'))?.rotulo).toBe('Aprovada');
  });
  it('sem o instante da cobrança (dado antigo) nunca vira "Dispensada" por engano', () => {
    const semInstante = itensDaCaixa({
      updates: [], contas: CONTAS_DE_EXEMPLO, nomeDaConta: nomeDaContaDeExemplo, rotuloEtapa: rotuloDeExemplo,
      afazeres: [cobrancaAfazer('f-old', { id: 'c-old', situacao: 'dispensada', atualizado_em: undefined as unknown as string }, { feito_por: 'pessoa-2', feito_em: '2026-10-25T10:30:00Z', feito: { name: 'Bia Exemplo' } })],
    })[0];
    expect(situacaoDecidida(semInstante)?.rotulo).toBe('Aprovada');
  });
});

// ── o que a decisão chama no banco ──
const todos = itensDaCaixa({
  updates: [U_CPFL], afazeres: [...AFAZERES_DE_COBRANCA, F_VISTORIA], contas: CONTAS_DE_EXEMPLO,
  nomeDaConta: nomeDaContaDeExemplo, rotuloEtapa: rotuloDeExemplo,
});
const de = (chave: string): ItemDaCaixa => {
  const i = todos.find(x => x.chave === chave);
  if (!i) throw new Error('sem ' + chave);
  return i;
};
// com espaços nas pontas e linha em branco no fim: tem de chegar ao banco EXATAMENTE assim
const TEXTO_DA_TELA = '  Prezados, boa tarde.\n\nTexto editado  com espaços.\n\nEquipe GD Manager\n\n';

describe('argumentosDaDecisao — o id e o texto que vão para o banco', () => {
  it('as fixtures separam os ids: o do A fazer NÃO é o da cobrança', () => {
    expect(de('f:f-cob').id).toBe('f-cob');
    expect(de('f:f-cob').afazer?.cobranca_id).toBe('c-1');
  });
  it('Enviar leva o id da COBRANÇA e o texto exato da tela, sem recortar', () => {
    expect(argumentosDaDecisao(de('f:f-cob'), 'enviar_cobranca', null, TEXTO_DA_TELA))
      .toEqual({ acao: 'enviar_cobranca', cobrancaId: 'c-1', texto: TEXTO_DA_TELA });
  });
  it('Enviar sem texto leva texto vazio (o banco recusa; nunca "undefined")', () => {
    expect(argumentosDaDecisao(de('f:f-cob'), 'enviar_cobranca', null)).toEqual({ acao: 'enviar_cobranca', cobrancaId: 'c-1', texto: '' });
  });
  it('Dispensar leva o id da COBRANÇA, não o do A fazer', () => {
    expect(argumentosDaDecisao(de('f:f-cob-2a'), 'dispensar_cobranca', null)).toEqual({ acao: 'dispensar_cobranca', cobrancaId: 'c-4' });
  });
  it('o A fazer comum leva o id do A fazer, e o texto nunca o acompanha', () => {
    expect(argumentosDaDecisao(de('f:f-vistoria'), 'feito', null, 'qualquer texto')).toEqual({ acao: 'feito', id: 'f-vistoria' });
  });
  it('a recomendação leva o id dela (Aplicar com a etapa escolhida ou sem etapa; Ignorar)', () => {
    expect(argumentosDaDecisao(de('u:u-cpfl'), 'aplicar', 'approved')).toEqual({ acao: 'aplicar', id: 'u-cpfl', etapa: 'approved' });
    expect(argumentosDaDecisao(de('u:u-cpfl'), 'aplicar', null)).toEqual({ acao: 'aplicar', id: 'u-cpfl', etapa: null });
    expect(argumentosDaDecisao(de('u:u-cpfl'), 'ignorar', null)).toEqual({ acao: 'ignorar', id: 'u-cpfl' });
  });
});

describe('executarDecisao — chama a gravação certa, e só ela', () => {
  const dubles = () => ({
    aplicar: vi.fn().mockResolvedValue('aplicou'), ignorar: vi.fn().mockResolvedValue('ignorou'), feito: vi.fn().mockResolvedValue('feito'),
    enviarCobranca: vi.fn().mockResolvedValue('enviou'), dispensarCobranca: vi.fn().mockResolvedValue('dispensou'),
  });
  const rodar = async (d: ReturnType<typeof dubles>, chave: string, acao: Parameters<typeof argumentosDaDecisao>[1], etapa: string | null, texto?: string) => {
    const r = await executarDecisao(d as unknown as AcoesDaDecisao, argumentosDaDecisao(de(chave), acao, etapa, texto));
    return { r, chamadas: Object.entries(d).filter(([, f]) => f.mock.calls.length > 0).map(([nome, f]) => [nome, f.mock.calls] as const) };
  };
  it('Enviar: enviarCobranca(id da cobrança, texto exato) e nenhuma outra', async () => {
    const { r, chamadas } = await rodar(dubles(), 'f:f-cob', 'enviar_cobranca', null, TEXTO_DA_TELA);
    expect(chamadas).toEqual([['enviarCobranca', [['c-1', TEXTO_DA_TELA]]]]);
    expect(r).toBe('enviou');
  });
  it('Dispensar: dispensarCobranca(id da cobrança) e nenhuma outra', async () => {
    expect((await rodar(dubles(), 'f:f-cob-2a', 'dispensar_cobranca', null)).chamadas).toEqual([['dispensarCobranca', [['c-4']]]]);
  });
  it('Marcar como feito, Ignorar e Aplicar seguem como eram', async () => {
    expect((await rodar(dubles(), 'f:f-vistoria', 'feito', null)).chamadas).toEqual([['feito', [['f-vistoria']]]]);
    expect((await rodar(dubles(), 'u:u-cpfl', 'ignorar', null)).chamadas).toEqual([['ignorar', [['u-cpfl']]]]);
    expect((await rodar(dubles(), 'u:u-cpfl', 'aplicar', 'approved')).chamadas).toEqual([['aplicar', [['u-cpfl', 'approved']]]]);
  });
  it('a rejeição do banco chega a quem chamou, no Enviar e no Dispensar (é o que faz a fila do Desfazer devolver a linha)', async () => {
    const d = dubles();
    d.enviarCobranca.mockRejectedValue(new Error('o banco recusou o envio'));
    d.dispensarCobranca.mockRejectedValue(new Error('o banco recusou a dispensa'));
    await expect(executarDecisao(d as unknown as AcoesDaDecisao, argumentosDaDecisao(de('f:f-cob'), 'enviar_cobranca', null, TEXTO_DA_TELA))).rejects.toThrow('o banco recusou o envio');
    await expect(executarDecisao(d as unknown as AcoesDaDecisao, argumentosDaDecisao(de('f:f-cob'), 'dispensar_cobranca', null))).rejects.toThrow('o banco recusou a dispensa');
  });
});

describe('idDoPorqueDoBotao — o parágrafo do motivo liga ao botão (aria-describedby)', () => {
  it('é um id válido (sem espaço nem dois-pontos), estável e diferente por linha', () => {
    const ids = ['f:f-cob', 'f:f-cob-2a', 'u:u-cpfl'].map(idDoPorqueDoBotao);
    expect(new Set(ids).size).toBe(3);
    for (const id of ids) expect(id).toMatch(/^porque-[A-Za-z0-9_-]+$/);
    expect(idDoPorqueDoBotao('f:f-cob')).toBe(idDoPorqueDoBotao('f:f-cob'));
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
