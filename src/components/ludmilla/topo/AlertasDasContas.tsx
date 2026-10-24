import { AlertTriangle } from 'lucide-react';
import type { AlertaUrgente } from '@/lib/ludmillaPainel';
import { cn } from '@/lib/utils';

/**
 * Alertas urgentes (spec §3.1), só quando existem, acima de tudo (o código da imagem vem à parte).
 * A ordem é a de `alertasDasContas` (erro, sessão expirada, caixa de e-mail): aqui só se mostra.
 */
export function AlertasDasContas({ alertas }: { alertas: AlertaUrgente[] }) {
  if (alertas.length === 0) return null;
  return (
    <div data-teste="alertas" className="space-y-2">
      {alertas.map(a => (
        <div key={a.chave} role="alert" className={cn('flex items-start gap-2 rounded-xl border-2 p-3 text-sm',
          a.tom === 'erro' ? 'border-red-300 bg-red-50 text-red-900' : 'border-amber-300 bg-amber-50 text-amber-900')}>
          <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />
          <div className="min-w-0">
            <b>{a.titulo}</b>
            {a.detalhe && <p className="mt-0.5 break-words text-xs">{a.detalhe}</p>}
          </div>
        </div>
      ))}
    </div>
  );
}
