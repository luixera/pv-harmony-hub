import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ChipDaConta, TomDaSaude } from '@/lib/ludmillaPainel';
import { cn } from '@/lib/utils';
import { ICONE_DO_MEIO, NOME_DO_MEIO } from '@/components/ludmilla/decidir/visual';
import { palavraDaSaude } from './saude';

// Tons 600/500: o ponto precisa de pelo menos 3:1 sobre o branco do chip (emerald/amber/slate-400 não chegavam).
const COR_DO_PONTO: Record<TomDaSaude, string> = {
  ok: 'bg-emerald-600', atencao: 'bg-amber-600', erro: 'bg-red-500', parada: 'bg-slate-500',
};
const COR_DA_PALAVRA: Record<TomDaSaude, string> = {
  ok: 'text-muted-foreground', atencao: 'text-amber-700', erro: 'text-red-700', parada: 'text-slate-600',
};

/**
 * A FAIXA DE SAÚDE (spec §3.1): um chip por concessionária. Clicar filtra a lista;
 * o botão ao lado faz "Verificar agora". No celular a faixa rola de lado.
 *
 * A saúde não vai só na cor do ponto: quando a conta não está em dia o chip mostra uma palavra
 * curta ("com erro", "offline"), visível também no celular (que não tem `title`); o leitor de tela
 * ouve o texto completo uma vez só ("CPFL Paulista, portal, com erro"), e a palavra visível fica
 * `aria-hidden` para não repetir.
 *
 * A faixa é `relative` DE PROPÓSITO: o `sr-only` é `position: absolute` e, sem um pai posicionado, escapa
 * do `overflow-x-auto`; os textos dos chips que rolam para fora da tela alargavam a PÁGINA inteira (no
 * celular ela passava a rolar de lado). Com o pai `relative` o rolável corta o que é dele.
 *
 * É um grupo, não uma `toolbar`: não há navegação por setas, e `toolbar` promete isso.
 */
export function FaixaDeSaude({ chips, contaId, onFiltrar, onVerificar, verificando }: {
  chips: ChipDaConta[];
  contaId: string | null;
  onFiltrar: (id: string | null) => void;
  onVerificar: (chip: ChipDaConta) => void;
  verificando: boolean;
}) {
  return (
    <div data-teste="faixa" role="group" aria-label="Concessionárias"
      className="relative flex gap-2 overflow-x-auto p-0.5 sm:flex-wrap sm:overflow-visible">
      <Button size="sm" className="shrink-0" variant={contaId === null ? 'default' : 'outline'}
        aria-pressed={contaId === null} onClick={() => onFiltrar(null)}>Todas</Button>
      {chips.map(c => {
        const Icone = ICONE_DO_MEIO[c.meio];
        const ativo = c.id === contaId;
        const palavra = palavraDaSaude(c.saude);
        return (
          <div key={c.id} data-chip={c.id}
            className={cn('flex shrink-0 items-stretch rounded-lg border bg-card', ativo && 'border-primary bg-primary/10 ring-2 ring-primary')}>
            <button type="button" onClick={() => onFiltrar(ativo ? null : c.id)} aria-pressed={ativo}
              title={ativo ? `Tirar o filtro de ${c.nome}` : `Filtrar a lista por ${c.nome}`}
              className="flex items-center gap-2 px-3 py-1.5 text-left text-sm">
              <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', COR_DO_PONTO[c.saude.tom])} aria-hidden />
              <span className="whitespace-nowrap font-medium">
                {c.nome}<span className="sr-only">, {NOME_DO_MEIO[c.meio]}, {c.saude.texto}.</span>
              </span>
              <Icone size={13} className="text-muted-foreground" aria-hidden />
              <span className="whitespace-nowrap text-xs text-muted-foreground">{c.lida}</span>
              {palavra && (
                <span aria-hidden title={palavra !== c.saude.texto ? c.saude.texto : undefined}
                  className={cn('whitespace-nowrap text-xs font-medium', COR_DA_PALAVRA[c.saude.tom])}>{palavra}</span>
              )}
              {c.pendentes > 0 && (
                <span className="rounded-full bg-primary px-1.5 text-[11px] font-semibold tabular-nums text-primary-foreground">
                  {c.pendentes}<span className="sr-only"> pendentes</span>
                </span>
              )}
            </button>
            <button type="button" onClick={() => onVerificar(c)} disabled={!c.podeVerificar || verificando}
              aria-label={`Verificar agora: ${c.nome}`} title="Verificar agora"
              className="flex min-w-12 items-center justify-center border-l text-muted-foreground hover:text-foreground disabled:opacity-40">
              <RefreshCw size={14} aria-hidden />
            </button>
          </div>
        );
      })}
    </div>
  );
}
