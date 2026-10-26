import { useLayoutEffect, useState } from 'react';

/**
 * A ALTURA DA CAIXA LADO A LADO (computador). A lista e o detalhe rolam por dentro; os botões do
 * detalhe ficam embaixo da caixa. Um `calc(100vh-…)` fixo não serve: o topo da página muda (código
 * da imagem da Elektro, alertas das contas, faixa de saúde), e com ele por cima os botões caíam
 * para fora da tela. A caixa vai de onde ela começa até o fim da janela.
 */

/**
 * Abaixo disto a lista e o detalhe ficam apertados demais: a página rola um pouco. 280 cabe em
 * 1280 × 800 com um alerta e a faixa em duas linhas (medido no harness); com o código da imagem
 * da Elektro na tela (urgente, 5 min) a página rola até os botões.
 */
export const ALTURA_MINIMA_DA_CAIXA = 280;
/** O respiro embaixo da caixa (o `p-6` do `MainLayout` no computador). */
export const FOLGA_EMBAIXO_DA_CAIXA = 24;

export function alturaDaCaixa(alturaDaJanela: number, topoNoDocumento: number): number {
  const livre = Math.floor(alturaDaJanela - topoNoDocumento - FOLGA_EMBAIXO_DA_CAIXA);
  return Number.isFinite(livre) ? Math.max(ALTURA_MINIMA_DA_CAIXA, livre) : ALTURA_MINIMA_DA_CAIXA;
}

/**
 * Onde o elemento começa NA PÁGINA, pela soma dos `offsetTop`. Não é o `getBoundingClientRect`
 * de propósito: o `<main>` do `MainLayout` entra deslizando 20 px (framer-motion), e a medida
 * feita durante a animação ficaria 20 px errada até a janela mudar de tamanho.
 */
function topoNaPagina(el: HTMLElement): number {
  let y = 0;
  for (let n: HTMLElement | null = el; n; n = n.offsetParent as HTMLElement | null) y += n.offsetTop;
  return y;
}

/**
 * Mede onde a caixa começa NA PÁGINA (não na tela: rolar não muda a conta) e acompanha o que
 * muda isso — janela redimensionada e o conteúdo de cima crescendo ou sumindo. `ligado` falso
 * (celular/tablet, detalhe por cima) não mede nada.
 *
 * `ref` é uma função (não um `useRef`): a grade só aparece depois do "Carregando…", e um efeito
 * preso a um `useRef` não sabe quando ela nasce. Observa os ANCESTRAIS da grade, não só o corpo:
 * o `min-h-screen` do `MainLayout` segura o corpo quando o topo encolhe (o código da imagem
 * respondido), e a caixa ficaria baixa até a janela mudar de tamanho.
 */
export function useAlturaDaCaixa(ligado: boolean): { ref: (el: HTMLElement | null) => void; altura: number | undefined } {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [altura, setAltura] = useState<number | undefined>(undefined);
  useLayoutEffect(() => {
    if (!ligado || !el) return;
    const medir = () => setAltura(alturaDaCaixa(window.innerHeight, topoNaPagina(el)));
    medir();
    // a nova altura muda o tamanho dos ancestrais observados: medir numa tarefa seguinte evita o
    // aviso "ResizeObserver loop" (a conta converge — o topo não depende da altura da caixa).
    // setTimeout, não requestAnimationFrame: aba em segundo plano não roda quadros, e a caixa
    // voltaria com a altura velha.
    let espera: ReturnType<typeof setTimeout> | undefined;
    const depois = () => { clearTimeout(espera); espera = setTimeout(medir, 0); };
    window.addEventListener('resize', depois);
    const observador = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(depois);
    for (let n = el.parentElement; n && observador; n = n.parentElement) observador.observe(n);
    return () => {
      clearTimeout(espera);
      window.removeEventListener('resize', depois);
      observador?.disconnect();
    };
  }, [el, ligado]);
  return { ref: setEl, altura: ligado ? altura : undefined };
}
