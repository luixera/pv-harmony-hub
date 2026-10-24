import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ChipDaConta, TomDaSaude } from '@/lib/ludmillaPainel';
import { cn } from '@/lib/utils';
import { ICONE_DO_MEIO, NOME_DO_MEIO } from '@/components/ludmilla/decidir/visual';

const COR_DO_PONTO: Record<TomDaSaude, string> = {
  ok: 'bg-emerald-500', atencao: 'bg-amber-500', erro: 'bg-red-500', parada: 'bg-slate-400',
};

/**
 * A FAIXA DE SAÚDE (spec §3.1): um chip por concessionária. Clicar filtra a lista;
 * o botão ao lado faz "Verificar agora". No celular a faixa rola de lado.
 *
 * A saúde vai por TEXTO além da cor (leitor de tela e `title`): o ponto sozinho não diz
 * "sessão expirada" nem "estação offline".
 *
 * A faixa é `relative` DE PROPÓSITO: o `sr-only` é `position: absolute` e, sem um pai posicionado, escapa
 * do `overflow-x-auto`; os textos dos chips que rolam para fora da tela alargavam a PÁGINA inteira (no
 * celular ela passava a rolar de lado). Com o pai `relative` o rolável corta o que é dele.
 */
export function FaixaDeSaude({ chips, contaId, onFiltrar, onVerificar, verificando }: {
  chips: ChipDaConta[];
  contaId: string | null;
  onFiltrar: (id: string | null) => void;
  onVerificar: (chip: ChipDaConta) => void;
  verificando: boolean;
}) {
  return (
    <div data-teste="faixa" role="toolbar" aria-label="Concessionárias"
      className="relative flex gap-2 overflow-x-auto p-0.5 sm:flex-wrap sm:overflow-visible">
      <Button size="sm" className="shrink-0" variant={contaId === null ? 'default' : 'outline'}
        aria-pressed={contaId === null} onClick={() => onFiltrar(null)}>Todas</Button>
      {chips.map(c => {
        const Icone = ICONE_DO_MEIO[c.meio];
        const ativo = c.id === contaId;
        return (
          <div key={c.id} data-chip={c.id} className={cn('flex shrink-0 items-stretch rounded-lg border bg-card', ativo && 'ring-2 ring-primary/50')}>
            <button type="button" onClick={() => onFiltrar(ativo ? null : c.id)} aria-pressed={ativo}
              title={`${c.nome}: ${c.saude.texto}`} className="flex items-center gap-2 px-3 py-1.5 text-left text-sm">
              <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', COR_DO_PONTO[c.saude.tom])} aria-hidden />
              <span className="sr-only">{c.saude.texto}, por {NOME_DO_MEIO[c.meio]}: </span>
              <span className="whitespace-nowrap font-medium">{c.nome}</span>
              <Icone size={13} className="text-muted-foreground" aria-hidden />
              <span className="whitespace-nowrap text-xs text-muted-foreground">{c.lida}</span>
              {c.pendentes > 0 && (
                <span className="rounded-full bg-primary px-1.5 text-[11px] font-semibold tabular-nums text-primary-foreground">
                  {c.pendentes}<span className="sr-only"> pendentes</span>
                </span>
              )}
            </button>
            <button type="button" onClick={() => onVerificar(c)} disabled={!c.podeVerificar || verificando}
              aria-label={`Verificar agora: ${c.nome}`} title="Verificar agora"
              className="flex min-w-[44px] items-center justify-center border-l text-muted-foreground hover:text-foreground disabled:opacity-40">
              <RefreshCw size={14} aria-hidden />
            </button>
          </div>
        );
      })}
    </div>
  );
}
