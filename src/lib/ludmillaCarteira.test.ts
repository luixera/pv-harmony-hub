import { describe, expect, it } from 'vitest';
import {
  FILTROS_DA_CARTEIRA, alemDoNormal, contarCarteira, diasInteiros, donosPorProjetoDe, emEtapa, filtrarCarteira,
  fraseDasNaoAcompanhadas, juntarComE, linhaDaRpc, naoAcompanhadas, normalDaRpc, normaisDaConcessionaria, ordenarCarteira,
  projetistasDaCarteira, proximoPasso, tempoDaLinha, textoDoNormal, textoDosDias, type LinhaDaCarteira, type NormalDaEtapa,
} from './ludmillaCarteira';

const ROTULOS: Record<string, string> = {
  pending: 'Projetos Recebidos', analysis: 'Em Análise', documentation: 'Documentação', approved: 'Aprovado',
  pendencia: 'Pendência', aguardando_instalacao: 'Aguardando Instalação', vistoria_solicitada: 'Vistoria Solicitada',
};
const rotulo = (s: string) => ROTULOS[s] ?? s;
const ANA = { id: 'pessoa-ana', nome: 'Ana Lima' };
const BRUNO = { id: 'pessoa-bruno', nome: 'Bruno Costa' };

const linha = (x: Partial<LinhaDaCarteira> = {}): LinhaDaCarteira => ({
  projectId: 'p-1', codigo: 'PRJ-1', titular: 'Marta', empresa: 'Solar Alfa', companyId: 'emp-1',
  concessionaria: 'CPFL Paulista', concessionaireId: 'conc-cpfl', status: 'analysis', naEtapaDesde: '2026-11-01T12:00:00Z',
  diasNaEtapa: 3, normalDias: 5, normalFonte: 'medido', atrasoDias: -2, comQuem: 'nos', donos: [], historico: [], naFila: false,
  ...x,
});

describe('linhaDaRpc', () => {
  it('lê a linha da RPC e aceita número como texto', () => {
    const l = linhaDaRpc({
      project_id: 'p-1', code: 'PRJ-10001', titular: 'Marta Ribeiro Campos', empresa: 'Solar Alfa', company_id: 'emp-alfa',
      concessionaria: 'CPFL Paulista', concessionaire_id: 'conc-cpfl', status: 'analysis', na_etapa_desde: '2026-10-10T12:00:00Z',
      dias_na_etapa: '12.5', normal_dias: 8, normal_fonte: 'medido', atraso_dias: 4.5, com_quem: 'concessionaria',
      donos: [{ id: 'pessoa-ana', nome: 'Ana Lima' }, { id: null, nome: 'sem id' }],
      historico: [{ etapa: 'pending', dias: 3, atual: false }, { etapa: 'analysis', dias: '12.5', atual: true }, { dias: 2 }],
      na_fila: true,
    });
    expect(l).toEqual({
      projectId: 'p-1', codigo: 'PRJ-10001', titular: 'Marta Ribeiro Campos', empresa: 'Solar Alfa', companyId: 'emp-alfa',
      concessionaria: 'CPFL Paulista', concessionaireId: 'conc-cpfl', status: 'analysis', naEtapaDesde: '2026-10-10T12:00:00Z',
      diasNaEtapa: 12.5, normalDias: 8, normalFonte: 'medido', atrasoDias: 4.5, comQuem: 'concessionaria',
      donos: [{ id: 'pessoa-ana', nome: 'Ana Lima' }],
      historico: [{ etapa: 'pending', dias: 3, atual: false }, { etapa: 'analysis', dias: 12.5, atual: true }],
      naFila: true,
    });
  });

  it('valores fora do esperado viram o padrão seguro', () => {
    const l = linhaDaRpc({
      project_id: 'p-2', code: null, status: 'approved', dias_na_etapa: null, normal_dias: null, normal_fonte: 'outra',
      atraso_dias: null, com_quem: 'ninguem', donos: null, historico: 'x', na_fila: null,
    });
    expect(l.codigo).toBe('—');
    expect(l.diasNaEtapa).toBe(0);
    expect(l.normalDias).toBeNull();
    expect(l.normalFonte).toBeNull();
    expect(l.comQuem).toBe('nos');
    expect(l.donos).toEqual([]);
    expect(l.historico).toEqual([]);
    expect(l.naFila).toBe(false);
  });
});

describe('normalDaRpc e normaisDaConcessionaria', () => {
  const normais: NormalDaEtapa[] = [
    normalDaRpc({ concessionaire_id: 'conc-cpfl', etapa: 'analysis', normal_dias: 8, amostra: 9, fonte: 'medido' }),
    normalDaRpc({ concessionaire_id: 'conc-enel', etapa: 'analysis', normal_dias: 2, amostra: 12, fonte: 'medido' }),
    normalDaRpc({ concessionaire_id: null, etapa: 'analysis', normal_dias: 5, amostra: 0, fonte: 'coluna' }),
  ];

  it('lê a linha', () => {
    expect(normais[0]).toEqual({ concessionaireId: 'conc-cpfl', etapa: 'analysis', normalDias: 8, amostra: 9, fonte: 'medido' });
  });

  it('separa por concessionária; projeto sem concessionária casa com a linha sem concessionária', () => {
    expect(normaisDaConcessionaria(normais, 'conc-enel').get('analysis')?.normalDias).toBe(2);
    expect(normaisDaConcessionaria(normais, null).get('analysis')?.normalDias).toBe(5);
    expect(normaisDaConcessionaria(normais, 'conc-edp').size).toBe(0);
  });
});

describe('além do normal', () => {
  it('usa os dias inteiros que a tela mostra', () => {
    expect(diasInteiros(7.9)).toBe(7);
    expect(diasInteiros(-1)).toBe(0);
    expect(alemDoNormal(7.9, 7)).toBe(false);
    expect(alemDoNormal(8, 7)).toBe(true);
    expect(alemDoNormal(400, null)).toBe(false);
  });
});

describe('filtros, contagem e ordem da carteira', () => {
  const L1 = linha({ projectId: 'p-1', codigo: 'PRJ-1', comQuem: 'concessionaria', diasNaEtapa: 12.5, normalDias: 8, atrasoDias: 4.5 });
  const L2 = linha({ projectId: 'p-2', codigo: 'PRJ-2', comQuem: 'nos', diasNaEtapa: 3, normalDias: 5, atrasoDias: -2 });
  const L3 = linha({ projectId: 'p-3', codigo: 'PRJ-3', comQuem: 'cliente', diasNaEtapa: 30, normalDias: null, atrasoDias: null });
  const L4 = linha({ projectId: 'p-4', codigo: 'PRJ-4', comQuem: 'nos', diasNaEtapa: 7.9, normalDias: 7, atrasoDias: 0.9 });
  const L5 = linha({ projectId: 'p-5', codigo: 'PRJ-5', comQuem: 'nos', diasNaEtapa: 8, normalDias: 7, atrasoDias: 1 });
  const todas = [L1, L2, L3, L4, L5];

  it('conta cada filtro, com os rótulos da tela', () => {
    expect(contarCarteira(todas)).toEqual({ parados: 2, nos: 3, concessionaria: 1, cliente: 1, todos: 5 });
    expect(FILTROS_DA_CARTEIRA.map(f => f.rotulo)).toEqual([
      'Parados além do normal', 'Com a gente', 'Com a concessionária', 'Com a empresa', 'Todos os projetos',
    ]);
  });

  it('parados = além do normal pela regra da tela', () => {
    expect(filtrarCarteira(todas, 'parados').map(l => l.projectId)).toEqual(['p-1', 'p-5']);
  });

  it('a ordem da spec: além do normal primeiro (maior atraso), depois os outros pelo tempo, empate pelo código', () => {
    const a = linha({ projectId: 'a', codigo: 'PRJ-A', normalDias: 7, atrasoDias: 5, diasNaEtapa: 12 });
    const b = linha({ projectId: 'b', codigo: 'PRJ-B', normalDias: 5, atrasoDias: -2, diasNaEtapa: 3 });
    const c = linha({ projectId: 'c', codigo: 'PRJ-C', normalDias: null, atrasoDias: null, diasNaEtapa: 40 });
    const d = linha({ projectId: 'd', codigo: 'PRJ-D', normalDias: 15, atrasoDias: 5, diasNaEtapa: 20 });
    const e = linha({ projectId: 'e', codigo: 'PRJ-E', normalDias: null, atrasoDias: null, diasNaEtapa: 10 });
    const f = linha({ projectId: 'f', codigo: 'PRJ-0', normalDias: null, atrasoDias: null, diasNaEtapa: 10 });
    expect(ordenarCarteira([a, b, c, d, e, f]).map(l => l.projectId)).toEqual(['d', 'a', 'c', 'f', 'e', 'b']);
  });

  it('7,4 dias com normal 7 não conta como além do normal na ordem (mesma regra da tela)', () => {
    const quase = linha({ projectId: 'q', codigo: 'PRJ-Q', normalDias: 7, atrasoDias: 0.4, diasNaEtapa: 7.4 });
    const longo = linha({ projectId: 'l', codigo: 'PRJ-L', normalDias: null, atrasoDias: null, diasNaEtapa: 30 });
    expect(ordenarCarteira([quase, longo]).map(l => l.projectId)).toEqual(['l', 'q']);
  });
});

describe('o tempo em palavras', () => {
  it('dias', () => {
    expect(textoDosDias(1.9)).toBe('1 dia');
    expect(textoDosDias(0.2)).toBe('0 dias');
    expect(textoDosDias(14.3)).toBe('14 dias');
  });

  it('o normal por fonte', () => {
    expect(textoDoNormal(7, 'medido', 'ENEL SP')).toBe('o normal na ENEL SP é até 7');
    expect(textoDoNormal(7, 'medido', 'ENEL SP', true)).toBe('o normal é até 7');
    expect(textoDoNormal(7, 'geral', 'ENEL SP')).toBe('o normal estimado é até 7');
    expect(textoDoNormal(10, 'coluna', 'ENEL SP')).toBe('o prazo do Kanban é 10');
    expect(textoDoNormal(null, null, 'ENEL SP')).toBe('ainda sem normal medido');
  });

  it('a etapa sem "em Em"', () => {
    expect(emEtapa('Em Análise')).toBe('em Análise');
    expect(emEtapa('Aprovado')).toBe('em Aprovado');
  });

  it('tempoDaLinha junta tudo e decide o alerta', () => {
    expect(tempoDaLinha(linha({ status: 'analysis', diasNaEtapa: 12.5, normalDias: 8, concessionaria: 'ENEL SP' }), rotulo)).toEqual({
      dias: '12 dias', em: 'em Análise', normalCurto: 'o normal é até 8', normalLongo: 'o normal na ENEL SP é até 8', alerta: true,
    });
  });
});

describe('donos', () => {
  const linhas = [linha({ projectId: 'p-1', donos: [BRUNO, ANA] }), linha({ projectId: 'p-2', donos: [ANA] }), linha({ projectId: 'p-3', donos: [] })];

  it('por projeto', () => {
    const m = donosPorProjetoDe(linhas);
    expect(m.get('p-2')).toEqual([ANA]);
    expect(m.get('p-3')).toEqual([]);
    expect(m.get('p-9')).toBeUndefined();
  });

  it('os projetistas, um de cada, pelo nome', () => {
    expect(projetistasDaCarteira(linhas)).toEqual([ANA, BRUNO]);
  });
});

describe('proximoPasso', () => {
  it('item na fila manda para a fila', () => {
    expect(proximoPasso(linha({ naFila: true }), rotulo)).toBe('Tem item esperando decisão na fila. Abra o item para decidir.');
  });

  it('com a concessionária', () => {
    expect(proximoPasso(linha({ comQuem: 'concessionaria', diasNaEtapa: 12.5, normalDias: 8 }), rotulo))
      .toBe('Esperar a CPFL Paulista. Passou 4 dias do normal em Análise.');
    expect(proximoPasso(linha({ comQuem: 'concessionaria', diasNaEtapa: 3, normalDias: 8 }), rotulo))
      .toBe('Nada a fazer agora: está com a CPFL Paulista, dentro do normal.');
  });

  it('com a concessionária e sem o normal medido, não diz "dentro do normal"', () => {
    expect(proximoPasso(linha({ comQuem: 'concessionaria', diasNaEtapa: 3, normalDias: null }), rotulo))
      .toBe('Nada a fazer agora: está com a CPFL Paulista há 3 dias; ainda não tenho o tempo normal desta etapa.');
  });

  it('com a empresa', () => {
    expect(proximoPasso(linha({ comQuem: 'cliente', status: 'pendencia', diasNaEtapa: 19.2 }), rotulo))
      .toBe('Cobrar a empresa: a CPFL Paulista pediu um ajuste há 19 dias.');
    expect(proximoPasso(linha({ comQuem: 'cliente', status: 'approved' }), rotulo))
      .toBe('A empresa está instalando. Quando ela pedir a vistoria pelo painel, a bola volta para a gente.');
  });

  it('com a gente', () => {
    expect(proximoPasso(linha({ comQuem: 'nos', status: 'approved' }), rotulo))
      .toBe('A empresa já pediu a vistoria pelo painel: falta pedir a vistoria na CPFL Paulista.');
    expect(proximoPasso(linha({ comQuem: 'nos', status: 'documentation', diasNaEtapa: 3, normalDias: 5 }), rotulo))
      .toBe('É com a gente: 3 dias em Documentação.');
    expect(proximoPasso(linha({ comQuem: 'nos', status: 'documentation', diasNaEtapa: 9, normalDias: 5 }), rotulo))
      .toBe('É com a gente, e já são 9 dias em Documentação, além do normal.');
  });
});

describe('concessionárias não acompanhadas', () => {
  it('as da carteira sem conta, pelo nome', () => {
    const linhas = [
      linha({ concessionaireId: 'conc-cpfl', concessionaria: 'CPFL Paulista' }),
      linha({ concessionaireId: 'conc-energisa', concessionaria: 'Energisa' }),
      linha({ concessionaireId: 'conc-cemig', concessionaria: 'CEMIG' }),
      linha({ concessionaireId: 'conc-cemig', concessionaria: 'CEMIG' }),
      linha({ concessionaireId: null, concessionaria: null }),
    ];
    const nomes = naoAcompanhadas(linhas, ['conc-cpfl', null]);
    expect(nomes).toEqual(['CEMIG', 'Energisa']);
    expect(fraseDasNaoAcompanhadas(nomes)).toBe('Ainda não acompanho CEMIG e Energisa.');
    expect(fraseDasNaoAcompanhadas([])).toBeNull();
  });

  it('juntarComE', () => {
    expect(juntarComE([])).toBe('');
    expect(juntarComE(['a'])).toBe('a');
    expect(juntarComE(['a', 'b', 'c'])).toBe('a, b e c');
  });
});
