import { useRef, type ReactNode } from 'react';
import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import type { FiltroDaCaixa, ItemDaCaixa } from '@/lib/ludmillaCaixa';
import { useAlturaDaCaixa } from './altura';
import { FiltrosDaCaixa } from './FiltrosDaCaixa';
import { LinhaDaCaixa } from './LinhaDaCaixa';
import { NOME_DO_MEIO, dataCurta } from './visual';

export interface PropsDaCaixa {
  lista: ItemDaCaixa[];
  filtro: FiltroDaCaixa;
  onFiltro: (f: FiltroDaCaixa) => void;
  selecionada: string | null;
  onSelecionar: (chave: string | null) => void;
  /** lado_a_lado a partir de 1024 px; folha = detalhe por cima (celular e tablet) */
  modo: 'lado_a_lado' | 'folha';
  carregando: boolean;
  buscando: boolean;
  /** null = sem erro; texto (pode ser vazio) = a consulta falhou */
  erro: string | null;
  onTentarDeNovo: () => void;
  agora: number;
  renderDetalhe: (item: ItemDaCaixa, layout: 'painel' | 'folha') => ReactNode;
}

/** Filtros + lista + detalhe: ao lado no computador, por cima (folha em tela cheia) no celular e no tablet. */
export function CaixaDeDecisoes(p: PropsDaCaixa) {
  const aberto = p.lista.find(i => i.chave === p.selecionada) ?? null;
  const semFiltro = p.filtro.situacao === 'pendente' && !p.filtro.busca && p.filtro.tipos.length === 0 && !p.filtro.contaId;
  const raiz = useRef<HTMLDivElement>(null);
  const { ref: grade, altura } = useAlturaDaCaixa(p.modo === 'lado_a_lado');

  // A folha fecha com animação: decidido o ÚLTIMO item, `aberto` vira null na hora e ela
  // deslizaria vazia. Durante a saída ela continua mostrando o que estava aberto.
  const ultimoAberto = useRef<ItemDaCaixa | null>(null);
  if (aberto) ultimoAberto.current = aberto;
  const naFolha = aberto ?? ultimoAberto.current;

  const lista = (
    <ul className="divide-y overflow-hidden rounded-xl border bg-card">
      {p.lista.map(i => (
        <li key={i.chave}>
          <LinhaDaCaixa item={i} ativa={i.chave === p.selecionada} agora={p.agora} onAbrir={() => p.onSelecionar(i.chave)} />
        </li>
      ))}
    </ul>
  );

  return (
    <div ref={raiz} tabIndex={-1} className="space-y-3 outline-none">
      <FiltrosDaCaixa filtro={p.filtro} onFiltro={p.onFiltro} />

      {/* Consulta que falhou NÃO é lista vazia: "Nada pendente" esconderia as recomendações. */}
      {p.erro !== null && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border-2 border-red-300 bg-red-50 p-4 text-sm text-red-900">
          <AlertTriangle size={18} className="shrink-0" aria-hidden />
          <div className="min-w-0 flex-1">
            <b>Não consegui carregar as recomendações.</b>{' '}
            Isto não quer dizer que não haja nenhuma pendente — a consulta falhou.
            {p.erro && <span className="mt-0.5 block break-words text-xs text-red-800">{p.erro}</span>}
          </div>
          <Button size="sm" variant="outline" className="gap-2" disabled={p.buscando} onClick={p.onTentarDeNovo}>
            {p.buscando ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Tentar de novo
          </Button>
        </div>
      )}

      {p.carregando ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 size={14} className="animate-spin" /> Carregando…</div>
      ) : p.lista.length === 0 ? (
        p.erro === null && (
          <div className="rounded-xl border p-8 text-center text-sm text-muted-foreground">
            {semFiltro ? 'Nada pendente — as concessionárias estão como o sistema.' : 'Nada com estes filtros.'}
          </div>
        )
      ) : p.modo === 'lado_a_lado' ? (
        // a altura vai de onde a caixa começa até o fim da janela (altura.ts): com o topo da página
        // por cima (código da imagem, alertas, faixa), um calc fixo jogava os botões para fora da tela.
        // O calc da classe só vale até a primeira medida.
        <div ref={grade} data-teste="caixa-lado-a-lado" className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] items-start gap-4">
          <div className="max-h-[calc(100vh-16rem)] overflow-y-auto rounded-xl" style={{ maxHeight: altura }}>{lista}</div>
          {/* coluna flex: quem rola é o corpo do detalhe; os botões dele ficam à vista embaixo */}
          <div className="flex max-h-[calc(100vh-16rem)] flex-col overflow-hidden rounded-xl border bg-card" style={{ maxHeight: altura }}>
            {aberto ? p.renderDetalhe(aberto, 'painel') : <p className="p-6 text-sm text-muted-foreground">Escolha uma linha.</p>}
          </div>
        </div>
      ) : lista}

      {p.modo === 'folha' && (
        // Não modal: o aviso com "Desfazer" (fora da folha) precisa continuar clicável.
        <Sheet open={!!aberto} modal={false} onOpenChange={o => { if (!o) p.onSelecionar(null); }}>
          <SheetContent
            side="right"
            // o "X" do Sheet (último filho) tem 16 px de largura: no celular o alvo de toque vira 48 × 48
            className="flex w-full max-w-none flex-col gap-0 p-0 sm:max-w-none [&>button:last-child]:right-1 [&>button:last-child]:top-1 [&>button:last-child]:flex [&>button:last-child]:h-12 [&>button:last-child]:w-12 [&>button:last-child]:items-center [&>button:last-child]:justify-center"
            onInteractOutside={e => {
              const alvo = e.target as Element | null;
              if (alvo?.closest?.('[data-sonner-toaster]')) e.preventDefault();
            }}
            // fechada a folha, o foco volta à linha que estava aberta (sem ela — decidida —, à primeira;
            // lista vazia, à própria caixa: a busca abriria o teclado do celular sem ninguém pedir)
            onCloseAutoFocus={e => {
              const chave = ultimoAberto.current?.chave;
              const linhas = [...(raiz.current?.querySelectorAll<HTMLElement>('[data-linha]') ?? [])];
              const destino = linhas.find(l => l.dataset.linha === chave) ?? linhas[0] ?? raiz.current;
              if (destino) {
                e.preventDefault();
                destino.focus();
              }
            }}
          >
            {naFolha && (
              <>
                <SheetHeader className="shrink-0 space-y-0.5 border-b px-4 py-3 pr-14 text-left">
                  <SheetTitle className="text-base">{naFolha.codigo ?? 'Sem projeto casado'}</SheetTitle>
                  <SheetDescription>
                    {naFolha.concessionaria} · por {NOME_DO_MEIO[naFolha.meio]} · {dataCurta(naFolha.quando)}
                    {naFolha.titular && <span className="block truncate">{naFolha.titular}</span>}
                  </SheetDescription>
                </SheetHeader>
                {p.renderDetalhe(naFolha, 'folha')}
              </>
            )}
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}
