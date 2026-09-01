import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/contexts/AuthContext";
import { useFinancialsByCompany } from "@/hooks/useFinancials";
import { useCompanySubscriptionStatement } from "@/hooks/useSubscriptionCharges";
import { useNavigate } from "react-router-dom";
import { DollarSign, TrendingUp, Clock, Loader2, Repeat, FileSignature } from "lucide-react";
import { motion } from "framer-motion";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

/**
 * "Meu Financeiro" da empresa integradora.
 *
 * Na assinatura mensal a empresa paga DUAS coisas diferentes, e ver as duas
 * somadas num bloco só confunde (decisão do usuário, jul/2026): a mensalidade
 * uma vez por mês, e a ART de cada projeto. Por isso a tela tem um bloco para
 * cada, e os totais do topo somam os dois — é o que ela realmente deve.
 *
 * O consumo da franquia aparece na mensalidade ("7 de 10 projetos"), porque é
 * ele que explica por que um projeto do mês veio mais caro que o outro.
 *
 * Empresa sem assinatura não vê o bloco de mensalidade (a RPC volta vazia).
 */

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

// O tom 500 sobre o card branco fica lavado e quase ilegível; o 700 mantém a
// mesma cor de significado (amarelo/azul/verde) com contraste de leitura.
const statusColors: Record<string, string> = {
  pending: 'bg-yellow-500/10 text-yellow-700 border-yellow-600/30',
  partial: 'bg-blue-500/10 text-blue-700 border-blue-600/30',
  paid: 'bg-green-500/10 text-green-700 border-green-600/30'
};

export default function CompanyFinancial() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data: financials = [], isLoading } = useFinancialsByCompany(user?.companyId);
  const { data: assinaturas = [], isLoading: loadingAssinaturas } = useCompanySubscriptionStatement();

  const temAssinatura = assinaturas.length > 0;

  const projetos = financials.reduce((acc, f) => {
    acc.billed += f.project_value;
    acc.paid += f.paid_value;
    return acc;
  }, { billed: 0, paid: 0 });

  const assinatura = assinaturas.reduce((acc, s) => {
    acc.billed += s.amount;
    acc.paid += s.amount_paid;
    return acc;
  }, { billed: 0, paid: 0 });

  const totalBilled = projetos.billed + assinatura.billed;
  const totalPaid = projetos.paid + assinatura.paid;
  const totalPending = totalBilled - totalPaid;

  if (isLoading || loadingAssinaturas) {
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
            {temAssinatura
              ? 'Acompanhe sua assinatura mensal e as ARTs dos seus projetos'
              : 'Acompanhe seus valores e pagamentos'}
          </p>
        </div>

        {/* Summary Cards — somam assinatura + projetos */}
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
                <div className="text-2xl font-bold">{formatCurrency(totalBilled)}</div>
                {temAssinatura && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {formatCurrency(assinatura.billed)} em assinatura ·{' '}
                    {formatCurrency(projetos.billed)} em ARTs
                  </p>
                )}
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
                <div className="text-2xl font-bold text-green-600">{formatCurrency(totalPaid)}</div>
                {temAssinatura && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {formatCurrency(assinatura.paid)} em assinatura ·{' '}
                    {formatCurrency(projetos.paid)} em ARTs
                  </p>
                )}
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
                <div className="text-2xl font-bold text-yellow-600">{formatCurrency(totalPending)}</div>
                {temAssinatura && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {formatCurrency(assinatura.billed - assinatura.paid)} em assinatura ·{' '}
                    {formatCurrency(projetos.billed - projetos.paid)} em ARTs
                  </p>
                )}
              </CardContent>
            </Card>
          </motion.div>
        </div>

        {/* Assinatura mensal — só para quem tem esse plano */}
        {temAssinatura && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Repeat className="h-4 w-4 text-muted-foreground" />
                Assinatura mensal
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableHead>Competência</TableHead>
                    <TableHead className="text-right">Mensalidade</TableHead>
                    <TableHead className="text-right">Pago</TableHead>
                    <TableHead className="text-right">Em Aberto</TableHead>
                    <TableHead>Projetos do mês</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {assinaturas.map(s => {
                    const pending = s.amount - s.amount_paid;
                    return (
                      <TableRow key={s.id}>
                        <TableCell className="font-medium capitalize">
                          {format(new Date(`${s.competence}T00:00:00`), "MMMM 'de' yyyy", { locale: ptBR })}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {formatCurrency(s.amount)}
                        </TableCell>
                        <TableCell className="text-right text-green-600">
                          {formatCurrency(s.amount_paid)}
                        </TableCell>
                        <TableCell className={`text-right font-medium ${pending > 0 ? 'text-yellow-600' : ''}`}>
                          {formatCurrency(pending)}
                        </TableCell>
                        <TableCell>
                          {s.project_limit == null ? (
                            <span className="text-muted-foreground">{s.projects_count}</span>
                          ) : (
                            <div>
                              <div>{s.projects_count} de {s.project_limit} da franquia</div>
                              {s.excess_count > 0 && (
                                <div className="text-xs text-yellow-600">
                                  {s.excess_count} além da franquia
                                  {s.excess_value > 0 && ` · ${formatCurrency(s.excess_value)} por projeto`}
                                </div>
                              )}
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={statusColors[s.status] ?? statusColors.pending}>
                            {statusLabels[s.status] ?? s.status}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              <p className="text-xs text-muted-foreground mt-3">
                A mensalidade cobre a franquia de projetos do mês. Cada projeto é
                cobrado à parte apenas pela ART; projeto que passa da franquia soma
                o valor adicional.
              </p>
            </CardContent>
          </Card>
        )}

        {/* ARTs / projetos */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {temAssinatura && <FileSignature className="h-4 w-4 text-muted-foreground" />}
              {temAssinatura ? 'ARTs por projeto' : 'Meus Projetos'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {financials.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                Nenhum registro financeiro encontrado
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableHead>Projeto</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead className="text-right">Pago</TableHead>
                    <TableHead className="text-right">Em Aberto</TableHead>
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
