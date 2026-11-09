import { describe, expect, it } from 'vitest';
import { barrasDoHistorico, descricaoDasBarras, ORDEM_PADRAO, type EntradaDasBarras } from './ludmillaBarras';
import type { NormalDaEtapa } from './ludmillaCarteira';

const ROTULOS: Record<string, string> = {
  pending: 'Projetos Recebidos', analysis: 'Em Análise', documentation: 'Documentação', approval: 'Aguardando Aprovação',
  approved: 'Aprovado', pendencia: 'Pendência', vistoria_solicitada: 'Vistoria Solicitada',
  aguardando_instalacao: 'Aguardando Instalação', etapa_nova: 'Etapa Nova',
};
const rotuloEtapa = (s: string) => ROTULOS[s] ?? s;
const normal = (etapa: string, normalDias: number): [string, NormalDaEtapa] =>
  [etapa, { concessionaireId: 'conc-cpfl', etapa, normalDias, amostra: 9, fonte: 'medido' }];
const NORMAIS = new Map([normal('pending', 2), normal('analysis', 8), normal('documentation', 5)]);

const entrada = (x: Partial<EntradaDasBarras>): EntradaDasBarras => ({
  historico: [], status: 'analysis', diasNaEtapa: 0, ordem: [], normais: NORMAIS, rotuloEtapa, ...x,
});

describe('barrasDoHistorico', () => {
  const comum = entrada({
    historico: [
      { etapa: 'pending', dias: 3, atual: false },
      { etapa: 'analysis', dias: 10, atual: false },
      { etapa: 'documentation', dias: 4, atual: true },
    ],
    status: 'documentation', diasNaEtapa: 4.2,
  });

  it('passadas, a atual e as que ainda vêm do caminho principal, sem desvios nem Concluído', () => {
    const b = barrasDoHistorico(comum);
    expect(b.map(x => x.etapa)).toEqual([
      'pending', 'analysis', 'documentation', 'approval', 'approved', 'vistoria_solicitada', 'aguardando_instalacao',
    ]);
    expect(b.map(x => x.tom)).toEqual(['passada', 'passada', 'atual', 'futura', 'futura', 'futura', 'futura']);
    expect(ORDEM_PADRAO).not.toContain('completed');
  });

  it('alturas e traço na escala do maior valor com folga de 15%', () => {
    const [pending, analysis, documentation, approval] = barrasDoHistorico(comum);
    expect(analysis).toMatchObject({ dias: 10, normal: 8, alturaPct: 87, normalPct: 69.6, cortePct: null, rotulo: 'Em Análise' });
    expect(pending).toMatchObject({ dias: 3, normal: 2, alturaPct: 26.1, normalPct: 17.4 });
    expect(documentation).toMatchObject({ dias: 4, normal: 5, alturaPct: 36.5, normalPct: 43.5, tom: 'atual' });
    expect(approval).toMatchObject({ dias: null, normal: null, alturaPct: 0, normalPct: null, cortePct: null });
  });

  it('a atual além do normal fica em alerta, com o corte no traço', () => {
    const doc = barrasDoHistorico({ ...comum, diasNaEtapa: 9.6 }).find(x => x.etapa === 'documentation')!;
    expect(doc).toMatchObject({ tom: 'alem', dias: 9, alturaPct: 83.5, cortePct: 52.1 });
  });

  it('estadas repetidas somam; desvio aparece só se visitado; a atual conta só a estada de agora', () => {
    const b = barrasDoHistorico(entrada({
      historico: [
        { etapa: 'analysis', dias: 3, atual: false },
        { etapa: 'pendencia', dias: 6, atual: false },
        { etapa: 'analysis', dias: 4, atual: false },
        { etapa: 'documentation', dias: 1, atual: false },
        { etapa: 'documentation', dias: 2, atual: true },
      ],
      status: 'documentation', diasNaEtapa: 2,
    }));
    expect(b.map(x => x.etapa)).toEqual([
      'analysis', 'documentation', 'approval', 'approved', 'pendencia', 'vistoria_solicitada', 'aguardando_instalacao',
    ]);
    expect(b.find(x => x.etapa === 'analysis')!.dias).toBe(7);
    expect(b.find(x => x.etapa === 'documentation')!.dias).toBe(2);
    expect(b.find(x => x.etapa === 'pendencia')!.tom).toBe('passada');
  });

  it('a atual num desvio: o caminho continua depois da última etapa do caminho principal', () => {
    const b = barrasDoHistorico(entrada({
      historico: [{ etapa: 'analysis', dias: 5, atual: false }, { etapa: 'pendencia', dias: 2, atual: true }],
      status: 'pendencia', diasNaEtapa: 2.3,
    }));
    expect(b.map(x => x.etapa)).toEqual([
      'analysis', 'documentation', 'approval', 'approved', 'pendencia', 'vistoria_solicitada', 'aguardando_instalacao',
    ]);
    expect(b.find(x => x.etapa === 'pendencia')).toMatchObject({ tom: 'atual', normal: null, normalPct: null });
  });

  it('segue a ordem do Kanban do tenant; etapa fora dela vai para o fim', () => {
    const b = barrasDoHistorico(entrada({
      historico: [{ etapa: 'analysis', dias: 2, atual: false }, { etapa: 'etapa_nova', dias: 3, atual: true }],
      status: 'etapa_nova', diasNaEtapa: 3, ordem: ['pending', 'analysis', 'documentation', 'completed'],
    }));
    expect(b.map(x => x.etapa)).toEqual(['analysis', 'documentation', 'etapa_nova']);
    expect(b[2]).toMatchObject({ tom: 'atual', rotulo: 'Etapa Nova' });
  });

  it('sem normal não há traço nem alerta', () => {
    const [b] = barrasDoHistorico(entrada({ status: 'analysis', diasNaEtapa: 50, normais: new Map(), ordem: ['analysis'] }));
    expect(b).toMatchObject({ tom: 'atual', dias: 50, normal: null, normalPct: null, cortePct: null });
  });

  it('a descrição para o leitor de tela', () => {
    const texto = descricaoDasBarras(barrasDoHistorico({ ...comum, diasNaEtapa: 9.6 }));
    expect(texto.startsWith('Projetos Recebidos: 3 dias, normal até 2. Em Análise: 10 dias, normal até 8. ')).toBe(true);
    expect(texto).toContain('Documentação: 9 dias, etapa atual, normal até 5, além do normal.');
    expect(texto).toContain('Aguardando Aprovação: ainda não.');
  });
});
