import { useState } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { motion } from 'framer-motion';
import { Zap, Plus, Search, Edit2, Loader2, LayoutTemplate, Package, PlugZap, Library, RefreshCw } from 'lucide-react';
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
import { LibraryImportDialog } from '@/components/concessionaires/LibraryImportDialog';
import { useConcessionaireLibrary } from '@/hooks/useConcessionaireLibrary';

function PackageItemCount({ concessionaireId }: { concessionaireId: string }) {
  const { data: items = [] } = useInstallerPackage(concessionaireId);
  const n = items.length;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${
      n > 0 ? 'bg-emerald-500/10 text-emerald-600' : 'bg-muted text-muted-foreground'
    }`}>
      <Package className="w-3 h-3" /> {n} {n === 1 ? 'item' : 'itens'}
    </span>
  );
}

/** Iniciais da concessionária (ex.: "CPFL" → "CP", "ENEL" → "EN"). */
function initials(name: string): string {
  const clean = name.trim().replace(/\s+/g, ' ');
  const parts = clean.split(' ');
  if (parts.length > 1) return (parts[0][0] + parts[1][0]).toUpperCase();
  return clean.slice(0, 2).toUpperCase();
}

/** Cor estável a partir do nome (mesmo nome → mesma cor). */
function colorForName(name: string): string {
  const palette = ['#378ADD', '#2D6A4F', '#D85A30', '#9B59B6', '#1ABC9C', '#E24B4A', '#F5A800', '#5B6EE1'];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}

/** Botão de ação em ícone com tooltip nativo. */
function IconAction({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <Button variant="ghost" size="icon" title={title} onClick={onClick} className="h-9 w-9 text-muted-foreground hover:text-foreground">
      {children}
    </Button>
  );
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
  const [libraryDialogOpen, setLibraryDialogOpen] = useState(false);
  const [selectedConcessionaire, setSelectedConcessionaire] = useState<EnergyConcessionaire | null>(null);
  
  const { data: concessionaires = [], isLoading } = useEnergyConcessionaires(showInactive);
  const toggleStatusMutation = useToggleConcessionaireStatus();

  // Biblioteca da GD Manager (vazia para o próprio tenant-biblioteca)
  const { data: library = [] } = useConcessionaireLibrary();
  const hasLibrary = library.length > 0;
  const updatesAvailable = library.filter(i => i.has_update).length;
  const notImported = library.filter(i => !i.imported).length;
  
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
            <div className="flex items-center gap-2">
              {hasLibrary && (
                <Button variant="outline" onClick={() => setLibraryDialogOpen(true)} className="gap-2 relative">
                  <Library className="w-4 h-4" />
                  Biblioteca
                  {(updatesAvailable > 0 || notImported > 0) && (
                    <span className="ml-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-primary text-primary-foreground">
                      {updatesAvailable + notImported}
                    </span>
                  )}
                </Button>
              )}
              <Button onClick={handleNewConcessionaire} className="gap-2">
                <Plus className="w-4 h-4" />
                Nova Concessionária
              </Button>
            </div>
          )}
        </div>

        {/* Avisos da biblioteca */}
        {isAdmin && hasLibrary && notImported > 0 && (
          <div className="flex items-center gap-3 p-3 rounded-lg border border-primary/30 bg-primary/5">
            <Library className="w-4 h-4 text-primary flex-shrink-0" />
            <p className="text-sm flex-1">
              <b>{notImported} concessionária(s)</b> prontas na biblioteca da GD Manager — com templates,
              regras de padrão de entrada e pacote do projetista já configurados.
            </p>
            <Button size="sm" onClick={() => setLibraryDialogOpen(true)}>Importar</Button>
          </div>
        )}
        {isAdmin && updatesAvailable > 0 && (
          <div className="flex items-center gap-3 p-3 rounded-lg border border-amber-500/40 bg-amber-500/5">
            <RefreshCw className="w-4 h-4 text-amber-600 flex-shrink-0" />
            <p className="text-sm flex-1">
              <b>{updatesAvailable} concessionária(s)</b> foram atualizadas na biblioteca. Você decide se quer trazer as novidades.
            </p>
            <Button size="sm" variant="outline" onClick={() => setLibraryDialogOpen(true)}>Ver atualizações</Button>
          </div>
        )}

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
            <div className="divide-y divide-border">
              {/* Cabeçalho */}
              <div className="hidden md:grid grid-cols-[1fr_120px_130px_120px_auto] items-center gap-4 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <span>Concessionária</span>
                <span className="text-center">Status</span>
                <span className="text-center">Pacote</span>
                <span>Cadastro</span>
                <span className="text-right pr-1">Ações</span>
              </div>

              {filteredConcessionaires.map((concessionaire) => (
                <div
                  key={concessionaire.id}
                  className="grid grid-cols-1 md:grid-cols-[1fr_120px_130px_120px_auto] items-center gap-3 md:gap-4 px-4 py-3 hover:bg-muted/40 transition-colors"
                >
                  {/* Nome com avatar */}
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className="w-9 h-9 rounded-lg flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0"
                      style={{ background: colorForName(concessionaire.name) }}
                    >
                      {initials(concessionaire.name)}
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-card-foreground truncate">{concessionaire.name}</p>
                      {!concessionaire.is_active && (
                        <span className="text-[10px] text-muted-foreground md:hidden">Inativa</span>
                      )}
                    </div>
                  </div>

                  {/* Status */}
                  <div className="flex items-center gap-2 md:justify-center">
                    {isAdmin ? (
                      <>
                        <Switch
                          checked={concessionaire.is_active}
                          onCheckedChange={() => handleToggleStatus(concessionaire)}
                          disabled={toggleStatusMutation.isPending}
                        />
                        <span className={`text-xs font-medium md:hidden ${concessionaire.is_active ? 'text-emerald-600' : 'text-muted-foreground'}`}>
                          {concessionaire.is_active ? 'Ativa' : 'Inativa'}
                        </span>
                      </>
                    ) : (
                      <Badge variant={concessionaire.is_active ? 'default' : 'secondary'}>
                        {concessionaire.is_active ? 'Ativa' : 'Inativa'}
                      </Badge>
                    )}
                  </div>

                  {/* Pacote */}
                  <div className="md:text-center">
                    <PackageItemCount concessionaireId={concessionaire.id} />
                  </div>

                  {/* Data */}
                  <div className="text-sm text-muted-foreground">
                    {format(new Date(concessionaire.created_at), 'dd/MM/yyyy', { locale: ptBR })}
                  </div>

                  {/* Ações — ícones com tooltip */}
                  <div className="flex items-center gap-1 md:justify-end">
                    <IconAction title="Pacote do Projetista" onClick={() => handleViewPackage(concessionaire)}>
                      <Package className="w-4 h-4" />
                    </IconAction>
                    <IconAction title="Templates de documento" onClick={() => handleViewTemplates(concessionaire)}>
                      <LayoutTemplate className="w-4 h-4" />
                    </IconAction>
                    <IconAction title="Regras de padrão de entrada" onClick={() => handleViewEntryRules(concessionaire)}>
                      <PlugZap className="w-4 h-4" />
                    </IconAction>
                    {isAdmin && (
                      <IconAction title="Editar concessionária" onClick={() => handleEdit(concessionaire)}>
                        <Edit2 className="w-4 h-4" />
                      </IconAction>
                    )}
                  </div>
                </div>
              ))}
            </div>
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

      <LibraryImportDialog
        open={libraryDialogOpen}
        onOpenChange={setLibraryDialogOpen}
      />
    </MainLayout>
  );
}
