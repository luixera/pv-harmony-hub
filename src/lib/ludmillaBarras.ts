import { alemDoNormal, diasInteiros, type NormalDaEtapa, type PassagemDoHistorico } from '@/lib/ludmillaCarteira';
import { VALID_PROJECT_STATUSES } from '@/lib/statusMapping';

/**
 * O HISTÓRICO EM BARRAS — função pura, sem React (spec §3, "o traço marcante", e §6.3).
 *
 * Como o consumo dos últimos meses na conta de luz: uma barra por etapa com os dias que o projeto
 * passou nela, um traço no normal daquela concessionária, a etapa atual em sol e, além do normal,
 * em alerta. As barras seguem as colunas do Kanban pelas quais o projeto passou ou ainda vai
 * passar (decisão 8 do plano).
 */

/** Etapas fora do caminho principal: só viram barra quando o projeto passou por elas. */
export const DESVIOS: readonly string[] = ['pendencia', 'vistoria_sem_protocolo', 'vistoria_reprovada'];
/** A ordem quando o Kanban do tenant ainda não carregou. `completed` nunca vira barra. */
export const ORDEM_PADRAO: readonly string[] = VALID_PROJECT_STATUSES.filter(s => s !== 'completed');
/** Folga em cima da barra mais alta: o número dela cabe no gráfico. */
export const FOLGA_DO_GRAFICO = 1.15;

export type TomDaBarra = 'passada' | 'atual' | 'alem' | 'futura';

export interface Barra {
  etapa: string;
  rotulo: string;
  /** dias inteiros; null = ainda não passou por ela */
  dias: number | null;
  /** o normal desta etapa nesta concessionária; null = sem traço */
  normal: number | null;
  tom: TomDaBarra;
  /** altura da barra, em % da altura do gráfico */
  alturaPct: number;
  /** onde fica o traço do normal, em % da altura do gráfico */
  normalPct: number | null;
  /** na barra em alerta: até onde (% da própria barra) ela é sol; acima disso, alerta */
  cortePct: number | null;
}

export interface EntradaDasBarras {
  historico: PassagemDoHistorico[];
  status: string;
  /** a estada de agora, de `ludmilla_carteira().dias_na_etapa` (o mesmo número do texto e do alerta) */
  diasNaEtapa: number;
  /** as colunas do Kanban do tenant, em ordem; vazio = ORDEM_PADRAO */
  ordem: readonly string[];
  /** os normais da concessionária do projeto (`normaisDaConcessionaria`) */
  normais: Map<string, NormalDaEtapa>;
  rotuloEtapa: (s: string) => string;
}

const umDecimal = (x: number) => Math.round(x * 10) / 10;

export function barrasDoHistorico(e: EntradaDasBarras): Barra[] {
  const ordem = (e.ordem.length > 0 ? e.ordem : ORDEM_PADRAO).filter(s => s !== 'completed');
  const ehDesvio = (s: string) => DESVIOS.includes(s);

  // estadas fechadas somadas por etapa; a etapa ATUAL conta só a estada de agora
  const dias = new Map<string, number>();
  for (const p of e.historico) {
    if (p.etapa === 'completed' || p.etapa === e.status) continue;
    dias.set(p.etapa, (dias.get(p.etapa) ?? 0) + Math.max(0, p.dias));
  }
  if (e.status && e.status !== 'completed') dias.set(e.status, Math.max(0, e.diasNaEtapa));

  const posicao = (s: string) => ordem.indexOf(s);
  const visitadas = [...dias.keys()];
  const ultimaDoCaminho = Math.max(-1, ...visitadas.filter(s => !ehDesvio(s)).map(posicao));
  const etapas = [
    ...ordem.filter(s => dias.has(s) || (!ehDesvio(s) && posicao(s) > ultimaDoCaminho)),
    ...visitadas.filter(s => posicao(s) < 0),
  ];

  const normalDe = (s: string) => e.normais.get(s)?.normalDias ?? null;
  const maior = Math.max(1, ...etapas.flatMap(s => (dias.has(s) ? [dias.get(s)!, normalDe(s) ?? 0] : [])));
  const escala = maior * FOLGA_DO_GRAFICO;

  return etapas.map((s): Barra => {
    const d = dias.has(s) ? dias.get(s)! : null;
    const normal = d === null ? null : normalDe(s);
    const atual = s === e.status;
    const alem = atual && d !== null && alemDoNormal(d, normal);
    return {
      etapa: s,
      rotulo: e.rotuloEtapa(s),
      dias: d === null ? null : diasInteiros(d),
      normal,
      tom: d === null ? 'futura' : alem ? 'alem' : atual ? 'atual' : 'passada',
      alturaPct: d === null ? 0 : umDecimal((d / escala) * 100),
      normalPct: normal === null ? null : umDecimal((normal / escala) * 100),
      cortePct: alem && normal !== null && d !== null && d > 0 ? umDecimal((normal / d) * 100) : null,
    };
  });
}

/** O gráfico em palavras, para o leitor de tela (o desenho fica `aria-hidden`). */
export function descricaoDasBarras(barras: Barra[]): string {
  if (barras.length === 0) return 'Sem histórico de etapas.';
  return `${barras.map(b => {
    if (b.dias === null) return `${b.rotulo}: ainda não`;
    const agora = b.tom === 'atual' || b.tom === 'alem' ? ', etapa atual' : '';
    const normal = b.normal === null ? '' : `, normal até ${b.normal}`;
    const alem = b.tom === 'alem' ? ', além do normal' : '';
    return `${b.rotulo}: ${b.dias === 1 ? '1 dia' : `${b.dias} dias`}${agora}${normal}${alem}`;
  }).join('. ')}.`;
}
