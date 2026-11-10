import { cn } from '@/lib/utils';
import { descricaoDasBarras, type Barra, type TomDaBarra } from '@/lib/ludmillaBarras';
import { MUNDO } from './cores';

/**
 * O HISTÓRICO EM BARRAS, o traço marcante do mundo (spec §3): pequeno no cartão e na linha da
 * carteira, grande no detalhe e na ficha. Só desenha o que `barrasDoHistorico` decidiu; o desenho é
 * `aria-hidden` e o leitor de tela ouve `descricaoDasBarras`.
 */

const COR: Record<TomDaBarra, string> = { passada: MUNDO.barra, atual: MUNDO.sol, alem: MUNDO.alerta, futura: MUNDO.caixa };

/** Na grande, a barra em alerta é sol até o traço e alerta acima dele (mockup "Mundo"). */
function fundoGrande(b: Barra): string {
  if (b.tom === 'alem' && b.cortePct !== null) {
    return `linear-gradient(to top, ${MUNDO.sol} 0 ${b.cortePct}%, ${MUNDO.alerta} ${b.cortePct}% 100%)`;
  }
  return COR[b.tom];
}

export function HistoricoPequeno({ barras }: { barras: Barra[] }) {
  return (
    <span aria-hidden className="flex h-9 shrink-0 items-end gap-[3px]" data-historico="pequeno">
      {barras.map(b => (
        <span
          key={b.etapa} data-barra={b.etapa} data-tom={b.tom} className="block w-[9px] rounded-t-sm"
          style={{ height: b.tom === 'futura' ? '6%' : `${Math.max(6, b.alturaPct)}%`, background: COR[b.tom] }}
        />
      ))}
    </span>
  );
}

export function HistoricoGrande({ barras, resumo, alerta, concessionaria }: {
  barras: Barra[];
  /** "14 dias em Troca, o normal na ENEL SP é até 7" */
  resumo: string;
  alerta: boolean;
  concessionaria: string | null;
}) {
  const colunas = { gridTemplateColumns: `repeat(${Math.max(1, barras.length)}, minmax(0, 1fr))` };
  return (
    <figure className="m-0 flex flex-col gap-1.5 rounded-lg border border-lm-borda px-3.5 py-3" data-historico="grande">
      <figcaption className="flex flex-wrap justify-between gap-x-2 gap-y-0.5 text-[13px]">
        <span className="font-bold">Histórico, em dias</span>
        <span className={cn('font-bold', alerta && 'text-lm-alerta')}>{resumo}</span>
      </figcaption>
      <div aria-hidden className="grid h-[120px] gap-2 border-b-2 border-lm-petroleo px-1" style={colunas}>
        {barras.map(b => {
          const altura = b.tom === 'futura' ? 3 : Math.max(4, b.alturaPct);
          return (
            <div key={b.etapa} className="relative h-full" data-barra={b.etapa} data-tom={b.tom}>
              <span
                className={cn('absolute inset-x-0 text-center text-xs font-bold',
                  b.tom === 'alem' && 'font-extrabold text-lm-alerta', b.tom === 'futura' && 'font-normal text-lm-suave')}
                style={{ bottom: `calc(${altura}% + 2px)` }}
              >
                {b.dias ?? '—'}
              </span>
              <span
                className="absolute bottom-0 left-1/2 block w-[26px] max-w-full -translate-x-1/2 rounded-t-sm"
                style={{ height: `${altura}%`, background: fundoGrande(b) }}
              />
              {b.normalPct !== null && (
                <span
                  data-traco
                  className="absolute left-1/2 block w-[38px] max-w-full -translate-x-1/2 border-t-2 border-lm-petroleo"
                  style={{ bottom: `${b.normalPct}%` }}
                />
              )}
            </div>
          );
        })}
      </div>
      <div aria-hidden className="grid gap-2 text-center text-[11px] font-semibold leading-tight text-lm-suave" style={colunas}>
        {barras.map(b => <span key={b.etapa} className="break-words">{b.rotulo}</span>)}
      </div>
      <p aria-hidden className="m-0 flex flex-wrap gap-x-4 gap-y-1 text-xs text-lm-suave">
        <span><span className="mr-1 inline-block w-4 border-t-2 border-lm-petroleo align-middle" />normal{concessionaria ? ` na ${concessionaria}` : ''}</span>
        <span><span className="mr-1 inline-block h-2.5 w-2.5 bg-lm-sol align-middle" />etapa atual</span>
        <span><span className="mr-1 inline-block h-2.5 w-2.5 bg-lm-alerta align-middle" />além do normal</span>
      </p>
      <p className="sr-only">{descricaoDasBarras(barras)}</p>
    </figure>
  );
}
