import { describe, expect, it } from 'vitest';
import type { RegistroLudmilla } from '@/hooks/useLudmilla';
import {
  chaveDaVisita, desdeDoRecado, diarioPorDia, fezSozinha, fraseDasLeituras, fraseDoRegistro, gravarVisita, lerVisita,
  recadoDoDia, rotuloDoDesde, ultimaLeituraDoDiaUtilAnterior, type LeituraDaConta,
} from './ludmillaRecado';

/** Segunda, 9/11/2026, 08:15 de Brasília. */
const SEG = Date.parse('2026-11-09T11:15:00Z');
/** Sexta, 6/11/2026, 18:00 de Brasília. */
const SEXTA_18H = Date.parse('2026-11-06T21:00:00Z');

const ev = (x: Partial<RegistroLudmilla> & Pick<RegistroLudmilla, 'quando' | 'acao' | 'titulo'>): RegistroLudmilla => ({
  ator: 'ludmilla', quem: 'Ludmilla', detalhe: null, situacao: 'ok', project_id: null, projeto: null, protocolo: null, ...x,
});

describe('desde quando (decisão 6)', () => {
  it('a última leitura do dia útil anterior pula o fim de semana', () => {
    expect(ultimaLeituraDoDiaUtilAnterior(SEG)).toBe(SEXTA_18H);
    expect(ultimaLeituraDoDiaUtilAnterior(Date.parse('2026-11-10T12:00:00Z'))).toBe(Date.parse('2026-11-09T21:00:00Z'));
    expect(ultimaLeituraDoDiaUtilAnterior(Date.parse('2026-11-08T15:00:00Z'))).toBe(SEXTA_18H);
  });

  it('a visita guardada vale; sem ela, inválida ou no futuro, a última leitura; nunca mais de 7 dias', () => {
    expect(desdeDoRecado('2026-11-09T10:00:00Z', SEG)).toBe(Date.parse('2026-11-09T10:00:00Z'));
    expect(desdeDoRecado(null, SEG)).toBe(SEXTA_18H);
    expect(desdeDoRecado('lixo', SEG)).toBe(SEXTA_18H);
    expect(desdeDoRecado('2026-11-09T12:00:00Z', SEG)).toBe(SEXTA_18H);
    expect(desdeDoRecado('2026-10-20T10:00:00Z', SEG)).toBe(SEG - 7 * 86_400_000);
  });

  it('o rótulo', () => {
    expect(rotuloDoDesde(Date.parse('2026-11-09T10:40:00Z'), SEG)).toBe('Desde as 07:40');
    expect(rotuloDoDesde(Date.parse('2026-11-08T20:00:00Z'), SEG)).toBe('Desde ontem');
    expect(rotuloDoDesde(SEXTA_18H, SEG)).toBe('Desde sexta');
    expect(rotuloDoDesde(Date.parse('2026-10-31T12:00:00Z'), SEG)).toBe('Desde 31/10');
  });
});

describe('a visita no localStorage', () => {
  it('guarda e lê por usuário', () => {
    const guardado = new Map<string, string>();
    const armazem = { getItem: (k: string) => guardado.get(k) ?? null, setItem: (k: string, v: string) => { guardado.set(k, v); } };
    gravarVisita(armazem, 'u1', '2026-11-09T11:00:00Z');
    expect(lerVisita(armazem, 'u1')).toBe('2026-11-09T11:00:00Z');
    expect(lerVisita(armazem, 'u2')).toBeNull();
    expect(chaveDaVisita('u1')).toBe('ludmilla:ultima-visita:u1');
  });

  it('armazém que recusa ou não existe nunca derruba a página', () => {
    const quebrado = {
      getItem: () => { throw new Error('bloqueado'); },
      setItem: () => { throw new Error('cota'); },
    };
    expect(lerVisita(quebrado, 'u1')).toBeNull();
    expect(() => gravarVisita(quebrado, 'u1', 'x')).not.toThrow();
    expect(lerVisita(null, 'u1')).toBeNull();
  });
});

describe('o recado do dia (spec §4.2)', () => {
  const LEITURAS: LeituraDaConta[] = [
    { nome: 'ENEL', meio: 'email', emails: 38, protocolos: null },
    { nome: 'CPFL', meio: 'portal', emails: null, protocolos: 199 },
    { nome: 'EDP', meio: 'email', emails: 0, protocolos: null },
  ];

  it('a frase das leituras pula quem não leu nada', () => {
    expect(fraseDasLeituras(LEITURAS)).toBe('li 38 e-mails da ENEL e 199 protocolos da CPFL');
    expect(fraseDasLeituras([{ nome: 'ENEL', meio: 'email', emails: 1, protocolos: null }])).toBe('li 1 e-mail da ENEL');
    expect(fraseDasLeituras([])).toBeNull();
  });

  it('o recado do mockup', () => {
    const r = recadoDoDia({ agora: SEG, desde: SEXTA_18H, leituras: LEITURAS, fizSozinha: 2, separei: 5, paraAgora: 2, semDono: 0 });
    expect(r.data).toBe('Segunda, 9/11, 08:15');
    expect(r.texto).toBe('Bom dia. Desde sexta li 38 e-mails da ENEL e 199 protocolos da CPFL. Fiz 2 coisas sozinha. Separei 5 coisas para vocês.');
    expect(r.curto).toBe('Bom dia. Separei 5 coisas; 2 para agora.');
  });

  it('sem nada', () => {
    const tarde = Date.parse('2026-11-09T18:00:00Z');
    const r = recadoDoDia({ agora: tarde, desde: Date.parse('2026-11-09T17:00:00Z'), leituras: [], fizSozinha: 0, separei: 0, paraAgora: 0, semDono: 0 });
    expect(r.texto).toBe('Boa tarde. Desde as 14:00 não li nada novo. Não separei nada para vocês.');
    expect(r.curto).toBe('Boa tarde. Nada para decidir agora.');
  });

  it('fila que não carregou nunca vira "não separei nada"', () => {
    const r = recadoDoDia({
      agora: SEG, desde: SEXTA_18H, leituras: [], fizSozinha: 2, separei: null, paraAgora: 0, semDono: 0,
    });
    expect(r.texto).toBe('Bom dia. Desde sexta não li nada novo. Fiz 2 coisas sozinha. Não consegui carregar a fila de decisões.');
    expect(r.curto).toBe('Bom dia. Não consegui carregar a fila.');
  });

  it('contagem que falhou não vira "não li nada"; sem dono vai no recado', () => {
    const r = recadoDoDia({
      agora: SEG, desde: Date.parse('2026-11-08T20:00:00Z'), leituras: null, fizSozinha: 1, separei: 1, paraAgora: 0, semDono: 1,
    });
    expect(r.texto).toBe('Bom dia. Desde ontem, não consegui contar o que li. Fiz 1 coisa sozinha. Separei 1 coisa para vocês; 1 está sem dono.');
    expect(r.curto).toBe('Bom dia. Separei 1 coisa; 0 para agora.');
    const varios = recadoDoDia({ agora: SEG, desde: SEXTA_18H, leituras: [], fizSozinha: 0, separei: 4, paraAgora: 1, semDono: 2 });
    expect(varios.texto).toContain('Separei 4 coisas para vocês; 2 estão sem dono.');
  });
});

describe('fezSozinha (entrega 2: o que ela já faz hoje)', () => {
  it('anexos conferidos e pareceres no card, desde então, o mais novo primeiro', () => {
    const registro = [
      ev({ quando: '2026-11-09T11:01:00Z', acao: 'anexo', titulo: 'Anexo da concessionária no card',
        detalhe: 'parecer.pdf · protocolo 4500 · conferido por cpf', project_id: 'p-8840', projeto: 'PRJ-8840' }),
      ev({ quando: '2026-11-08T12:00:00Z', acao: 'parecer', titulo: 'Parecer da concessionária no card',
        detalhe: 'Análise técnica · APROVADO · protocolo 7001', project_id: 'p-1', projeto: 'PRJ-1' }),
      ev({ quando: '2026-11-08T12:30:00Z', acao: 'anexo', titulo: 'Anexo bloqueado (titular/UC não conferem)', situacao: 'aviso', projeto: 'PRJ-2' }),
      ev({ quando: '2026-11-09T11:02:00Z', acao: 'visita', titulo: 'Varredura no portal CPFL Paulista' }),
      ev({ quando: '2026-11-09T10:00:00Z', ator: 'equipe', quem: 'Bia', acao: 'aplicada', titulo: 'Recomendação aplicada' }),
      ev({ quando: '2026-11-05T12:00:00Z', acao: 'anexo', titulo: 'Anexo da concessionária no card', detalhe: 'velho.pdf', projeto: 'PRJ-9' }),
    ];
    expect(fezSozinha(registro, SEXTA_18H)).toEqual([
      { quando: '2026-11-09T11:01:00Z', projectId: 'p-8840', texto: 'Anexei parecer.pdf ao PRJ-8840.' },
      { quando: '2026-11-08T12:00:00Z', projectId: 'p-1',
        texto: 'Pus o parecer da concessionária no card do PRJ-1 (Análise técnica · APROVADO · protocolo 7001).' },
    ]);
  });
});

describe('o Diário em primeira pessoa', () => {
  it('as frases dela', () => {
    expect(fraseDoRegistro(ev({ quando: '', acao: 'visita', titulo: 'Varredura no portal CPFL Paulista' }))).toBe('Li o portal CPFL Paulista');
    expect(fraseDoRegistro(ev({ quando: '', acao: 'visita', titulo: 'Leitura dos e-mails da ENEL SP' }))).toBe('Li os e-mails da ENEL SP');
    expect(fraseDoRegistro(ev({ quando: '', acao: 'visita', titulo: 'Varredura no portal Elektro', situacao: 'erro' })))
      .toBe('Não consegui: Varredura no portal Elektro');
    expect(fraseDoRegistro(ev({ quando: '', acao: 'recomendacao', titulo: 'Mudança no portal: Aprovado', projeto: 'PRJ-1' })))
      .toBe('Vi uma mudança: Aprovado (PRJ-1)');
    expect(fraseDoRegistro(ev({ quando: '', acao: 'anexo', titulo: 'Anexo da concessionária no card', projeto: 'PRJ-2' })))
      .toBe('Anexei o documento da concessionária no card (PRJ-2)');
    expect(fraseDoRegistro(ev({ quando: '', acao: 'tarefa_encerrada', titulo: 'Tarefa encerrada: Solicitar vistoria' })))
      .toBe('Encerrei a tarefa: Solicitar vistoria');
    expect(fraseDoRegistro({ ator: 'ludmilla', quem: 'Ludmilla', acao: 'afazer', titulo: 'Vistoria aprovada', detalhe: null, situacao: 'ok', projeto: null }))
      .toBe('Vistoria aprovada');
  });

  it('as frases da equipe', () => {
    expect(fraseDoRegistro(ev({ quando: '', ator: 'equipe', quem: 'Bia Souza', acao: 'aplicada', titulo: 'Recomendação aplicada', projeto: 'PRJ-3' })))
      .toBe('Bia Souza aplicou a recomendação (PRJ-3)');
    expect(fraseDoRegistro(ev({ quando: '', ator: 'equipe', quem: null, acao: 'captcha_respondido', titulo: 'Código da imagem respondido (Elektro)' })))
      .toBe('Alguém da equipe digitou o código da imagem');
  });

  it('agrupa por dia de Brasília, o mais novo primeiro', () => {
    const dias = diarioPorDia([
      ev({ quando: '2026-11-09T11:00:00Z', acao: 'visita', titulo: 'Leitura dos e-mails da ENEL SP', detalhe: '12 projetos conferidos' }),
      ev({ quando: '2026-11-09T11:02:00Z', acao: 'visita', titulo: 'Varredura no portal CPFL Paulista', detalhe: '199 protocolos lidos' }),
      ev({ quando: '2026-11-08T15:00:00Z', ator: 'equipe', quem: 'Bia Souza', acao: 'aplicada', titulo: 'Recomendação aplicada', projeto: 'PRJ-3' }),
      ev({ quando: '2026-11-06T20:40:00Z', acao: 'visita', titulo: 'Varredura no portal Elektro', situacao: 'erro', detalhe: 'sessão expirada' }),
      ev({ quando: 'lixo', acao: 'visita', titulo: 'sem data' }),
    ], SEG);
    expect(dias.map(d => d.rotulo)).toEqual(['Hoje, segunda 9/11', 'Ontem, domingo 8/11', 'Sexta, 6/11']);
    expect(dias[0].itens.map(i => [i.hora, i.texto])).toEqual([['08:02', 'Li o portal CPFL Paulista'], ['08:00', 'Li os e-mails da ENEL SP']]);
    expect(dias[1].itens[0]).toMatchObject({ deLa: false, quem: 'Bia Souza', texto: 'Bia Souza aplicou a recomendação (PRJ-3)' });
    expect(dias[2].itens[0]).toMatchObject({ deLa: true, quem: 'Ludmilla', erro: true, detalhe: 'sessão expirada' });
  });
});
