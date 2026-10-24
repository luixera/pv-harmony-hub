import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { filtrarItens, proximaDepoisDe, selecaoValida, type FiltroDaCaixa, type ItemDaCaixa } from '@/lib/ludmillaCaixa';
import { textoDaDecisao, type AcaoDaDecisao } from '@/lib/ludmillaPainel';
import { CaixaDeDecisoes } from './CaixaDeDecisoes';

/** Depois de uma decisão, as que chegarem antes disto são o mesmo gesto repetido, não uma decisão nova. */
const INTERVALO_ENTRE_DECISOES_MS = 700;

/**
 * As três gravações possíveis — no app, `useAcoesDaCaixa()` (espera a mutação, REJEITA na
 * falha e atualiza o detalhe); no harness, dublês. A rejeição é o que faz a linha voltar.
 */
export interface AcoesDaCaixa {
  aplicar: (updateId: string, etapa: string | null) => Promise<unknown>;
  ignorar: (updateId: string) => Promise<unknown>;
  feito: (afazerId: string) => Promise<unknown>;
}

export interface PropsDaAbaDecidir {
  itens: ItemDaCaixa[];
  filtro: FiltroDaCaixa;
  onFiltro: (f: FiltroDaCaixa) => void;
  /** o chip da faixa de saúde (vem de fora da aba) */
  contaId: string | null;
  ocultos: ReadonlySet<string>;
  decidir: (chave: string, texto: string, executar: () => Promise<unknown>) => void;
  acoes: AcoesDaCaixa;
  rotuloEtapa: (s: string | null | undefined) => string;
  carregando: boolean;
  buscando: boolean;
  erro: string | null;
  onTentarDeNovo: () => void;
  agora: number;
  modo: 'lado_a_lado' | 'folha';
  detalhe: (item: ItemDaCaixa, layout: 'painel' | 'folha', onDecidir: (acao: AcaoDaDecisao, etapa: string | null) => void) => ReactNode;
}

/**
 * A COLA DA ABA DECIDIR: escolhe a linha aberta, decide e vai para a próxima
 * pendente (spec §3.2, "Depois de decidir"). Não lê banco — recebe tudo pronto.
 */
export function AbaDecidir(p: PropsDaAbaDecidir) {
  const [selecionada, setSelecionada] = useState<string | null>(null);
  const lista = useMemo(
    () => filtrarItens(p.itens, { ...p.filtro, contaId: p.contaId }, p.ocultos),
    [p.itens, p.filtro, p.contaId, p.ocultos],
  );
  const efetiva = selecaoValida(lista, selecionada, p.modo === 'lado_a_lado');
  const ultimaDecisaoEm = useRef(0);

  // O FOCO vai para o detalhe só a pedido de um gesto: depois de uma decisão (o botão clicado
  // desmonta e o foco cairia no <body>; na folha não modal o Tab a fecharia) ou, no computador,
  // quando a pessoa escolhe uma linha. NUNCA na abertura da página: quem usa teclado ou leitor
  // de tela começa pelo topo. No celular, abrir a folha fica com o foco automático do Radix.
  const focarDetalhe = useRef(false);
  useEffect(() => {
    if (!focarDetalhe.current) return;
    focarDetalhe.current = false;
    if (!efetiva) return; // decidido o último item: a folha fecha e devolve o foco à lista
    const alvo = [...document.querySelectorAll<HTMLElement>('[data-detalhe]')].find(d => d.dataset.detalhe === efetiva);
    alvo?.focus({ preventScroll: true });
  });

  const escolher = (chave: string | null) => {
    if (chave && p.modo === 'lado_a_lado') focarDetalhe.current = true;
    setSelecionada(chave);
  };

  const decidirItem = (item: ItemDaCaixa, acao: AcaoDaDecisao, etapa: string | null) => {
    // Decidido, o painel troca NA HORA para o próximo item com os botões no mesmo lugar: o
    // segundo clique de um clique duplo (ou um toque repetido) cairia no item seguinte.
    const agora = Date.now();
    if (agora - ultimaDecisaoEm.current < INTERVALO_ENTRE_DECISOES_MS) return;
    ultimaDecisaoEm.current = agora;
    const proxima = proximaDepoisDe(lista, item.chave);
    const executar = acao === 'feito' ? () => p.acoes.feito(item.id)
      : acao === 'ignorar' ? () => p.acoes.ignorar(item.id)
      : () => p.acoes.aplicar(item.id, etapa);
    // sem etapa escolhida vale a recomendada (o coalesce do banco): textoDaDecisao já sabe
    p.decidir(item.chave, textoDaDecisao(item, acao, etapa, p.rotuloEtapa), executar);
    focarDetalhe.current = true;
    setSelecionada(proxima);
  };

  return (
    <CaixaDeDecisoes
      lista={lista} filtro={{ ...p.filtro, contaId: p.contaId }} onFiltro={f => p.onFiltro({ ...f, contaId: null })}
      selecionada={efetiva} onSelecionar={escolher} modo={p.modo}
      carregando={p.carregando} buscando={p.buscando} erro={p.erro} onTentarDeNovo={p.onTentarDeNovo} agora={p.agora}
      renderDetalhe={(item, layout) => p.detalhe(item, layout, (acao, etapa) => decidirItem(item, acao, etapa))}
    />
  );
}
