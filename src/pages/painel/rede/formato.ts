const fmt = (casas: number) =>
  new Intl.NumberFormat('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });

export const kw  = (v: number | null | undefined) => v == null ? '—' : `${fmt(Math.abs(v) >= 100 ? 0 : 1).format(v)} kW`;
export const kva = (v: number | null | undefined) => v == null ? '—' : `${fmt(0).format(v)} kVA`;
export const pct = (v: number | null | undefined) => v == null ? 'sem dado' : `${fmt(0).format(v)}%`;
export const inteiro = (n: number) => fmt(0).format(n);

export function mesesDesde(iso: string, agora = Date.now()): number {
  const meses = (agora - new Date(iso).getTime()) / (1000 * 60 * 60 * 24 * 30.4);
  return Math.max(0, Math.round(meses));
}

export function rotuloIdade(meses: number): string {
  if (meses <= 0) return 'deste mês';
  if (meses === 1) return '1 mês atrás';
  if (meses < 24) return `${meses} meses atrás`;
  return `${Math.floor(meses / 12)} anos atrás`;
}

export const percentualDe = (parte: number, total: number) =>
  total > 0 ? Math.round((parte / total) * 100) : 0;
