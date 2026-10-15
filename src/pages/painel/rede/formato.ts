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

export function bytesLegiveis(n: number | null | undefined): string {
  if (n == null) return '—';
  if (n < 1024 ** 2) return `${fmt(0).format(n / 1024)} KB`;
  if (n < 1024 ** 3) return `${fmt(1).format(n / 1024 ** 2)} MB`;
  return `${fmt(2).format(n / 1024 ** 3)} GB`;
}
export const data = (iso: string | null | undefined) => iso ? new Date(iso).toLocaleDateString('pt-BR') : '—';
export const dataHora = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—';
export const hashCurto = (h: string | null | undefined) => h ? `${h.slice(0, 12)}…` : '—';
