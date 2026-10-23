import { describe, expect, it } from 'vitest';
import {
  FILTRO_INICIAL, cartaoBloqueado, contarPendentes, filtrarItens, itensDaCaixa, limparOcultos, meioDaConta,
  ordenarItens, proximaDepoisDe, rotuloDoAfazer, selecaoValida, unirPorId, type ItemDaCaixa,
} from './ludmillaCaixa';
import {
  AFAZERES_DE_EXEMPLO, CONTAS_DE_EXEMPLO, CONTA_CPFL, CONTA_EDP, CONTA_ELEKTRO, UPDATES_DE_EXEMPLO, U_CPFL,
  U_CPFL_SEM_PROJETO, U_EDP, U_ENEL_BLOQUEADO, U_ENEL_TROCA, nomeDaContaDeExemplo, rotuloDeExemplo,
} from './ludmillaCaixa.fixtures';

// Todos os nomes e números são inventados (ver o arquivo de fixtures).
const itens = itensDaCaixa({
  updates: UPDATES_DE_EXEMPLO, afazeres: AFAZERES_DE_EXEMPLO, contas: CONTAS_DE_EXEMPLO,
  nomeDaConta: nomeDaContaDeExemplo, rotuloEtapa: rotuloDeExemplo,
});
const item = (chave: string) => itens.find(i => i.chave === chave)!;
const chaves = (l: ItemDaCaixa[]) => l.map(i => i.chave);
const PENDENTES = ['u:u-enel-bloq', 'f:f-vistoria', 'u:u-cpfl', 'u:u-enel-troca', 'u:u-edp', 'u:u-cpfl-sem', 'f:f-devolucao'];

describe('itensDaCaixa — recomendações e A fazer na mesma lista', () => {
  it('uma linha por recomendação e por aviso, com a origem na chave', () => {
    expect(itens).toHaveLength(10);
    expect(item('u:u-cpfl').origem).toBe('recomendacao');
    expect(item('f:f-vistoria').origem).toBe('afazer');
  });
  it('a linha diz quem é, de qual empresa e de qual concessionária', () => {
    expect(item('u:u-cpfl')).toMatchObject({
      codigo: 'PRJ-10001', projectId: 'p-1', titular: 'Marta Ribeiro Campos', noPortal: 'UFV MARTA RIBEIRO',
      empresa: 'Solar Alfa', concessionaria: 'CPFL Paulista', meio: 'portal', protocolo: '7001234', situacao: 'pendente',
    });
  });
  it('o meio vem da conta', () => {
    expect(item('u:u-edp').meio).toBe('email');
    expect(item('f:f-vistoria').meio).toBe('email');
  });
  it('mudar etapa: selo "de → para" com os rótulos do Kanban', () => {
    expect(item('u:u-cpfl').selos).toEqual([{ texto: 'Em análise → Aprovado', tom: 'etapa' }]);
    expect(item('u:u-cpfl').tipos).toEqual(['etapa']);
  });
  it('troca de protocolo: "Gravar protocolo" e os dois tipos', () => {
    expect(item('u:u-enel-troca').selos.map(s => s.texto)).toEqual(['Documentação → Aprovado', 'Gravar protocolo', 'Documento anexado']);
    expect(item('u:u-enel-troca').tipos).toEqual(['etapa', 'protocolo']);
  });
  it('documento de outra pessoa: só "Documento bloqueado"', () => {
    expect(item('u:u-enel-bloq').selos).toEqual([{ texto: 'Documento bloqueado', tom: 'bloqueado' }]);
    expect(item('u:u-enel-bloq').tipos).toEqual(['bloqueado']);
  });
  it('vários documentos: o número vai no selo', () => {
    expect(item('u:u-edp').selos).toContainEqual({ texto: '2 documentos anexados', tom: 'anexo' });
  });
  it('sem etapa, sem troca e sem bloqueio: "Sem sugestão"; sem projeto, sem código', () => {
    expect(item('u:u-cpfl-sem').selos).toEqual([{ texto: 'Sem sugestão', tom: 'neutro' }]);
    expect(item('u:u-cpfl-sem').tipos).toEqual([]);
    expect(item('u:u-cpfl-sem').codigo).toBeNull();
    expect(item('u:u-cpfl-sem').titular).toBe('UFV JOSE ALVES');
  });
  it('A fazer: selo curto pelo tipo; situação pelo feito_em', () => {
    expect(item('f:f-vistoria').selos).toEqual([{ texto: 'A fazer: pedir a troca do relógio', tom: 'afazer' }]);
    expect(item('f:f-vistoria')).toMatchObject({ situacao: 'pendente', codigo: 'PRJ-10007', titular: 'Diego Martins', tipos: ['afazer'] });
    expect(item('f:f-feito').situacao).toBe('feito');
    expect(item('f:f-devolucao').codigo).toBeNull();
    expect(item('f:f-devolucao').concessionaria).toBe('ENEL SP');
  });
});

describe('cartaoBloqueado — só "não anexei · …"', () => {
  const comMotivo = (motivo: string) => ({
    ...U_ENEL_BLOQUEADO, raw: { assunto: 'x', remetente: 'y', motivo } as unknown as Record<string, string>,
  });
  it('"não anexei · …" e "NAO ANEXEI" são bloqueio', () => {
    expect(cartaoBloqueado(comMotivo('não anexei · o documento é de "X"'))).toBe(true);
    expect(cartaoBloqueado(comMotivo('NAO ANEXEI'))).toBe(true);
  });
  it('"não anexei ainda: …" e "não anexado(s)" não são', () => {
    expect(cartaoBloqueado(comMotivo('não anexei ainda: a IA não leu o documento'))).toBe(false);
    expect(cartaoBloqueado(comMotivo('2 arquivo(s) não anexado(s): o nome traz outro número'))).toBe(false);
  });
  it('cartão do portal, sem motivo, não é', () => {
    expect(cartaoBloqueado(U_CPFL)).toBe(false);
  });
});

describe('rotuloDoAfazer', () => {
  it('tipos conhecidos têm texto próprio', () => {
    expect(rotuloDoAfazer({ tipo: 'troca_falhou', titulo: 'x' })).toBe('A fazer: troca do relógio não executada');
    expect(rotuloDoAfazer({ tipo: 'devolucao', titulo: 'x' })).toBe('A fazer: conferir o e-mail que voltou');
  });
  it('tipo genérico usa o título sem o emoji do sino (e não come letra acentuada)', () => {
    expect(rotuloDoAfazer({ tipo: 'aviso', titulo: '📡 Ótimo aviso novo' })).toBe('A fazer: Ótimo aviso novo');
    expect(rotuloDoAfazer({ tipo: 'aviso', titulo: '📡 ' })).toBe('A fazer');
  });
});

describe('filtrarItens — situação, tipo, concessionária e busca', () => {
  it('Pendentes, mais antigas primeiro', () => {
    expect(chaves(filtrarItens(itens, FILTRO_INICIAL))).toEqual(PENDENTES);
  });
  it('Aplicadas inclui o A fazer feito; Ignoradas só as ignoradas; Todas tudo', () => {
    expect(chaves(filtrarItens(itens, { ...FILTRO_INICIAL, situacao: 'aplicada' }))).toEqual(['f:f-feito', 'u:u-aplicada']);
    expect(chaves(filtrarItens(itens, { ...FILTRO_INICIAL, situacao: 'ignorada' }))).toEqual(['u:u-ignorada']);
    expect(filtrarItens(itens, { ...FILTRO_INICIAL, situacao: 'todas' })).toHaveLength(10);
  });
  it('tipo: qualquer um dos marcados basta', () => {
    expect(chaves(filtrarItens(itens, { ...FILTRO_INICIAL, tipos: ['afazer'] }))).toEqual(['f:f-vistoria', 'f:f-devolucao']);
    expect(chaves(filtrarItens(itens, { ...FILTRO_INICIAL, tipos: ['protocolo', 'bloqueado'] }))).toEqual(['u:u-enel-bloq', 'u:u-enel-troca']);
  });
  it('concessionária escolhida no chip', () => {
    expect(chaves(filtrarItens(itens, { ...FILTRO_INICIAL, contaId: 'conta-cpfl' }))).toEqual(['u:u-cpfl', 'u:u-cpfl-sem']);
  });
  it('busca por titular sem acento e sem caixa', () => {
    expect(chaves(filtrarItens(itens, { ...FILTRO_INICIAL, busca: 'cassia PRADO' }))).toEqual(['u:u-edp']);
  });
  it('busca por empresa, código e nome do portal', () => {
    expect(chaves(filtrarItens(itens, { ...FILTRO_INICIAL, busca: 'sol nascente' }))).toEqual(['u:u-enel-troca']);
    expect(chaves(filtrarItens(itens, { ...FILTRO_INICIAL, busca: 'prj-10007' }))).toEqual(['f:f-vistoria']);
    expect(chaves(filtrarItens(itens, { ...FILTRO_INICIAL, busca: 'jose alves' }))).toEqual(['u:u-cpfl-sem']);
  });
  it('busca por protocolo ignora zeros à esquerda (EDP)', () => {
    expect(chaves(filtrarItens(itens, { ...FILTRO_INICIAL, busca: '45006443920' }))).toEqual(['u:u-edp']);
    expect(chaves(filtrarItens(itens, { ...FILTRO_INICIAL, busca: '0045006443920' }))).toEqual(['u:u-edp']);
  });
  it('o que foi decidido agora (esperando o Desfazer) sai da lista', () => {
    expect(chaves(filtrarItens(itens, FILTRO_INICIAL, new Set(['u:u-cpfl'])))).not.toContain('u:u-cpfl');
  });
});

describe('contarPendentes', () => {
  it('total e por concessionária, sem os ocultos', () => {
    expect(contarPendentes(itens)).toEqual({ total: 7, porConta: { 'conta-enel': 4, 'conta-cpfl': 2, 'conta-edp': 1 } });
    expect(contarPendentes(itens, new Set(['f:f-devolucao'])).porConta['conta-enel']).toBe(3);
  });
});

describe('proximaDepoisDe — o painel vai para a próxima pendente', () => {
  const lista = filtrarItens(itens, FILTRO_INICIAL);
  it('a de baixo', () => expect(proximaDepoisDe(lista, 'u:u-cpfl')).toBe('u:u-enel-troca'));
  it('na última, a de cima', () => expect(proximaDepoisDe(lista, 'f:f-devolucao')).toBe('u:u-cpfl-sem'));
  it('a única: nenhuma', () => expect(proximaDepoisDe(lista.slice(0, 1), 'u:u-enel-bloq')).toBeNull());
  it('pula as já decididas', () => {
    const todas = filtrarItens(itens, { ...FILTRO_INICIAL, situacao: 'todas' });
    expect(proximaDepoisDe(todas, 'u:u-enel-bloq')).toBe('f:f-vistoria');
    expect(proximaDepoisDe(todas.slice(0, 4), 'u:u-enel-bloq')).toBeNull();
  });
  it('chave que sumiu da lista: a primeira pendente', () => expect(proximaDepoisDe(lista, 'u:nao-existe')).toBe('u:u-enel-bloq'));
});

describe('selecaoValida', () => {
  const lista = filtrarItens(itens, FILTRO_INICIAL);
  it('mantém a escolhida enquanto ela estiver na lista', () => expect(selecaoValida(lista, 'u:u-edp', true)).toBe('u:u-edp'));
  it('no computador abre a primeira', () => expect(selecaoValida(lista, null, true)).toBe('u:u-enel-bloq'));
  it('no celular não abre nada sozinha', () => {
    expect(selecaoValida(lista, null, false)).toBeNull();
    expect(selecaoValida(lista, 'u:sumiu', false)).toBeNull();
  });
});

describe('limparOcultos', () => {
  it('fica oculto só o que ainda está pendente nos dados', () => {
    expect([...limparOcultos(new Set(['u:u-cpfl', 'u:u-aplicada', 'u:sumiu']), itens)]).toEqual(['u:u-cpfl']);
  });
});

// Acréscimos à prova do plano: as mutações mostraram que estas três regras passavam sem teste.
describe('ordenarItens — empate no horário', () => {
  it('desempata pela chave, não pela ordem de chegada', () => {
    const a = { ...item('u:u-edp'), chave: 'u:b', quando: '2026-10-21T14:00:00Z' };
    const b = { ...item('u:u-cpfl-sem'), chave: 'u:a', quando: '2026-10-21T14:00:00Z' };
    expect(chaves(ordenarItens([a, b]))).toEqual(['u:a', 'u:b']);
    expect(chaves(ordenarItens([b, a]))).toEqual(['u:a', 'u:b']);
  });
});

describe('meioDaConta — portal, e-mail ou estação local', () => {
  it('cada conta no seu meio; conta desconhecida cai no portal', () => {
    expect(meioDaConta(CONTA_CPFL)).toBe('portal');
    expect(meioDaConta(CONTA_EDP)).toBe('email');
    expect(meioDaConta(CONTA_ELEKTRO)).toBe('estacao');
    expect(meioDaConta(undefined)).toBe('portal');
  });
  it('a linha de uma conta da estação local diz "estacao"', () => {
    const [linha] = itensDaCaixa({
      updates: [{ ...U_CPFL_SEM_PROJETO, account_id: 'conta-elektro' }], afazeres: [], contas: CONTAS_DE_EXEMPLO,
      nomeDaConta: nomeDaContaDeExemplo, rotuloEtapa: rotuloDeExemplo,
    });
    expect(linha.meio).toBe('estacao');
    expect(linha.concessionaria).toBe('Elektro');
  });
});

describe('selo de anexo — um só por linha', () => {
  it('2 documentos: só "2 documentos anexados", sem "Documento anexado" junto', () => {
    expect(item('u:u-edp').selos).toEqual([
      { texto: 'Em análise → Aprovado', tom: 'etapa' }, { texto: '2 documentos anexados', tom: 'anexo' },
    ]);
  });
});

describe('unirPorId', () => {
  it('junta as listas sem repetir, na ordem em que aparecem', () => {
    expect(unirPorId([U_CPFL, U_EDP], [U_EDP, U_ENEL_TROCA]).map(u => u.id)).toEqual(['u-cpfl', 'u-edp', 'u-enel-troca']);
  });
});
