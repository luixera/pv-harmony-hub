import { describe, it, expect } from 'vitest';
import { rgba, montarCamadas, larguraLinha, type Fabricas } from './camadas';
import type { RespostaMapa } from './tipos';

// Fábricas falsas: guardam as props em vez de criar layers do deck.gl.
type Capturada = { tipo: string; props: Record<string, unknown> };
const fabricas = (): Fabricas & { criadas: Capturada[] } => {
  const criadas: Capturada[] = [];
  const faz = (tipo: string) => function (this: unknown, props: Record<string, unknown>) { criadas.push({ tipo, props }); return { id: props.id }; };
  return { GeoJsonLayer: faz('geojson') as never, criadas };
};

const resposta = (parcial: Partial<RespostaMapa>): RespostaMapa => ({
  base: {}, regras: { fator: 0.8, atencao: 60, risco: 100 }, zoom: 13, camada: 'celula', nivel: 3,
  contagem: 4001, teto_pontos: 4000, resumo: { total: 10, risco: 1, atencao: 2, folga: 7, sem_dado: 0 },
  pontos: null, celulas: null, alimentadores: null, subestacoes: null, ...parcial,
});
const colecao = (n: number) => ({ type: 'FeatureCollection' as const,
  features: Array.from({ length: n }, (_, i) => ({ type: 'Feature' as const, id: i + 1, geometry: {}, properties: { id: i + 1, risco: 'folga' } })) });
const opcoes = { satelite: false, zoom: 13, camadas: ['pontos', 'alimentadores', 'subestacoes'] as const, selecao: null, atlas: { url: 'data:,', mapeamento: {} }, aoPassar: () => {}, aoClicar: () => {} };

describe('camadas WebGL', () => {
  it('rgba converte o hexa do semáforo para 0–255 com alfa', () => {
    expect(rgba('#F0523F', 0.5)).toEqual([240, 82, 63, 128]);
    expect(rgba('#1F7A3D')).toEqual([31, 122, 61, 255]);
  });
  it('a largura da linha cresce com o zoom e com o risco', () => {
    expect(larguraLinha('risco', 14, false)).toBeGreaterThan(larguraLinha('folga', 14, false));
    expect(larguraLinha('risco', 16, false)).toBeGreaterThan(larguraLinha('risco', 11, false));
  });
  it('só cria as camadas que têm dado e estão ligadas', () => {
    const f = fabricas();
    const r = resposta({ celulas: colecao(3) as never });
    const ls = montarCamadas(f, r, { ...opcoes, camadas: ['pontos'] });
    expect(ls.map(l => (l as { id: string }).id)).toEqual(['celulas']);
  });
  it('pontos viram ícones do atlas; no satélite as linhas ganham contorno por baixo', () => {
    const f = fabricas();
    const r = resposta({ camada: 'ponto', nivel: null, pontos: colecao(2) as never, alimentadores: colecao(1) as never });
    const ids = montarCamadas(f, r, { ...opcoes, satelite: true }).map(l => (l as { id: string }).id);
    expect(ids).toEqual(['alimentadores-contorno', 'alimentadores', 'pontos']);
    const pontos = f.criadas.find(c => c.props.id === 'pontos')!;
    expect(pontos.props.pointType).toBe('icon');
    expect(pontos.props.pickable).toBe(true);
  });
  it('a seleção vira uma camada própria por cima, com o único trafo escolhido', () => {
    const f = fabricas();
    const r = resposta({ camada: 'ponto', nivel: null, pontos: colecao(3) as never });
    const ids = montarCamadas(f, r, { ...opcoes, selecao: { tipo: 'trafo', id: 2 } }).map(l => (l as { id: string }).id);
    expect(ids).toEqual(['pontos', 'selecao-ponto']);
    const sel = f.criadas.find(c => c.props.id === 'selecao-ponto')!;
    expect((sel.props.data as { features: unknown[] }).features).toHaveLength(1);
  });
});
