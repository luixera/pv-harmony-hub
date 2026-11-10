import type { ReactNode } from 'react';
import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ComQuem, DonoDoProjeto } from '@/lib/ludmillaCarteira';
import { primeiroNome, type TomDoPrazo } from '@/lib/ludmillaFila';

/** As peças pequenas do mundo "Conta de luz" (mockup: `.chip`, `.who`, o esqueleto e o aviso de falha). */

export type TomDoChip = 'alerta' | 'sol' | 'caixa' | 'ok' | 'azul';

/** Todas as combinações passam 4,5:1 (texto escuro sobre fundo claro). */
const COR_DO_CHIP: Record<TomDoChip, string> = {
  alerta: 'bg-lm-alerta-fundo text-lm-alerta-texto',
  sol: 'bg-lm-sol-fundo text-lm-sol-texto',
  caixa: 'bg-lm-caixa text-lm-petroleo',
  ok: 'bg-lm-ok-fundo text-lm-ok-texto',
  azul: 'bg-lm-azul-fundo text-lm-azul-texto',
};

export const TOM_DO_PRAZO: Record<TomDoPrazo, TomDoChip> = { alerta: 'alerta', sol: 'sol', caixa: 'caixa' };
export const TOM_DO_COM_QUEM: Record<ComQuem, TomDoChip> = { nos: 'sol', concessionaria: 'azul', cliente: 'caixa' };

export function Chip({ tom, children }: { tom: TomDoChip; children: ReactNode }) {
  return (
    <span className={cn('inline-flex items-center whitespace-nowrap rounded px-2 py-0.5 text-xs font-bold', COR_DO_CHIP[tom])}>
      {children}
    </span>
  );
}

/** O responsável (spec §6.2): a inicial num círculo e o primeiro nome; sem nenhum, "Sem dono" em alerta. */
export function Donos({ donos }: { donos: DonoDoProjeto[] }) {
  if (donos.length === 0) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-lm-alerta-texto">
        <span aria-hidden className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-lm-alerta text-[11px] text-white">!</span>
        Sem dono
      </span>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2 text-xs font-semibold">
      {donos.map(d => (
        <span key={d.id} className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-lm-petroleo text-[11px] text-white">
            {primeiroNome(d.nome).charAt(0).toUpperCase()}
          </span>
          {primeiroNome(d.nome)}
        </span>
      ))}
    </span>
  );
}

/** O lugar do que ainda carrega (spec §4.6). Sem animação para quem pediu menos movimento. */
export function Esqueleto({ linhas = 3, rotulo }: { linhas?: number; rotulo: string }) {
  return (
    <div role="status" aria-label={rotulo} className="flex flex-col gap-3">
      {Array.from({ length: linhas }, (_, i) => (
        <div key={i} className="h-20 animate-pulse rounded-lg bg-lm-caixa motion-reduce:animate-none" />
      ))}
    </div>
  );
}

/** Uma fonte que não carregou: diz o quê, e o resto da página continua (spec §4.6). */
export function AvisoDeFalha({ oQue, detalhe, buscando, onTentar }: {
  oQue: string; detalhe?: string | null; buscando?: boolean; onTentar?: () => void;
}) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border-2 border-lm-alerta bg-lm-alerta-fundo p-4 text-sm text-lm-alerta-texto">
      <AlertTriangle size={18} className="shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        <b>Não consegui carregar {oQue}.</b> A consulta falhou: isto não quer dizer que não haja nada.
        {detalhe && <span className="mt-0.5 block break-words text-xs">{detalhe}</span>}
      </div>
      {onTentar && (
        <Button type="button" size="sm" variant="outline" className="gap-2" disabled={buscando} onClick={onTentar}>
          {buscando ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <RefreshCw size={14} aria-hidden />} Tentar de novo
        </Button>
      )}
    </div>
  );
}
