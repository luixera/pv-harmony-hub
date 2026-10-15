import { CORES, COR_SUBESTACAO } from './estilos';
import type { Risco } from './tipos';

/**
 * Atlas de ícones para o deck.gl: as MESMAS formas da legenda (círculo, anel,
 * triângulo, quadrado, losango), desenhadas uma vez num canvas e lidas pela
 * GPU. Um ícone por (estado, fundo liso/satélite, destaque) — 20 no total.
 * `mapeamentoAtlas()` é puro e testado; `desenharAtlas()` precisa de canvas.
 */
export const TAM_ICONE = 64;                      // px no atlas (desenho 2x, exibido em ~16–24 px)
export type Estado = Risco | 'subestacao';
const ESTADOS: Estado[] = ['folga', 'atencao', 'risco', 'sem_dado', 'subestacao'];
const CONTORNO_ESCURO = '#07070B';
const MIOLO_ESCURO = '#0E0E14';

export const nomeIcone = (estado: Estado, satelite: boolean, destaque = false) =>
  `${estado}-${satelite ? 'sat' : 'liso'}${destaque ? '-destaque' : ''}`;

export interface IconeNoAtlas { x: number; y: number; width: number; height: number; mask: boolean }
export type Mapeamento = Record<string, IconeNoAtlas>;

export function mapeamentoAtlas(): Mapeamento {
  const m: Mapeamento = {};
  let i = 0;
  for (const e of ESTADOS) for (const sat of [false, true]) for (const d of [false, true]) {
    m[nomeIcone(e, sat, d)] = { x: i * TAM_ICONE, y: 0, width: TAM_ICONE, height: TAM_ICONE, mask: false };
    i += 1;
  }
  return m;
}

function desenharIcone(ctx: CanvasRenderingContext2D, estado: Estado, satelite: boolean, destaque: boolean) {
  const c = TAM_ICONE / 2;
  const r = (satelite ? 13 : 11) * (destaque ? 1.3 : 1);
  const contorno = satelite ? CONTORNO_ESCURO : 'rgba(255,255,255,0.55)';
  const traco = (satelite ? 4 : 3) + (destaque ? 3 : 0);
  ctx.lineJoin = 'round';
  if (estado === 'subestacao') {
    ctx.beginPath(); ctx.moveTo(c, c - r - 3); ctx.lineTo(c + r + 3, c); ctx.lineTo(c, c + r + 3); ctx.lineTo(c - r - 3, c); ctx.closePath();
    ctx.fillStyle = COR_SUBESTACAO; ctx.fill();
    ctx.lineWidth = traco; ctx.strokeStyle = satelite ? CONTORNO_ESCURO : MIOLO_ESCURO; ctx.stroke();
    return;
  }
  const cor = CORES[estado];
  if (estado === 'risco') {
    ctx.beginPath(); ctx.moveTo(c, c - r - 3); ctx.lineTo(c + r + 2, c + r); ctx.lineTo(c - r - 2, c + r); ctx.closePath();
    ctx.fillStyle = cor; ctx.fill();
    ctx.lineWidth = traco; ctx.strokeStyle = satelite ? CONTORNO_ESCURO : MIOLO_ESCURO; ctx.stroke();
  } else if (estado === 'atencao') {
    // anel: vazado no mapa liso, miolo escuro opaco sobre imagem
    ctx.beginPath(); ctx.arc(c, c, r, 0, Math.PI * 2);
    if (satelite) { ctx.fillStyle = MIOLO_ESCURO; ctx.fill(); }
    ctx.lineWidth = 7 + (destaque ? 3 : 0); ctx.strokeStyle = cor; ctx.stroke();
    if (satelite) { ctx.lineWidth = 2; ctx.strokeStyle = CONTORNO_ESCURO; ctx.beginPath(); ctx.arc(c, c, r + 4.5, 0, Math.PI * 2); ctx.stroke(); }
  } else if (estado === 'sem_dado') {
    // quadrado, não anel fino: espessura não se lê sobre imagem
    ctx.beginPath(); ctx.rect(c - r, c - r, 2 * r, 2 * r);
    ctx.fillStyle = satelite ? cor : MIOLO_ESCURO; ctx.globalAlpha = satelite ? 0.9 : 0.35; ctx.fill(); ctx.globalAlpha = 1;
    ctx.lineWidth = traco; ctx.strokeStyle = satelite ? CONTORNO_ESCURO : cor; ctx.stroke();
  } else {
    ctx.beginPath(); ctx.arc(c, c, r, 0, Math.PI * 2);
    ctx.fillStyle = cor; ctx.fill();
    ctx.lineWidth = traco; ctx.strokeStyle = contorno; ctx.stroke();
  }
}

export interface Atlas { url: string; mapeamento: Mapeamento }

/** Desenha os 20 ícones e devolve o PNG como data URL (o deck.gl aceita URL). */
export function desenharAtlas(): Atlas {
  const mapeamento = mapeamentoAtlas();
  const canvas = document.createElement('canvas');
  canvas.width = TAM_ICONE * Object.keys(mapeamento).length; canvas.height = TAM_ICONE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { url: '', mapeamento };
  for (const e of ESTADOS) for (const sat of [false, true]) for (const d of [false, true]) {
    const { x } = mapeamento[nomeIcone(e, sat, d)];
    ctx.save(); ctx.translate(x, 0);
    ctx.beginPath(); ctx.rect(0, 0, TAM_ICONE, TAM_ICONE); ctx.clip();
    desenharIcone(ctx, e, sat, d);
    ctx.restore();
  }
  return { url: canvas.toDataURL('image/png'), mapeamento };
}
