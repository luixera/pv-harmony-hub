import type { GeoJsonLayer } from '@deck.gl/layers';
import { CORES } from './estilos';
import { nomeIcone, type Atlas } from './atlas';
import type { Camada, Colecao, Feicao, PropsAlimentador, PropsCelula, PropsPonto, PropsSubestacao, RespostaMapa, Risco, Selecao } from './tipos';

/**
 * Monta as camadas do deck.gl a partir da resposta da RPC. Recebe as CLASSES
 * do deck por parâmetro (`Fabricas`) para a função ser pura e testável sem
 * WebGL: o teste passa fábricas falsas e confere ids, ordem e props.
 *
 * Por que WebGL: a `google.maps.Data` desenha em SVG, um `<path>` por parte,
 * e os alimentadores de MT chegam em dezenas de milhares de partes (árvore,
 * LineMerge não une em nó de grau 3). Medido em 15/10/2026: 40–120 mil
 * elementos SVG movidos por arrasto. O deck desenha isso num quadro.
 */
export interface Fabricas { GeoJsonLayer: typeof GeoJsonLayer }
/** O acessor do deck recebe `Feature<Geometry, P>`; só as propriedades interessam aqui. */
type ComProps<P> = { properties: P };

export type Alvo =
  | { tipo: 'trafo'; f: Feicao<PropsPonto> } | { tipo: 'celula'; f: Feicao<PropsCelula> }
  | { tipo: 'alimentador'; f: Feicao<PropsAlimentador> } | { tipo: 'subestacao'; f: Feicao<PropsSubestacao> };

export interface Opcoes {
  satelite: boolean; zoom: number; camadas: readonly Camada[]; selecao: Selecao; atlas: Atlas;
  aoPassar: (a: Alvo | null) => void; aoClicar: (a: Alvo) => void;
}

export type Cor = [number, number, number, number];
export function rgba(hex: string, alfa = 1): Cor {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, Math.round(alfa * 255)];
}
const CONTORNO_ESCURO = '#07070B';

/** Traço por estado além da cor: risco grosso e contínuo, folga fino e tênue (igual à v2). */
export function larguraLinha(risco: Risco, zoom: number, satelite: boolean, destaque = false): number {
  const base = zoom < 11 ? 1.5 : zoom < 14 ? 2.5 : 3.5;
  const fator = { risco: 1.3, atencao: 1.0, folga: 0.7, sem_dado: 0.6 }[risco] ?? 0.6;
  return base * fator + (satelite ? 0.5 : 0) + (destaque ? 2.5 : 0);
}
const OPACIDADE_LINHA: Record<Risco, number> = { risco: 0.95, atencao: 0.9, folga: 0.7, sem_dado: 0.65 };
const corDe = (risco: Risco | undefined) => CORES[risco ?? 'sem_dado'] ?? CORES.sem_dado;

/** Sobre imagem, 0,3 de cor saturada vira barro: miolo mais fraco, borda forte. */
function preenchimentoCelula(p: PropsCelula, satelite: boolean): Cor {
  const cor = p.risco === 'sem_dado' && !satelite ? '#3A3A48' : corDe(p.risco);
  return rgba(cor, satelite ? 0.22 : (p.nivel >= 3 ? 0.26 : 0.3));
}

type Info = { object?: unknown; index: number };
const feicao = <P,>(info: Info) => (info.object ?? null) as Feicao<P> | null;
const so = <P,>(c: Colecao<P>, id: number): Colecao<P> =>
  ({ type: 'FeatureCollection', features: c.features.filter(f => f.id === id || f.properties?.['id' as keyof P] === id) });

export function montarCamadas(fab: Fabricas, r: RespostaMapa | undefined, o: Opcoes): unknown[] {
  if (!r) return [];
  const { GeoJsonLayer: Geo } = fab;
  const camadas: unknown[] = [];
  const liga = (c: Camada) => o.camadas.includes(c);
  const passar = (tipo: Alvo['tipo']) => (info: Info) => {
    const f = feicao<never>(info);
    o.aoPassar(f ? ({ tipo, f } as Alvo) : null);
  };
  const clicar = (tipo: Alvo['tipo']) => (info: Info) => {
    const f = feicao<never>(info);
    if (f) o.aoClicar({ tipo, f } as Alvo);
  };

  if (liga('pontos') && r.celulas) {
    camadas.push(new Geo<PropsCelula>({
      id: 'celulas', data: r.celulas as never, pickable: true, filled: true, stroked: true,
      getFillColor: (f: ComProps<PropsCelula>) => preenchimentoCelula(f.properties, o.satelite),
      getLineColor: (f: ComProps<PropsCelula>) => rgba(corDe(f.properties.risco), o.satelite ? 1 : 0.6),
      getLineWidth: o.satelite ? 2 : 1, lineWidthUnits: 'pixels', lineWidthMinPixels: 1,
      onHover: passar('celula'), onClick: clicar('celula'),
      updateTriggers: { getFillColor: [o.satelite], getLineColor: [o.satelite] },
    }));
  }

  if (liga('alimentadores') && r.alimentadores) {
    const dados = r.alimentadores as never;
    if (o.satelite) {
      // contorno escuro por baixo das linhas: só sobre imagem, onde a cor sozinha some
      camadas.push(new Geo<PropsAlimentador>({
        id: 'alimentadores-contorno', data: dados, pickable: false, filled: false, stroked: true,
        getLineColor: rgba(CONTORNO_ESCURO, 0.85),
        getLineWidth: (f: ComProps<PropsAlimentador>) => larguraLinha(f.properties.risco, o.zoom, true) * 1.3 + 3,
        lineWidthUnits: 'pixels', lineCapRounded: true, lineJointRounded: true,
        updateTriggers: { getLineWidth: [o.zoom] }
      }));
    }
    camadas.push(new Geo<PropsAlimentador>({
      id: 'alimentadores', data: dados, pickable: true, filled: false, stroked: true,
      getLineColor: (f: ComProps<PropsAlimentador>) => rgba(corDe(f.properties.risco), OPACIDADE_LINHA[f.properties.risco] ?? 0.65),
      getLineWidth: (f: ComProps<PropsAlimentador>) => larguraLinha(f.properties.risco, o.zoom, o.satelite),
      lineWidthUnits: 'pixels', lineWidthMinPixels: 1, lineCapRounded: true, lineJointRounded: true,
      onHover: passar('alimentador'), onClick: clicar('alimentador'),
      updateTriggers: { getLineWidth: [o.zoom, o.satelite] }
    }));
    if (o.selecao?.tipo === 'alimentador') {
      const um = so(r.alimentadores, o.selecao.id);
      if (um.features.length) {
        camadas.push(new Geo<PropsAlimentador>({
          id: 'selecao-alimentador', data: um as never, pickable: false, filled: false, stroked: true,
          getLineColor: (f: ComProps<PropsAlimentador>) => rgba(corDe(f.properties.risco), 1),
          getLineWidth: (f: ComProps<PropsAlimentador>) => larguraLinha(f.properties.risco, o.zoom, o.satelite, true),
          lineWidthUnits: 'pixels', lineCapRounded: true, lineJointRounded: true
        }));
      }
    }
  }

  const icone = (destaque: boolean) => ({
    pointType: 'icon', iconAtlas: o.atlas.url, iconMapping: o.atlas.mapeamento,
    iconSizeUnits: 'pixels' as const, iconSizeMinPixels: 10, iconAlphaCutoff: 0.05, iconBillboard: true,
    getIconSize: (o.satelite ? 22 : 18) * (destaque ? 1.5 : 1),
  });

  if (liga('subestacoes') && r.subestacoes) {
    camadas.push(new Geo<PropsSubestacao>({
      id: 'subestacoes', data: r.subestacoes as never, pickable: true, ...icone(false),
      getIcon: () => nomeIcone('subestacao', o.satelite),
      getIconSize: o.satelite ? 24 : 20,
      onHover: passar('subestacao'), onClick: clicar('subestacao'),
      updateTriggers: { getIcon: [o.satelite] }
    }));
  }

  if (liga('pontos') && r.pontos) {
    camadas.push(new Geo<PropsPonto>({
      id: 'pontos', data: r.pontos as never, pickable: true, ...icone(false),
      getIcon: (f: ComProps<PropsPonto>) => nomeIcone(f.properties.risco, o.satelite),
      onHover: passar('trafo'), onClick: clicar('trafo'),
      updateTriggers: { getIcon: [o.satelite] }
    }));
    if (o.selecao?.tipo === 'trafo') {
      const um = so(r.pontos, o.selecao.id);
      if (um.features.length) {
        camadas.push(new Geo<PropsPonto>({
          id: 'selecao-ponto', data: um as never, pickable: false, ...icone(true),
          getIcon: (f: ComProps<PropsPonto>) => nomeIcone(f.properties.risco, o.satelite, true),
         
        }));
      }
    }
  }
  return camadas;
}
