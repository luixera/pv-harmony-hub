import { useMemo, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ItemDaCaixa } from '@/lib/ludmillaCaixa';
import type { AcaoDaDecisao, AcoesDaDecisao } from '@/lib/ludmillaPainel';
import { barrasDoHistorico, type Barra } from '@/lib/ludmillaBarras';
import {
  FILTROS_DA_CARTEIRA, contarCarteira, donosPorProjetoDe, filtrarCarteira, normaisDaConcessionaria, projetistasDaCarteira,
  tempoDaLinha, type FiltroDaCarteira, type LinhaDaCarteira, type NormalDaEtapa,
} from '@/lib/ludmillaCarteira';
import {
  GRUPOS_DA_FILA, TODOS, botaoDoCartao, donosDoItem, filaInicial, filaPorGrupo, grupoDoItem, linhaDoProjeto, opcoesDeDono,
  porqueDoItem, prazoDoItem, textoDoFiltroDeDono, tituloDoItem, type FiltroDeDono, type GrupoDaFila, type UsuarioDaPagina,
} from '@/lib/ludmillaFila';
import type { LinhaDeLeitura } from '@/lib/ludmillaLeituras';
import type { DiaDoDiario, FeitoSozinha, RecadoDoDia } from '@/lib/ludmillaRecado';
import { useAlturaDaCaixa } from '@/components/ludmilla/decidir/altura';
import { HistoricoGrande } from '@/components/ludmilla/mundo/HistoricoEmBarras';
import { Esqueleto } from '@/components/ludmilla/mundo/pecas';
import { useFonteDaLudmilla } from '@/components/ludmilla/mundo/useFonteDaLudmilla';
import { AjustesDaLudmilla } from './AjustesDaLudmilla';
import type { DadosDoCartao } from './CartaoDaFila';
import { ColunaDaEsquerda, type ItemDeNavegacao } from './ColunaDaEsquerda';
import { Diario, PainelDoRecado, type EstadoDoDiario } from './Diario';
import { FaixaDaLudmilla } from './FaixaDaLudmilla';
import { FaixaDoCelular } from './FaixaDoCelular';
import { FizSozinha, PainelDoQueFacoSozinha } from './FizSozinha';
import { FolhaDaLudmilla } from './FolhaDaLudmilla';
import type { DadosDaLinha } from './LinhaDaCarteira';
import { ListaDaCarteira } from './ListaDaCarteira';
import { ListaDaFila } from './ListaDaFila';
import { TopoDaDecisao } from './TopoDaDecisao';
import type { ModoDaPagina } from './modo';
import { useEscolhaEDecisao } from './useEscolhaEDecisao';

export type VistaDaLudmilla =
  | { tipo: 'decidir'; grupo: GrupoDaFila }
  | { tipo: 'carteira'; filtro: FiltroDaCarteira }
  | { tipo: 'sozinha' }
  | { tipo: 'diario' }
  | { tipo: 'ajustes' };

export type DecidirItem = (acao: AcaoDaDecisao, etapa: string | null, texto?: string) => void;

interface EstadoDaConsulta { carregando: boolean; buscando: boolean; erro: string | null; tentar: () => void }

export interface PropsDaPagina {
  modo: ModoDaPagina;
  agora: number;
  usuario: UsuarioDaPagina | null;
  rotuloEtapa: (s: string | null | undefined) => string;
  /** as colunas do Kanban do tenant, em ordem (`useStatusOrder`) */
  ordemDasEtapas: string[];
  itens: ItemDaCaixa[];
  ocultos: ReadonlySet<string>;
  decidir: (chave: string, texto: string, executar: () => Promise<unknown>) => void;
  acoes: AcoesDaDecisao;
  fila: EstadoDaConsulta;
  carteira: LinhaDaCarteira[];
  normais: NormalDaEtapa[];
  estadoDaCarteira: EstadoDaConsulta;
  /** null = carregando */
  recado: RecadoDoDia | null;
  feitos: FeitoSozinha[];
  /** "Desde sexta" */
  rotuloDoDesde: string;
  diario: DiaDoDiario[];
  estadoDoDiario: EstadoDoDiario;
  leituras: LinhaDeLeitura[];
  textoDaListaVazia: string;
  /** o código da imagem da Elektro: acima de tudo (spec §4.5) */
  alertaUrgente: ReactNode;
  /** o que lê banco fica do lado de fora: no app `DetalheConectado`, no harness o detalhe com fixtures */
  detalhe: (item: ItemDaCaixa, layout: 'painel' | 'folha', onDecidir: DecidirItem, topo: ReactNode, historico: ReactNode) => ReactNode;
  ficha: (linha: LinhaDaCarteira, historico: ReactNode, onVerNaFila: (() => void) | null) => ReactNode;
  ondeEuLeio: () => ReactNode;
  onAbrirProjeto: (projectId: string) => void;
}

const SEM_ITENS: ItemDaCaixa[] = [];

function tituloDaVista(vista: VistaDaLudmilla, rotuloDoDesde: string): [string, string] {
  switch (vista.tipo) {
    case 'decidir': {
      const g = GRUPOS_DA_FILA.find(x => x.valor === vista.grupo) ?? GRUPOS_DA_FILA[0];
      return [g.rotulo, g.dica];
    }
    case 'carteira':
      return [FILTROS_DA_CARTEIRA.find(f => f.valor === vista.filtro)?.rotulo ?? 'Carteira', 'o mais passado do normal primeiro'];
    case 'sozinha':
      return ['Fiz sozinha', rotuloDoDesde.charAt(0).toLowerCase() + rotuloDoDesde.slice(1)];
    case 'diario':
      return ['Diário', 'o que eu li e fiz, e o que a equipe decidiu'];
    case 'ajustes':
      return ['Ajustes', 'o que eu faço sozinha, como eu aviso e onde eu leio'];
  }
}

function CabecalhoDoMeio({ titulo, subtitulo }: { titulo: string; subtitulo: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
      <h1 className="m-0 text-[22px] font-extrabold">{titulo}</h1>
      <span className="text-[13px] text-lm-suave">{subtitulo}</span>
    </div>
  );
}

/**
 * A PÁGINA NOVA DA LUDMILLA (spec 2026-11-08, estrutura A no mundo "Conta de luz").
 *
 * Três colunas a partir de 1280 px (navegação, lista, detalhe/ficha/painel); de 960 a 1279, a
 * navegação e a lista, com o detalhe numa folha; abaixo de 960, uma coluna por vez (spec §5). Não lê
 * banco: recebe tudo pronto (no app, `pages/Ludmilla.tsx`; no harness, dados inventados).
 */
export function PaginaDaLudmilla(p: PropsDaPagina) {
  useFonteDaLudmilla();
  const [vista, setVista] = useState<VistaDaLudmilla>({ tipo: 'decidir', grupo: 'agora' });
  const [dono, setDono] = useState<FiltroDeDono>(() => filaInicial(p.usuario));
  const [projetoEscolhido, setProjetoEscolhido] = useState<string | null>(null);
  const [menuAberto, setMenuAberto] = useState(false);
  const origemDoMenu = useRef<HTMLElement | null>(null);
  const navegouPeloMenu = useRef(false);
  const ladoALado = p.modo === 'tres';
  const { ref: grade, altura } = useAlturaDaCaixa(p.modo !== 'uma');

  const donosPorProjeto = useMemo(() => donosPorProjetoDe(p.carteira), [p.carteira]);
  const linhaPorProjeto = useMemo(() => new Map(p.carteira.map(l => [l.projectId, l])), [p.carteira]);
  const barrasPorProjeto = useMemo(() => new Map<string, Barra[]>(p.carteira.map(l => [l.projectId, barrasDoHistorico({
    historico: l.historico, status: l.status, diasNaEtapa: l.diasNaEtapa, ordem: p.ordemDasEtapas,
    normais: normaisDaConcessionaria(p.normais, l.concessionaireId), rotuloEtapa: p.rotuloEtapa,
  })])), [p.carteira, p.normais, p.ordemDasEtapas, p.rotuloEtapa]);
  const fila = useMemo(
    () => filaPorGrupo(p.itens, { ocultos: p.ocultos, agora: p.agora, donosPorProjeto, dono }),
    [p.itens, p.ocultos, p.agora, donosPorProjeto, dono],
  );
  const contagem = useMemo(() => contarCarteira(p.carteira), [p.carteira]);
  const opcoes = useMemo(() => opcoesDeDono(projetistasDaCarteira(p.carteira), p.usuario), [p.carteira, p.usuario]);

  const lista = vista.tipo === 'decidir' ? fila[vista.grupo] : SEM_ITENS;
  const linhas = useMemo(() => (vista.tipo === 'carteira' ? filtrarCarteira(p.carteira, vista.filtro) : []), [p.carteira, vista]);
  const { selecionada, escolher, decidirItem } = useEscolhaEDecisao({
    lista, abrirPrimeira: ladoALado, decidir: p.decidir, acoes: p.acoes, rotuloEtapa: p.rotuloEtapa,
  });
  const projetoAberto = linhas.some(l => l.projectId === projetoEscolhido)
    ? projetoEscolhido
    : (ladoALado ? linhas[0]?.projectId ?? null : null);
  const itemAberto = lista.find(i => i.chave === selecionada) ?? null;
  const linhaAberta = linhas.find(l => l.projectId === projetoAberto) ?? null;

  const abrirMenu = () => {
    origemDoMenu.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setMenuAberto(true);
  };

  const irPara = (v: VistaDaLudmilla) => {
    if (menuAberto) navegouPeloMenu.current = true;
    setVista(v);
    setMenuAberto(false);
    setProjetoEscolhido(null);
    escolher(null);
  };

  const historicoDe = (linha: LinhaDaCarteira | null): ReactNode => {
    if (!linha) return null;
    const t = tempoDaLinha(linha, p.rotuloEtapa);
    return (
      <HistoricoGrande
        barras={barrasPorProjeto.get(linha.projectId) ?? []} resumo={`${t.dias} ${t.em}, ${t.normalLongo}`}
        alerta={t.alerta} concessionaria={linha.concessionaria}
      />
    );
  };

  const cartaoDe = (item: ItemDaCaixa): DadosDoCartao => {
    const linha = item.projectId ? linhaPorProjeto.get(item.projectId) ?? null : null;
    return {
      chave: item.chave,
      titulo: tituloDoItem(item, p.rotuloEtapa),
      projeto: linhaDoProjeto(item),
      porque: porqueDoItem(item),
      prazo: prazoDoItem(item, p.agora),
      donos: donosDoItem(item, donosPorProjeto),
      barras: linha ? barrasPorProjeto.get(linha.projectId) ?? null : null,
      tempo: linha ? tempoDaLinha(linha, p.rotuloEtapa) : null,
      botao: botaoDoCartao(item, p.rotuloEtapa),
    };
  };

  const dadosDaLinha = (l: LinhaDaCarteira): DadosDaLinha => ({
    projectId: l.projectId, codigo: l.codigo, titular: l.titular, concessionaria: l.concessionaria,
    barras: barrasPorProjeto.get(l.projectId) ?? [], tempo: tempoDaLinha(l, p.rotuloEtapa), comQuem: l.comQuem, donos: l.donos,
  });

  /** O botão do cartão: decide direto ou abre o detalhe (decisão 13). */
  const noBotao = (chave: string) => {
    const item = lista.find(i => i.chave === chave);
    if (!item) return;
    const b = botaoDoCartao(item, p.rotuloEtapa);
    if (b.tipo === 'decidir') decidirItem(item, b.acao, null);
    else escolher(item.chave);
  };

  /** "Ver na fila" da ficha: o primeiro item pendente do projeto, no grupo dele, na fila de todos. */
  const verNaFila = (linha: LinhaDaCarteira): (() => void) | null => {
    const item = p.itens.find(i => i.projectId === linha.projectId && i.situacao === 'pendente' && !p.ocultos.has(i.chave));
    if (!item) return null;
    return () => {
      setDono(TODOS);
      setVista({ tipo: 'decidir', grupo: grupoDoItem(item, p.agora) });
      setProjetoEscolhido(null);
      escolher(item.chave);
    };
  };

  const semNumero = (e: EstadoDaConsulta) => e.carregando || e.erro !== null;
  const navGrupos: ItemDeNavegacao[] = GRUPOS_DA_FILA.map(g => ({
    chave: `grupo-${g.valor}`, rotulo: g.rotulo, n: semNumero(p.fila) ? null : fila[g.valor].length,
    ativo: vista.tipo === 'decidir' && vista.grupo === g.valor,
    onClick: () => irPara({ tipo: 'decidir', grupo: g.valor }),
  }));
  const navCarteira: ItemDeNavegacao[] = FILTROS_DA_CARTEIRA.map(f => ({
    chave: `carteira-${f.valor}`, rotulo: f.rotulo, n: semNumero(p.estadoDaCarteira) ? null : contagem[f.valor],
    alerta: f.valor === 'parados', ativo: vista.tipo === 'carteira' && vista.filtro === f.valor,
    onClick: () => irPara({ tipo: 'carteira', filtro: f.valor }),
  }));
  const navComigo: ItemDeNavegacao[] = [
    { chave: 'sozinha', rotulo: 'Fiz sozinha', n: p.feitos.length, ativo: vista.tipo === 'sozinha', onClick: () => irPara({ tipo: 'sozinha' }) },
    { chave: 'diario', rotulo: 'Diário', n: null, ativo: vista.tipo === 'diario', onClick: () => irPara({ tipo: 'diario' }) },
  ];

  const meio = (): ReactNode => {
    switch (vista.tipo) {
      case 'decidir':
        return (
          <ListaDaFila
            cartoes={lista.map(cartaoDe)} aberto={selecionada} onAbrir={chave => escolher(chave)} onBotao={noBotao}
            carregando={p.fila.carregando} erro={p.fila.erro} buscando={p.fila.buscando} onTentar={p.fila.tentar}
            vazio={p.textoDaListaVazia}
          />
        );
      case 'carteira':
        return p.estadoDaCarteira.carregando ? <Esqueleto rotulo="Carregando a carteira" /> : (
          <ListaDaCarteira
            linhas={linhas.map(dadosDaLinha)} aberta={projetoAberto} onAbrir={setProjetoEscolhido}
            erro={p.estadoDaCarteira.erro} buscando={p.estadoDaCarteira.buscando} onTentar={p.estadoDaCarteira.tentar}
          />
        );
      case 'sozinha':
        return <FizSozinha feitos={p.feitos} rotuloDoDesde={p.rotuloDoDesde} agora={p.agora} onAbrirProjeto={p.onAbrirProjeto} />;
      case 'diario':
        return <Diario dias={p.diario} estado={p.estadoDoDiario} />;
      case 'ajustes':
        return <AjustesDaLudmilla />;
    }
  };

  const direita = (layout: 'painel' | 'folha'): ReactNode => {
    switch (vista.tipo) {
      case 'decidir': {
        if (p.fila.carregando) return <div className="p-5"><Esqueleto linhas={2} rotulo="Carregando o detalhe" /></div>;
        if (!itemAberto) return <p className="m-0 p-5 text-sm text-lm-suave">Escolha um cartão.</p>;
        const item = itemAberto;
        const c = cartaoDe(item);
        const linha = item.projectId ? linhaPorProjeto.get(item.projectId) ?? null : null;
        const topo = (
          <TopoDaDecisao
            prazo={c.prazo} donos={c.donos} titulo={c.titulo} projeto={linhaDoProjeto(item, true)}
            projectId={item.projectId} onAbrirProjeto={p.onAbrirProjeto}
          />
        );
        return p.detalhe(item, layout, (acao, etapa, texto) => decidirItem(item, acao, etapa, texto), topo, historicoDe(linha));
      }
      case 'carteira':
        if (p.estadoDaCarteira.carregando) return <div className="p-5"><Esqueleto linhas={2} rotulo="Carregando a ficha" /></div>;
        if (!linhaAberta) return <p className="m-0 p-5 text-sm text-lm-suave">Escolha um projeto.</p>;
        return p.ficha(linhaAberta, historicoDe(linhaAberta), verNaFila(linhaAberta));
      case 'sozinha':
        return <PainelDoQueFacoSozinha onAjustes={() => irPara({ tipo: 'ajustes' })} />;
      case 'diario':
        return <PainelDoRecado recado={p.recado} />;
      case 'ajustes':
        return p.ondeEuLeio();
    }
  };

  // ── a folha (fora das três colunas): detalhe e ficha ──
  const folhaAberta = !ladoALado && ((vista.tipo === 'decidir' && !!itemAberto) || (vista.tipo === 'carteira' && !!linhaAberta));
  const conteudoDaFolha = folhaAberta ? direita('folha') : null;
  // a folha fecha com animação: durante a saída ela continua mostrando o que estava aberto
  const ultimoConteudo = useRef<ReactNode>(null);
  if (conteudoDaFolha) ultimoConteudo.current = conteudoDaFolha;
  // fechada, o foco volta ao cartão (ou à linha) que estava aberto; sem ele, à lista
  const ultimoAberto = useRef<string | null>(null);
  if (vista.tipo === 'decidir' && itemAberto) ultimoAberto.current = `[data-abrir="${itemAberto.chave}"]`;
  if (vista.tipo === 'carteira' && linhaAberta) ultimoAberto.current = `[data-linha-carteira="${linhaAberta.projectId}"]`;
  const fecharFolha = () => {
    if (vista.tipo === 'decidir') escolher(null);
    else setProjetoEscolhido(null);
  };
  const devolverFoco = (e: Event) => {
    const alvo = (ultimoAberto.current ? document.querySelector<HTMLElement>(ultimoAberto.current) : null)
      ?? document.querySelector<HTMLElement>('[data-coluna="meio"]');
    if (alvo) {
      e.preventDefault();
      alvo.focus();
    }
  };
  // o menu não tem Trigger do Radix, então sem isto o foco cai no body ao fechar; depois de escolher uma vista ele vai para a lista
  const devolverFocoDoMenu = (e: Event) => {
    const alvo = navegouPeloMenu.current
      ? document.querySelector<HTMLElement>('[data-coluna="meio"]')
      : (origemDoMenu.current?.isConnected ? origemDoMenu.current : document.querySelector<HTMLElement>('[data-nav="menu"]'));
    navegouPeloMenu.current = false;
    if (alvo) {
      e.preventDefault();
      alvo.focus();
    }
  };
  const voltarPara = vista.tipo === 'carteira'
    ? FILTROS_DA_CARTEIRA.find(f => f.valor === vista.filtro)?.rotulo ?? 'Carteira'
    : vista.tipo === 'decidir'
      ? GRUPOS_DA_FILA.find(g => g.valor === vista.grupo)?.rotulo ?? 'Voltar'
      : 'Voltar';

  const [titulo, subtitulo] = tituloDaVista(vista, p.rotuloDoDesde);
  const painelEmbaixo = !ladoALado && (vista.tipo === 'sozinha' || vista.tipo === 'diario' || vista.tipo === 'ajustes');
  const coluna = (
    <ColunaDaEsquerda
      recado={p.recado} grupos={navGrupos} donos={opcoes} dono={dono}
      onDono={v => { setDono(v); escolher(null); }}
      carteira={navCarteira} comigo={navComigo} leituras={p.leituras} onLeituras={() => irPara({ tipo: 'ajustes' })}
    />
  );

  // a casca cancela o respiro do MainLayout dos 4 lados (no celular o de baixo é o pb-20 da BottomNav:
  // o papel desce por trás dela e o pb-20 volta aqui dentro, para o conteúdo não ficar coberto)
  return (
    <div
      data-modo={p.modo}
      className="ludmilla-mundo -mx-4 -mt-4 -mb-20 flex min-h-[calc(100vh-3.5rem)] flex-col pb-20 sm:-mb-4 sm:pb-0 md:-mx-6 md:-mt-6 md:-mb-6 md:min-h-[calc(100vh-4rem)]"
    >
      {p.alertaUrgente && <div className="flex flex-col gap-2 px-4 py-3 sm:px-6">{p.alertaUrgente}</div>}
      {p.modo === 'uma'
        ? <FaixaDoCelular onMenu={abrirMenu} onAjustes={() => irPara({ tipo: 'ajustes' })} />
        : <FaixaDaLudmilla onAjustes={() => irPara({ tipo: 'ajustes' })} ajustesAberto={vista.tipo === 'ajustes'} />}

      {p.modo === 'uma' ? (
        <section aria-label="Lista" tabIndex={-1} data-coluna="meio" className="flex flex-col gap-3 px-4 pb-6 outline-none">
          <div className="-mx-4 flex items-center justify-between gap-2.5 bg-lm-caixa px-4 py-2.5 text-[13px]">
            <span>{p.recado?.curto ?? 'Carregando o recado…'}</span>
            <button type="button" onClick={abrirMenu} className="shrink-0 whitespace-nowrap font-bold underline underline-offset-4">
              Ler o recado
            </button>
          </div>
          {vista.tipo === 'decidir' && (
            <>
              <div role="group" aria-label="Para decidir" className="flex gap-1.5 overflow-x-auto">
                {navGrupos.map(g => (
                  <button
                    key={g.chave} type="button" aria-pressed={g.ativo} onClick={g.onClick} data-nav={g.chave}
                    className={cn('min-h-11 shrink-0 rounded-md px-3.5 text-sm',
                      g.ativo ? 'bg-lm-sol font-extrabold' : 'border-[1.5px] border-lm-borda bg-white font-bold')}
                  >
                    {g.rotulo}{g.n !== null ? ` ${g.n}` : ''}
                  </button>
                ))}
              </div>
              <p className="m-0 text-xs text-lm-suave">{textoDoFiltroDeDono(dono, opcoes)}</p>
            </>
          )}
          <CabecalhoDoMeio titulo={titulo} subtitulo={subtitulo} />
          {meio()}
          {painelEmbaixo && <div className="-mx-4 border-t border-lm-borda">{direita('painel')}</div>}
        </section>
      ) : (
        <div ref={grade} className="flex min-h-0" style={altura ? { height: altura } : undefined}>
          <div className="w-[260px] shrink-0 overflow-y-auto bg-lm-caixa">{coluna}</div>
          <section
            aria-label="Lista" tabIndex={-1} data-coluna="meio"
            className="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto px-5 pb-10 pt-4 outline-none"
          >
            <CabecalhoDoMeio titulo={titulo} subtitulo={subtitulo} />
            {meio()}
            {painelEmbaixo && <div className="border-t border-lm-borda">{direita('painel')}</div>}
          </section>
          {ladoALado && (
            <aside
              aria-label="Detalhe" data-coluna="direita"
              className={cn('flex w-[360px] shrink-0 flex-col border-l border-lm-borda 2xl:w-[420px]',
                vista.tipo === 'decidir' ? 'overflow-hidden' : 'overflow-y-auto')}
            >
              {direita('painel')}
            </aside>
          )}
        </div>
      )}

      {!ladoALado && (
        <FolhaDaLudmilla
          aberta={folhaAberta} onFechar={fecharFolha} titulo={voltarPara} onCloseAutoFocus={devolverFoco}
          cabecalho={(
            <button type="button" onClick={fecharFolha} className="flex min-h-11 items-center gap-1.5 pr-2 text-[15px] font-bold text-white">
              <ChevronLeft size={20} aria-hidden /> {voltarPara}
            </button>
          )}
        >
          {conteudoDaFolha ?? ultimoConteudo.current}
        </FolhaDaLudmilla>
      )}
      {p.modo === 'uma' && (
        <FolhaDaLudmilla
          aberta={menuAberto} onFechar={() => setMenuAberto(false)} lado="left" titulo="Menu da Ludmilla" onCloseAutoFocus={devolverFocoDoMenu}
          cabecalho={(
            <>
              <span className="pl-1 text-[17px] font-extrabold text-white">Ludmilla</span>
              <button type="button" onClick={() => setMenuAberto(false)} className="min-h-11 px-2 text-[15px] font-bold text-white">
                Fechar
              </button>
            </>
          )}
        >
          {coluna}
        </FolhaDaLudmilla>
      )}
    </div>
  );
}
