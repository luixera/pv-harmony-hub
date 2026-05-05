import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertTriangle, Building2, Kanban } from 'lucide-react';
import { useCompanies } from '@/hooks/useCompanies';
import { useKanbanModels, useCompanyKanbanModels, useAssignKanbanModel } from '@/hooks/useKanbanConfig';

export function CompanyKanbanAssignment() {
  const { data: companies = [] } = useCompanies();
  const { data: kanbanModels = [] } = useKanbanModels();
  const { data: assignments = [] } = useCompanyKanbanModels();
  const assignModel = useAssignKanbanModel();

  const [selectedCompany, setSelectedCompany] = useState<string>('');
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);

  const activeModels = kanbanModels.filter(m => m.is_active);

  const getCompanyAssignment = (companyId: string) => {
    return assignments.find((a: { company_id: string }) => a.company_id === companyId);
  };

  const handleAssign = () => {
    if (!selectedCompany || !selectedModel) return;

    assignModel.mutate({
      companyId: selectedCompany,
      modelId: selectedModel
    }, {
      onSuccess: () => {
        setShowConfirmDialog(false);
        setSelectedCompany('');
        setSelectedModel('');
      }
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Building2 className="w-5 h-5" />
          Atribuição por Empresa
        </CardTitle>
        <CardDescription>
          Defina qual modelo de Kanban cada empresa utiliza
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Assignment Form */}
        <div className="flex flex-wrap gap-4 items-end">
          <div className="flex-1 min-w-[200px]">
            <label className="text-sm font-medium mb-2 block">Empresa</label>
            <Select value={selectedCompany} onValueChange={setSelectedCompany}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione uma empresa" />
              </SelectTrigger>
              <SelectContent>
                {companies.map(company => (
                  <SelectItem key={company.id} value={company.id}>
                    {company.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex-1 min-w-[200px]">
            <label className="text-sm font-medium mb-2 block">Modelo de Kanban</label>
            <Select value={selectedModel} onValueChange={setSelectedModel}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione um modelo" />
              </SelectTrigger>
              <SelectContent>
                {activeModels.map(model => (
                  <SelectItem key={model.id} value={model.id}>
                    <div className="flex items-center gap-2">
                      <Kanban className="w-4 h-4" />
                      {model.name}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button 
            onClick={() => setShowConfirmDialog(true)}
            disabled={!selectedCompany || !selectedModel}
          >
            Atribuir Modelo
          </Button>
        </div>

        {/* Assignments Table */}
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Empresa</TableHead>
                <TableHead>Modelo Atual</TableHead>
                <TableHead>Atribuído em</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {companies.map(company => {
                const assignment = getCompanyAssignment(company.id);
                return (
                  <TableRow key={company.id}>
                    <TableCell className="font-medium">{company.name}</TableCell>
                    <TableCell>
                      {assignment ? (
                        <div className="flex items-center gap-2">
                          <Kanban className="w-4 h-4 text-muted-foreground" />
                          {(assignment as { kanban_models?: { name: string } }).kanban_models?.name || 'N/A'}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">Modelo Padrão</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {assignment ? new Date(assignment.assigned_at).toLocaleDateString('pt-BR') : '-'}
                    </TableCell>
                    <TableCell>
                      {assignment ? (
                        <Badge variant="success">Configurado</Badge>
                      ) : (
                        <Badge variant="secondary">Padrão</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              {companies.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                    Nenhuma empresa cadastrada
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>

      {/* Confirmation Dialog */}
      <Dialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-warning" />
              Confirmar Atribuição
            </DialogTitle>
            <DialogDescription>
              Você está prestes a atribuir um novo modelo de Kanban para esta empresa.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <div className="bg-muted/50 rounded-lg p-4 space-y-2">
              <p className="text-sm">
                <strong>Empresa:</strong> {companies.find(c => c.id === selectedCompany)?.name}
              </p>
              <p className="text-sm">
                <strong>Modelo:</strong> {kanbanModels.find(m => m.id === selectedModel)?.name}
              </p>
            </div>
            <p className="text-sm text-muted-foreground mt-4">
              <strong>Importante:</strong> Projetos existentes não terão seu status alterado. 
              Apenas novos projetos utilizarão este modelo.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowConfirmDialog(false)}>
              Cancelar
            </Button>
            <Button onClick={handleAssign} disabled={assignModel.isPending}>
              Confirmar Atribuição
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
