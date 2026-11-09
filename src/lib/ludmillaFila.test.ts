import { describe, expect, it } from 'vitest';
import type { PortalUpdate } from '@/hooks/useLudmilla';
import { itensDaCaixa, type Afazer, type ItemDaCaixa } from './ludmillaCaixa';
import {
  AFAZERES_DE_EXEMPLO, AGORA, CONTAS_DE_EXEMPLO, F_DEVOLUCAO, F_VISTORIA, U_CPFL, UPDATES_DE_EXEMPLO,
  nomeDaContaDeExemplo, rotuloDeExemplo,
} from './ludmillaCaixa.fixtures';
import { COBRANCA_BASE, F_COBRANCA, F_COBRANCA_SEGUNDA } from './ludmillaCobranca.fixtures';
import {
  SEM_DONO, TODOS, botaoDoCartao, casaDono, filaInicial, filaPorGrupo, grupoDoItem, linhaDoProjeto, opcoesDeDono,
  porqueDoItem, prazoDoItem, primeiroNome, resumoDaFila, textoDoFiltroDeDono, tituloDoItem,
} from './ludmillaFila';

// AGORA (fixtures) = 22/10/2026 12:00 UTC = 09:00 de quinta em Brasília
const ANA = { id: 'pessoa-ana', nome: 'Ana Lima' };
const BRUNO = { id: 'pessoa-bruno', nome: 'Bruno Costa' };

const U_HOJE: PortalUpdate = { ...U_CPFL, id: 'u-hoje', detectado_em: '2026-10-22T10:30:00Z' };
const U_ONTEM_A_NOITE: PortalUpdate = { ...U_CPFL, id: 'u-noite', detectado_em: '2026-10-22T02:00:00Z' }; // 23:00 de 21/10
const U_SO_PROTOCOLO: PortalUpdate = { ...U_CPFL, id: 'u-proto', recomendacao: null, atualizar_protocolo: true };
const F_VISTORIA_7: Afazer = { ...F_VISTORIA, id: 'f-vist-7', criado_em: '2026-10-15T12:00:00Z' };
const F_VISTORIA_6: Afazer = { ...F_VISTORIA, id: 'f-vist-6', criado_em: '2026-10-16T12:00:00Z' };
const F_AVISO: Afazer = { ...F_DEVOLUCAO, id: 'f-aviso', tipo: 'aviso', titulo: '📡 Conferir a carta da ENEL', mensagem: '' };
const F_COBRANCA_VENCIDA: Afazer = { ...F_COBRANCA, id: 'f-cob-venc', cobranca: { ...COBRANCA_BASE, vence_em: '2026-10-20T14:00:00Z' } };

const montar = (updates: PortalUpdate[] = UPDATES_DE_EXEMPLO, afazeres: Afazer[] = AFAZERES_DE_EXEMPLO): ItemDaCaixa[] =>
  itensDaCaixa({ updates, afazeres, contas: CONTAS_DE_EXEMPLO, nomeDaConta: nomeDaContaDeExemplo, rotuloEtapa: rotuloDeExemplo });
const TODOS_OS_ITENS = montar(
  [...UPDATES_DE_EXEMPLO, U_HOJE, U_ONTEM_A_NOITE, U_SO_PROTOCOLO],
  [...AFAZERES_DE_EXEMPLO, F_VISTORIA_7, F_VISTORIA_6, F_AVISO, F_COBRANCA, F_COBRANCA_SEGUNDA, F_COBRANCA_VENCIDA],
);
const item = (chave: string): ItemDaCaixa => {
  const i = TODOS_OS_ITENS.find(x => x.chave === chave);
  if (!i) throw new Error(`a fixture não tem ${chave}`);
  return i;
};
const DONOS = new Map([['p-1', [ANA]], ['p-2', [BRUNO]], ['p-3', [ANA, BRUNO]]]);

describe('grupoDoItem (spec §6.1)', () => {
  it('Agora: cobrança, troca que falhou, e-mail que voltou e recomendação de etapa de hoje', () => {
    expect(grupoDoItem(item('f:f-cob'), AGORA)).toBe('agora');
    expect(grupoDoItem(item('f:f-feito'), AGORA)).toBe('agora'); // troca_falhou
    expect(grupoDoItem(item('f:f-devolucao'), AGORA)).toBe('agora');
    expect(grupoDoItem(item('u:u-hoje'), AGORA)).toBe('agora');
  });

  it('Esta semana: recomendação de etapa de dias anteriores (o dia é o de Brasília)', () => {
    expect(grupoDoItem(item('u:u-cpfl'), AGORA)).toBe('semana');
    expect(grupoDoItem(item('u:u-noite'), AGORA)).toBe('semana');
  });

  it('vistoria aprovada: Esta semana até 6 dias, Agora a partir de 7', () => {
    expect(grupoDoItem(item('f:f-vistoria'), AGORA)).toBe('semana');
    expect(grupoDoItem(item('f:f-vist-6'), AGORA)).toBe('semana');
    expect(grupoDoItem(item('f:f-vist-7'), AGORA)).toBe('agora');
  });

  it('Quando puder: documento travado, só protocolo, sem sugestão e aviso', () => {
    expect(grupoDoItem(item('u:u-enel-bloq'), AGORA)).toBe('depois');
    expect(grupoDoItem(item('u:u-proto'), AGORA)).toBe('depois');
    expect(grupoDoItem(item('u:u-cpfl-sem'), AGORA)).toBe('depois');
    expect(grupoDoItem(item('f:f-aviso'), AGORA)).toBe('depois');
  });
});

describe('a fila por grupo, com o dono (spec §6.2)', () => {
  const pendentes = montar();
  const base = { ocultos: new Set<string>(), agora: AGORA, donosPorProjeto: DONOS };

  it('Todos: só o que espera decisão, mais antigo primeiro em cada grupo', () => {
    const g = filaPorGrupo(pendentes, { ...base, dono: TODOS });
    expect(g.agora.map(i => i.chave)).toEqual(['f:f-devolucao']);
    expect(g.semana.map(i => i.chave)).toEqual(['f:f-vistoria', 'u:u-cpfl', 'u:u-enel-troca', 'u:u-edp']);
    expect(g.depois.map(i => i.chave)).toEqual(['u:u-enel-bloq', 'u:u-cpfl-sem']);
  });

  it('a fila de um projetista; com vários ligados, o item conta na de cada um', () => {
    const a = filaPorGrupo(pendentes, { ...base, dono: ANA.id });
    expect([...a.agora, ...a.semana, ...a.depois].map(i => i.chave)).toEqual(['u:u-cpfl', 'u:u-enel-bloq']);
    const b = filaPorGrupo(pendentes, { ...base, dono: BRUNO.id });
    expect([...b.agora, ...b.semana, ...b.depois].map(i => i.chave)).toEqual(['u:u-enel-troca', 'u:u-enel-bloq']);
  });

  it('Sem dono: sem projeto, ou projeto sem projetista ligado', () => {
    const g = filaPorGrupo(pendentes, { ...base, dono: SEM_DONO });
    expect([...g.agora, ...g.semana, ...g.depois].map(i => i.chave)).toEqual(['f:f-devolucao', 'f:f-vistoria', 'u:u-edp', 'u:u-cpfl-sem']);
  });

  it('o que espera o Desfazer não aparece', () => {
    const g = filaPorGrupo(pendentes, { ...base, ocultos: new Set(['u:u-cpfl']), dono: TODOS });
    expect(g.semana.map(i => i.chave)).not.toContain('u:u-cpfl');
  });

  it('o resumo do recado conta a fila de todos', () => {
    expect(resumoDaFila(pendentes, base)).toEqual({ total: 7, agora: 1, semDono: 4 });
  });

  it('casaDono', () => {
    expect(casaDono([], TODOS)).toBe(true);
    expect(casaDono([], SEM_DONO)).toBe(true);
    expect(casaDono([ANA], SEM_DONO)).toBe(false);
    expect(casaDono([ANA, BRUNO], BRUNO.id)).toBe(true);
    expect(casaDono([ANA], BRUNO.id)).toBe(false);
  });
});

describe('quem abre em qual fila', () => {
  it('o projetista na própria; o gestor em Todos', () => {
    expect(filaInicial({ id: ANA.id, role: 'staff' })).toBe(ANA.id);
    expect(filaInicial({ id: 'chefe', role: 'admin' })).toBe(TODOS);
    expect(filaInicial(null)).toBe(TODOS);
  });

  it('os botões de "Fila de": quem abriu entra mesmo sem vínculo', () => {
    expect(opcoesDeDono([ANA, BRUNO], { id: 'chefe', role: 'admin' })).toEqual([
      { valor: TODOS, rotulo: 'Todos' }, { valor: ANA.id, rotulo: 'Ana' },
      { valor: BRUNO.id, rotulo: 'Bruno' }, { valor: SEM_DONO, rotulo: 'Sem dono' },
    ]);
    expect(opcoesDeDono([BRUNO], { id: 'pessoa-carla', role: 'staff', name: 'Carla Dias' }).map(o => o.rotulo))
      .toEqual(['Todos', 'Bruno', 'Carla', 'Sem dono']);
  });

  it('o texto do celular', () => {
    const opcoes = opcoesDeDono([ANA, BRUNO], null);
    expect(textoDoFiltroDeDono(TODOS, opcoes)).toBe('Fila de todos. Para ver só a sua, abra o menu.');
    expect(textoDoFiltroDeDono(ANA.id, opcoes)).toBe('Fila de Ana. Para mudar, abra o menu.');
    expect(textoDoFiltroDeDono(SEM_DONO, opcoes)).toBe('Só o que está sem dono. Para mudar, abra o menu.');
    expect(primeiroNome('  Bruno Costa ')).toBe('Bruno');
  });
});

describe('prazoDoItem', () => {
  it('cobrança vencida e e-mail que voltou ficam em alerta', () => {
    expect(prazoDoItem(item('f:f-cob-venc'), AGORA)).toEqual({ texto: 'venceu há 2 dias', tom: 'alerta' });
    expect(prazoDoItem(item('f:f-devolucao'), AGORA)).toEqual({ texto: 'voltou hoje', tom: 'alerta' });
  });

  it('recomendação de hoje, de ontem e de antes, em sol', () => {
    expect(prazoDoItem(item('u:u-hoje'), AGORA)).toEqual({ texto: 'chegou hoje', tom: 'sol' });
    expect(prazoDoItem(item('u:u-enel-troca'), AGORA)).toEqual({ texto: 'chegou ontem', tom: 'sol' });
    expect(prazoDoItem(item('u:u-cpfl'), AGORA)).toEqual({ texto: 'chegou há 2 dias', tom: 'sol' });
  });

  it('vistoria: sol na semana, alerta quando vira Agora', () => {
    expect(prazoDoItem(item('f:f-vistoria'), AGORA)).toEqual({ texto: 'aprovada há 2 dias', tom: 'sol' });
    expect(prazoDoItem(item('f:f-vist-7'), AGORA)).toEqual({ texto: 'aprovada há 7 dias', tom: 'alerta' });
  });

  it('Quando puder fica na caixa', () => {
    expect(prazoDoItem(item('u:u-enel-bloq'), AGORA)).toEqual({ texto: 'chegou há 3 dias', tom: 'caixa' });
  });
});

describe('tituloDoItem: a ação como título', () => {
  it('recomendações', () => {
    expect(tituloDoItem(item('u:u-cpfl'), rotuloDeExemplo)).toBe('Mover para Aprovado');
    expect(tituloDoItem(item('u:u-enel-troca'), rotuloDeExemplo)).toBe('Mover para Aprovado e gravar o protocolo');
    expect(tituloDoItem(item('u:u-proto'), rotuloDeExemplo)).toBe('Gravar o protocolo');
    expect(tituloDoItem(item('u:u-enel-bloq'), rotuloDeExemplo)).toBe('Decidir sobre um documento que travei');
    expect(tituloDoItem(item('u:u-cpfl-sem'), rotuloDeExemplo)).toBe('Ver o que chegou');
  });

  it('A fazer', () => {
    expect(tituloDoItem(item('f:f-cob'), rotuloDeExemplo)).toBe('Cobrar a troca do relógio');
    expect(tituloDoItem(item('f:f-vistoria'), rotuloDeExemplo)).toBe('Pedir a troca do relógio');
    expect(tituloDoItem(item('f:f-devolucao'), rotuloDeExemplo)).toBe('Conferir o e-mail que voltou');
    expect(tituloDoItem(item('f:f-feito'), rotuloDeExemplo)).toBe('Ver a troca do relógio que não aconteceu');
    expect(tituloDoItem(item('f:f-aviso'), rotuloDeExemplo)).toBe('Conferir a carta da ENEL');
  });

  it('a linha do projeto', () => {
    expect(linhaDoProjeto(item('u:u-cpfl'))).toBe('PRJ-10001, Marta Ribeiro Campos, CPFL Paulista');
    expect(linhaDoProjeto(item('u:u-cpfl'), true)).toBe('PRJ-10001, Marta Ribeiro Campos, Solar Alfa, CPFL Paulista');
    expect(linhaDoProjeto(item('f:f-devolucao'))).toBe('Sem projeto casado, ENEL SP');
  });
});

describe('porqueDoItem: em primeira pessoa', () => {
  it('portal e e-mail', () => {
    expect(porqueDoItem(item('u:u-cpfl'))).toBe('Vi no portal da CPFL Paulista que mudou de “Em Andamento” para “Aprovado”.');
    expect(porqueDoItem(item('u:u-edp'))).toBe('Li um e-mail da EDP São Paulo: Parecer favorável.');
  });

  it('documento travado', () => {
    expect(porqueDoItem(item('u:u-enel-bloq')))
      .toBe('Não anexei: o documento é de "Carlos Souza" e o projeto é de "Ana Paula Reis".');
  });

  it('cobrança: a nota como a ENEL escreve, e quantas vezes já cobramos', () => {
    expect(porqueDoItem(item('f:f-cob')))
      .toBe('Vi que a ENEL SP abriu a nota 70700000123 em 01/10/2026 e ainda não trocou o relógio. Ninguém cobrou desta nota ainda.');
    expect(porqueDoItem(item('f:f-cob-2a')))
      .toBe('Vi que a ENEL SP abriu a nota 70700000123 em 01/10/2026 e ainda não trocou o relógio. Já cobramos 1 vez.');
  });

  it('vistoria aprovada e os outros A fazer', () => {
    expect(porqueDoItem(item('f:f-vistoria'))).toBe('Vi que a vistoria foi aprovada em 20/10/2026 e ninguém pediu a troca ainda.');
    expect(porqueDoItem(item('f:f-devolucao'))).toBe('Um dos destinatários de um e-mail não recebeu a mensagem (devolução do servidor).');
    expect(porqueDoItem(item('f:f-aviso'))).toBe('Conferir a carta da ENEL.');
  });
});

describe('botaoDoCartao (decisão 13)', () => {
  it('decide direto só o que não pede revisão', () => {
    expect(botaoDoCartao(item('u:u-cpfl'), rotuloDeExemplo)).toEqual({ tipo: 'decidir', acao: 'aplicar', rotulo: 'Mover para Aprovado' });
    expect(botaoDoCartao(item('u:u-enel-troca'), rotuloDeExemplo)).toEqual({ tipo: 'decidir', acao: 'aplicar', rotulo: 'Mover e gravar o protocolo' });
    expect(botaoDoCartao(item('u:u-proto'), rotuloDeExemplo)).toEqual({ tipo: 'decidir', acao: 'aplicar', rotulo: 'Gravar o protocolo' });
    expect(botaoDoCartao(item('f:f-devolucao'), rotuloDeExemplo)).toEqual({ tipo: 'decidir', acao: 'feito', rotulo: 'Marcar como feito' });
  });

  it('o resto abre o detalhe', () => {
    expect(botaoDoCartao(item('f:f-cob'), rotuloDeExemplo)).toEqual({ tipo: 'abrir', rotulo: 'Revisar e enviar' });
    expect(botaoDoCartao(item('f:f-vistoria'), rotuloDeExemplo)).toEqual({ tipo: 'abrir', rotulo: 'Revisar e enviar' });
    expect(botaoDoCartao(item('u:u-enel-bloq'), rotuloDeExemplo)).toEqual({ tipo: 'abrir', rotulo: 'Abrir para decidir' });
    expect(botaoDoCartao(item('u:u-cpfl-sem'), rotuloDeExemplo)).toEqual({ tipo: 'abrir', rotulo: 'Abrir para decidir' });
  });
});
