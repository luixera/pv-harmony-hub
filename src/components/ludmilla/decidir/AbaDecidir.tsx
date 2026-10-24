import { useMemo, useState, type ReactNode } from 'react';
import { filtrarItens, proximaDepoisDe, selecaoValida, type FiltroDaCaixa, type ItemDaCaixa } from '@/lib/ludmillaCaixa';
import { textoDaDecisao, type AcaoDaDecisao } from '@/lib/ludmillaPainel';
import { CaixaDeDecisoes } from './CaixaDeDecisoes';

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

  const decidirItem = (item: ItemDaCaixa, acao: AcaoDaDecisao, etapa: string | null) => {
    const proxima = proximaDepoisDe(lista, item.chave);
    const executar = acao === 'feito' ? () => p.acoes.feito(item.id)
      : acao === 'ignorar' ? () => p.acoes.ignorar(item.id)
      : () => p.acoes.aplicar(item.id, etapa);
    // sem etapa escolhida vale a recomendada (o coalesce do banco): textoDaDecisao já sabe
    p.decidir(item.chave, textoDaDecisao(item, acao, etapa, p.rotuloEtapa), executar);
    setSelecionada(proxima);
  };

  return (
    <CaixaDeDecisoes
      lista={lista} filtro={{ ...p.filtro, contaId: p.contaId }} onFiltro={f => p.onFiltro({ ...f, contaId: null })}
      selecionada={efetiva} onSelecionar={setSelecionada} modo={p.modo}
      carregando={p.carregando} buscando={p.buscando} erro={p.erro} onTentarDeNovo={p.onTentarDeNovo} agora={p.agora}
      renderDetalhe={(item, layout) => p.detalhe(item, layout, (acao, etapa) => decidirItem(item, acao, etapa))}
    />
  );
}
