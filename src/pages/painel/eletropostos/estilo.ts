import type { CSSProperties } from 'react';
import { GOLD } from '../ConsoleSections';

/** Peças de estilo da seção, no visual do console (fundo #0E0E14, cartões #16161F, dourado). */
export const input: CSSProperties = {
  background: '#0E0E14', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8,
  padding: '7px 10px', color: '#fff', fontSize: 13, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
};
export const botao: CSSProperties = {
  padding: '7px 13px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)', background: '#16161F',
  color: '#ddd', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
};
export const botaoOuro: CSSProperties = { ...botao, background: GOLD, borderColor: GOLD, color: '#1A1A1A' };
export const mudo: CSSProperties = { color: '#777' };
export const rotulo: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: '#999' };
export const th: CSSProperties = {
  textAlign: 'left', fontSize: 11, color: '#888', fontWeight: 600, padding: '6px 10px',
  borderBottom: '1px solid #222', whiteSpace: 'nowrap', position: 'sticky', top: 0, background: '#16161F',
};
export const td: CSSProperties = { fontSize: 12.5, color: '#ddd', padding: '8px 10px', borderBottom: '1px solid #1a1a22', whiteSpace: 'nowrap' };
export const manchete: CSSProperties = { fontSize: 20, lineHeight: 1.3, fontWeight: 500, color: '#eee', maxWidth: '62ch', margin: '0 0 6px' };
export const sub: CSSProperties = { color: '#999', margin: '0 0 18px', maxWidth: '75ch', fontSize: 13 };
export const h3: CSSProperties = { fontSize: 14, fontWeight: 700, color: '#fff', margin: '0 0 10px' };
export const vazio: CSSProperties = {
  padding: 28, textAlign: 'center', color: '#999', background: '#16161F',
  border: '1px dashed rgba(255,255,255,0.12)', borderRadius: 12, fontSize: 13,
};
