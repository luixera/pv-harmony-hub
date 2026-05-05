import { useState } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar, Filter } from "lucide-react";
import { Financial } from "@/hooks/useFinancials";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
interface ReceivablesTableProps {
  financials: Financial[];
  companies: {
    id: string;
    name: string;
  }[];
}
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
export function ReceivablesTable({
  financials,
  companies
}: ReceivablesTableProps) {
  const navigate = useNavigate();
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [companyFilter, setCompanyFilter] = useState<string>('all');
  const filteredFinancials = financials.filter(f => {
    // Filter by date range
    if (startDate && f.due_date && f.due_date < startDate) return false;
    if (endDate && f.due_date && f.due_date > endDate) return false;

    // Filter by status
    if (statusFilter !== 'all' && f.status !== statusFilter) return false;

    // Filter by company
    if (companyFilter !== 'all' && f.company_id !== companyFilter) return false;
    return true;
  });
  const today = new Date().toISOString().split('T')[0];
  return <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-4 items-end p-4 rounded-lg bg-secondary-foreground">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium text-muted-foreground">Filtros:</span>
        </div>
        
        <div className="flex-1 min-w-[200px]">
          <label className="text-xs text-muted-foreground mb-1 block">Data Inicial</label>
          <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="h-9" />
        </div>
        
        <div className="flex-1 min-w-[200px]">
          <label className="text-xs text-muted-foreground mb-1 block">Data Final</label>
          <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="h-9" />
        </div>
        
        <div className="flex-1 min-w-[150px]">
          <label className="text-xs text-muted-foreground mb-1 block">Status</label>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-9">
              <SelectValue placeholder="Todos" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="pending">Pendente</SelectItem>
              <SelectItem value="partial">Parcial</SelectItem>
              <SelectItem value="paid">Pago</SelectItem>
            </SelectContent>
          </Select>
        </div>
        
        <div className="flex-1 min-w-[200px]">
          <label className="text-xs text-muted-foreground mb-1 block">Empresa</label>
          <Select value={companyFilter} onValueChange={setCompanyFilter}>
            <SelectTrigger className="h-9">
              <SelectValue placeholder="Todas" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas</SelectItem>
              {companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        
        <Button variant="outline" size="sm" onClick={() => {
        setStartDate('');
        setEndDate('');
        setStatusFilter('all');
        setCompanyFilter('all');
      }}>
          Limpar
        </Button>
      </div>

      {/* Table */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Empresa</TableHead>
              <TableHead>Projeto</TableHead>
              <TableHead className="text-right">Valor</TableHead>
              <TableHead className="text-right">Pago</TableHead>
              <TableHead className="text-right">Em Aberto</TableHead>
              <TableHead>Vencimento</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredFinancials.length === 0 ? <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                  Nenhum registro encontrado
                </TableCell>
              </TableRow> : filteredFinancials.map(f => {
            const pending = f.project_value - f.amount_paid;
            const isOverdue = f.due_date && f.due_date < today && f.status !== 'paid';
            return <TableRow key={f.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/project/${f.project_id}`)}>
                    <TableCell className="font-medium">
                      {f.company?.name || '-'}
                    </TableCell>
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
                      {formatCurrency(f.amount_paid)}
                    </TableCell>
                    <TableCell className={`text-right font-medium ${pending > 0 ? 'text-yellow-600' : ''}`}>
                      {formatCurrency(pending)}
                    </TableCell>
                    <TableCell>
                      <div className={`flex items-center gap-2 ${isOverdue ? 'text-red-500' : ''}`}>
                        <Calendar className="h-4 w-4" />
                        {f.due_date ? format(new Date(f.due_date), 'dd/MM/yyyy', {
                    locale: ptBR
                  }) : '-'}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={statusColors[f.status]}>
                        {statusLabels[f.status]}
                      </Badge>
                    </TableCell>
                  </TableRow>;
          })}
          </TableBody>
        </Table>
      </div>
    </div>;
}