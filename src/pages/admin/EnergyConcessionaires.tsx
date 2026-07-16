import { useState } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { motion } from 'framer-motion';
import { Zap, Plus, Search, Edit2, FileText, Loader2, LayoutTemplate, Package, PlugZap } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useAuth } from '@/contexts/AuthContext';
import { 
  useEnergyConcessionaires, 
  useToggleConcessionaireStatus,
  EnergyConcessionaire 
} from '@/hooks/useEnergyConcessionaires';
import { useInstallerPackage } from '@/hooks/useInstallerPackage';
import { PacoteProjetistaDialog } from '@/components/concessionaires/PacoteProjetistaDialog';
import { ConcessionaireFormDialog } from '@/components/concessionaires/ConcessionaireFormDialog';
import { ConcessionaireTemplatesDialog } from '@/components/concessionaires/ConcessionaireTemplatesDialog';
import { EntryRulesDialog } from '@/components/concessionaires/EntryRulesDialog';

function PackageItemCount({ concessionaireId }: { concessionaireId: string }) {
  const { data: items = [] } = useInstallerPackage(concessionaireId);
  return <span className="text-sm text-muted-foreground">{items.length} {items.length === 1 ? 'item' : 'itens'}</span>;
}

export default function EnergyConcessionaires() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  
  const [searchTerm, setSearchTerm] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [formDialogOpen, setFormDialogOpen] = useState(false);
  const [packageDialogOpen, setPackageDialogOpen] = useState(false);
  const [templatesDialogOpen, setTemplatesDialogOpen] = useState(false);
  const [entryRulesDialogOpen, setEntryRulesDialogOpen] = useState(false);
  const [selectedConcessionaire, setSelectedConcessionaire] = useState<EnergyConcessionaire | null>(null);
  
  const { data: concessionaires = [], isLoading } = useEnergyConcessionaires(showInactive);
  const toggleStatusMutation = useToggleConcessionaireStatus();
  
  // Filter by search term
  const filteredConcessionaires = concessionaires.filter(c => 
    c.name.toLowerCase().includes(searchTerm.toLowerCase())
  );
  
  const handleEdit = (concessionaire: EnergyConcessionaire) => {
    setSelectedConcessionaire(concessionaire);
    setFormDialogOpen(true);
  };
  
  const handleViewPackage = (concessionaire: EnergyConcessionaire) => {
    setSelectedConcessionaire(concessionaire);
    setPackageDialogOpen(true);
  };

  const handleViewTemplates = (concessionaire: EnergyConcessionaire) => {
    setSelectedConcessionaire(concessionaire);
    setTemplatesDialogOpen(true);
  };

  const handleViewEntryRules = (concessionaire: EnergyConcessionaire) => {
    setSelectedConcessionaire(concessionaire);
    setEntryRulesDialogOpen(true);
  };
  
  const handleNewConcessionaire = () => {
    setSelectedConcessionaire(null);
    setFormDialogOpen(true);
  };
  
  const handleToggleStatus = (concessionaire: EnergyConcessionaire) => {
    toggleStatusMutation.mutate({ 
      id: concessionaire.id, 
      isActive: !concessionaire.is_active 
    });
  };
  
  return (
    <MainLayout>
      <motion.div 
        initial={{ opacity: 0, y: 20 }} 
        animate={{ opacity: 1, y: 0 }}
        className="space-y-6"
      >
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Zap className="w-6 h-6 text-primary" />
              Concessionárias de Energia
            </h1>
            <p className="text-muted-foreground">
              Gerencie as concessionárias de energia do sistema
            </p>
          </div>
          
          {isAdmin && (
            <Button onClick={handleNewConcessionaire} className="gap-2">
              <Plus className="w-4 h-4" />
              Nova Concessionária
            </Button>
          )}
        </div>
        
        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por nome..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
          
          {isAdmin && (
            <div className="flex items-center gap-2">
              <Switch
                id="show-inactive"
                checked={showInactive}
                onCheckedChange={setShowInactive}
              />
              <label htmlFor="show-inactive" className="text-sm text-muted-foreground cursor-pointer">
                Mostrar inativas
              </label>
            </div>
          )}
        </div>
        
        {/* Table */}
        <div className="kpi-card">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          ) : filteredConcessionaires.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Zap className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p className="text-lg font-medium">Nenhuma concessionária encontrada</p>
              <p className="text-sm">
                {searchTerm 
                  ? 'Tente uma busca diferente' 
                  : isAdmin 
                    ? 'Clique em "Nova Concessionária" para adicionar' 
                    : 'Nenhuma concessionária cadastrada ainda'}
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                  <TableHead className="text-center">Pacote Projetista</TableHead>
                  <TableHead>Data de Cadastro</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredConcessionaires.map((concessionaire) => (
                  <TableRow key={concessionaire.id}>
                    <TableCell className="font-medium">{concessionaire.name}</TableCell>
                    <TableCell className="text-center">
                      {isAdmin ? (
                        <Switch
                          checked={concessionaire.is_active}
                          onCheckedChange={() => handleToggleStatus(concessionaire)}
                          disabled={toggleStatusMutation.isPending}
                        />
                      ) : (
                        <Badge variant={concessionaire.is_active ? 'default' : 'secondary'}>
                          {concessionaire.is_active ? 'Ativa' : 'Inativa'}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      <PackageItemCount concessionaireId={concessionaire.id} />
                    </TableCell>
                    <TableCell>
                      {format(new Date(concessionaire.created_at), 'dd/MM/yyyy', { locale: ptBR })}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleViewPackage(concessionaire)}
                          className="gap-1"
                        >
                          <Package className="w-4 h-4" />
                          Pacote Projetista
                        </Button>

                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleViewTemplates(concessionaire)}
                          className="gap-1"
                        >
                          <LayoutTemplate className="w-4 h-4" />
                          Templates
                        </Button>

                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleViewEntryRules(concessionaire)}
                          className="gap-1"
                        >
                          <PlugZap className="w-4 h-4" />
                          Padrão de entrada
                        </Button>

                        {isAdmin && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleEdit(concessionaire)}
                          >
                            <Edit2 className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </motion.div>
      
      {/* Dialogs */}
      <ConcessionaireFormDialog
        open={formDialogOpen}
        onOpenChange={setFormDialogOpen}
        concessionaire={selectedConcessionaire}
      />
      
      <PacoteProjetistaDialog
        open={packageDialogOpen}
        onOpenChange={setPackageDialogOpen}
        concessionaire={selectedConcessionaire}
      />

      <ConcessionaireTemplatesDialog
        open={templatesDialogOpen}
        onOpenChange={setTemplatesDialogOpen}
        concessionaire={selectedConcessionaire}
      />

      <EntryRulesDialog
        open={entryRulesDialogOpen}
        onOpenChange={setEntryRulesDialogOpen}
        concessionaire={selectedConcessionaire}
      />
    </MainLayout>
  );
}
