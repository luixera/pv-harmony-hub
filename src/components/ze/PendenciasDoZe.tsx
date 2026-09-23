import { motion } from 'framer-motion';
import { AlertTriangle, Check, X, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useZePendencias, useResolverPendencia } from '@/hooks/useZe';

/**
 * AÇÕES QUE ESPERAM SEU "SIM".
 *
 * Hoje só mover etapa. O Zé nunca move um card sozinho: ele propõe, pergunta,
 * e o card só anda quando o gestor confirma — aqui ou pelo WhatsApp. Confirmar
 * pelos dois caminhos resolve a mesma linha, e o histórico do projeto registra
 * o gestor como autor, com "(via Zé)" na assinatura.
 */

const horasAte = (iso: string) => {
  const h = Math.round((new Date(iso).getTime() - Date.now()) / 3600_000);
  return h <= 0 ? 'expirando' : h === 1 ? 'expira em 1h' : `expira em ${h}h`;
};

export function PendenciasDoZe() {
  const { data: pendencias = [], isLoading } = useZePendencias();
  const resolver = useResolverPendencia();

  if (isLoading || pendencias.length === 0) return null;

  return (
    <div className="space-y-3">
      {pendencias.map(p => (
        <motion.div
          key={p.id}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-xl border-2 border-amber-300 bg-amber-50 p-4"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-gray-900">O Zé quer {p.resumo}</p>
              {typeof p.payload?.motivo === 'string' && p.payload.motivo && (
                <p className="mt-0.5 text-xs text-gray-600">Motivo: {String(p.payload.motivo)}</p>
              )}
              <p className="mt-1 text-[11px] text-amber-700">{horasAte(p.expira_em)}</p>
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <Button
              size="sm" className="bg-amber-600 hover:bg-amber-700"
              onClick={() => resolver.mutate({ id: p.id, confirmar: true })}
              disabled={resolver.isPending}
            >
              {resolver.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1 h-3.5 w-3.5" />}
              Pode mover
            </Button>
            <Button
              size="sm" variant="outline"
              onClick={() => resolver.mutate({ id: p.id, confirmar: false })}
              disabled={resolver.isPending}
            >
              <X className="mr-1 h-3.5 w-3.5" /> Não
            </Button>
          </div>
        </motion.div>
      ))}
    </div>
  );
}
