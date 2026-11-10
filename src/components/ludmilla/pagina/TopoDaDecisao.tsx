import { Chip, Donos, TOM_DO_PRAZO } from '@/components/ludmilla/mundo/pecas';
import type { DonoDoProjeto } from '@/lib/ludmillaCarteira';
import type { TomDoPrazo } from '@/lib/ludmillaFila';

/**
 * O topo do detalhe (spec §4.4): chip do prazo e responsável · a ação como título · projeto, titular,
 * empresa e concessionária · "Abrir o projeto". "Passar para outra pessoa" fica para depois (precisa
 * de coluna nova no banco).
 */
export function TopoDaDecisao({ prazo, donos, titulo, projeto, projectId, onAbrirProjeto }: {
  prazo: { texto: string; tom: TomDoPrazo };
  donos: DonoDoProjeto[];
  titulo: string;
  projeto: string;
  projectId: string | null;
  onAbrirProjeto: (projectId: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="flex flex-wrap items-center gap-2">
        <Chip tom={TOM_DO_PRAZO[prazo.tom]}>{prazo.texto}</Chip>
        <Donos donos={donos} />
      </span>
      <h2 className="m-0 text-[21px] font-extrabold leading-tight">{titulo}</h2>
      <p className="m-0 text-[13px] text-lm-suave">{projeto}</p>
      {projectId && (
        <button
          type="button" onClick={() => onAbrirProjeto(projectId)}
          className="self-start text-[13px] font-bold underline underline-offset-4 hover:text-lm-alerta"
        >
          Abrir o projeto
        </button>
      )}
    </div>
  );
}
