import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, CheckCircle2, RotateCcw } from 'lucide-react';
import { useBatchSettle, useBatchReverse } from '@/hooks/usePaymentHistory';
import { formatCurrency } from '@/lib/utils';

interface BatchProject {
  id: string;
  code: string;
  holderName: string;
  balance: number;
  paidValue: number;
}

interface BatchSettleDialogProps {
  mode: 'settle' | 'reverse';
  projects: BatchProject[];
  onClose: () => void;
  onDone: () => void;
}

const fmt = formatCurrency;

export function BatchSettleDialog({ mode, projects, onClose, onDone }: BatchSettleDialogProps) {
  const settle = useBatchSettle();
  const reverse = useBatchReverse();

  const [payDate, setPayDate] = useState(new Date().toISOString().split('T')[0]);
  const [note, setNote] = useState('');

  const isSettle = mode === 'settle';
  const totalSettle = projects.reduce((s, p) => s + p.balance, 0);
  const totalReverse = projects.reduce((s, p) => s + p.paidValue, 0);
  const pending = settle.isPending || reverse.isPending;

  const handleConfirm = async () => {
    const ids = projects.map(p => p.id);
    if (isSettle) {
      await settle.mutateAsync({ projectIds: ids, paymentDate: payDate, notes: note || undefined });
    } else {
      await reverse.mutateAsync({ projectIds: ids, reason: note || undefined });
    }
    onDone();
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isSettle
              ? <><CheckCircle2 className="w-5 h-5 text-emerald-600" /> Quitação rápida</>
              : <><RotateCcw className="w-5 h-5 text-destructive" /> Estorno de quitação</>}
          </DialogTitle>
          <DialogDescription>
            {isSettle
              ? `Registra o pagamento do saldo em aberto de ${projects.length} projeto(s), aplicando a mesma data e observação a todos.`
              : `Reverte todos os pagamentos ativos de ${projects.length} projeto(s). O saldo volta a ficar em aberto.`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {/* Regras de pagamento comuns */}
          {isSettle && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Data do pagamento</Label>
                <Input type="date" value={payDate} onChange={e => setPayDate(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Observação (opcional)</Label>
                <Input value={note} onChange={e => setNote(e.target.value)} placeholder="Ex: PIX em lote" />
              </div>
            </div>
          )}
          {!isSettle && (
            <div className="space-y-1.5">
              <Label className="text-xs">Motivo do estorno (opcional)</Label>
              <Input value={note} onChange={e => setNote(e.target.value)} placeholder="Ex: pagamento não compensado" />
            </div>
          )}

          {/* Resumo */}
          <div className="rounded-lg border bg-muted/40 p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-muted-foreground">
                {isSettle ? 'Total a quitar' : 'Total a estornar'}
              </span>
              <span className={`text-sm font-bold ${isSettle ? 'text-emerald-600' : 'text-destructive'}`}>
                {fmt(isSettle ? totalSettle : totalReverse)}
              </span>
            </div>
            <div className="max-h-40 overflow-y-auto space-y-1">
              {projects.map(p => (
                <div key={p.id} className="flex items-center justify-between text-xs">
                  <span className="font-mono text-foreground truncate mr-2">{p.code}</span>
                  <span className="text-muted-foreground truncate flex-1">{p.holderName}</span>
                  <span className={`font-medium flex-shrink-0 ${isSettle ? 'text-emerald-600' : 'text-destructive'}`}>
                    {fmt(isSettle ? p.balance : p.paidValue)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={onClose} disabled={pending}>Cancelar</Button>
          <Button
            onClick={handleConfirm}
            disabled={pending || projects.length === 0}
            className={isSettle ? 'bg-emerald-600 hover:bg-emerald-700 text-white' : 'bg-destructive hover:bg-destructive/90 text-white'}
          >
            {pending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {isSettle ? `Quitar ${projects.length} projeto(s)` : `Estornar ${projects.length} projeto(s)`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
