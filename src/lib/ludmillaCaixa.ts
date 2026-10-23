/**
 * A CAIXA DE DECISÕES DA LUDMILLA — funções puras, sem React.
 *
 * Spec: docs/superpowers/specs/2026-10-22-ludmilla-pagina-decidir-design.md §3.2.
 * A aba "Decidir" é UMA lista com dois tipos de linha: a RECOMENDAÇÃO
 * (`portal_updates`, a de sempre) e o A FAZER (`portal_afazeres`, o aviso que
 * pede ação de uma pessoa). O que a linha mostra, em que ordem, o que cada
 * filtro deixa passar e para onde o painel vai depois de decidir mora aqui,
 * com teste; a tela só desenha.
 */
import type { PortalAccount, PortalUpdate, ProjetoDoCartao } from '@/hooks/useLudmilla';
import { detalheDoCartaoDeEmail, identidadeDoCartao } from '@/lib/ludmillaCartao';

/** O que o aviso pede (a RPC `ludmilla_email_avisar` deduz do título do sino). */
export type TipoAfazer = 'vistoria_aprovada' | 'troca_falhou' | 'devolucao' | 'aviso';

/** Uma linha de `portal_afazeres`, com o projeto e quem marcou "Feito" (embeds). */
export interface Afazer {
  id: string;
  tenant_id: string;
  account_id: string;
  project_id: string | null;
  mensagem_id: string | null;
  tipo: TipoAfazer;
  titulo: string;
  mensagem: string;
  criado_em: string;
  feito_por: string | null;
  feito_em: string | null;
  project?: ProjetoDoCartao | null;
  feito?: { name: string | null } | null;
}

export type SituacaoDoFiltro = 'pendente' | 'aplicada' | 'ignorada' | 'todas';
export type TipoDoFiltro = 'etapa' | 'protocolo' | 'bloqueado' | 'afazer';
export type MeioDoItem = 'portal' | 'email' | 'estacao';
export type TomDoSelo = 'etapa' | 'protocolo' | 'anexo' | 'bloqueado' | 'afazer' | 'neutro';

export interface Selo { texto: string; tom: TomDoSelo }

export interface ItemDaCaixa {
  /** `u:<id>` para recomendação, `f:<id>` para A fazer — única na lista */
  chave: string;
  origem: 'recomendacao' | 'afazer';
  id: string;
  accountId: string;
  concessionaria: string;
  meio: MeioDoItem;
  /** detectado_em (recomendação) ou criado_em (A fazer) */
  quando: string;
  codigo: string | null;
  projectId: string | null;
  titular: string | null;
  noPortal: string | null;
  empresa: string | null;
  protocolo: string | null;
  situacao: 'pendente' | 'aplicada' | 'ignorada' | 'feito';
  tipos: TipoDoFiltro[];
  selos: Selo[];
  /** já normalizado (sem acento, minúsculo) */
  textoDeBusca: string;
  update: PortalUpdate | null;
  afazer: Afazer | null;
}

export interface FiltroDaCaixa {
  situacao: SituacaoDoFiltro;
  /** vazio = todos; mais de um marcado = qualquer um deles */
  tipos: TipoDoFiltro[];
  /** o chip da faixa de saúde; null = todas as concessionárias */
  contaId: string | null;
  busca: string;
}

export const FILTRO_INICIAL: FiltroDaCaixa = { situacao: 'pendente', tipos: [], contaId: null, busca: '' };

export interface EntradaDaCaixa {
  updates: PortalUpdate[];
  afazeres: Afazer[];
  contas: PortalAccount[];
  nomeDaConta: (accountId: string) => string;
  rotuloEtapa: (status: string | null | undefined) => string;
}

/** Como a concessionária é acompanhada: e-mail, estação local (Elektro) ou portal pela VPS. */
export function meioDaConta(c: Pick<PortalAccount, 'acompanhamento' | 'modo'> | null | undefined): MeioDoItem {
  if (c?.acompanhamento === 'email') return 'email';
  return c?.modo === 'local' ? 'estacao' : 'portal';
}

/** Sem acento, minúsculo, espaços únicos. */
export function normalizar(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

const semZeros = (d: string) => d.replace(/^0+/, '') || '0';

/** Quantos documentos o e-mail levou ao card (`raw.anexos`, gravado como número). */
export function anexosDoCartao(u: PortalUpdate): number {
  const n = Number((u.raw as Record<string, unknown> | null | undefined)?.anexos);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * O cartão diz que o documento NÃO foi anexado (o titular dele é de outra pessoa).
 * A regra NÃO é reescrita aqui: é a de `detalheDoCartaoDeEmail` (ludmillaCartao.ts,
 * rodada da ENEL) — o motivo abre com "não anexei ·", e não "não anexei ainda: …"
 * nem "não anexado(s)". Cartão de portal (CPFL) nunca é bloqueado.
 */
export function cartaoBloqueado(u: PortalUpdate): boolean {
  return detalheDoCartaoDeEmail(u)?.bloqueio === true;
}

const ROTULO_AFAZER: Record<Exclude<TipoAfazer, 'aviso'>, string> = {
  vistoria_aprovada: 'A fazer: pedir a troca do relógio',
  troca_falhou: 'A fazer: troca do relógio não executada',
  devolucao: 'A fazer: conferir o e-mail que voltou',
};

/** O selo do A fazer. Tipo genérico: o título sem o emoji do sino. */
export function rotuloDoAfazer(f: Pick<Afazer, 'tipo' | 'titulo'>): string {
  if (f.tipo !== 'aviso') return ROTULO_AFAZER[f.tipo];
  const t = f.titulo.replace(/^[^\p{L}\p{N}]+/u, '').trim();
  return t ? `A fazer: ${t}` : 'A fazer';
}

function textoDeBusca(partes: (string | null | undefined)[], protocolo: string | null | undefined): string {
  const digitos = (protocolo ?? '').replace(/\D/g, '');
  return normalizar([...partes, digitos ? semZeros(digitos) : null].filter(Boolean).join(' | '));
}

function selosDaRecomendacao(u: PortalUpdate, rotulo: EntradaDaCaixa['rotuloEtapa']): Selo[] {
  const selos: Selo[] = [];
  if (u.recomendacao) {
    const de = u.project ? rotulo(u.project.status) : null;
    selos.push({ texto: de ? `${de} → ${rotulo(u.recomendacao)}` : `→ ${rotulo(u.recomendacao)}`, tom: 'etapa' });
  }
  if (u.atualizar_protocolo) selos.push({ texto: 'Gravar protocolo', tom: 'protocolo' });
  const n = anexosDoCartao(u);
  if (n === 1) selos.push({ texto: 'Documento anexado', tom: 'anexo' });
  if (n > 1) selos.push({ texto: `${n} documentos anexados`, tom: 'anexo' });
  if (cartaoBloqueado(u)) selos.push({ texto: 'Documento bloqueado', tom: 'bloqueado' });
  if (selos.length === 0) selos.push({ texto: 'Sem sugestão', tom: 'neutro' });
  return selos;
}

function tiposDaRecomendacao(u: PortalUpdate): TipoDoFiltro[] {
  const tipos: TipoDoFiltro[] = [];
  if (u.recomendacao) tipos.push('etapa');
  if (u.atualizar_protocolo) tipos.push('protocolo');
  if (cartaoBloqueado(u)) tipos.push('bloqueado');
  return tipos;
}

export function itensDaCaixa(e: EntradaDaCaixa): ItemDaCaixa[] {
  const contaPorId = new Map(e.contas.map(c => [c.id, c]));

  const daRecomendacao = (u: PortalUpdate): ItemDaCaixa => {
    const { titular, noPortal, empresa } = identidadeDoCartao(u);
    const codigo = u.project?.code ?? null;
    return {
      chave: `u:${u.id}`, origem: 'recomendacao', id: u.id, accountId: u.account_id,
      concessionaria: e.nomeDaConta(u.account_id), meio: meioDaConta(contaPorId.get(u.account_id)),
      quando: u.detectado_em, codigo, projectId: u.project?.id ?? u.project_id ?? null,
      titular, noPortal, empresa, protocolo: u.protocolo?.trim() || null,
      situacao: u.situacao, tipos: tiposDaRecomendacao(u), selos: selosDaRecomendacao(u, e.rotuloEtapa),
      textoDeBusca: textoDeBusca([codigo, titular, noPortal, empresa, u.protocolo], u.protocolo),
      update: u, afazer: null,
    };
  };

  const doAfazer = (f: Afazer): ItemDaCaixa => {
    const { titular, empresa } = identidadeDoCartao({ titular_portal: null, project: f.project ?? null });
    const codigo = f.project?.code ?? null;
    return {
      chave: `f:${f.id}`, origem: 'afazer', id: f.id, accountId: f.account_id,
      concessionaria: e.nomeDaConta(f.account_id), meio: meioDaConta(contaPorId.get(f.account_id)),
      quando: f.criado_em, codigo, projectId: f.project?.id ?? f.project_id ?? null,
      titular, noPortal: null, empresa, protocolo: null,
      situacao: f.feito_em ? 'feito' : 'pendente', tipos: ['afazer'],
      selos: [{ texto: rotuloDoAfazer(f), tom: 'afazer' }],
      textoDeBusca: textoDeBusca([codigo, titular, empresa, f.titulo], null),
      update: null, afazer: f,
    };
  };

  return [...e.updates.map(daRecomendacao), ...e.afazeres.map(doAfazer)];
}

/** Todas as palavras precisam aparecer; número também casa sem os zeros à esquerda. */
export function casaBusca(item: ItemDaCaixa, busca: string): boolean {
  const termos = normalizar(busca).split(' ').filter(Boolean);
  return termos.every(t =>
    item.textoDeBusca.includes(t) || (/^\d+$/.test(t) && item.textoDeBusca.includes(semZeros(t))));
}

function casaSituacao(item: ItemDaCaixa, s: SituacaoDoFiltro): boolean {
  if (s === 'todas') return true;
  if (s === 'pendente') return item.situacao === 'pendente';
  if (s === 'aplicada') return item.situacao === 'aplicada' || item.situacao === 'feito';
  return item.situacao === 'ignorada';
}

/** Mais antigas primeiro (spec §3.2). Empate: pela chave, para a ordem não pular. */
export function ordenarItens(itens: ItemDaCaixa[]): ItemDaCaixa[] {
  return [...itens].sort((a, b) => (Date.parse(a.quando) - Date.parse(b.quando)) || a.chave.localeCompare(b.chave));
}

export function filtrarItens(
  itens: ItemDaCaixa[], filtro: FiltroDaCaixa, ocultos: ReadonlySet<string> = new Set(),
): ItemDaCaixa[] {
  return ordenarItens(itens.filter(i =>
    !ocultos.has(i.chave)
    && casaSituacao(i, filtro.situacao)
    && (filtro.tipos.length === 0 || i.tipos.some(t => filtro.tipos.includes(t)))
    && (!filtro.contaId || i.accountId === filtro.contaId)
    && casaBusca(i, filtro.busca)));
}

export function contarPendentes(
  itens: ItemDaCaixa[], ocultos: ReadonlySet<string> = new Set(),
): { total: number; porConta: Record<string, number> } {
  const porConta: Record<string, number> = {};
  let total = 0;
  for (const i of itens) {
    if (i.situacao !== 'pendente' || ocultos.has(i.chave)) continue;
    total++;
    porConta[i.accountId] = (porConta[i.accountId] ?? 0) + 1;
  }
  return { total, porConta };
}

/**
 * Depois de decidir `chave`: a próxima PENDENTE abaixo dela na lista visível; sem
 * nenhuma abaixo, a pendente de cima mais próxima; sem nenhuma, null.
 */
export function proximaDepoisDe(lista: ItemDaCaixa[], chave: string): string | null {
  const pendente = (x: ItemDaCaixa) => x.situacao === 'pendente' && x.chave !== chave;
  const i = lista.findIndex(x => x.chave === chave);
  if (i < 0) return lista.find(pendente)?.chave ?? null;
  const abaixo = lista.slice(i + 1).find(pendente);
  if (abaixo) return abaixo.chave;
  return [...lista.slice(0, i)].reverse().find(pendente)?.chave ?? null;
}

/** A seleção vale enquanto estiver na lista; senão a primeira (computador) ou nenhuma (celular). */
export function selecaoValida(lista: ItemDaCaixa[], selecionada: string | null, abrirPrimeira: boolean): string | null {
  if (selecionada && lista.some(x => x.chave === selecionada)) return selecionada;
  return abrirPrimeira ? (lista[0]?.chave ?? null) : null;
}

/** Fica oculto só o que ainda está pendente nos dados: o resto a decisão já levou ao banco. */
export function limparOcultos(ocultos: ReadonlySet<string>, itens: ItemDaCaixa[]): Set<string> {
  const pendentes = new Set(itens.filter(i => i.situacao === 'pendente').map(i => i.chave));
  return new Set([...ocultos].filter(c => pendentes.has(c)));
}

export function unirPorId<T extends { id: string }>(...listas: T[][]): T[] {
  const vistos = new Map<string, T>();
  for (const l of listas) for (const x of l) if (!vistos.has(x.id)) vistos.set(x.id, x);
  return [...vistos.values()];
}
