import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Barra } from '@/lib/ludmillaBarras';
import type { DonoDoProjeto, TempoDaLinha } from '@/lib/ludmillaCarteira';
import type { BotaoDoCartao, TomDoPrazo } from '@/lib/ludmillaFila';
import { HistoricoPequeno } from '@/components/ludmilla/mundo/HistoricoEmBarras';
import { Chip, Donos, TOM_DO_PRAZO } from '@/components/ludmilla/mundo/pecas';

/** Tudo o que o cartão mostra, já decidido pelas funções puras (PaginaDaLudmilla monta). */
export interface DadosDoCartao {
  chave: string;
  titulo: string;
  projeto: string;
  porque: string;
  prazo: { texto: string; tom: TomDoPrazo };
  donos: DonoDoProjeto[];
  /** null = item sem projeto na carteira (sem histórico) */
  barras: Barra[] | null;
  tempo: TempoDaLinha | null;
  botao: BotaoDoCartao;
}

/** O histórico pequeno com "14 dias em Troca / o normal é até 7" (cartão e linha da carteira). */
export function TempoPequeno({ barras, tempo }: { barras: Barra[]; tempo: TempoDaLinha }) {
  return (
    <span className="flex items-end gap-2.5">
      <HistoricoPequeno barras={barras} />
      <span className="text-xs leading-snug">
        <strong className={cn(tempo.alerta && 'text-lm-alerta')}>{tempo.dias}</strong> {tempo.em}
        <br />
        {tempo.normalCurto}
      </span>
    </span>
  );
}

/**
 * O CARTÃO COMPLETO da fila (spec §4.3): prazo, responsável, a ação como título, projeto/titular/
 * concessionária, o porquê em primeira pessoa, o histórico pequeno e o botão principal. Clicar no
 * cartão abre o detalhe; o botão faz a ação (ou abre o detalhe, quando a decisão pede revisão).
 */
export function CartaoDaFila({ dados, aberto, onAbrir, onBotao }: {
  dados: DadosDoCartao; aberto: boolean; onAbrir: () => void; onBotao: () => void;
}) {
  return (
    <article
      data-cartao={dados.chave}
      className={cn('flex flex-col gap-2.5 rounded-lg border bg-white p-4',
        aberto ? 'border-2 border-lm-petroleo p-[15px]' : 'border-lm-borda')}
    >
      <button
        type="button" onClick={onAbrir} data-abrir={dados.chave} aria-current={aberto ? 'true' : undefined}
        className="flex flex-col gap-1.5 rounded text-left"
      >
        <span className="flex flex-wrap items-center justify-between gap-2">
          <Chip tom={TOM_DO_PRAZO[dados.prazo.tom]}>{dados.prazo.texto}</Chip>
          <Donos donos={dados.donos} />
        </span>
        <span className="text-base font-extrabold">{dados.titulo}</span>
        <span className="text-[13px] text-lm-suave">{dados.projeto}</span>
        {dados.porque && <span className="text-sm leading-normal">{dados.porque}</span>}
      </button>
      <div className="flex flex-wrap items-end justify-between gap-3">
        {dados.barras && dados.tempo ? <TempoPequeno barras={dados.barras} tempo={dados.tempo} /> : <span />}
        <Button type="button" onClick={onBotao} className="w-full font-bold sm:w-auto">{dados.botao.rotulo}</Button>
      </div>
    </article>
  );
}
