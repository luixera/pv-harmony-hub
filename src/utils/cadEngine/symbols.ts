import { ComponentKind, Primitive } from './types';

/**
 * Símbolos elétricos (alpha, inspirados em IEC 60617 — inversor com onda
 * senoidal, disjuntor com traço de abertura, medidor circular com "M").
 * Aproximados de propósito: serão recalibrados quando houver diagramas
 * unifilares reais da GD Manager para referência (combinado com o usuário).
 *
 * Convenção local: origem no canto superior-esquerdo do bloco (0,0),
 * Y crescendo para baixo (mesma convenção de SVG/PDF — não é a convenção
 * CAD tradicional Y-up; suficiente enquanto não há exportador DXF).
 * Caixa padrão: 24×20 mm.
 */

const W = 24, H = 20;

export const SYMBOL_BBOX = { w: W, h: H };

export const SYMBOL_DEFS: Record<ComponentKind, Primitive[]> = {
  'pv-array': [
    { kind: 'rect', x: 2, y: 3, w: W - 4, h: H - 6 },
    { kind: 'line', a: { x: 4, y: H - 4 }, b: { x: W - 8, y: 5 } },
    { kind: 'line', a: { x: 8, y: H - 4 }, b: { x: W - 4, y: 5 } },
    { kind: 'line', a: { x: 12, y: H - 4 }, b: { x: W - 2, y: 6 } },
  ],
  inverter: [
    { kind: 'rect', x: 2, y: 2, w: W - 4, h: H - 4 },
    { kind: 'line', a: { x: W / 2, y: 2 }, b: { x: W / 2, y: H - 2 } },
    // lado CC (esquerda): dois traços +/-
    { kind: 'line', a: { x: 5, y: 7 }, b: { x: 9, y: 7 } },
    { kind: 'line', a: { x: 5, y: H - 7 }, b: { x: 9, y: H - 7 } },
    // lado CA (direita): senoide simplificada em polilinha
    {
      kind: 'polyline',
      points: [
        { x: W / 2 + 3, y: H / 2 },
        { x: W / 2 + 5, y: H / 2 - 4 },
        { x: W / 2 + 8, y: H / 2 + 4 },
        { x: W / 2 + 10, y: H / 2 },
      ],
    },
  ],
  breaker: [
    { kind: 'line', a: { x: W / 2, y: 2 }, b: { x: W / 2, y: 7 } },
    { kind: 'line', a: { x: W / 2, y: 7 }, b: { x: W / 2 + 7, y: H - 5 } },
    { kind: 'line', a: { x: W / 2, y: H - 5 }, b: { x: W / 2, y: H - 2 } },
    { kind: 'circle', center: { x: W / 2, y: 7 }, radius: 1 },
    { kind: 'circle', center: { x: W / 2, y: H - 5 }, radius: 1 },
  ],
  meter: [
    { kind: 'circle', center: { x: W / 2, y: H / 2 }, radius: 8 },
    { kind: 'text', at: { x: W / 2, y: H / 2 + 3 }, value: 'M', size: 8, anchor: 'middle', weight: 'bold' },
  ],
  'utility-grid': [
    { kind: 'line', a: { x: 4, y: H / 2 }, b: { x: W - 4, y: H / 2 } },
    { kind: 'line', a: { x: 6, y: H / 2 }, b: { x: 3, y: H / 2 + 5 } },
    { kind: 'line', a: { x: 10, y: H / 2 }, b: { x: 7, y: H / 2 + 5 } },
    { kind: 'line', a: { x: 14, y: H / 2 }, b: { x: 11, y: H / 2 + 5 } },
    { kind: 'line', a: { x: 18, y: H / 2 }, b: { x: 15, y: H / 2 + 5 } },
  ],
};
