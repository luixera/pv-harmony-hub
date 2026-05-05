import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { DollarSign, Plus, Calendar, History, Loader2 } from "lucide-react";
import { Financial, FinancialPayment, useUpsertFinancial, useAddPayment, useFinancialPayments } from "@/hooks/useFinancials";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";

interface ProjectFinancialCardProps {
  projectId: string;
  companyId: string;
  financial: Financial | null;
  isAdmin: boolean;
}

const formatCurrency = (value: number) => {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format(value);
};

const statusLabels: Record<string, string> = {
  pending: 'Pendente',
  partial: 'Parcialmente Pago',
  paid: 'Pago'
};

const statusColors: Record<string, string> = {
  pending: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
  partial: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
  paid: 'bg-green-500/10 text-green-500 border-green-500/20'
};

export function ProjectFinancialCard({ projectId, companyId, financial, isAdmin }: ProjectFinancialCardProps) {
  const [projectValue, setProjectValue] = useState(financial?.project_value?.toString() || '');
  const [dueDate, setDueDate] = useState(financial?.due_date || '');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().split('T')[0]);
  const [paymentNotes, setPaymentNotes] = useState('');
  const [isPaymentDialogOpen, setIsPaymentDialogOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  
  const upsertFinancial = useUpsertFinancial();
  const addPayment = useAddPayment();
  const { data: payments = [] } = useFinancialPayments(financial?.id);

  const pendingAmount = financial 
    ? financial.project_value - financial.amount_paid 
    : 0;

  const handleSaveFinancial = async () => {
    if (!projectValue || Number(projectValue) <= 0) {
      toast.error("Informe um valor válido para o projeto");
      return;
    }
    
    setIsSaving(true);
    try {
      await upsertFinancial.mutateAsync({
        projectId,
        companyId,
        projectValue: Number(projectValue),
        dueDate: dueDate || null
      });
      toast.success("Dados financeiros salvos com sucesso");
    } catch (error) {
      toast.error("Erro ao salvar dados financeiros");
      console.error(error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddPayment = async () => {
    if (!financial?.id) {
      toast.error("Salve os dados financeiros primeiro");
      return;
    }
    
    if (!paymentAmount || Number(paymentAmount) <= 0) {
      toast.error("Informe um valor válido");
      return;
    }
    
    if (Number(paymentAmount) > pendingAmount) {
      toast.error("O valor do pagamento não pode ser maior que o saldo em aberto");
      return;
    }
    
    try {
      await addPayment.mutateAsync({
        financialId: financial.id,
        paymentDate,
        amount: Number(paymentAmount),
        notes: paymentNotes || undefined
      });
      toast.success("Pagamento registrado com sucesso");
      setPaymentAmount('');
      setPaymentNotes('');
      setIsPaymentDialogOpen(false);
    } catch (error) {
      toast.error("Erro ao registrar pagamento");
      console.error(error);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <DollarSign className="h-5 w-5" />
          Financeiro
        </CardTitle>
        {financial && (
          <Badge variant="outline" className={statusColors[financial.status]}>
            {statusLabels[financial.status]}
          </Badge>
        )}
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Summary */}
        {financial && (
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center p-3 bg-muted/50 rounded-lg">
              <p className="text-xs text-muted-foreground">Valor do Projeto</p>
              <p className="text-lg font-bold">{formatCurrency(financial.project_value)}</p>
            </div>
            <div className="text-center p-3 bg-green-500/10 rounded-lg">
              <p className="text-xs text-muted-foreground">Total Pago</p>
              <p className="text-lg font-bold text-green-600">{formatCurrency(financial.amount_paid)}</p>
            </div>
            <div className="text-center p-3 bg-yellow-500/10 rounded-lg">
              <p className="text-xs text-muted-foreground">Saldo Restante</p>
              <p className="text-lg font-bold text-yellow-600">{formatCurrency(pendingAmount)}</p>
            </div>
          </div>
        )}

        {/* Admin Form */}
        {isAdmin && (
          <>
            <Separator />
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="projectValue">Valor do Projeto (R$)</Label>
                  <Input
                    id="projectValue"
                    type="number"
                    step="0.01"
                    min="0"
                    value={projectValue}
                    onChange={(e) => setProjectValue(e.target.value)}
                    placeholder="0,00"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="dueDate">Data de Vencimento</Label>
                  <Input
                    id="dueDate"
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                  />
                </div>
              </div>
              
              <div className="flex gap-2">
                <Button onClick={handleSaveFinancial} disabled={isSaving}>
                  {isSaving ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Salvando...
                    </>
                  ) : (
                    'Salvar Dados Financeiros'
                  )}
                </Button>
                
                {financial && financial.status !== 'paid' && (
                  <Dialog open={isPaymentDialogOpen} onOpenChange={setIsPaymentDialogOpen}>
                    <DialogTrigger asChild>
                      <Button variant="outline">
                        <Plus className="h-4 w-4 mr-2" />
                        Registrar Pagamento
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Registrar Pagamento</DialogTitle>
                      </DialogHeader>
                      <div className="space-y-4 py-4">
                        <div className="p-3 bg-muted/50 rounded-lg text-center">
                          <p className="text-sm text-muted-foreground">Saldo em Aberto</p>
                          <p className="text-xl font-bold">{formatCurrency(pendingAmount)}</p>
                        </div>
                        
                        <div className="space-y-2">
                          <Label htmlFor="paymentAmount">Valor do Pagamento (R$)</Label>
                          <Input
                            id="paymentAmount"
                            type="number"
                            step="0.01"
                            min="0"
                            max={pendingAmount}
                            value={paymentAmount}
                            onChange={(e) => setPaymentAmount(e.target.value)}
                            placeholder="0,00"
                          />
                        </div>
                        
                        <div className="space-y-2">
                          <Label htmlFor="paymentDate">Data do Pagamento</Label>
                          <Input
                            id="paymentDate"
                            type="date"
                            value={paymentDate}
                            onChange={(e) => setPaymentDate(e.target.value)}
                          />
                        </div>
                        
                        <div className="space-y-2">
                          <Label htmlFor="paymentNotes">Observação (opcional)</Label>
                          <Textarea
                            id="paymentNotes"
                            value={paymentNotes}
                            onChange={(e) => setPaymentNotes(e.target.value)}
                            placeholder="Ex: Pagamento via PIX"
                            rows={2}
                          />
                        </div>
                        
                        <Button 
                          className="w-full" 
                          onClick={handleAddPayment}
                          disabled={addPayment.isPending}
                        >
                          {addPayment.isPending ? (
                            <>
                              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                              Registrando...
                            </>
                          ) : (
                            'Confirmar Pagamento'
                          )}
                        </Button>
                      </div>
                    </DialogContent>
                  </Dialog>
                )}
              </div>
            </div>
          </>
        )}

        {/* Payment History */}
        {payments.length > 0 && (
          <>
            <Separator />
            <div className="space-y-3">
              <h4 className="font-medium flex items-center gap-2">
                <History className="h-4 w-4" />
                Histórico de Pagamentos
              </h4>
              <div className="space-y-2">
                {payments.map(payment => (
                  <div 
                    key={payment.id} 
                    className="flex items-center justify-between p-3 bg-muted/30 rounded-lg"
                  >
                    <div className="flex items-center gap-3">
                      <Calendar className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <p className="font-medium">
                          {format(new Date(payment.payment_date), 'dd/MM/yyyy', { locale: ptBR })}
                        </p>
                        {payment.notes && (
                          <p className="text-xs text-muted-foreground">{payment.notes}</p>
                        )}
                      </div>
                    </div>
                    <span className="font-bold text-green-600">
                      {formatCurrency(payment.amount)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Due Date Info */}
        {financial?.due_date && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Calendar className="h-4 w-4" />
            <span>Vencimento: {format(new Date(financial.due_date), 'dd/MM/yyyy', { locale: ptBR })}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
