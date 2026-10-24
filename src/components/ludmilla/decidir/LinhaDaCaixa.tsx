import type { ItemDaCaixa } from '@/lib/ludmillaCaixa';
import { haQuantoTempo } from '@/lib/ludmillaPainel';
import { cn } from '@/lib/utils';
import { COR_DO_SELO, ICONE_DO_MEIO, NOME_DO_MEIO } from './visual';

/** A linha compacta (spec §3.2): meio, código, concessionária, há quanto tempo, titular, empresa e selos. */
export function LinhaDaCaixa({ item, ativa, agora, onAbrir }: {
  item: ItemDaCaixa; ativa: boolean; agora: number; onAbrir: () => void;
}) {
  const Icone = ICONE_DO_MEIO[item.meio];
  return (
    <button
      type="button" onClick={onAbrir} data-linha={item.chave} aria-current={ativa ? 'true' : undefined}
      className={cn(
        'flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/50',
        ativa && 'bg-primary/5 ring-1 ring-inset ring-primary/30',
        item.situacao !== 'pendente' && 'opacity-70',
      )}
    >
      <Icone size={16} className="mt-0.5 shrink-0 text-muted-foreground" aria-label={NOME_DO_MEIO[item.meio]} />
      <span className="min-w-0 flex-1 space-y-1">
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-sm font-semibold">{item.codigo ?? 'Sem projeto casado'}</span>
          <span className="text-xs text-muted-foreground">{item.concessionaria}</span>
          <span className="ml-auto whitespace-nowrap text-xs text-muted-foreground">{haQuantoTempo(item.quando, agora)}</span>
        </span>
        <span className="block truncate text-sm">
          {item.titular ?? '—'}
          <span className="text-muted-foreground"> · {item.empresa ?? '—'}</span>
        </span>
        <span className="flex flex-wrap gap-1">
          {item.selos.map(s => (
            <span key={s.texto} className={cn('whitespace-nowrap rounded px-1.5 py-0.5 text-[11px]', COR_DO_SELO[s.tom])}>{s.texto}</span>
          ))}
        </span>
      </span>
    </button>
  );
}
