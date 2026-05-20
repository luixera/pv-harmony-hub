import { useState, useEffect, useRef, useMemo, useCallback, memo } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { useProjects, useUpdateProjectStatus } from '@/hooks/useProjects';
import { useCompanies } from '@/hooks/useCompanies';
import { useCompanyDisplay } from '@/hooks/useCompanyDisplay';
import { useDefaultKanbanModel, useStaleProjects } from '@/hooks/useKanbanConfig';
import { useStaleNotifications } from '@/hooks/useStaleNotifications';
import { useIsMobile } from '@/hooks/use-mobile';
import { useAuth } from '@/contexts/AuthContext';
import { motion } from 'framer-motion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { NewRevisionDialog } from '@/components/revisions/NewRevisionDialog';
import { ProtocolDialog, ProtocolData } from '@/components/projects/ProtocolDialog';
import { useRegisterProtocol } from '@/hooks/useProjectProtocol';
import { useSearchParams } from 'react-router-dom';
import { Search, Building2, Zap, MapPin, Loader2, ChevronRight, ArrowRight, AlertCircle, DollarSign, MoreVertical, Trash2, Users, FileOutput, ExternalLink, XCircle, Clock, Hash } from 'lucide-react';
import { useProjectRevisions, useProjectRevisionSummary } from '@/hooks/useProjectRevisions';
import { Database } from '@/integrations/supabase/types';
import { ProjectModal } from '@/components/projects/ProjectModal';
import { StaffAssignmentDialog } from '@/components/projects/StaffAssignmentDialog';
import { GenerateDocumentDialog } from '@/components/projects/GenerateDocumentDialog';
import { DeleteProjectDialog } from '@/components/projects/DeleteProjectDialog';
import { ProjectWithDetails } from '@/hooks/useProjects';

type ProjectStatus = Database['public']['Enums']['project_status'];

const fallbackColumns: { id: string; title: string; color: string; isRejectionStage: boolean; requiresProtocol: boolean }[] = [
  { id: 'pending', title: 'Pendente', color: 'bg-muted', isRejectionStage: false, requiresProtocol: false },
  { id: 'analysis', title: 'Em Análise', color: 'bg-kanban-analysis', isRejectionStage: false, requiresProtocol: false },
  { id: 'documentation', title: 'Documentação', color: 'bg-kanban-progress', isRejectionStage: false, requiresProtocol: false },
  { id: 'approval', title: 'Aprovação', color: 'bg-kanban-progress', isRejectionStage: false, requiresProtocol: false },
  { id: 'approved', title: 'Aprovado', color: 'bg-kanban-approved', isRejectionStage: false, requiresProtocol: false },
];

const utilityCompanies = ['CPFL Energia', 'Enel SP', 'Elektro', 'EDP São Paulo', 'Energisa', 'Light', 'Cemig', 'Copel', 'Celesc', 'CEEE'];

const statusVariants: Record<string, string> = {
  pending: 'pending',
  analysis: 'analysis',
  documentation: 'progress',
  approval: 'progress',
  approved: 'approved',
  pendencia: 'pending',
  vistoria_solicitada: 'progress',
  completed: 'approved',
};

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pendente',
  analysis: 'Em Análise',
  documentation: 'Documentação',
  approval: 'Aprovação',
  approved: 'Aprovado',
  pendencia: 'Pendência',
  vistoria_solicitada: 'Vistoria Solicitada',
  completed: 'Concluído',
};

// Uses project_financials (canonical table). financialRecord is the legacy `financials` table.
function hasNoValue(project: { financials?: { project_value?: number | null } | null }) {
  return !project.financials?.project_value || project.financials.project_value === 0;
}

function RevisionBadge({ projectId }: { projectId: string }) {
  // Uses the lightweight summary hook (no joins) to avoid N heavy queries on mount
  const { data: revisions = [] } = useProjectRevisionSummary(projectId);
  if (revisions.length <= 1) return null;
  const current = revisions.find(r => r.is_current) ?? revisions[revisions.length - 1];
  if (!current) return null;
  return (
    <span
      style={{
        fontSize: 9,
        fontWeight: 700,
        padding: '2px 6px',
        borderRadius: 20,
        background: 'rgba(226,75,74,0.1)',
        color: '#A32D2D',
        border: '0.5px solid rgba(226,75,74,0.3)',
        whiteSpace: 'nowrap',
      }}
    >
      Rev. {current.revision_number}
    </span>
  );
}

// ── New revision loader for Kanban confirmation modal ────────────────────────
function KanbanNewRevisionLoader({
  project,
  open,
  onOpenChange,
}: {
  project: ProjectWithDetails;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data: revisions = [] } = useProjectRevisions(project.id);
  const currentRevision = revisions.find(r => r.is_current);
  const nextRevisionNumber = (revisions.length > 0 ? Math.max(...revisions.map(r => r.revision_number)) : 0) + 1;
  return (
    <NewRevisionDialog
      open={open}
      onOpenChange={onOpenChange}
      project={project}
      currentRevision={currentRevision}
      nextRevisionNumber={nextRevisionNumber}
    />
  );
}

// ── Shared column type (keeps prop types DRY) ────────────────────────────────
type KanbanCol = {
  id: string;
  title: string;
  color: string;
  isRejectionStage: boolean | null | undefined;
  requiresProtocol: boolean;
};

// ── Memoized card inner content ──────────────────────────────────────────────
// Extracted so React.memo can skip re-renders during drag (only outer div
// needs updating for isDragging class; the inner content is data-driven).
const KanbanCardContent = memo(function KanbanCardContent({
  project,
  isAdmin,
  daysStale,
  columns,
  companyDisplayName,
  onOpenModal,
  onChangeStatus,
}: {
  project: ProjectWithDetails;
  isAdmin: boolean;
  daysStale: number | undefined;
  columns: KanbanCol[];
  companyDisplayName: string;
  onOpenModal: (id: string) => void;
  onChangeStatus: (id: string, status: ProjectStatus) => void;
}) {
  const noValue = hasNoValue(project);
  const isStale = daysStale !== undefined;
  return (
    <>
      <div className="flex items-start justify-between mb-3">
        <span className="text-xs font-mono text-primary">{project.code}</span>
        <div className="flex items-center gap-1">
          <RevisionBadge projectId={project.id} />
          {isStale && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium cursor-default"
                  style={{ background: '#FFFBEB', color: '#92400E', border: '0.5px solid #F59E0B' }}
                >
                  <Clock className="w-2.5 h-2.5" />
                  {daysStale}d parado
                </span>
              </TooltipTrigger>
              <TooltipContent>
                <p>Projeto sem movimentação há {daysStale} dia{daysStale !== 1 ? 's' : ''}</p>
              </TooltipContent>
            </Tooltip>
          )}
          {isAdmin && noValue && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium cursor-default"
                  style={{ background: '#FFF0E6', color: '#993C1D' }}
                >
                  <DollarSign className="w-2.5 h-2.5" />
                  Sem valor
                </span>
              </TooltipTrigger>
              <TooltipContent>
                <p>Projeto sem valor atribuído</p>
              </TooltipContent>
            </Tooltip>
          )}
          <CardMenu
            project={project}
            isAdmin={isAdmin}
            columns={columns}
            onOpenModal={onOpenModal}
            onChangeStatus={onChangeStatus}
          />
        </div>
      </div>
      <h4 className="font-medium text-card-foreground text-sm mb-2">
        {project.generalData?.holder_name || project.title}
      </h4>
      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
        <Building2 className="w-3 h-3" />
        <span className="truncate">{companyDisplayName}</span>
      </div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-3">
        <MapPin className="w-3 h-3" />
        <span className="truncate">
          {project.generalData?.city}/{project.generalData?.state}
        </span>
      </div>
      <div className="flex items-center justify-between pt-3 border-t border-border/50">
        <span className="text-xs text-muted-foreground">
          {project.equipment?.total_installed_power || 0} kWp
        </span>
        <span className="text-xs text-muted-foreground">
          {project.equipment?.module_quantity || 0} módulos
        </span>
      </div>
      {project.protocol_number && (() => {
        const noProto = project.protocol_number.toLowerCase().includes('sem protocolo');
        return (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              marginTop: 6,
              paddingTop: 6,
              borderTop: '0.5px solid #F0F0F0',
            }}
          >
            <Hash size={10} color={noProto ? '#aaa' : '#378ADD'} />
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                color: noProto ? '#aaa' : '#378ADD',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {project.protocol_number}
            </span>
          </div>
        );
      })()}
    </>
  );
});

// ── Card "..." context menu ───────────────────────────────────────────────────
function CardMenu({
  project,
  isAdmin,
  columns,
  onOpenModal,
  onChangeStatus,
}: {
  project: ProjectWithDetails;
  isAdmin: boolean;
  columns: { id: string; title: string }[];
  onOpenModal: (id: string) => void;
  onChangeStatus: (id: string, status: ProjectStatus) => void;
}) {
  const [open, setOpen] = useState(false);
  const [showStatus, setShowStatus] = useState(false);
  const [showStaff, setShowStaff] = useState(false);
  const [showGenDoc, setShowGenDoc] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); setShowStatus(false); }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const menuBtn = (icon: React.ReactNode, label: string, onClick: () => void, red = false) => (
    <button
      onClick={e => { e.stopPropagation(); onClick(); setOpen(false); setShowStatus(false); }}
      style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '9px 12px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 12, color: red ? '#E24B4A' : '#333', textAlign: 'left' }}
      onMouseEnter={e => (e.currentTarget.style.background = '#F8F8F8')}
      onMouseLeave={e => (e.currentTarget.style.background = 'none')}
    >
      {icon} {label}
    </button>
  );

  return (
    <div ref={ref} style={{ position: 'relative' }} onClick={e => e.stopPropagation()}>
      <button
        onClick={e => { e.stopPropagation(); setOpen(v => !v); setShowStatus(false); }}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, borderRadius: 5, border: '0.5px solid #E0E0E0', background: '#F8F8F8', cursor: 'pointer', padding: 0 }}
      >
        <MoreVertical size={12} color="#888" />
      </button>
      {open && (
        <div style={{ position: 'absolute', top: 'calc(100% + 4px)', right: 0, background: '#fff', borderRadius: 9, border: '0.5px solid #E0E0E0', boxShadow: '0 8px 20px rgba(0,0,0,0.10)', minWidth: 190, zIndex: 50, overflow: 'visible' }}>
          {menuBtn(<ExternalLink size={12} />, 'Abrir projeto', () => onOpenModal(project.id))}

          {/* Status submenu */}
          <div style={{ position: 'relative' }}
            onMouseEnter={() => setShowStatus(true)}
            onMouseLeave={() => setShowStatus(false)}
          >
            <button
              style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '9px 12px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 12, color: '#333', textAlign: 'left', justifyContent: 'space-between' }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <ArrowRight size={12} /> Mudar status
              </span>
              <ChevronRight size={11} color="#999" />
            </button>
            {showStatus && (
              <div style={{ position: 'absolute', left: '100%', top: 0, background: '#fff', borderRadius: 9, border: '0.5px solid #E0E0E0', boxShadow: '0 8px 20px rgba(0,0,0,0.10)', minWidth: 160, zIndex: 60, overflow: 'hidden' }}>
                {columns.map(col => (
                  <button
                    key={col.id}
                    onClick={e => { e.stopPropagation(); onChangeStatus(project.id, col.id as ProjectStatus); setOpen(false); setShowStatus(false); }}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', padding: '9px 12px', border: 'none', background: col.id === project.status ? '#FEF3D0' : 'none', cursor: 'pointer', fontSize: 12, color: col.id === project.status ? '#854F0B' : '#333', textAlign: 'left' }}
                  >
                    {col.title}
                  </button>
                ))}
              </div>
            )}
          </div>

          {menuBtn(<Users size={12} />, 'Atribuir projetista', () => setShowStaff(true))}
          {menuBtn(<FileOutput size={12} />, 'Gerar documento', () => setShowGenDoc(true))}
          {isAdmin && (
            <>
              <div style={{ height: 1, background: '#F0F0F0', margin: '4px 0' }} />
              {menuBtn(<Trash2 size={12} />, 'Excluir projeto', () => setShowDelete(true), true)}
            </>
          )}
        </div>
      )}

      {/* Sub-dialogs */}
      {showStaff && <StaffAssignmentDialog open={showStaff} onOpenChange={setShowStaff} projectId={project.id} projectCode={project.code} />}
      {showGenDoc && <GenerateDocumentDialog open={showGenDoc} onOpenChange={setShowGenDoc} project={project} />}
      {showDelete && (
        <DeleteProjectDialog
          open={showDelete}
          onOpenChange={setShowDelete}
          projectId={project.id}
          projectCode={project.code}
          companyName={project.companyName}
        />
      )}
    </div>
  );
}

// ── Protocol dialog com revisão carregada ─────────────────────────────────────
function ProtocolDialogWithRevision({
  protocolDialog,
  projects,
  onConfirm,
  onCancel,
}: {
  protocolDialog: { open: boolean; projectId: string; projectCode: string; concessionaireName: string; newStatus: string; currentRevisionNumber: number };
  projects: ProjectWithDetails[];
  onConfirm: (data: import('@/components/projects/ProtocolDialog').ProtocolData) => void;
  onCancel: () => void;
}) {
  const { data: revisions = [] } = useProjectRevisions(protocolDialog.projectId);
  const currentRevision = revisions.find(r => r.is_current);
  const revisionNumber = currentRevision?.revision_number ?? 1;
  const project = projects.find(p => p.id === protocolDialog.projectId);
  return (
    <ProtocolDialog
      open={protocolDialog.open}
      onOpenChange={(open) => { if (!open) onCancel(); }}
      projectId={protocolDialog.projectId}
      projectCode={protocolDialog.projectCode}
      concessionaireName={project?.concessionaireName || protocolDialog.concessionaireName}
      currentRevisionNumber={revisionNumber}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}

// ── Main Kanban ───────────────────────────────────────────────────────────────
export default function ProjectsKanban() {
  const [searchParams] = useSearchParams();
  const isMobile = useIsMobile();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const { data: projects = [], isLoading } = useProjects();
  const { data: companies = [] } = useCompanies();
  const { getCompanyDisplayName, shouldHideCompanyName } = useCompanyDisplay();
  const { data: kanbanModel, isLoading: isLoadingModel } = useDefaultKanbanModel();
  const { data: staleProjectsData = [] } = useStaleProjects();
  const updateStatus = useUpdateProjectStatus();
  const registerProtocol = useRegisterProtocol();

  // Generate stale notifications (admin only, runs in background)
  useStaleNotifications();

  const [searchTerm, setSearchTerm] = useState('');
  const [companyFilter, setCompanyFilter] = useState<string>('all');
  const [utilityFilter, setUtilityFilter] = useState<string>('all');
  const [mobileStatusFilter, setMobileStatusFilter] = useState<string>('all');
  const [noValueFilter, setNoValueFilter] = useState(false);
  const [modalProjectId, setModalProjectId] = useState<string | null>(null);
  const [pendingDrop, setPendingDrop] = useState<{ projectId: string; targetStatus: ProjectStatus } | null>(null);
  const [showKanbanRevision, setShowKanbanRevision] = useState(false);
  const [protocolDialog, setProtocolDialog] = useState<{
    open: boolean;
    projectId: string;
    projectCode: string;
    concessionaireName: string;
    currentRevisionNumber: number;
    newStatus: string;
  } | null>(null);

  // Auto-activate from query param ?filter=no-value
  useEffect(() => {
    if (searchParams.get('filter') === 'no-value') {
      setNoValueFilter(true);
    }
  }, [searchParams]);

  // ── Memoized derivations ─────────────────────────────────────────────────
  // staleMap: id → days_stale (only recomputed when staleProjectsData changes)
  const staleMap = useMemo(
    () => new Map(staleProjectsData.map(s => [s.id, Math.floor(s.days_stale)])),
    [staleProjectsData]
  );

  const filteredProjects = useMemo(() => projects.filter(project => {
    const holderName = project.generalData?.holder_name || project.title || '';
    const matchesSearch =
      project.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
      holderName.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCompany = companyFilter === 'all' || project.company_id === companyFilter;
    const matchesUtility = utilityFilter === 'all' || project.generalData?.utility_company === utilityFilter;
    const matchesStatus = mobileStatusFilter === 'all' || project.status === mobileStatusFilter;
    const matchesNoValue = !noValueFilter || hasNoValue(project);
    return matchesSearch && matchesCompany && matchesUtility && matchesNoValue && (isMobile ? matchesStatus : true);
  }), [projects, searchTerm, companyFilter, utilityFilter, mobileStatusFilter, noValueFilter, isMobile]);

  const kanbanColumns = useMemo(() => kanbanModel?.columns?.map(col => ({
    id: col.status_key,
    title: col.status_label,
    color: col.color,
    isRejectionStage: col.is_rejection_stage,
    requiresProtocol: col.requires_protocol ?? false,
  })) || fallbackColumns, [kanbanModel]);

  // Pre-grouped projects per column — O(N) once, not O(N×C) in the render loop
  const projectsByStatus = useMemo(() => {
    const map = new Map<string, ProjectWithDetails[]>();
    for (const col of kanbanColumns) {
      map.set(col.id, []);
    }
    for (const p of filteredProjects) {
      const bucket = map.get(p.status);
      if (bucket) bucket.push(p);
    }
    return map;
  }, [filteredProjects, kanbanColumns]);

  // ── Stable callbacks (prevent KanbanCardContent re-renders via React.memo) ─
  const handleOpenModal = useCallback((id: string) => setModalProjectId(id), []);
  const handleChangeStatus = useCallback((id: string, status: ProjectStatus) => {
    updateStatus.mutate({ projectId: id, status });
  }, [updateStatus]);

  const handleDragEnd = useCallback((result: DropResult) => {
    if (!result.destination) return;
    const { draggableId, destination } = result;
    const newStatus = destination.droppableId as ProjectStatus;
    const targetCol = kanbanColumns.find(c => c.id === newStatus);
    if (!targetCol) return;

    // Interceptar coluna de reprovação
    if (targetCol.isRejectionStage) {
      setPendingDrop({ projectId: draggableId, targetStatus: newStatus });
      return;
    }

    // Interceptar coluna que exige protocolo
    if (targetCol.requiresProtocol) {
      const project = projects.find(p => p.id === draggableId);
      if (!project) return;
      setProtocolDialog({
        open: true,
        projectId: draggableId,
        projectCode: project.code,
        concessionaireName: project.concessionaireName || '',
        currentRevisionNumber: 1, // será atualizado pelo componente
        newStatus,
      });
      return;
    }

    updateStatus.mutate({ projectId: draggableId, status: newStatus });
  }, [kanbanColumns, projects, updateStatus]);

  const handleProtocolConfirm = useCallback(async (data: ProtocolData) => {
    if (!protocolDialog) return;
    const revisionNumber = protocolDialog.currentRevisionNumber;
    await registerProtocol.mutateAsync({
      projectId: protocolDialog.projectId,
      revisionNumber,
      protocolNumber: data.protocol_number,
      noProtocol: data.no_protocol,
      noProtocolReason: data.no_protocol_reason,
      newStatus: protocolDialog.newStatus,
    });
    setProtocolDialog(null);
  }, [protocolDialog, registerProtocol]);

  const handleProtocolCancel = useCallback(() => {
    setProtocolDialog(null);
  }, []);

  if (isLoading || isLoadingModel) {
    return (
      <MainLayout>
        <div className="flex items-center justify-center h-96">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex flex-col gap-3">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-foreground">Kanban de Projetos</h1>
            {!isMobile && <p className="text-muted-foreground mt-1">Arraste os cards para alterar o status</p>}
          </div>

          {/* Filters */}
          <div className="flex flex-wrap gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Buscar projetos..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 bg-muted/50 h-11 text-base"
              />
            </div>

            {isMobile && (
              <Select value={mobileStatusFilter} onValueChange={setMobileStatusFilter}>
                <SelectTrigger className="w-40 bg-muted/50 h-11 text-sm">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os status</SelectItem>
                  {kanbanColumns.map(col => (
                    <SelectItem key={col.id} value={col.id}>{col.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {!isMobile && !shouldHideCompanyName && (
              <Select value={companyFilter} onValueChange={setCompanyFilter}>
                <SelectTrigger className="w-48 bg-muted/50">
                  <Building2 className="w-4 h-4 mr-2" />
                  <SelectValue placeholder="Empresa" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as empresas</SelectItem>
                  {companies.map(company => (
                    <SelectItem key={company.id} value={company.id}>{company.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {!isMobile && (
              <Select value={utilityFilter} onValueChange={setUtilityFilter}>
                <SelectTrigger className="w-48 bg-muted/50">
                  <Zap className="w-4 h-4 mr-2" />
                  <SelectValue placeholder="Concessionária" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as concessionárias</SelectItem>
                  {utilityCompanies.map(utility => (
                    <SelectItem key={utility} value={utility}>{utility}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {isAdmin && (
              <Button
                variant={noValueFilter ? 'default' : 'outline'}
                size="sm"
                className="h-11 gap-2 font-medium"
                style={noValueFilter
                  ? { background: '#F5A800', color: '#1A1A1A', borderColor: '#F5A800' }
                  : { borderColor: '#F5A800', color: '#F5A800' }}
                onClick={() => setNoValueFilter(v => !v)}
              >
                <AlertCircle className="w-4 h-4" />
                Sem valor
                {noValueFilter && (
                  <span className="ml-1 bg-white/30 text-inherit rounded-full px-1.5 text-[11px] font-bold">
                    {projects.filter(hasNoValue).length}
                  </span>
                )}
              </Button>
            )}
          </div>
        </div>

        {/* MOBILE: List view */}
        {isMobile ? (
          <div className="space-y-3">
            {filteredProjects.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <p>Nenhum projeto encontrado</p>
              </div>
            ) : (
              filteredProjects.map((project) => {
                const col = kanbanColumns.find(c => c.id === project.status);
                const noValue = hasNoValue(project);
                const daysStale = staleMap.get(project.id);
                const isStale = daysStale !== undefined;
                return (
                  <motion.div
                    key={project.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-card rounded-xl p-4 border border-white/10 shadow-md"
                    style={isStale ? { borderLeft: '3px solid #F59E0B' } : undefined}
                    onClick={() => setModalProjectId(project.id)}
                  >
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-mono text-primary mb-1">{project.code}</p>
                        <h4 className="font-semibold text-card-foreground text-base leading-tight truncate">
                          {project.generalData?.holder_name || project.title}
                        </h4>
                      </div>
                      <div className="flex flex-col items-end gap-1 flex-shrink-0">
                        <Badge variant={statusVariants[project.status] as any} className="text-xs">
                          {col?.title || project.status}
                        </Badge>
                        {isStale && (
                          <span
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium"
                            style={{ background: '#FFFBEB', color: '#92400E', border: '0.5px solid #F59E0B' }}
                          >
                            <Clock className="w-2.5 h-2.5" />
                            {daysStale}d parado
                          </span>
                        )}
                        {isAdmin && noValue && (
                          <Badge className="text-[10px] gap-1" style={{ background: '#FFF0E6', color: '#993C1D', border: 'none' }}>
                            <DollarSign className="w-2.5 h-2.5" />
                            Sem valor
                          </Badge>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground mt-2">
                      <span className="flex items-center gap-1 truncate">
                        <Building2 className="w-3 h-3 flex-shrink-0" />
                        {getCompanyDisplayName(project.companyName)}
                      </span>
                      {project.generalData?.city && (
                        <span className="flex items-center gap-1 truncate">
                          <MapPin className="w-3 h-3 flex-shrink-0" />
                          {project.generalData.city}/{project.generalData.state}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center justify-between mt-3 pt-2 border-t border-border/50">
                      <span className="text-xs text-muted-foreground">
                        {project.equipment?.total_installed_power || 0} kWp · {project.equipment?.module_quantity || 0} módulos
                      </span>
                      <ChevronRight className="w-4 h-4 text-muted-foreground" />
                    </div>
                  </motion.div>
                );
              })
            )}
          </div>
        ) : (
          /* DESKTOP: Kanban board */
          <DragDropContext onDragEnd={handleDragEnd}>
            <div className="flex gap-4 overflow-x-auto pb-4 scrollbar-thin">
              {kanbanColumns.map((column, columnIndex) => (
                <motion.div
                  key={column.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: columnIndex * 0.1 }}
                  className="flex-shrink-0 w-80"
                >
                  {column.isRejectionStage ? (
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        marginBottom: 16,
                        background: '#E24B4A',
                        borderRadius: 8,
                        padding: '6px 12px',
                      }}
                    >
                      <XCircle size={14} style={{ color: '#fff', flexShrink: 0 }} />
                      <span style={{ fontWeight: 700, color: '#fff', fontSize: 14 }}>
                        {column.title}
                      </span>
                      <span
                        style={{
                          marginLeft: 'auto',
                          fontSize: 11,
                          fontWeight: 700,
                          background: 'rgba(255,255,255,0.2)',
                          color: '#fff',
                          borderRadius: 20,
                          padding: '1px 8px',
                        }}
                      >
                        {(projectsByStatus.get(column.id) || []).length}
                      </span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3 mb-4">
                      <div className={`w-3 h-3 rounded-full ${column.color}`} />
                      <h3 className="font-semibold text-foreground">{column.title}</h3>
                      <Badge variant="secondary" className="ml-auto">
                        {(projectsByStatus.get(column.id) || []).length}
                      </Badge>
                    </div>
                  )}

                  <Droppable droppableId={column.id}>
                    {(provided, snapshot) => (
                      <div
                        ref={provided.innerRef}
                        {...provided.droppableProps}
                        className={`kanban-column transition-colors ${
                          snapshot.isDraggingOver ? 'bg-primary/10 ring-2 ring-primary/20' : ''
                        }`}
                      >
                        {(projectsByStatus.get(column.id) || []).map((project, index) => {
                          const daysStale = staleMap.get(project.id);
                          return (
                            <Draggable key={project.id} draggableId={project.id} index={index}>
                              {(provided, snapshot) => (
                                <div
                                  ref={provided.innerRef}
                                  {...provided.draggableProps}
                                  {...provided.dragHandleProps}
                                  onClick={() => handleOpenModal(project.id)}
                                  className={`kanban-card mb-3 ${
                                    snapshot.isDragging ? 'shadow-2xl ring-2 ring-primary' : ''
                                  }`}
                                  style={daysStale !== undefined ? { borderLeft: '3px solid #F59E0B', borderRadius: 8 } : undefined}
                                >
                                  <KanbanCardContent
                                    project={project}
                                    isAdmin={isAdmin}
                                    daysStale={daysStale}
                                    columns={kanbanColumns}
                                    companyDisplayName={getCompanyDisplayName(project.companyName)}
                                    onOpenModal={handleOpenModal}
                                    onChangeStatus={handleChangeStatus}
                                  />
                                </div>
                              )}
                            </Draggable>
                          );
                        })}
                        {provided.placeholder}
                        {(projectsByStatus.get(column.id) || []).length === 0 && (
                          <div className="text-center py-8 text-muted-foreground text-sm">
                            Nenhum projeto
                          </div>
                        )}
                      </div>
                    )}
                  </Droppable>
                </motion.div>
              ))}
            </div>
          </DragDropContext>
        )}
      </div>

      {/* Project Modal */}
      {modalProjectId && (
        <ProjectModal
          projectId={modalProjectId}
          onClose={() => setModalProjectId(null)}
        />
      )}

      {/* Protocol Dialog */}
      {protocolDialog?.open && (
        <ProtocolDialogWithRevision
          protocolDialog={protocolDialog}
          projects={projects}
          onConfirm={handleProtocolConfirm}
          onCancel={handleProtocolCancel}
        />
      )}

      {/* Rejection confirmation modal */}
      <Dialog
        open={!!pendingDrop && !showKanbanRevision}
        onOpenChange={(open) => { if (!open) setPendingDrop(null); }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mover para coluna de reprovação</DialogTitle>
            <DialogDescription>
              Este projeto será marcado como reprovado. Deseja também registrar uma nova revisão com o motivo da reprovação?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button
              variant="outline"
              onClick={() => setPendingDrop(null)}
            >
              Cancelar
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                if (pendingDrop) {
                  updateStatus.mutate({ projectId: pendingDrop.projectId, status: pendingDrop.targetStatus });
                }
                setPendingDrop(null);
              }}
            >
              Só mover
            </Button>
            <Button
              onClick={() => {
                if (pendingDrop) {
                  updateStatus.mutate({ projectId: pendingDrop.projectId, status: pendingDrop.targetStatus });
                  setShowKanbanRevision(true);
                }
              }}
              style={{ background: '#E24B4A', color: '#fff' }}
            >
              Mover e registrar revisão
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New revision dialog triggered from Kanban */}
      {pendingDrop && showKanbanRevision && (() => {
        const project = projects.find(p => p.id === pendingDrop.projectId);
        if (!project) return null;
        return (
          <KanbanNewRevisionLoader
            project={project}
            open={showKanbanRevision}
            onOpenChange={(open) => {
              setShowKanbanRevision(open);
              if (!open) setPendingDrop(null);
            }}
          />
        );
      })()}
    </MainLayout>
  );
}
