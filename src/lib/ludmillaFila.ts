/**
 * A FILA DA LUDMILLA — funções puras, sem React.
 *
 * Spec: docs/superpowers/specs/2026-11-08-ludmilla-repaginacao-design.md §4.3 (o cartão completo),
 * §6.1 (em que grupo cai cada item) e §6.2 (de quem é cada item). Os itens são os de sempre
 * (`ItemDaCaixa`: recomendações + A fazer); aqui se decide o grupo, o dono, o prazo, o título, o
 * porquê em primeira pessoa e o que o botão do cartão faz.
 */
import { cartaoBloqueado, ordenarItens, type ItemDaCaixa } from '@/lib/ludmillaCaixa';
import type { DonoDoProjeto } from '@/lib/ludmillaCarteira';
// `dataBr` (dd/mm/aaaa no fuso de Brasília) é a MESMA data que vai no e-mail da cobrança: o porquê
// do cartão cita a nota igual ao e-mail. Exceção aceita à regra "dia e hora saem de ludmillaTempo".
import { dataBr, notaNaTela } from '@/lib/ludmillaCobranca';
import { acoesDoItem, type AcaoDaDecisao } from '@/lib/ludmillaPainel';
import { diasEntre } from '@/lib/ludmillaTempo';

export type GrupoDaFila = 'agora' | 'semana' | 'depois';

export const GRUPOS_DA_FILA: { valor: GrupoDaFila; rotulo: string; dica: string }[] = [
  { valor: 'agora', rotulo: 'Agora', dica: 'prazo vencido ou novidade de hoje' },
  { valor: 'semana', rotulo: 'Esta semana', dica: 'antes que vire atraso' },
  { valor: 'depois', rotulo: 'Quando puder', dica: 'sem prazo, mas esperando alguém' },
];

/** Vistoria aprovada sem o pedido da troca vai de "Esta semana" para "Agora" com 7 dias (spec §6.1). */
export const DIAS_ATE_A_VISTORIA_VIRAR_AGORA = 7;

/** Decisão 4 do plano: "hoje" é o dia de Brasília; travado vence a etapa; sem etapa é Quando puder. */
export function grupoDoItem(item: ItemDaCaixa, agora: number): GrupoDaFila {
  const f = item.afazer;
  if (f) {
    if (f.tipo === 'cobrar_troca' || f.tipo === 'troca_falhou' || f.tipo === 'devolucao') return 'agora';
    if (f.tipo === 'vistoria_aprovada') {
      return diasEntre(f.criado_em, agora) >= DIAS_ATE_A_VISTORIA_VIRAR_AGORA ? 'agora' : 'semana';
    }
    return 'depois';
  }
  const u = item.update;
  if (!u || cartaoBloqueado(u) || !u.recomendacao) return 'depois';
  return diasEntre(u.detectado_em, agora) === 0 ? 'agora' : 'semana';
}

/** `TODOS`, `SEM_DONO` ou o id de um projetista. */
export type FiltroDeDono = string;
export const TODOS = 'todos';
export const SEM_DONO = 'sem';

export function donosDoItem(item: ItemDaCaixa, donosPorProjeto: Map<string, DonoDoProjeto[]>): DonoDoProjeto[] {
  return item.projectId ? donosPorProjeto.get(item.projectId) ?? [] : [];
}

/** Vários projetistas ligados: o item conta na fila de cada um (spec §6.2). */
export function casaDono(donos: DonoDoProjeto[], filtro: FiltroDeDono): boolean {
  if (filtro === TODOS) return true;
  if (filtro === SEM_DONO) return donos.length === 0;
  return donos.some(d => d.id === filtro);
}

export type FilaPorGrupo = Record<GrupoDaFila, ItemDaCaixa[]>;

export interface OpcoesDaFila {
  /** decisões esperando o Desfazer (`useFilaDeDecisoes`) */
  ocultos: ReadonlySet<string>;
  agora: number;
  donosPorProjeto: Map<string, DonoDoProjeto[]>;
}

/** Só o que espera decisão, do dono escolhido; mais antigo primeiro dentro do grupo (spec §6.1). */
export function filaPorGrupo(itens: ItemDaCaixa[], o: OpcoesDaFila & { dono: FiltroDeDono }): FilaPorGrupo {
  const g: FilaPorGrupo = { agora: [], semana: [], depois: [] };
  const pendentes = itens.filter(i => i.situacao === 'pendente' && !o.ocultos.has(i.chave)
    && casaDono(donosDoItem(i, o.donosPorProjeto), o.dono));
  for (const i of ordenarItens(pendentes)) g[grupoDoItem(i, o.agora)].push(i);
  return g;
}

/** Os números do recado: a fila de todos, o que é para agora e o que ficou sem dono. */
export function resumoDaFila(itens: ItemDaCaixa[], o: OpcoesDaFila): { total: number; agora: number; semDono: number } {
  const g = filaPorGrupo(itens, { ...o, dono: TODOS });
  const todos = [...g.agora, ...g.semana, ...g.depois];
  return {
    total: todos.length,
    agora: g.agora.length,
    semDono: todos.filter(i => donosDoItem(i, o.donosPorProjeto).length === 0).length,
  };
}

export interface UsuarioDaPagina { id: string; role: string; name?: string | null }

/** O projetista abre na fila dele; o gestor, em Todos (spec §6.2). */
export function filaInicial(usuario: UsuarioDaPagina | null): FiltroDeDono {
  return usuario?.role === 'staff' ? usuario.id : TODOS;
}

export function primeiroNome(nome: string): string {
  return nome.trim().split(/\s+/)[0] || nome;
}

/** Os botões de "Fila de": Todos, cada projetista (quem abriu entra mesmo sem vínculo) e Sem dono. */
export function opcoesDeDono(projetistas: DonoDoProjeto[], usuario: UsuarioDaPagina | null): { valor: FiltroDeDono; rotulo: string }[] {
  const lista = [...projetistas];
  if (usuario?.role === 'staff' && !lista.some(p => p.id === usuario.id)) {
    lista.push({ id: usuario.id, nome: usuario.name?.trim() || 'Você' });
    lista.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  }
  return [
    { valor: TODOS, rotulo: 'Todos' },
    ...lista.map(p => ({ valor: p.id, rotulo: primeiroNome(p.nome) })),
    { valor: SEM_DONO, rotulo: 'Sem dono' },
  ];
}

/** A linha do celular embaixo dos grupos (mockup "CelularLista"). */
export function textoDoFiltroDeDono(dono: FiltroDeDono, opcoes: { valor: FiltroDeDono; rotulo: string }[]): string {
  if (dono === TODOS) return 'Fila de todos. Para ver só a sua, abra o menu.';
  if (dono === SEM_DONO) return 'Só o que está sem dono. Para mudar, abra o menu.';
  return `Fila de ${opcoes.find(o => o.valor === dono)?.rotulo ?? 'alguém'}. Para mudar, abra o menu.`;
}

export type TomDoPrazo = 'alerta' | 'sol' | 'caixa';

function haQuantosDias(verbo: string, iso: string, agora: number): string {
  const d = Math.max(0, diasEntre(iso, agora));
  return d === 0 ? `${verbo} hoje` : d === 1 ? `${verbo} ontem` : `${verbo} há ${d} dias`;
}

/** O chip do prazo (mockup: "venceu há 2 dias", "chegou hoje", "aprovada há 4 dias"). */
export function prazoDoItem(item: ItemDaCaixa, agora: number): { texto: string; tom: TomDoPrazo } {
  const f = item.afazer;
  const grupo = grupoDoItem(item, agora);
  if (f?.tipo === 'cobrar_troca') return { texto: haQuantosDias('venceu', f.cobranca?.vence_em ?? f.criado_em, agora), tom: 'alerta' };
  if (f?.tipo === 'devolucao') return { texto: haQuantosDias('voltou', f.criado_em, agora), tom: 'alerta' };
  if (f?.tipo === 'troca_falhou') return { texto: haQuantosDias('chegou', f.criado_em, agora), tom: 'alerta' };
  if (f?.tipo === 'vistoria_aprovada') {
    return { texto: haQuantosDias('aprovada', f.criado_em, agora), tom: grupo === 'agora' ? 'alerta' : 'sol' };
  }
  return { texto: haQuantosDias('chegou', item.quando, agora), tom: grupo === 'depois' ? 'caixa' : 'sol' };
}

const semEmoji = (s: string) => s.replace(/^[^\p{L}\p{N}]+/u, '').trim();
const limpo = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const comPonto = (s: string) => (/[.!?…]$/.test(s) ? s : `${s}.`);

/** A ação como título do cartão (spec §4.3: "Cobrar a troca do relógio"). */
export function tituloDoItem(item: ItemDaCaixa, rotuloEtapa: (s: string) => string): string {
  const f = item.afazer;
  if (f) {
    switch (f.tipo) {
      case 'cobrar_troca': return 'Cobrar a troca do relógio';
      case 'vistoria_aprovada': return 'Pedir a troca do relógio';
      case 'troca_falhou': return 'Ver a troca do relógio que não aconteceu';
      case 'devolucao': return 'Conferir o e-mail que voltou';
      default: return semEmoji(f.titulo) || 'Ver o aviso';
    }
  }
  const u = item.update;
  if (!u) return 'Ver o que chegou';
  if (cartaoBloqueado(u)) return 'Decidir sobre um documento que travei';
  if (u.recomendacao && u.atualizar_protocolo) return `Mover para ${rotuloEtapa(u.recomendacao)} e gravar o protocolo`;
  if (u.recomendacao) return `Mover para ${rotuloEtapa(u.recomendacao)}`;
  if (u.atualizar_protocolo) return 'Gravar o protocolo';
  return 'Ver o que chegou';
}

/** "PRJ-2187, Marina Duarte, ENEL SP" (no detalhe, com a empresa). */
export function linhaDoProjeto(item: ItemDaCaixa, comEmpresa = false): string {
  return [item.codigo ?? 'Sem projeto casado', item.titular, comEmpresa ? item.empresa : null, item.concessionaria]
    .filter((x): x is string => !!x)
    .join(', ');
}

/** O porquê em primeira pessoa ("Vi que…"), só com o que o item já traz. */
export function porqueDoItem(item: ItemDaCaixa): string {
  const conc = item.concessionaria || 'concessionária';
  const f = item.afazer;
  if (f?.tipo === 'cobrar_troca') {
    const c = f.cobranca;
    if (!c) return 'Vi que a troca do relógio passou do prazo.';
    const base = `Vi que a ${conc} abriu a nota ${notaNaTela(c.nota_servico) ?? 'sem número'} em ${dataBr(c.data_nota)} e ainda não trocou o relógio.`;
    return c.enviadas > 0
      ? `${base} Já cobramos ${c.enviadas === 1 ? '1 vez' : `${c.enviadas} vezes`}.`
      : `${base} Ninguém cobrou desta nota ainda.`;
  }
  if (f?.tipo === 'vistoria_aprovada') return `Vi que a vistoria foi aprovada em ${dataBr(f.criado_em)} e ninguém pediu a troca ainda.`;
  if (f) return comPonto(limpo(f.mensagem) ?? (semEmoji(f.titulo) || 'Pede alguém da equipe'));
  const u = item.update;
  if (!u) return '';
  const r = (u.raw ?? {}) as Record<string, unknown>;
  if (cartaoBloqueado(u)) {
    const motivo = (limpo(r.motivo) ?? '').replace(/^não anexei\s*·\s*/i, '');
    return motivo ? `Não anexei: ${comPonto(motivo)}` : 'Não anexei o documento: o titular não confere.';
  }
  if (item.meio === 'email') {
    const resumo = limpo(r.resumo) ?? limpo(r.assunto);
    return resumo ? `Li um e-mail da ${conc}: ${comPonto(resumo)}` : `Li um e-mail da ${conc}.`;
  }
  const de = limpo(u.status_anterior);
  return de
    ? `Vi no portal da ${conc} que mudou de “${de}” para “${u.status_portal}”.`
    : `Vi no portal da ${conc} a situação “${u.status_portal}”.`;
}

export type BotaoDoCartao =
  | { tipo: 'decidir'; acao: AcaoDaDecisao; rotulo: string }
  | { tipo: 'abrir'; rotulo: string };

/** Decisão 13 do plano: o botão decide direto só o que não pede revisão; o resto abre o detalhe. */
export function botaoDoCartao(item: ItemDaCaixa, rotuloEtapa: (s: string) => string): BotaoDoCartao {
  const f = item.afazer;
  if (f?.tipo === 'cobrar_troca' || f?.tipo === 'vistoria_aprovada') return { tipo: 'abrir', rotulo: 'Revisar e enviar' };
  if (f) return { tipo: 'decidir', acao: 'feito', rotulo: 'Marcar como feito' };
  const u = item.update;
  if (!u || cartaoBloqueado(u)) return { tipo: 'abrir', rotulo: 'Abrir para decidir' };
  const { principal } = acoesDoItem(item, null);
  if (principal?.acao !== 'aplicar' || !principal.habilitada) return { tipo: 'abrir', rotulo: 'Abrir para decidir' };
  const rotulo = !u.recomendacao ? 'Gravar o protocolo'
    : u.atualizar_protocolo ? 'Mover e gravar o protocolo'
    : `Mover para ${rotuloEtapa(u.recomendacao)}`;
  return { tipo: 'decidir', acao: 'aplicar', rotulo };
}
