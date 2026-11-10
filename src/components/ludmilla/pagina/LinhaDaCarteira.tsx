import { cn } from '@/lib/utils';
import type { Barra } from '@/lib/ludmillaBarras';
import { ROTULO_COM_QUEM, type ComQuem, type DonoDoProjeto, type TempoDaLinha } from '@/lib/ludmillaCarteira';
import { Chip, Donos, TOM_DO_COM_QUEM } from '@/components/ludmilla/mundo/pecas';
import { TempoPequeno } from './CartaoDaFila';

export interface DadosDaLinha {
  projectId: string;
  codigo: string;
  titular: string | null;
  concessionaria: string | null;
  barras: Barra[];
  tempo: TempoDaLinha;
  comQuem: ComQuem;
  donos: DonoDoProjeto[];
}

/**
 * Uma linha da carteira (spec §4.3): código e titular, concessionária, histórico pequeno com o
 * tempo e o normal, com quem está e o responsável. Duas colunas em qualquer largura: a lista do meio
 * tem de 380 a 700 px conforme a tela.
 */
export function LinhaDaCarteira({ dados, aberta, onAbrir }: { dados: DadosDaLinha; aberta: boolean; onAbrir: () => void }) {
  return (
    <button
      type="button" onClick={onAbrir} aria-current={aberta ? 'true' : undefined} data-linha-carteira={dados.projectId}
      className={cn('grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2.5 rounded-lg border bg-white px-3.5 py-3 text-left',
        aberta ? 'border-2 border-lm-petroleo px-[13px] py-[11px]' : 'border-lm-borda')}
    >
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-extrabold">{dados.codigo}</span>
        <span className="truncate text-[13px] text-lm-suave">{dados.titular ?? '—'}</span>
      </span>
      <span className="text-right text-[13px] font-semibold">{dados.concessionaria ?? '—'}</span>
      <TempoPequeno barras={dados.barras} tempo={dados.tempo} />
      <span className="flex flex-col items-end gap-1">
        <Chip tom={TOM_DO_COM_QUEM[dados.comQuem]}>{ROTULO_COM_QUEM[dados.comQuem]}</Chip>
        <Donos donos={dados.donos} />
      </span>
    </button>
  );
}
