import type { Filtro, Local, Ordem, Resumo } from './tipos';

/**
 * Lógica pura da tela de eletropostos — porta do JS do painel local
 * (web/index.html). Nada de React nem de Supabase aqui, para ser testável.
 */

export const fmt = (v: number | null | undefined, d = 1): string =>
  v == null || Number.isNaN(v) ? '—' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });

export const pct = (v: number | null | undefined): string => (v == null ? '—' : fmt(v * 100, 1) + '%');

export const brl = (v: number | null | undefined): string =>
  v == null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

/** R$ em milhares, uma casa. */
export const mil = (v: number): string => fmt(v / 1000, 1);

/** Faixa "min–max"; colapsa num valor só quando os dois arredondam igual. */
export const faixa = (a: number | null | undefined, b: number | null | undefined, f: (v: number) => string): string =>
  a == null || b == null ? '—' : Math.round(a) === Math.round(b) ? f(a) : `${f(a)}–${f(b)}`;

/** Média das 7 linhas do perfil (dia da semana × hora) → 24 valores, null onde nenhum dia tem leitura. */
export function perfilMedio(perfil: (number | null)[][] | null | undefined): (number | null)[] {
  return Array.from({ length: 24 }, (_, h) => {
    const vs = (perfil ?? []).map(l => l?.[h] ?? null).filter((v): v is number => v != null);
    return vs.length ? vs.reduce((s, v) => s + v, 0) / vs.length : null;
  });
}

/** "agora", "há 12 min", "há 3 h", "há 2 d" ou "nunca". */
export function relativo(iso: string | null | undefined, agora = Date.now()): string {
  if (!iso) return 'nunca';
  const m = Math.round((agora - new Date(iso).getTime()) / 60_000);
  if (m < 1) return 'agora';
  if (m < 60) return `há ${m} min`;
  if (m < 1440) return `há ${Math.round(m / 60)} h`;
  return `há ${Math.round(m / 1440)} d`;
}

/** Fonte sem leitura há mais de 15 min (3 janelas) está atrasada. */
export const atrasada = (iso: string | null | undefined, agora = Date.now()): boolean =>
  !iso || agora - new Date(iso).getTime() > 15 * 60_000;

/** Data civil de Brasília (UTC-3 fixo, como o Python fazia) em YYYY-MM-DD. */
export const hojeBrasilia = (agora = Date.now()): string => new Date(agora - 3 * 3600e3).toISOString().slice(0, 10);

export const menosDias = (dia: string, n: number): string =>
  new Date(new Date(dia + 'T12:00Z').getTime() - n * 864e5).toISOString().slice(0, 10);

const valorDe = (l: Local, col: Ordem['col']): number | string | null => {
  if (col === 'agora') return l.agora.ocupado ?? 0;
  const v = l[col];
  return v == null ? null : (v as number | string);
};

/** Ordena com null sempre no fim, qualquer que seja a direção. */
export function ordenar(locais: Local[], ordem: Ordem): Local[] {
  return [...locais].sort((a, b) => {
    const x = valorDe(a, ordem.col), y = valorDe(b, ordem.col);
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    const c = typeof x === 'string' && typeof y === 'string' ? x.localeCompare(y, 'pt-BR') : x > y ? 1 : x < y ? -1 : 0;
    return c * ordem.dir;
  });
}

export function filtrar(locais: Local[], f: Filtro): Local[] {
  const q = f.q.trim().toLowerCase();
  return locais.filter(l =>
    (!q || `${l.nome} ${l.endereco ?? ''}`.toLowerCase().includes(q))
    && (!f.cidade || l.cidade === f.cidade)
    && (!f.operadora || l.operadora === f.operadora)
    && (!f.tipo || l.tipo === f.tipo)
    && (f.mon === '' || String(Number(l.monitorado)) === f.mon));
}

export const opcoes = (locais: Local[], campo: 'cidade' | 'operadora'): string[] =>
  [...new Set(locais.map(l => l[campo]).filter((v): v is string => !!v))].sort((a, b) => a.localeCompare(b, 'pt-BR'));

const COLUNAS_CSV: (keyof Local)[] = [
  'id', 'nome', 'operadora', 'cidade', 'endereco', 'tipo', 'potencia_kw', 'conectores', 'conectores_monitorados',
  'preco_efetivo', 'custo_efetivo', 'horas_ocupado', 'horas_ocupado_dia', 'ocupacao', 'cobertura', 'sessoes',
  'kwh_min', 'kwh_max', 'receita_min', 'receita_max', 'margem_min', 'margem_max', 'fonte_status',
];

const celula = (v: unknown): string => {
  if (v == null) return '';
  if (typeof v === 'number') return String(Math.round(v * 10000) / 10000);
  if (typeof v === 'boolean') return v ? '1' : '0';
  const s = String(v);
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Mesmas colunas do `exportar_csv` do servidor local; separador ponto e vírgula. */
export function csvDoResumo(r: Resumo): string {
  const linhas = [
    `periodo;${r.periodo.de};${r.periodo.ate}`,
    COLUNAS_CSV.join(';'),
    ...r.locais.map(l => COLUNAS_CSV.map(c => celula(l[c])).join(';')),
  ];
  return linhas.join('\n');
}
