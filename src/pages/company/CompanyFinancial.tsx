import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/contexts/AuthContext";
import { useFinancialsByCompany } from "@/hooks/useFinancials";
import { useNavigate } from "react-router-dom";
import { DollarSign, TrendingUp, Clock, Calendar, Loader2 } from "lucide-react";
import { motion } from "framer-motion";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

const formatCurrency = (value: number) => {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format(value);
};

const statusLabels: Record<string, string> = {
  pending: 'Pendente',
  partial: 'Parcial',
  paid: 'Pago'
};

const statusColors: Record<string, string> = {
  pending: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
  partial: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
  paid: 'bg-green-500/10 text-green-500 border-green-500/20'
};

export default function CompanyFinancial() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data: financials = [], isLoading } = useFinancialsByCompany(user?.companyId);

  const summary = financials.reduce((acc, f) => {
    acc.totalBilled += f.project_value;
    acc.totalPaid += f.paid_value;
    acc.totalPending += f.project_value - f.paid_value;
    return acc;
  }, { totalBilled: 0, totalPaid: 0, totalPending: 0 });

  if (isLoading) {
    return (
      <MainLayout>
        <div className="flex items-center justify-center min-h-[400px]">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Meu Financeiro</h1>
          <p className="text-muted-foreground">
            Acompanhe seus valores e pagamentos
          </p>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0 }}
          >
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Total Contratado
                </CardTitle>
                <div className="p-2 rounded-lg bg-blue-500/10">
                  <DollarSign className="h-4 w-4 text-blue-500" />
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{formatCurrency(summary.totalBilled)}</div>
              </CardContent>
            </Card>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
          >
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Total Pago
                </CardTitle>
                <div className="p-2 rounded-lg bg-green-500/10">
                  <TrendingUp className="h-4 w-4 text-green-500" />
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-green-600">{formatCurrency(summary.totalPaid)}</div>
              </CardContent>
            </Card>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
          >
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Em Aberto
                </CardTitle>
                <div className="p-2 rounded-lg bg-yellow-500/10">
                  <Clock className="h-4 w-4 text-yellow-500" />
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-yellow-600">{formatCurrency(summary.totalPending)}</div>
              </CardContent>
            </Card>
          </motion.div>
        </div>

        {/* Projects Table */}
        <Card>
          <CardHeader>
            <CardTitle>Meus Projetos</CardTitle>
          </CardHeader>
          <CardContent>
            {financials.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                Nenhum registro financeiro encontrado
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Projeto</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead className="text-right">Pago</TableHead>
                    <TableHead className="text-right">Em Aberto</TableHead>
                    <TableHead>Vencimento</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {financials.map(f => {
                    const pending = f.project_value - f.paid_value;

                    return (
                      <TableRow
                        key={f.id}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => navigate(`/project/${f.project_id}`)}
                      >
                        <TableCell>
                          <div>
                            <div className="font-medium">{f.project?.code || '-'}</div>
                            <div className="text-xs text-muted-foreground">
                              {f.project?.holder_name || '-'}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {formatCurrency(f.project_value)}
                        </TableCell>
                        <TableCell className="text-right text-green-600">
                          {formatCurrency(f.paid_value)}
                        </TableCell>
                        <TableCell className={`text-right font-medium ${pending > 0 ? 'text-yellow-600' : ''}`}>
                          {formatCurrency(pending)}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Calendar className="h-4 w-4 text-muted-foreground" />
                            {f.due_date
                              ? format(new Date(f.due_date), 'dd/MM/yyyy', { locale: ptBR })
                              : '-'
                            }
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={statusColors[f.payment_status]}>
                            {statusLabels[f.payment_status]}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
}
