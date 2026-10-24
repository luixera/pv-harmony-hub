import { Building2, FilePlus2, Inbox, ScrollText, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export type AbaDaLudmilla = 'decidir' | 'concessionarias' | 'criacoes' | 'registro';

export const ABAS_DA_LUDMILLA: { valor: AbaDaLudmilla; rotulo: string; rotuloCurto: string; icone: LucideIcon }[] = [
  { valor: 'decidir', rotulo: 'Decidir', rotuloCurto: 'Decidir', icone: Inbox },
  { valor: 'concessionarias', rotulo: 'Concessionárias', rotuloCurto: 'Contas', icone: Building2 },
  { valor: 'criacoes', rotulo: 'Criações na CPFL', rotuloCurto: 'Criações', icone: FilePlus2 },
  { valor: 'registro', rotulo: 'Registro', rotuloCurto: 'Registro', icone: ScrollText },
];

/**
 * As abas no celular (spec §3.4): uma barra NO TOPO, não embaixo — decisão do usuário
 * (22/10/2026): embaixo já existe a barra de atalhos do app (`BottomNav`), e duas barras
 * empilhadas confundem. Só o celular usa; no computador a página usa as abas do shadcn.
 *
 * Fica logo abaixo da barra do topo do app (`Topbar`: sticky, `h-14` no celular) e gruda ali
 * enquanto a página rola. Onde o pai tem `overflow: hidden` o sticky não gruda e a barra
 * simplesmente fica no fluxo, no mesmo lugar: nada quebra. Quem usa deve pôr a barra ANTES do
 * conteúdo das abas.
 */
export function BarraDeAbas({ ativa, onTrocar, contadores }: {
  ativa: AbaDaLudmilla;
  onTrocar: (a: AbaDaLudmilla) => void;
  contadores: Partial<Record<AbaDaLudmilla, number>>;
}) {
  return (
    <nav aria-label="Abas da Ludmilla" data-teste="barra-de-abas"
      className="sticky top-14 z-20 grid grid-cols-4 gap-1 rounded-xl bg-muted p-1 shadow-sm">
      {ABAS_DA_LUDMILLA.map(a => {
        const Icone = a.icone;
        const ligada = a.valor === ativa;
        const n = contadores[a.valor] ?? 0;
        return (
          <button key={a.valor} type="button" onClick={() => onTrocar(a.valor)} aria-current={ligada ? 'page' : undefined}
            title={a.rotulo}
            className={cn('relative flex flex-col items-center justify-center gap-0.5 rounded-lg px-1 py-1.5 text-[11px] transition-colors',
              ligada ? 'bg-card font-semibold text-foreground shadow-sm' : 'text-muted-foreground')}>
            <Icone size={18} aria-hidden />
            <span className="max-w-full truncate">{a.rotuloCurto}</span>
            {n > 0 && (
              <>
                <span aria-hidden className="absolute right-1 top-0.5 min-w-[1.1rem] rounded-full bg-primary px-1 text-center text-[10px] font-semibold leading-4 tabular-nums text-primary-foreground">
                  {n > 99 ? '99+' : n}
                </span>
                <span className="sr-only">, {n} pendentes</span>
              </>
            )}
          </button>
        );
      })}
    </nav>
  );
}
