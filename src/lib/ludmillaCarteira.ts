/**
 * A CARTEIRA DA LUDMILLA — funções puras, sem React.
 *
 * Spec: docs/superpowers/specs/2026-11-08-ludmilla-repaginacao-design.md §4.3 (a lista), §4.4 (a
 * ficha), §6.3 (tempo e normal) e §6.4 (com quem está). Os dados vêm de `ludmilla_carteira()` e
 * `ludmilla_normais()` (entrega 1): aqui eles viram o formato da tela, e moram as regras de
 * filtro, contagem, ordem, "além do normal", os textos do tempo e o próximo passo.
 */

export type ComQuem = 'nos' | 'concessionaria' | 'cliente';
export type FonteDoNormal = 'medido' | 'geral' | 'coluna';

export interface DonoDoProjeto { id: string; nome: string }
export interface PassagemDoHistorico { etapa: string; dias: number; atual: boolean }

export interface LinhaDaCarteira {
  projectId: string;
  codigo: string;
  titular: string | null;
  empresa: string | null;
  companyId: string | null;
  concessionaria: string | null;
  concessionaireId: string | null;
  status: string;
  naEtapaDesde: string | null;
  diasNaEtapa: number;
  normalDias: number | null;
  normalFonte: FonteDoNormal | null;
  atrasoDias: number | null;
  comQuem: ComQuem;
  donos: DonoDoProjeto[];
  historico: PassagemDoHistorico[];
  naFila: boolean;
}

export interface NormalDaEtapa {
  concessionaireId: string | null;
  etapa: string;
  normalDias: number | null;
  amostra: number;
  fonte: FonteDoNormal | null;
}

type Bruto = Record<string, unknown>;

function numero(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function texto(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}
const COM_QUEM: readonly ComQuem[] = ['nos', 'concessionaria', 'cliente'];
const FONTES: readonly FonteDoNormal[] = ['medido', 'geral', 'coluna'];
const fonteDoNormal = (v: unknown): FonteDoNormal | null => (FONTES.includes(v as FonteDoNormal) ? (v as FonteDoNormal) : null);

/** Uma linha de `ludmilla_carteira()`. O PostgREST manda `numeric` como número; texto também é aceito. */
export function linhaDaRpc(r: Bruto): LinhaDaCarteira {
  const donos = Array.isArray(r.donos) ? r.donos : [];
  const historico = Array.isArray(r.historico) ? r.historico : [];
  return {
    projectId: String(r.project_id ?? ''),
    codigo: texto(r.code) ?? '—',
    titular: texto(r.titular),
    empresa: texto(r.empresa),
    companyId: texto(r.company_id),
    concessionaria: texto(r.concessionaria),
    concessionaireId: texto(r.concessionaire_id),
    status: texto(r.status) ?? '',
    naEtapaDesde: texto(r.na_etapa_desde),
    diasNaEtapa: numero(r.dias_na_etapa) ?? 0,
    normalDias: numero(r.normal_dias),
    normalFonte: fonteDoNormal(r.normal_fonte),
    atrasoDias: numero(r.atraso_dias),
    comQuem: COM_QUEM.includes(r.com_quem as ComQuem) ? (r.com_quem as ComQuem) : 'nos',
    donos: donos.flatMap((d): DonoDoProjeto[] => {
      const o = (d ?? {}) as Bruto;
      const id = texto(o.id);
      return id ? [{ id, nome: texto(o.nome) ?? 'Sem nome' }] : [];
    }),
    historico: historico.flatMap((h): PassagemDoHistorico[] => {
      const o = (h ?? {}) as Bruto;
      const etapa = texto(o.etapa);
      return etapa ? [{ etapa, dias: numero(o.dias) ?? 0, atual: o.atual === true }] : [];
    }),
    naFila: r.na_fila === true,
  };
}

/** Uma linha de `ludmilla_normais()`. */
export function normalDaRpc(r: Bruto): NormalDaEtapa {
  return {
    concessionaireId: texto(r.concessionaire_id),
    etapa: texto(r.etapa) ?? '',
    normalDias: numero(r.normal_dias),
    amostra: numero(r.amostra) ?? 0,
    fonte: fonteDoNormal(r.fonte),
  };
}

/**
 * Os normais de UMA concessionária, por etapa. Projeto sem concessionária casa com a linha sem
 * concessionária (o `IS NOT DISTINCT FROM` de `ludmilla_carteira`).
 */
export function normaisDaConcessionaria(normais: NormalDaEtapa[], concessionaireId: string | null): Map<string, NormalDaEtapa> {
  return new Map(normais.filter(n => n.concessionaireId === concessionaireId).map(n => [n.etapa, n]));
}

/**
 * Os dias que a tela mostra ("14 dias") e o número com que ela decide o alerta: o MESMO. Com o
 * decimal do banco, 7,4 dias contra um normal de 7 sairia "7 dias, o normal é até 7" em alerta.
 */
export function diasInteiros(dias: number): number {
  return Math.max(0, Math.floor(dias));
}

/** Parado além do normal (spec §6.3): dias na etapa maior que o normal. Sem normal, nunca. */
export function alemDoNormal(dias: number, normal: number | null): boolean {
  return normal !== null && diasInteiros(dias) > normal;
}

/** No banco `cliente`; na tela, "Com a empresa" (a empresa cliente — decisão de 09/11/2026). */
export const ROTULO_COM_QUEM: Record<ComQuem, string> = {
  nos: 'Com a gente', concessionaria: 'Com a concessionária', cliente: 'Com a empresa',
};

export type FiltroDaCarteira = 'parados' | ComQuem | 'todos';

export const FILTROS_DA_CARTEIRA: { valor: FiltroDaCarteira; rotulo: string }[] = [
  { valor: 'parados', rotulo: 'Parados além do normal' },
  { valor: 'nos', rotulo: ROTULO_COM_QUEM.nos },
  { valor: 'concessionaria', rotulo: ROTULO_COM_QUEM.concessionaria },
  { valor: 'cliente', rotulo: ROTULO_COM_QUEM.cliente },
  { valor: 'todos', rotulo: 'Todos os projetos' },
];

export function casaFiltroDaCarteira(l: LinhaDaCarteira, f: FiltroDaCarteira): boolean {
  if (f === 'todos') return true;
  if (f === 'parados') return alemDoNormal(l.diasNaEtapa, l.normalDias);
  return l.comQuem === f;
}

/**
 * A ordem da spec §4.3: "mais passado do normal primeiro; depois os sem atraso, pelo tempo".
 * "Além do normal" é a regra da tela (`alemDoNormal`, dias inteiros); entre eles, maior atraso
 * primeiro; todos os outros (sem atraso ou sem normal) pelo tempo na etapa; empate pelo código.
 * A RPC ordena diferente entre os sem atraso; esta função é quem vale (decisão 11 do plano).
 */
export function ordenarCarteira(linhas: LinhaDaCarteira[]): LinhaDaCarteira[] {
  const atrasada = (l: LinhaDaCarteira) => alemDoNormal(l.diasNaEtapa, l.normalDias);
  return [...linhas].sort((a, b) => {
    const xa = atrasada(a);
    const xb = atrasada(b);
    if (xa !== xb) return xa ? -1 : 1;
    if (xa && xb && (a.atrasoDias ?? 0) !== (b.atrasoDias ?? 0)) return (b.atrasoDias ?? 0) - (a.atrasoDias ?? 0);
    return (b.diasNaEtapa - a.diasNaEtapa) || a.codigo.localeCompare(b.codigo, 'pt-BR');
  });
}

export function filtrarCarteira(linhas: LinhaDaCarteira[], f: FiltroDaCarteira): LinhaDaCarteira[] {
  return ordenarCarteira(linhas.filter(l => casaFiltroDaCarteira(l, f)));
}

export function contarCarteira(linhas: LinhaDaCarteira[]): Record<FiltroDaCarteira, number> {
  const n: Record<FiltroDaCarteira, number> = { parados: 0, nos: 0, concessionaria: 0, cliente: 0, todos: 0 };
  for (const l of linhas) for (const f of FILTROS_DA_CARTEIRA) if (casaFiltroDaCarteira(l, f.valor)) n[f.valor]++;
  return n;
}

export function textoDosDias(dias: number): string {
  const n = diasInteiros(dias);
  return n === 1 ? '1 dia' : `${n} dias`;
}

/**
 * "O normal" em palavras. `medido` = mediana da concessionária; `geral` = mediana de todas
 * ("estimado", spec §11); `coluna` = o prazo da coluna do Kanban. `curto` tira o nome da
 * concessionária (o cartão já diz qual é).
 */
export function textoDoNormal(normal: number | null, fonte: FonteDoNormal | null, concessionaria: string | null, curto = false): string {
  if (normal === null) return 'ainda sem normal medido';
  if (fonte === 'geral') return `o normal estimado é até ${normal}`;
  if (fonte === 'coluna') return `o prazo do Kanban é ${normal}`;
  return curto || !concessionaria ? `o normal é até ${normal}` : `o normal na ${concessionaria} é até ${normal}`;
}

/** "em Aprovado"; rótulo que já começa com "Em" vira "em Análise", nunca "em Em Análise". */
export function emEtapa(rotulo: string): string {
  return /^em\s+/i.test(rotulo) ? `em ${rotulo.replace(/^em\s+/i, '')}` : `em ${rotulo}`;
}

export interface TempoDaLinha {
  /** "14 dias" */
  dias: string;
  /** "em Aprovado" */
  em: string;
  /** "o normal é até 7" (cartão, linha da carteira) */
  normalCurto: string;
  /** "o normal na ENEL SP é até 7" (detalhe, ficha) */
  normalLongo: string;
  alerta: boolean;
}

export function tempoDaLinha(l: LinhaDaCarteira, rotuloEtapa: (s: string) => string): TempoDaLinha {
  return {
    dias: textoDosDias(l.diasNaEtapa),
    em: emEtapa(rotuloEtapa(l.status)),
    normalCurto: textoDoNormal(l.normalDias, l.normalFonte, l.concessionaria, true),
    normalLongo: textoDoNormal(l.normalDias, l.normalFonte, l.concessionaria),
    alerta: alemDoNormal(l.diasNaEtapa, l.normalDias),
  };
}

/** De quem é cada projeto (spec §6.2): os projetistas ligados à empresa (`staff_companies`). */
export function donosPorProjetoDe(linhas: LinhaDaCarteira[]): Map<string, DonoDoProjeto[]> {
  return new Map(linhas.map(l => [l.projectId, l.donos]));
}

/** Os projetistas da carteira, um de cada, pelo nome — os botões de "Fila de". */
export function projetistasDaCarteira(linhas: LinhaDaCarteira[]): DonoDoProjeto[] {
  const porId = new Map<string, DonoDoProjeto>();
  for (const l of linhas) for (const d of l.donos) if (!porId.has(d.id)) porId.set(d.id, d);
  return [...porId.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

/** "a, b e c". */
export function juntarComE(partes: string[]): string {
  if (partes.length <= 1) return partes[0] ?? '';
  return `${partes.slice(0, -1).join(', ')} e ${partes[partes.length - 1]}`;
}

/**
 * O próximo passo da ficha (spec §4.4), pela bola (§6.4) e pelo tempo. Só descreve: a ficha não
 * cria tarefa nem manda nada (isso é das entregas 3 e 4).
 */
export function proximoPasso(l: LinhaDaCarteira, rotuloEtapa: (s: string) => string): string {
  const conc = l.concessionaria ?? 'concessionária';
  const naEtapa = emEtapa(rotuloEtapa(l.status));
  const dias = textoDosDias(l.diasNaEtapa);
  const alem = alemDoNormal(l.diasNaEtapa, l.normalDias);
  if (l.naFila) return 'Tem item esperando decisão na fila. Abra o item para decidir.';
  if (l.comQuem === 'concessionaria') {
    return alem && l.normalDias !== null
      ? `Esperar a ${conc}. Passou ${textoDosDias(diasInteiros(l.diasNaEtapa) - l.normalDias)} do normal ${naEtapa}.`
      : `Nada a fazer agora: está com a ${conc}, dentro do normal.`;
  }
  if (l.comQuem === 'cliente') {
    if (l.status === 'pendencia') return `Cobrar a empresa: a ${conc} pediu um ajuste há ${dias}.`;
    if (l.status === 'approved' || l.status === 'aguardando_instalacao') {
      return 'A empresa está instalando. Quando ela pedir a vistoria pelo painel, a bola volta para a gente.';
    }
    return `Está com a empresa há ${dias}.`;
  }
  if (l.status === 'approved') return `A empresa já pediu a vistoria pelo painel: falta pedir a vistoria na ${conc}.`;
  return alem ? `É com a gente, e já são ${dias} ${naEtapa}, além do normal.` : `É com a gente: ${dias} ${naEtapa}.`;
}

/** As concessionárias da carteira sem conta da Ludmilla (spec §4.4: "Ainda não acompanho …"). */
export function naoAcompanhadas(linhas: LinhaDaCarteira[], acompanhadas: (string | null)[]): string[] {
  const ids = new Set(acompanhadas.filter((x): x is string => !!x));
  const nomes = new Set<string>();
  for (const l of linhas) {
    if (l.concessionaireId && l.concessionaria && !ids.has(l.concessionaireId)) nomes.add(l.concessionaria);
  }
  return [...nomes].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

export function fraseDasNaoAcompanhadas(nomes: string[]): string | null {
  return nomes.length === 0 ? null : `Ainda não acompanho ${juntarComE(nomes)}.`;
}
