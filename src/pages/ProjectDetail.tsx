import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { MainLayout } from '@/components/layout/MainLayout';
import { useAuth } from '@/contexts/AuthContext';
import { useProject, useUpdateProjectFinancials, useUpdateProjectStatus, useUpdateProjectData } from '@/hooks/useProjects';
import { useComments } from '@/hooks/useComments';
import { useDocuments } from '@/hooks/useDocuments';
import { useProjectHistory } from '@/hooks/useHistory';
import { useCompanyDisplay } from '@/hooks/useCompanyDisplay';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { motion } from 'framer-motion';
import {
  ArrowLeft, FileText, MessageSquare, History, DollarSign, Upload, Download, Send,
  Clock, User, MapPin, Zap, Building2, Save, LayoutGrid, CheckCircle2, XCircle,
  ArrowRight, Tag, Loader2, Users, Trash2, MoreVertical, FileOutput, Pencil,
  AlertTriangle, X, Sun, Activity, ExternalLink
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { MapPicker } from '@/components/maps/MapPicker';
import { ptBR } from 'date-fns/locale';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Database } from '@/integrations/supabase/types';
import { ProjectFinancialCard } from '@/components/financial/ProjectFinancialCard';
import { StaffAssignmentDialog } from '@/components/projects/StaffAssignmentDialog';
import { DeleteProjectDialog } from '@/components/projects/DeleteProjectDialog';
import { GenerateDocumentDialog } from '@/components/projects/GenerateDocumentDialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';

type DocumentType = Database['public']['Enums']['document_type'];
type PaymentStatus = Database['public']['Enums']['payment_status'];
type ProjectStatus = Database['public']['Enums']['project_status'];

const documentTypeLabels: Record<string, string> = {
  energy_bill_generator: 'Conta de energia - Geradora',
  energy_bill_beneficiaries: 'Contas de energia - Beneficiárias',
  holder_document: 'Documento do titular',
  entrance_standard_photo: 'Foto do padrão de entrada',
  breaker_photo: 'Foto do disjuntor',
  other_photos: 'Outras fotos'
};

const statusLabels: Record<string, string> = {
  pending: 'Aguardando',
  analysis: 'Em Análise',
  documentation: 'Documentação',
  approval: 'Aprovação',
  approved: 'Aprovado',
  completed: 'Concluído'
};

const statusSteps: ProjectStatus[] = ['pending', 'analysis', 'documentation', 'approval', 'approved', 'completed'];

// Helper: highlight empty field
function EmptyFieldWarning() {
  return (
    <div className="flex items-center gap-1 mt-1">
      <AlertTriangle className="w-3 h-3 text-amber-500 flex-shrink-0" />
      <span className="text-xs text-amber-500">Não preenchido</span>
    </div>
  );
}

function FieldValue({ value, className = '' }: { value: string | number | null | undefined; className?: string }) {
  if (value === null || value === undefined || value === '' || value === '-') {
    return <EmptyFieldWarning />;
  }
  return <p className={`text-sm font-medium text-card-foreground mt-1 ${className}`}>{value}</p>;
}

// Progress bar component
function ProjectProgressBar({ currentStatus }: { currentStatus: string }) {
  const currentIndex = statusSteps.indexOf(currentStatus as ProjectStatus);

  return (
    <div className="kpi-card py-4">
      <div className="flex items-center gap-1 overflow-x-auto pb-1">
        {statusSteps.map((step, index) => {
          const isCompleted = index < currentIndex;
          const isCurrent = index === currentIndex;
          const isPending = index > currentIndex;
          return (
            <div key={step} className="flex items-center gap-1 min-w-0 flex-1">
              <div className="flex flex-col items-center gap-1 min-w-0 flex-1">
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 transition-colors"
                  style={
                    isCompleted ? { background: '#F5A800', color: '#1A1A1A' } :
                    isCurrent ? { background: 'transparent', border: '2px solid #F5A800', color: '#F5A800' } :
                    { background: '#F0F0F0', color: '#999999' }
                  }
                >
                  {isCompleted ? (
                    <CheckCircle2 className="w-4 h-4" />
                  ) : (
                    <span className="text-[10px] font-bold">{index + 1}</span>
                  )}
                </div>
                <span
                  className="text-[10px] text-center leading-tight truncate w-full"
                  style={
                    isCurrent ? { color: '#F5A800', fontWeight: 600 } :
                    isCompleted ? { color: '#F5A800' } :
                    { color: '#999999' }
                  }
                >
                  {statusLabels[step]}
                </span>
              </div>
              {index < statusSteps.length - 1 && (
                <div
                  className="h-0.5 flex-1 rounded-full mb-4 transition-colors"
                  style={{ background: index < currentIndex ? '#F5A800' : '#E0E0E0' }}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function ProjectDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { getCompanyDisplayName } = useCompanyDisplay();

  const { data: project, isLoading: isLoadingProject } = useProject(id);
  const { data: comments = [], refetch: refetchComments } = useComments(id);
  const { data: documents = [] } = useDocuments(id);
  const { data: historyEntries = [] } = useProjectHistory(id);

  const updateFinancials = useUpdateProjectFinancials();
  const updateStatus = useUpdateProjectStatus();
  const updateData = useUpdateProjectData();

  const isAdminOrStaff = user?.role === 'admin' || user?.role === 'staff';

  // Comment
  const [newComment, setNewComment] = useState('');
  const [isSendingComment, setIsSendingComment] = useState(false);

  // Financial
  const [projectValue, setProjectValue] = useState('');
  const [paidValue, setPaidValue] = useState('');
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>('pending');

  // Dialogs
  const [isAssignmentDialogOpen, setIsAssignmentDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isGenerateDocDialogOpen, setIsGenerateDocDialogOpen] = useState(false);
  const [isMapDialogOpen, setIsMapDialogOpen] = useState(false);
  const [mapCoords, setMapCoords] = useState('');

  // Inline editing states
  const [editingBlock, setEditingBlock] = useState<'identification' | 'holder' | 'equipment' | null>(null);

  const [editGeneral, setEditGeneral] = useState({
    holder_name: '',
    holder_cpf_cnpj: '',
    holder_phone: '',
    holder_email: '',
    address: '',
    city: '',
    state: '',
    cep: '',
    uc_number: '',
    utility_company: '',
    circuit_breaker_current: '',
    phase_type: '',
    coordinates: '',
  });

  const [editEquipment, setEditEquipment] = useState({
    inverter_brand: '',
    inverter_model: '',
    inverter_power: '',
    inverter_quantity: '',
    module_brand: '',
    module_model: '',
    module_power: '',
    module_quantity: '',
    total_installed_power: '',
  });

  useEffect(() => {
    if (project?.financials) {
      setProjectValue(project.financials.project_value?.toString() || '0');
      setPaidValue(project.financials.paid_value?.toString() || '0');
      setPaymentStatus(project.financials.payment_status || 'pending');
    }
  }, [project?.financials]);

  const startEditing = (block: 'identification' | 'holder' | 'equipment') => {
    const gd = project?.generalData;
    const eq = project?.equipment;
    if (block === 'identification' || block === 'holder') {
      setEditGeneral({
        holder_name: gd?.holder_name || '',
        holder_cpf_cnpj: gd?.holder_cpf_cnpj || '',
        holder_phone: gd?.holder_phone || '',
        holder_email: gd?.holder_email || '',
        address: gd?.address || '',
        city: gd?.city || '',
        state: gd?.state || '',
        cep: (gd as any)?.cep || '',
        uc_number: gd?.uc_number || '',
        utility_company: gd?.utility_company || '',
        circuit_breaker_current: gd?.circuit_breaker_current || '',
        phase_type: gd?.phase_type || '',
        coordinates: gd?.coordinates || '',
      });
    }
    if (block === 'equipment') {
      setEditEquipment({
        inverter_brand: eq?.inverter_brand || '',
        inverter_model: eq?.inverter_model || '',
        inverter_power: eq?.inverter_power?.toString() || '',
        inverter_quantity: eq?.inverter_quantity?.toString() || '',
        module_brand: eq?.module_brand || '',
        module_model: eq?.module_model || '',
        module_power: eq?.module_power?.toString() || '',
        module_quantity: eq?.module_quantity?.toString() || '',
        total_installed_power: eq?.total_installed_power?.toString() || '',
      });
    }
    setEditingBlock(block);
  };

  const cancelEditing = () => setEditingBlock(null);

  const saveBlock = async (block: 'identification' | 'holder' | 'equipment') => {
    if (!project) return;
    try {
      if (block === 'identification' || block === 'holder') {
        await updateData.mutateAsync({
          projectId: project.id,
          generalData: {
            holder_name: editGeneral.holder_name || null,
            holder_cpf_cnpj: editGeneral.holder_cpf_cnpj || null,
            holder_phone: editGeneral.holder_phone || null,
            holder_email: editGeneral.holder_email || null,
            address: editGeneral.address || null,
            city: editGeneral.city || null,
            state: editGeneral.state || null,
            uc_number: editGeneral.uc_number || null,
            utility_company: editGeneral.utility_company || null,
            circuit_breaker_current: editGeneral.circuit_breaker_current || null,
            phase_type: editGeneral.phase_type || null,
            coordinates: editGeneral.coordinates || null,
          },
        });
      } else {
        await updateData.mutateAsync({
          projectId: project.id,
          equipment: {
            inverter_brand: editEquipment.inverter_brand || null,
            inverter_model: editEquipment.inverter_model || null,
            inverter_power: editEquipment.inverter_power ? parseFloat(editEquipment.inverter_power) : null,
            inverter_quantity: editEquipment.inverter_quantity ? parseInt(editEquipment.inverter_quantity) : null,
            module_brand: editEquipment.module_brand || null,
            module_model: editEquipment.module_model || null,
            module_power: editEquipment.module_power ? parseFloat(editEquipment.module_power) : null,
            module_quantity: editEquipment.module_quantity ? parseInt(editEquipment.module_quantity) : null,
            total_installed_power: editEquipment.total_installed_power ? parseFloat(editEquipment.total_installed_power) : null,
          },
        });
      }
      setEditingBlock(null);
    } catch {
      // toast already shown by hook
    }
  };

  if (isLoadingProject) {
    return (
      <MainLayout>
        <div className="flex items-center justify-center h-96">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      </MainLayout>
    );
  }

  if (!project) {
    return (
      <MainLayout>
        <div className="text-center py-20">
          <h2 className="text-2xl font-bold text-foreground mb-4">Projeto não encontrado</h2>
          <p className="text-muted-foreground mb-4">O projeto solicitado não existe ou você não tem permissão para visualizá-lo.</p>
          <Button onClick={() => navigate(-1)}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Voltar
          </Button>
        </div>
      </MainLayout>
    );
  }

  const handleSendComment = async () => {
    if (!newComment.trim() || !user) return;
    setIsSendingComment(true);
    try {
      const { error } = await supabase.from('comments').insert({
        project_id: project.id,
        user_id: user.id,
        message: newComment
      });
      if (error) throw error;
      setNewComment('');
      refetchComments();
      toast.success('Comentário enviado');
    } catch (error) {
      console.error('Error sending comment:', error);
      toast.error('Erro ao enviar comentário');
    } finally {
      setIsSendingComment(false);
    }
  };

  const handleSaveFinancial = async () => {
    try {
      await updateFinancials.mutateAsync({
        projectId: project.id,
        projectValue: parseFloat(projectValue) || 0,
        paidValue: parseFloat(paidValue) || 0
      });
    } catch (error) {
      console.error('Error saving financials:', error);
    }
  };

  const handleStatusChange = async (newStatus: ProjectStatus) => {
    try {
      await updateStatus.mutateAsync({ projectId: project.id, status: newStatus });
      toast.success('Status atualizado');
    } catch (error) {
      console.error('Error updating status:', error);
      toast.error('Erro ao atualizar status');
    }
  };

  const getDocsByType = (type: string) => documents.filter(d => d.document_type === type);
  const docTypes = ['energy_bill_generator', 'energy_bill_beneficiaries', 'holder_document', 'entrance_standard_photo', 'breaker_photo', 'other_photos'];

  const isImageFile = (fileName: string) => {
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg'];
    const ext = fileName.toLowerCase().substring(fileName.lastIndexOf('.'));
    return imageExtensions.includes(ext);
  };

  const isPdfFile = (fileName: string) => fileName.toLowerCase().endsWith('.pdf');

  const handleDownloadDocument = async (fileUrl: string, fileName: string) => {
    try {
      const options = isPdfFile(fileName) ? { download: fileName } : {};
      const { data, error } = await supabase.storage.from('project-documents').createSignedUrl(fileUrl, 60, options);
      if (error) throw error;
      if (isPdfFile(fileName)) {
        const response = await fetch(data.signedUrl);
        const blob = await response.blob();
        const blobUrl = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(blobUrl);
        toast.success('Download iniciado');
      } else {
        const link = document.createElement('a');
        link.href = data.signedUrl;
        if (!isImageFile(fileName)) link.download = fileName;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
    } catch (error) {
      console.error('Error downloading document:', error);
      toast.error('Erro ao baixar documento');
    }
  };

  const generalData = project.generalData;
  const equipment = project.equipment;
  const financials = project.financials;

  // Helper to get status badge variant
  const statusVariant = (s: string) =>
    s === 'pending' ? 'pending' : s === 'analysis' ? 'analysis' : s === 'approved' ? 'approved' : s === 'completed' ? 'completed' : 'progress';

  // Edit block header helpers
  const BlockHeader = ({
    icon, title, blockKey
  }: {
    icon: React.ReactNode;
    title: string;
    blockKey: 'identification' | 'holder' | 'equipment';
  }) => (
    <div className="flex items-center justify-between mb-4">
      <div className="flex items-center gap-2">
        {icon}
        <h3 className="font-semibold text-card-foreground">{title}</h3>
      </div>
      {isAdminOrStaff && editingBlock !== blockKey && (
        <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground hover:text-foreground" onClick={() => startEditing(blockKey)}>
          <Pencil className="w-3.5 h-3.5" />
          Editar
        </Button>
      )}
      {isAdminOrStaff && editingBlock === blockKey && (
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" onClick={cancelEditing}>
            <X className="w-3.5 h-3.5" />
            Cancelar
          </Button>
          <Button variant="cta" size="sm" className="gap-1.5" onClick={() => saveBlock(blockKey)} disabled={updateData.isPending}>
            {updateData.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Salvar
          </Button>
        </div>
      )}
    </div>
  );

  return (
    <MainLayout>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-start gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)} className="mt-1 flex-shrink-0">
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-lg font-bold text-muted-foreground">{project.code}</h1>
              {isAdminOrStaff ? (
                <Select value={project.status} onValueChange={v => handleStatusChange(v as ProjectStatus)}>
                  <SelectTrigger className="w-auto h-7 text-xs">
                    <Badge variant={statusVariant(project.status)}>{statusLabels[project.status]}</Badge>
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(statusLabels).map(([value, label]) => (
                      <SelectItem key={value} value={value}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Badge variant={statusVariant(project.status)}>{statusLabels[project.status]}</Badge>
              )}

              {/* Concessionaire badge */}
              {(project.concessionaireName || generalData?.utility_company) && (
                <Badge variant="outline" className="gap-1 text-xs">
                  <Building2 className="w-3 h-3" />
                  {project.concessionaireName || generalData?.utility_company}
                </Badge>
              )}

              {/* Gerar Documento — admin e staff */}
              {isAdminOrStaff && (
                <Button variant="cta" size="sm" className="gap-2 ml-auto" onClick={() => setIsGenerateDocDialogOpen(true)}>
                  <FileOutput className="w-4 h-4" />
                  Gerar Documento
                </Button>
              )}

              {/* Admin-only actions menu */}
              {user?.role === 'admin' && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="gap-2">
                      <MoreVertical className="w-4 h-4" />
                      Ações
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    <DropdownMenuItem onClick={() => setIsAssignmentDialogOpen(true)}>
                      <Users className="w-4 h-4 mr-2" />
                      Atribuir Projetistas
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => setIsDeleteDialogOpen(true)} className="text-destructive focus:text-destructive">
                      <Trash2 className="w-4 h-4 mr-2" />
                      Excluir Projeto
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>

            {/* Holder name — destaque */}
            <h2 className="text-2xl font-bold text-foreground mt-1 truncate">
              {generalData?.holder_name || project.title || 'Sem titular'}
            </h2>
          </div>
        </div>

        {/* Progress bar */}
        <ProjectProgressBar currentStatus={project.status} />

        {/* Tabs */}
        <Tabs defaultValue="geral" className="space-y-6">
          <TabsList className="bg-muted/50 p-1 flex-wrap">
            <TabsTrigger value="geral" className="gap-2">
              <LayoutGrid className="w-4 h-4" />
              Geral
            </TabsTrigger>
            <TabsTrigger value="dados" className="gap-2">
              <FileText className="w-4 h-4" />
              Dados
            </TabsTrigger>
            <TabsTrigger value="documentos" className="gap-2">
              <Upload className="w-4 h-4" />
              Documentos
            </TabsTrigger>
            <TabsTrigger value="comentarios" className="gap-2">
              <MessageSquare className="w-4 h-4" />
              Comentários
            </TabsTrigger>
            <TabsTrigger value="historico" className="gap-2">
              <History className="w-4 h-4" />
              Histórico
            </TabsTrigger>
            {user?.role === 'admin' && (
              <TabsTrigger value="financeiro" className="gap-2">
                <DollarSign className="w-4 h-4" />
                Financeiro
              </TabsTrigger>
            )}
          </TabsList>

          {/* ── GERAL TAB ── */}
          <TabsContent value="geral">
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">

              {/* Bloco 1 – Identificação do Projeto */}
              <div className="kpi-card">
                <BlockHeader
                  icon={<Tag className="w-5 h-5 text-primary" />}
                  title="Identificação do Projeto"
                  blockKey="identification"
                />
                {editingBlock === 'identification' ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    <div>
                      <label className="text-xs text-muted-foreground">Nº UC</label>
                      <Input className="mt-1 h-8 text-sm" value={editGeneral.uc_number} onChange={e => setEditGeneral(p => ({ ...p, uc_number: e.target.value }))} placeholder="Número da UC" />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground">Concessionária</label>
                      <Input className="mt-1 h-8 text-sm" value={editGeneral.utility_company} onChange={e => setEditGeneral(p => ({ ...p, utility_company: e.target.value }))} placeholder="Concessionária" />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground">Tipo de Fase</label>
                      <Input className="mt-1 h-8 text-sm" value={editGeneral.phase_type} onChange={e => setEditGeneral(p => ({ ...p, phase_type: e.target.value }))} placeholder="Ex: Monofásico" />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground">Disjuntor (A)</label>
                      <Input className="mt-1 h-8 text-sm" value={editGeneral.circuit_breaker_current} onChange={e => setEditGeneral(p => ({ ...p, circuit_breaker_current: e.target.value }))} placeholder="Ex: 63" />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground">Coordenadas</label>
                      <Input className="mt-1 h-8 text-sm" value={editGeneral.coordinates} onChange={e => setEditGeneral(p => ({ ...p, coordinates: e.target.value }))} placeholder="Lat, Long" />
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="bg-muted/30 rounded-lg p-4">
                      <label className="text-xs text-muted-foreground">Código do Projeto</label>
                      <p className="text-sm font-medium text-card-foreground mt-1">{project.code}</p>
                    </div>
                    <div className="bg-muted/30 rounded-lg p-4">
                      <label className="text-xs text-muted-foreground">Empresa</label>
                      <p className="text-sm font-medium text-card-foreground mt-1">{getCompanyDisplayName(project.companyName)}</p>
                    </div>
                    <div className="bg-muted/30 rounded-lg p-4">
                      <label className="text-xs text-muted-foreground">Status</label>
                      <div className="mt-1">
                        <Badge variant={statusVariant(project.status)}>{statusLabels[project.status]}</Badge>
                      </div>
                    </div>
                    <div className="bg-muted/30 rounded-lg p-4">
                      <label className="text-xs text-muted-foreground">Concessionária</label>
                      <FieldValue value={project.concessionaireName || generalData?.utility_company} />
                    </div>
                    <div className="bg-muted/30 rounded-lg p-4">
                      <label className="text-xs text-muted-foreground">Tipo de Fase</label>
                      <FieldValue value={generalData?.phase_type} />
                    </div>
                    <div className="bg-muted/30 rounded-lg p-4">
                      <label className="text-xs text-muted-foreground">Nº UC</label>
                      <FieldValue value={generalData?.uc_number} />
                    </div>
                    <div className="bg-muted/30 rounded-lg p-4">
                      <label className="text-xs text-muted-foreground">Disjuntor</label>
                      <FieldValue value={generalData?.circuit_breaker_current ? `${generalData.circuit_breaker_current} A` : null} />
                    </div>
                  </div>
                )}
              </div>

              {/* Bloco 2 – Titular e UC */}
              <div className="kpi-card">
                <BlockHeader
                  icon={<User className="w-5 h-5 text-primary" />}
                  title="Titular e Unidade Consumidora"
                  blockKey="holder"
                />
                {editingBlock === 'holder' ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    <div>
                      <label className="text-xs text-muted-foreground">Nome do Titular</label>
                      <Input className="mt-1 h-8 text-sm" value={editGeneral.holder_name} onChange={e => setEditGeneral(p => ({ ...p, holder_name: e.target.value }))} placeholder="Nome completo" />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground">CPF/CNPJ</label>
                      <Input className="mt-1 h-8 text-sm" value={editGeneral.holder_cpf_cnpj} onChange={e => setEditGeneral(p => ({ ...p, holder_cpf_cnpj: e.target.value }))} placeholder="000.000.000-00" />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground">Telefone</label>
                      <Input className="mt-1 h-8 text-sm" value={editGeneral.holder_phone} onChange={e => setEditGeneral(p => ({ ...p, holder_phone: e.target.value }))} placeholder="(00) 00000-0000" />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground">E-mail</label>
                      <Input className="mt-1 h-8 text-sm" value={editGeneral.holder_email} onChange={e => setEditGeneral(p => ({ ...p, holder_email: e.target.value }))} placeholder="email@exemplo.com" />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="text-xs text-muted-foreground">Endereço</label>
                      <Input className="mt-1 h-8 text-sm" value={editGeneral.address} onChange={e => setEditGeneral(p => ({ ...p, address: e.target.value }))} placeholder="Rua, número, bairro" />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground">Cidade</label>
                      <Input className="mt-1 h-8 text-sm" value={editGeneral.city} onChange={e => setEditGeneral(p => ({ ...p, city: e.target.value }))} placeholder="Cidade" />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground">Estado</label>
                      <Input className="mt-1 h-8 text-sm" value={editGeneral.state} onChange={e => setEditGeneral(p => ({ ...p, state: e.target.value }))} placeholder="UF" maxLength={2} />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground">CEP</label>
                      <Input className="mt-1 h-8 text-sm" value={editGeneral.cep} onChange={e => setEditGeneral(p => ({ ...p, cep: e.target.value }))} placeholder="00000-000" />
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    <div>
                      <label className="text-xs text-muted-foreground">Nome do Titular</label>
                      <FieldValue value={generalData?.holder_name} />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground">CPF/CNPJ</label>
                      <FieldValue value={generalData?.holder_cpf_cnpj
                        ? (isAdminOrStaff
                          ? generalData.holder_cpf_cnpj.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
                          : generalData.holder_cpf_cnpj.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.***.***-$4'))
                        : null}
                      />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground">Telefone</label>
                      <FieldValue value={generalData?.holder_phone} />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground">E-mail</label>
                      <FieldValue value={generalData?.holder_email} />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground">Número da UC</label>
                      <FieldValue value={generalData?.uc_number} />
                    </div>
                    <div className="sm:col-span-2 lg:col-span-3">
                      <label className="text-xs text-muted-foreground">Endereço Completo</label>
                      <FieldValue value={
                        generalData?.address
                          ? `${generalData.address}, ${generalData.city}/${generalData.state}`
                          : null
                      } />
                    </div>
                    {generalData?.is_rural && (
                      <div className="sm:col-span-2 lg:col-span-3">
                        <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                          <MapPin className="w-4 h-4 text-amber-500" />
                          <div>
                            <span className="text-sm font-medium text-amber-700 dark:text-amber-400">Projeto Rural</span>
                            {generalData?.coordinates && (
                              <p className="text-xs text-muted-foreground">Coordenadas: {generalData.coordinates}</p>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Bloco 2.5 – Localização no Mapa */}
              <div className="kpi-card">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <MapPin className="w-5 h-5 text-primary" />
                    <h3 className="font-semibold text-card-foreground">Localização</h3>
                  </div>
                  <div className="flex gap-2">
                    {generalData?.coordinates && (
                      <a
                        href={`https://www.google.com/maps?q=${generalData.coordinates}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        Abrir no Google Maps
                      </a>
                    )}
                    {isAdminOrStaff && !generalData?.coordinates && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-xs gap-1.5"
                        onClick={() => {
                          setMapCoords('');
                          setIsMapDialogOpen(true);
                        }}
                      >
                        <MapPin className="w-3.5 h-3.5" />
                        Definir localização
                      </Button>
                    )}
                  </div>
                </div>

                {generalData?.coordinates ? (
                  <MapPicker
                    value={generalData.coordinates}
                    onChange={() => {}}
                    showAutocomplete={false}
                    height={280}
                    draggable={false}
                  />
                ) : (
                  <div className="flex items-center gap-2 p-4 rounded-lg bg-muted/30 text-muted-foreground text-sm">
                    <MapPin className="w-4 h-4 flex-shrink-0" />
                    {isAdminOrStaff
                      ? 'Nenhuma localização cadastrada. Clique em "Definir localização" para adicionar.'
                      : 'Localização não cadastrada para este projeto.'}
                  </div>
                )}
              </div>

              {/* Bloco 3 – Equipamentos */}
              <div className="kpi-card">
                <BlockHeader
                  icon={<Zap className="w-5 h-5 text-primary" />}
                  title="Equipamentos"
                  blockKey="equipment"
                />
                {editingBlock === 'equipment' ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    <div className="lg:col-span-3">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Inversor</p>
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground">Marca</label>
                      <Input className="mt-1 h-8 text-sm" value={editEquipment.inverter_brand} onChange={e => setEditEquipment(p => ({ ...p, inverter_brand: e.target.value }))} placeholder="Ex: Fronius" />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground">Modelo</label>
                      <Input className="mt-1 h-8 text-sm" value={editEquipment.inverter_model} onChange={e => setEditEquipment(p => ({ ...p, inverter_model: e.target.value }))} placeholder="Ex: Symo 6.0" />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground">Potência (kW)</label>
                      <Input className="mt-1 h-8 text-sm" type="number" value={editEquipment.inverter_power} onChange={e => setEditEquipment(p => ({ ...p, inverter_power: e.target.value }))} placeholder="Ex: 6.0" />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground">Quantidade</label>
                      <Input className="mt-1 h-8 text-sm" type="number" value={editEquipment.inverter_quantity} onChange={e => setEditEquipment(p => ({ ...p, inverter_quantity: e.target.value }))} placeholder="Ex: 1" />
                    </div>
                    <div className="lg:col-span-3 border-t border-border pt-3">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Módulos</p>
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground">Marca</label>
                      <Input className="mt-1 h-8 text-sm" value={editEquipment.module_brand} onChange={e => setEditEquipment(p => ({ ...p, module_brand: e.target.value }))} placeholder="Ex: Canadian Solar" />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground">Modelo</label>
                      <Input className="mt-1 h-8 text-sm" value={editEquipment.module_model} onChange={e => setEditEquipment(p => ({ ...p, module_model: e.target.value }))} placeholder="Ex: CS3L-370MS" />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground">Potência (W)</label>
                      <Input className="mt-1 h-8 text-sm" type="number" value={editEquipment.module_power} onChange={e => setEditEquipment(p => ({ ...p, module_power: e.target.value }))} placeholder="Ex: 370" />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground">Quantidade</label>
                      <Input className="mt-1 h-8 text-sm" type="number" value={editEquipment.module_quantity} onChange={e => setEditEquipment(p => ({ ...p, module_quantity: e.target.value }))} placeholder="Ex: 10" />
                    </div>
                    <div className="lg:col-span-3 border-t border-border pt-3">
                      <label className="text-xs text-muted-foreground">Potência Total Instalada (kWp)</label>
                      <Input className="mt-1 h-8 text-sm w-48" type="number" value={editEquipment.total_installed_power} onChange={e => setEditEquipment(p => ({ ...p, total_installed_power: e.target.value }))} placeholder="Ex: 3.7" />
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* Inversor */}
                      <div className="bg-muted/30 rounded-lg p-4">
                        <div className="flex items-center gap-2 mb-3">
                          <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
                            <Activity className="w-4 h-4 text-primary" />
                          </div>
                          <h4 className="text-sm font-semibold text-card-foreground">Inversor</h4>
                        </div>
                        <div className="space-y-2 text-sm">
                          <div className="flex justify-between items-center">
                            <span className="text-muted-foreground">Marca</span>
                            {equipment?.inverter_brand
                              ? <span className="font-medium text-card-foreground">{equipment.inverter_brand}</span>
                              : <span className="flex items-center gap-1 text-amber-500 text-xs"><AlertTriangle className="w-3 h-3" />Não inf.</span>}
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-muted-foreground">Modelo</span>
                            {equipment?.inverter_model
                              ? <span className="font-medium text-card-foreground">{equipment.inverter_model}</span>
                              : <span className="flex items-center gap-1 text-amber-500 text-xs"><AlertTriangle className="w-3 h-3" />Não inf.</span>}
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-muted-foreground">Potência</span>
                            {equipment?.inverter_power
                              ? <span className="font-bold text-primary">{equipment.inverter_power} kW</span>
                              : <span className="flex items-center gap-1 text-amber-500 text-xs"><AlertTriangle className="w-3 h-3" />Não inf.</span>}
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-muted-foreground">Qtd.</span>
                            <span className="font-medium text-card-foreground">{equipment?.inverter_quantity || 1}</span>
                          </div>
                        </div>
                      </div>

                      {/* Módulos */}
                      <div className="bg-muted/30 rounded-lg p-4">
                        <div className="flex items-center gap-2 mb-3">
                          <div className="w-7 h-7 rounded-lg bg-amber-500/10 flex items-center justify-center">
                            <Sun className="w-4 h-4 text-amber-500" />
                          </div>
                          <h4 className="text-sm font-semibold text-card-foreground">Módulos</h4>
                        </div>
                        <div className="space-y-2 text-sm">
                          <div className="flex justify-between items-center">
                            <span className="text-muted-foreground">Marca</span>
                            {equipment?.module_brand
                              ? <span className="font-medium text-card-foreground">{equipment.module_brand}</span>
                              : <span className="flex items-center gap-1 text-amber-500 text-xs"><AlertTriangle className="w-3 h-3" />Não inf.</span>}
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-muted-foreground">Modelo</span>
                            {equipment?.module_model
                              ? <span className="font-medium text-card-foreground">{equipment.module_model}</span>
                              : <span className="flex items-center gap-1 text-amber-500 text-xs"><AlertTriangle className="w-3 h-3" />Não inf.</span>}
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-muted-foreground">Potência</span>
                            {equipment?.module_power
                              ? <span className="font-bold text-amber-500">{equipment.module_power} W</span>
                              : <span className="flex items-center gap-1 text-amber-500 text-xs"><AlertTriangle className="w-3 h-3" />Não inf.</span>}
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-muted-foreground">Qtd.</span>
                            <span className="font-bold text-card-foreground text-base">{equipment?.module_quantity || 0}</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 p-4 bg-primary/10 rounded-lg flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Zap className="w-5 h-5 text-primary" />
                        <span className="text-sm font-medium text-card-foreground">Potência Total do Projeto</span>
                      </div>
                      {equipment?.total_installed_power
                        ? <span className="text-2xl font-bold text-primary">{equipment.total_installed_power} <span className="text-sm font-normal">kWp</span></span>
                        : <span className="flex items-center gap-1 text-amber-500 text-sm"><AlertTriangle className="w-4 h-4" />Não informado</span>}
                    </div>
                  </>
                )}
              </div>

              {/* Bloco 4 – Disjuntor de Entrada */}
              <div className="kpi-card">
                <div className="flex items-center gap-2 mb-4">
                  <Zap className="w-5 h-5 text-primary" />
                  <h3 className="font-semibold text-card-foreground">Disjuntor de Entrada</h3>
                </div>
                {(() => {
                  const hasBreakerPhoto = getDocsByType('breaker_photo').length > 0;
                  const breakerCurrent = generalData?.circuit_breaker_current;
                  if (hasBreakerPhoto) {
                    const breakerDocs = getDocsByType('breaker_photo');
                    return (
                      <div className="space-y-3">
                        <div className="flex items-center gap-2 p-3 rounded-lg bg-success/10 border border-success/20">
                          <CheckCircle2 className="w-5 h-5 text-success" />
                          <span className="text-sm font-medium text-success">Foto do disjuntor enviada</span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {breakerDocs.map(doc => (
                            <div key={doc.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors cursor-pointer" onClick={() => handleDownloadDocument(doc.file_url, doc.file_name)}>
                              <div className="flex items-center gap-2">
                                <FileText className="w-4 h-4 text-primary" />
                                <span className="text-sm text-card-foreground truncate">{doc.file_name}</span>
                              </div>
                              <Download className="w-4 h-4 text-muted-foreground" />
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  } else if (breakerCurrent) {
                    return (
                      <div className="space-y-3">
                        <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                          <XCircle className="w-5 h-5 text-amber-500" />
                          <span className="text-sm font-medium text-amber-700 dark:text-amber-400">Foto do disjuntor não enviada</span>
                        </div>
                        <div className="p-4 bg-muted/30 rounded-lg">
                          <label className="text-xs text-muted-foreground">Corrente informada manualmente</label>
                          <p className="text-xl font-bold text-card-foreground mt-1">{breakerCurrent} A</p>
                        </div>
                      </div>
                    );
                  } else {
                    return (
                      <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20">
                        <XCircle className="w-5 h-5 text-destructive" />
                        <div>
                          <span className="text-sm font-medium text-destructive">Informação do disjuntor não disponível</span>
                          <p className="text-xs text-muted-foreground">Nenhuma foto enviada e corrente não informada</p>
                        </div>
                      </div>
                    );
                  }
                })()}
              </div>

              {/* Bloco 5 – Documentos */}
              <div className="kpi-card">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <Upload className="w-5 h-5 text-primary" />
                    <h3 className="font-semibold text-card-foreground">Documentos</h3>
                  </div>
                  <Button variant="ghost" size="sm" className="text-primary" onClick={() => {
                    const element = document.querySelector('[data-value="documentos"]');
                    if (element) (element as HTMLButtonElement).click();
                  }}>
                    Ver todos
                    <ArrowRight className="w-4 h-4 ml-1" />
                  </Button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {docTypes.map(type => {
                    const docs = getDocsByType(type);
                    const hasDoc = docs.length > 0;
                    return (
                      <div key={type} className="flex items-center gap-3 p-3 rounded-lg bg-muted/30">
                        {hasDoc
                          ? <CheckCircle2 className="w-5 h-5 text-success flex-shrink-0" />
                          : <XCircle className="w-5 h-5 text-muted-foreground flex-shrink-0" />}
                        <div className="min-w-0">
                          <p className="text-sm text-card-foreground truncate">{documentTypeLabels[type] || type}</p>
                          <p className={`text-xs ${hasDoc ? 'text-success' : 'text-muted-foreground'}`}>
                            {hasDoc ? `${docs.length} arquivo(s)` : 'Pendente'}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Bloco 6 – Comentários rápidos */}
              <div className="kpi-card">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <MessageSquare className="w-5 h-5 text-primary" />
                    <h3 className="font-semibold text-card-foreground">Comentários</h3>
                  </div>
                  <Button variant="ghost" size="sm" className="text-primary" onClick={() => {
                    const element = document.querySelector('[data-value="comentarios"]');
                    if (element) (element as HTMLButtonElement).click();
                  }}>
                    Ver todos
                    <ArrowRight className="w-4 h-4 ml-1" />
                  </Button>
                </div>
                <div className="max-h-64 overflow-y-auto scrollbar-thin mb-4">
                  {comments.length > 0 ? (
                    <div className="space-y-3">
                      {[...comments].reverse().slice(0, 5).map(comment => (
                        <div key={comment.id} className="flex gap-3 p-3 rounded-lg bg-muted/30">
                          <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 bg-primary/20">
                            <span className="text-xs font-medium text-primary">{(comment.userName || 'U').charAt(0)}</span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-medium text-card-foreground">{comment.userName || 'Usuário'}</span>
                              <Badge variant="secondary" className="text-[10px]">
                                {comment.userRole === 'admin' && 'Admin'}
                                {comment.userRole === 'staff' && 'Staff'}
                                {comment.userRole === 'company' && 'Empresa'}
                              </Badge>
                              <span className="text-xs text-muted-foreground ml-auto">
                                {formatDistanceToNow(new Date(comment.created_at), { addSuffix: true, locale: ptBR })}
                              </span>
                            </div>
                            <p className="text-sm text-muted-foreground mt-1">{comment.message}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-6">
                      <MessageSquare className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                      <p className="text-sm text-muted-foreground">Nenhum comentário ainda</p>
                    </div>
                  )}
                </div>
                <div className="flex gap-3 pt-4 border-t border-border">
                  <Input placeholder="Escreva um comentário rápido..." value={newComment} onChange={e => setNewComment(e.target.value)} onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSendComment()} className="flex-1" />
                  <Button variant="cta" onClick={handleSendComment} disabled={!newComment.trim() || isSendingComment}>
                    {isSendingComment ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    Enviar
                  </Button>
                </div>
              </div>

              {/* Bloco 7 – Financeiro (admin) */}
              {user?.role === 'admin' && financials && (
                <div className="kpi-card">
                  <div className="flex items-center gap-2 mb-4">
                    <DollarSign className="w-5 h-5 text-primary" />
                    <h3 className="font-semibold text-card-foreground">Financeiro</h3>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="bg-muted/30 rounded-lg p-4">
                      <label className="text-xs text-muted-foreground">Valor do Projeto</label>
                      <p className="text-lg font-bold text-card-foreground mt-1">
                        R$ {(financials.project_value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                      </p>
                    </div>
                    <div className="bg-muted/30 rounded-lg p-4">
                      <label className="text-xs text-muted-foreground">Valor Pago</label>
                      <p className="text-lg font-bold text-success mt-1">
                        R$ {(financials.paid_value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                      </p>
                    </div>
                    <div className="bg-muted/30 rounded-lg p-4">
                      <label className="text-xs text-muted-foreground">Status</label>
                      <div className="mt-1">
                        <Badge variant={financials.payment_status === 'paid' ? 'success' : financials.payment_status === 'partial' ? 'warning' : 'destructive'}>
                          {financials.payment_status === 'paid' ? 'Pago' : financials.payment_status === 'partial' ? 'Parcialmente pago' : 'Pendente'}
                        </Badge>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </motion.div>
          </TabsContent>

          {/* ── DADOS TAB ── */}
          <TabsContent value="dados">
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Titular */}
              <div className="kpi-card">
                <BlockHeader
                  icon={<User className="w-5 h-5 text-primary" />}
                  title="Dados do Titular"
                  blockKey="holder"
                />
                {editingBlock === 'holder' ? (
                  <div className="space-y-3">
                    {[
                      { label: 'Nome', key: 'holder_name', placeholder: 'Nome completo' },
                      { label: 'CPF/CNPJ', key: 'holder_cpf_cnpj', placeholder: '000.000.000-00' },
                      { label: 'E-mail', key: 'holder_email', placeholder: 'email@exemplo.com' },
                      { label: 'Telefone', key: 'holder_phone', placeholder: '(00) 00000-0000' },
                    ].map(({ label, key, placeholder }) => (
                      <div key={key}>
                        <label className="text-xs text-muted-foreground">{label}</label>
                        <Input className="mt-1 h-8 text-sm" value={(editGeneral as any)[key]} onChange={e => setEditGeneral(p => ({ ...p, [key]: e.target.value }))} placeholder={placeholder} />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div><label className="text-xs text-muted-foreground">Nome</label><FieldValue value={generalData?.holder_name} /></div>
                    <div><label className="text-xs text-muted-foreground">CPF/CNPJ</label><FieldValue value={generalData?.holder_cpf_cnpj} /></div>
                    <div><label className="text-xs text-muted-foreground">Email</label><FieldValue value={generalData?.holder_email} /></div>
                    <div><label className="text-xs text-muted-foreground">Telefone</label><FieldValue value={generalData?.holder_phone} /></div>
                  </div>
                )}
              </div>

              {/* Unidade Consumidora */}
              <div className="kpi-card">
                <BlockHeader
                  icon={<MapPin className="w-5 h-5 text-primary" />}
                  title="Unidade Consumidora"
                  blockKey="identification"
                />
                {editingBlock === 'identification' ? (
                  <div className="space-y-3">
                    {[
                      { label: 'Endereço', key: 'address', placeholder: 'Rua, número, bairro' },
                      { label: 'Cidade', key: 'city', placeholder: 'Cidade' },
                      { label: 'Estado', key: 'state', placeholder: 'UF' },
                      { label: 'Concessionária', key: 'utility_company', placeholder: 'Concessionária' },
                      { label: 'Nº UC', key: 'uc_number', placeholder: 'Número da UC' },
                    ].map(({ label, key, placeholder }) => (
                      <div key={key}>
                        <label className="text-xs text-muted-foreground">{label}</label>
                        <Input className="mt-1 h-8 text-sm" value={(editGeneral as any)[key]} onChange={e => setEditGeneral(p => ({ ...p, [key]: e.target.value }))} placeholder={placeholder} />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div><label className="text-xs text-muted-foreground">Endereço</label><FieldValue value={generalData?.address} /></div>
                    <div><label className="text-xs text-muted-foreground">Cidade/Estado</label><FieldValue value={generalData?.city ? `${generalData.city}/${generalData.state}` : null} /></div>
                    <div><label className="text-xs text-muted-foreground">Concessionária</label><FieldValue value={generalData?.utility_company} /></div>
                    <div><label className="text-xs text-muted-foreground">Nº UC</label><FieldValue value={generalData?.uc_number} /></div>
                    {generalData?.is_rural && generalData?.coordinates && (
                      <div><label className="text-xs text-muted-foreground">Coordenadas</label><FieldValue value={generalData.coordinates} /></div>
                    )}
                  </div>
                )}
              </div>

              {/* Equipamentos */}
              <div className="kpi-card">
                <BlockHeader
                  icon={<Zap className="w-5 h-5 text-primary" />}
                  title="Equipamentos"
                  blockKey="equipment"
                />
                {editingBlock === 'equipment' ? (
                  <div className="space-y-3">
                    <div><label className="text-xs text-muted-foreground">Potência Instalada (kWp)</label><Input className="mt-1 h-8 text-sm" type="number" value={editEquipment.total_installed_power} onChange={e => setEditEquipment(p => ({ ...p, total_installed_power: e.target.value }))} /></div>
                    <div><label className="text-xs text-muted-foreground">Qtd. Módulos</label><Input className="mt-1 h-8 text-sm" type="number" value={editEquipment.module_quantity} onChange={e => setEditEquipment(p => ({ ...p, module_quantity: e.target.value }))} /></div>
                    <div><label className="text-xs text-muted-foreground">Modelo do Inversor</label><Input className="mt-1 h-8 text-sm" value={editEquipment.inverter_model} onChange={e => setEditEquipment(p => ({ ...p, inverter_model: e.target.value }))} /></div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div><label className="text-xs text-muted-foreground">Potência Instalada</label><FieldValue value={equipment?.total_installed_power ? `${equipment.total_installed_power} kWp` : null} className="font-bold text-primary text-base" /></div>
                    <div><label className="text-xs text-muted-foreground">Quantidade de Módulos</label><FieldValue value={equipment?.module_quantity?.toString()} /></div>
                    <div><label className="text-xs text-muted-foreground">Modelo do Inversor</label><FieldValue value={equipment?.inverter_model} /></div>
                  </div>
                )}
              </div>

              {/* Empresa */}
              <div className="kpi-card">
                <div className="flex items-center gap-2 mb-4">
                  <Building2 className="w-5 h-5 text-primary" />
                  <h3 className="font-semibold text-card-foreground">Empresa Responsável</h3>
                </div>
                <div className="space-y-4">
                  <div><label className="text-xs text-muted-foreground">Nome</label><p className="text-sm text-card-foreground mt-1">{getCompanyDisplayName(project.companyName)}</p></div>
                  <div>
                    <label className="text-xs text-muted-foreground">Data de Criação</label>
                    <p className="text-sm text-card-foreground mt-1">{format(new Date(project.created_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}</p>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">Última Atualização</label>
                    <p className="text-sm text-card-foreground mt-1">{format(new Date(project.updated_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}</p>
                  </div>
                </div>
              </div>
            </motion.div>
          </TabsContent>

          {/* ── DOCUMENTOS TAB ── */}
          <TabsContent value="documentos">
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="kpi-card">
              <div className="flex items-center justify-between mb-6">
                <h3 className="font-semibold text-card-foreground">Documentos do Projeto</h3>
              </div>
              <div className="space-y-6">
                {docTypes.map(type => {
                  const docs = getDocsByType(type);
                  return (
                    <div key={type} className="border-b border-border pb-4 last:border-0">
                      <div className="flex items-center gap-2 mb-3">
                        {docs.length > 0 ? <CheckCircle2 className="w-4 h-4 text-success" /> : <XCircle className="w-4 h-4 text-muted-foreground" />}
                        <span className="text-sm font-medium text-card-foreground">{documentTypeLabels[type] || type}</span>
                        <Badge variant="secondary" className="text-xs">{docs.length} arquivo(s)</Badge>
                      </div>
                      {docs.length > 0 ? (
                        <div className="space-y-2 pl-6">
                          {docs.map(doc => (
                            <div key={doc.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors">
                              <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                                  <FileText className="w-4 h-4 text-primary" />
                                </div>
                                <div>
                                  <p className="text-sm font-medium text-card-foreground">{doc.file_name}</p>
                                  <p className="text-xs text-muted-foreground">{format(new Date(doc.created_at), "dd/MM/yyyy", { locale: ptBR })}</p>
                                </div>
                              </div>
                              <Button variant="ghost" size="icon" onClick={() => handleDownloadDocument(doc.file_url, doc.file_name)}>
                                <Download className="w-4 h-4" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground pl-6">Nenhum arquivo enviado</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </motion.div>
          </TabsContent>

          {/* ── COMENTÁRIOS TAB ── */}
          <TabsContent value="comentarios">
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="kpi-card">
              <h3 className="font-semibold text-card-foreground mb-6">Comentários</h3>
              <div className="space-y-4 mb-6 max-h-96 overflow-y-auto scrollbar-thin">
                {comments.map(comment => (
                  <div key={comment.id} className="flex gap-3">
                    <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 bg-primary/20">
                      <span className="text-xs font-medium text-primary">{(comment.userName || 'U').charAt(0)}</span>
                    </div>
                    <div className="flex-1 bg-muted/30 rounded-lg p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-sm font-medium text-card-foreground">{comment.userName || 'Usuário'}</span>
                        <Badge variant="secondary" className="text-[10px]">
                          {comment.userRole === 'admin' && 'Admin'}
                          {comment.userRole === 'staff' && 'Staff'}
                          {comment.userRole === 'company' && 'Empresa'}
                        </Badge>
                        <span className="text-xs text-muted-foreground ml-auto">
                          {formatDistanceToNow(new Date(comment.created_at), { addSuffix: true, locale: ptBR })}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground">{comment.message}</p>
                    </div>
                  </div>
                ))}
                {comments.length === 0 && (
                  <div className="text-center py-8">
                    <MessageSquare className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                    <p className="text-muted-foreground">Nenhum comentário ainda</p>
                  </div>
                )}
              </div>
              <div className="flex gap-3 pt-4 border-t border-border">
                <Input placeholder="Escreva um comentário..." value={newComment} onChange={e => setNewComment(e.target.value)} onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSendComment()} className="flex-1" />
                <Button variant="cta" onClick={handleSendComment} disabled={!newComment.trim() || isSendingComment}>
                  {isSendingComment ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  Enviar
                </Button>
              </div>
            </motion.div>
          </TabsContent>

          {/* ── HISTÓRICO TAB ── */}
          <TabsContent value="historico">
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="kpi-card bg-secondary">
              <h3 className="font-semibold mb-6 text-muted-foreground">Linha do Tempo</h3>
              <div className="relative">
                <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-border" />
                <div className="space-y-6">
                  {historyEntries.map((entry, index) => (
                    <div key={entry.id} className="relative pl-10">
                      <div className={`absolute left-2.5 w-3 h-3 rounded-full ${index === 0 ? 'bg-primary' : 'bg-muted'}`} />
                      <div className="rounded-lg p-4 bg-success-foreground">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm font-medium text-card-foreground">{entry.action}</span>
                          <span className="text-xs text-muted-foreground">
                            • {format(new Date(entry.created_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                          </span>
                        </div>
                        <p className="text-sm text-success">{entry.description}</p>
                        {entry.user_name && <p className="text-xs text-muted-foreground mt-2">Por {entry.user_name}</p>}
                      </div>
                    </div>
                  ))}
                  {historyEntries.length === 0 && (
                    <div className="text-center py-8">
                      <Clock className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                      <p className="text-muted-foreground">Nenhum registro no histórico</p>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          </TabsContent>

          {/* ── FINANCEIRO TAB ── */}
          {(user?.role === 'admin' || user?.role === 'company') && (
            <TabsContent value="financeiro">
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
                <ProjectFinancialCard projectId={id || ''} companyId={project?.company_id || ''} financial={project?.financialRecord as any || null} isAdmin={user?.role === 'admin'} />
              </motion.div>
            </TabsContent>
          )}
        </Tabs>

        {/* Dialogs */}
        {user?.role === 'admin' && project && (
          <StaffAssignmentDialog projectId={project.id} projectCode={project.code} open={isAssignmentDialogOpen} onOpenChange={setIsAssignmentDialogOpen} />
        )}
        {user?.role === 'admin' && project && (
          <DeleteProjectDialog projectId={project.id} projectCode={project.code} companyName={project.companyName} open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen} onSuccess={() => navigate('/projects')} />
        )}
        {isAdminOrStaff && project && (
          <GenerateDocumentDialog open={isGenerateDocDialogOpen} onOpenChange={setIsGenerateDocDialogOpen} project={project} />
        )}

        {/* Define location dialog */}
        {isAdminOrStaff && project && (
          <Dialog open={isMapDialogOpen} onOpenChange={setIsMapDialogOpen}>
            <DialogContent className="max-w-2xl w-full">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <MapPin className="w-5 h-5 text-primary" />
                  Definir localização do projeto
                </DialogTitle>
              </DialogHeader>
              <div className="py-2">
                <MapPicker
                  value={mapCoords}
                  onChange={setMapCoords}
                  showAutocomplete={true}
                  height={320}
                  draggable={true}
                  label="Clique no mapa ou busque o endereço"
                />
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setIsMapDialogOpen(false)}>Cancelar</Button>
                <Button
                  variant="cta"
                  disabled={!mapCoords || updateData.isPending}
                  onClick={async () => {
                    await updateData.mutateAsync({
                      projectId: project.id,
                      generalData: { coordinates: mapCoords },
                    });
                    setIsMapDialogOpen(false);
                  }}
                >
                  {updateData.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                  Salvar localização
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>
    </MainLayout>
  );
}
