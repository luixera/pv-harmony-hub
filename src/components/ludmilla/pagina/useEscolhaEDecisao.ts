import { useEffect, useRef, useState } from 'react';
import { proximaDepoisDe, selecaoValida, type ItemDaCaixa } from '@/lib/ludmillaCaixa';
import {
  argumentosDaDecisao, executarDecisao, textoDaDecisao, type AcaoDaDecisao, type AcoesDaDecisao,
} from '@/lib/ludmillaPainel';

/** Depois de uma decisão, as que chegarem antes disto são o mesmo gesto repetido (clique duplo), não uma nova. */
const INTERVALO_ENTRE_DECISOES_MS = 700;

/**
 * A COLA DA FILA (spec §4.5): qual item está aberto, decidir e ir ao próximo. É a lógica da antiga
 * aba Decidir, com UMA diferença: o detalhe só passa ao próximo (e recebe o foco) quando a decisão é
 * do item aberto. O id e o texto de cada decisão vêm de `argumentosDaDecisao`/`textoDaDecisao`
 * (com teste), e quem grava é a fila do Desfazer (`decidir` de `useFilaDeDecisoes`, 8 s).
 *
 * O foco vai para o detalhe só a pedido de um gesto (decidir, ou escolher no computador), nunca ao
 * abrir a página. Decidir pelo botão de um cartão que NÃO é o aberto não mexe no aberto, mas o foco
 * vai para o cartão que ocupa o lugar do decidido (ou para a lista), nunca cai no body.
 */
export function useEscolhaEDecisao(o: {
  lista: ItemDaCaixa[];
  /** computador: o primeiro item já abre ao lado; fora dele nada abre sozinho */
  abrirPrimeira: boolean;
  decidir: (chave: string, texto: string, executar: () => Promise<unknown>) => void;
  acoes: AcoesDaDecisao;
  rotuloEtapa: (s: string | null | undefined) => string;
}) {
  const [selecionada, setSelecionada] = useState<string | null>(null);
  const efetiva = selecaoValida(o.lista, selecionada, o.abrirPrimeira);
  const ultimaDecisaoEm = useRef(0);
  const focarDetalhe = useRef(false);
  /** decidido um cartão que não era o aberto: a chave do cartão que fica no lugar dele ('' = não há) */
  const focarCartao = useRef<string | null>(null);

  useEffect(() => {
    if (focarCartao.current !== null) {
      const chave = focarCartao.current;
      focarCartao.current = null;
      const proximo = chave
        ? [...document.querySelectorAll<HTMLElement>('[data-abrir]')].find(c => c.dataset.abrir === chave)
        : undefined;
      (proximo ?? document.querySelector<HTMLElement>('[data-coluna="meio"]'))?.focus({ preventScroll: true });
    }
    if (!focarDetalhe.current) return;
    focarDetalhe.current = false;
    if (!efetiva) return;
    const alvo = [...document.querySelectorAll<HTMLElement>('[data-detalhe]')].find(d => d.dataset.detalhe === efetiva);
    alvo?.focus({ preventScroll: true });
  });

  const escolher = (chave: string | null, focar = false) => {
    if (chave && (o.abrirPrimeira || focar)) focarDetalhe.current = true;
    setSelecionada(chave);
  };

  const decidirItem = (item: ItemDaCaixa, acao: AcaoDaDecisao, etapa: string | null, texto?: string) => {
    // Decidido, o painel troca NA HORA para o próximo item com os botões no mesmo lugar: o segundo
    // clique de um clique duplo cairia no item seguinte.
    const agora = Date.now();
    if (agora - ultimaDecisaoEm.current < INTERVALO_ENTRE_DECISOES_MS) return;
    ultimaDecisaoEm.current = agora;
    const chamada = argumentosDaDecisao(item, acao, etapa, texto);
    o.decidir(item.chave, textoDaDecisao(item, acao, etapa, o.rotuloEtapa), () => executarDecisao(o.acoes, chamada));
    if (item.chave === efetiva) {
      focarDetalhe.current = true;
      setSelecionada(proximaDepoisDe(o.lista, item.chave));
    } else {
      focarCartao.current = proximaDepoisDe(o.lista, item.chave) ?? '';
    }
  };

  return { selecionada: efetiva, escolher, decidirItem };
}
