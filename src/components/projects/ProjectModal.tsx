import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useWindowSize } from '@/hooks/useWindowSize';
import { formatCurrency, sanitizeFileName } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { useCompanyDisplay } from '@/hooks/useCompanyDisplay';
import { useProject, useUpdateProjectStatus, useUpdateProjectData } from '@/hooks/useProjects';
import { useComments, useAddComment } from '@/hooks/useComments';
import { useDocuments, useUploadDocument, useDocumentUrl } from '@/hooks/useDocuments';
import { useProjectHistory } from '@/hooks/useHistory';
import { useStageChecklists } from '@/hooks/useStageChecklists';
import { usePaymentHistory, useAddPaymentHistory, useUpdateProjectValue, useReverseSinglePayment, PaymentHistoryEntry } from '@/hooks/usePaymentHistory';
import { useProjectRevisions } from '@/hooks/useProjectRevisions';
import { useRejectionColumn } from '@/hooks/useKanbanConfig';
import { useProjectProtocols, useRegisterProtocol } from '@/hooks/useProjectProtocol';
import { ProtocolDialog } from './ProtocolDialog';
import { RevisionSelector } from '@/components/revisions/RevisionSelector';
import { RevisionTimeline } from '@/components/revisions/RevisionTimeline';
import { NewRevisionDialog } from '@/components/revisions/NewRevisionDialog';
import { GenerateDocumentDialog } from './GenerateDocumentDialog';
import { InstallerPackageDialog } from './InstallerPackageDialog';
import { Package as PackageIcon } from 'lucide-react';
import { StaffAssignmentDialog } from './StaffAssignmentDialog';
import { useProjectAssignments } from '@/hooks/useProjectAssignments';
import { useDefaultKanbanModel } from '@/hooks/useKanbanConfig';
import { useMinhasEmpresasDeStaff } from '@/hooks/useStaffCompanies';
import { logSystemEvent } from '@/lib/systemLog';
import { EquipmentModelCombobox } from '@/components/equipment/EquipmentModelCombobox';
import { UnifilarTab } from './UnifilarTab';
import { useDiagramEngineAccess } from '@/hooks/useDiagramEngineAccess';
import { DeleteProjectDialog } from './DeleteProjectDialog';
import { Badge } from '@/components/ui/badge';
import {
  X, ExternalLink, Pencil, FileOutput, MoreVertical, Users, Trash2,
  Check, ChevronRight, Upload, Download, Send, Paperclip, FileText,
  Image, Loader2, AlertTriangle, Save, Lock, DollarSign, Clock, MapPin, Hash,
  CheckSquare, Plus, Circle, CheckCircle2, Calendar, User as UserIcon, RotateCcw, FlaskConical, Mail,
  Search,
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { toast } from 'sonner';
import { ProjectEmailsTab } from '@/components/projects/ProjectEmailsTab';
import { supabase } from '@/integrations/supabase/client';
import { Database } from '@/integrations/supabase/types';
import { ProjectWithDetails } from '@/hooks/useProjects';
import { useProjectTasks, useUpdateTask, Task, TaskPriority } from '@/hooks/useTasks';
import { TaskDialog } from '@/components/tasks/TaskDialog';
import { matchEntryRule, useEntryRules } from '@/hooks/useEntryRules';
import { useVistoriaStatus, useSolicitarVistoria } from '@/hooks/useVistoria';

type ProjectStatus = Database['public']['Enums']['project_status'];
type DocumentType = Database['public']['Enums']['document_type'];

const STATUS_STEPS: ProjectStatus[] = ['pending', 'analysis', 'documentation', 'approval', 'approved', 'completed'];
const STATUS_LABELS: Record<string, string> = {
  pending: 'Aguardando',
  analysis: 'Em Análise',
  documentation: 'Documentação',
  approval: 'Aprovação',
  approved: 'Aprovado',
  rejected: 'Reprovado',
  completed: 'Concluído',
};
const DOC_TYPE_LABELS: Record<string, string> = {
  energy_bill_generator: 'Conta de energia - Geradora',
  energy_bill_beneficiaries: 'Contas de energia - Beneficiárias',
  holder_document: 'Documento do titular',
  entrance_standard_photo: 'Foto do padrão de entrada',
  breaker_photo: 'Foto do disjuntor',
  other_photos: 'Outras fotos',
  // Titular pessoa jurídica
  cnpj_card: 'Cartão CNPJ',
  social_contract: 'Contrato social',
  legal_rep_document: 'Documento do responsável legal',
  power_of_attorney: 'Procuração',
  extra_attachment: 'Arquivos extras',
};
const ROLE_COLORS: Record<string, { bg: string; color: string; label: string }> = {
  admin:   { bg: '#FEF3D0', color: '#854F0B', label: 'Admin' },
  staff:   { bg: '#E6F1FB', color: '#185FA5', label: 'Projetista' },
  company: { bg: '#E1F5EE', color: '#0F6E56', label: 'Empresa' },
};

interface ProjectModalProps {
  projectId: string;
  onClose: () => void;
  initialTab?: string;
  /**
   * Simulação do ambiente da empresa ("Ver como empresa"). O modal decide o que
   * mostrar pelo PAPEL de quem abriu; sem este aviso, o admin simulando via a
   * si mesmo — com Unifilar, Financeiro, Histórico e as ferramentas da equipe —
   * e a tela deixava de cumprir o que promete, que é conferir a experiência do
   * cliente (relato do usuário, set/2026).
   */
  viewAsCompany?: boolean;
}

// ── Document Preview ───────────────────────────────────────────────────────────
function DocPreview({ filePath, fileName }: { filePath: string; fileName: string }) {
  const { data: url, isLoading } = useDocumentUrl(filePath);
  const [isDownloading, setIsDownloading] = useState(false);
  const isImage = /\.(png|jpe?g|gif|webp)$/i.test(fileName);
  const isPdf = /\.pdf$/i.test(fileName);

  // Baixa o arquivo como blob e dispara o download (o navegador pergunta onde
  // salvar) sem sair da página. O atributo `download` de um <a> é ignorado em
  // URLs de outro domínio (as URLs assinadas do Supabase), por isso o download
  // direto do blob.
  const handleDownload = async () => {
    if (isDownloading) return;
    setIsDownloading(true);
    try {
      const { data, error } = await supabase.storage.from('project-documents').download(filePath);
      if (error || !data) throw error ?? new Error('download vazio');
      const objectUrl = URL.createObjectURL(data);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (e) {
      console.error('Erro ao baixar documento:', e);
      toast.error('Não foi possível baixar o arquivo');
    } finally {
      setIsDownloading(false);
    }
  };

  if (isLoading) return (
    <div className="flex-1 flex items-center justify-center">
      <Loader2 className="w-6 h-6 animate-spin" style={{ color: '#F5A800' }} />
    </div>
  );
  if (!url) return null;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div style={{ padding: '8px 12px', borderBottom: '1px solid #F0F0F0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#1A1A1A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>{fileName}</span>
        <button onClick={handleDownload} disabled={isDownloading} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#F5A800', fontWeight: 600, background: 'none', border: 'none', cursor: isDownloading ? 'default' : 'pointer', padding: 0 }}>
          {isDownloading ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />} Baixar
        </button>
      </div>
      {isPdf && <iframe src={url} title={fileName} style={{ flex: 1, border: 'none', minHeight: 0 }} />}
      {isImage && <img src={url} alt={fileName} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', margin: 'auto', padding: 12 }} />}
      {!isPdf && !isImage && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <FileText size={40} style={{ color: '#E0E0E0' }} />
          <button onClick={handleDownload} disabled={isDownloading} style={{ color: '#F5A800', fontWeight: 600, fontSize: 13, background: 'none', border: 'none', cursor: isDownloading ? 'default' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            {isDownloading ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} Baixar arquivo
          </button>
        </div>
      )}
    </div>
  );
}

// ── Progress Bar ───────────────────────────────────────────────────────────────
function ProgressBar({ currentStatus, canChange, onChangeStatus }: {
  currentStatus: string;
  canChange: boolean;
  onChangeStatus: (s: ProjectStatus) => void;
}) {
  // As etapas vêm do MESMO modelo que o quadro usa (`useDefaultKanbanModel`).
  //
  // Antes havia aqui uma consulta própria a `kanban_columns`, e ela dava três
  // problemas ao mesmo tempo (relato do usuário, ago/2026): guardava o
  // resultado por 10 minutos, então mudar a configuração não refletia aqui;
  // usava uma chave de cache que NENHUMA mutação da tela de configuração
  // invalidava, então nem ao recarregar a lista chegava; e lia as colunas sem
  // filtrar por modelo — com dois modelos cadastrados, misturaria as etapas
  // dos dois. Uma fonte só resolve os três.
  const { data: kanbanModel } = useDefaultKanbanModel();
  const kanbanCols = kanbanModel?.columns ?? [];

  // Fall back to hardcoded steps while columns load
  const steps = kanbanCols.length > 0
    ? kanbanCols.map(c => ({
        key: c.status_key as string,
        label: c.status_label as string,
        isRejection: c.is_rejection_stage as boolean,
      }))
    : STATUS_STEPS.map(s => ({ key: s, label: STATUS_LABELS[s] || s, isRejection: false }));

  const currentIndex = steps.findIndex(s => s.key === currentStatus);

  return (
    <div style={{ background: '#242424', padding: '16px 28px 14px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 0, overflowX: 'auto' }}>
      {steps.map((step, i) => {
        const done = i < currentIndex;
        const active = i === currentIndex;
        const isLast = i === steps.length - 1;
        const dotColor = step.isRejection ? '#E24B4A' : '#F5A800';
        return (
          <div key={step.key} style={{ display: 'flex', alignItems: 'flex-start', flex: isLast ? 0 : 1, minWidth: isLast ? 'auto' : 0 }}>
            {/* Step column: circle + label.
                Largura FIXA: o rótulo é livre (o usuário nomeia a etapa como
                quiser) e antes saía em linha única sem limite, empurrando a
                coluna e escrevendo por cima da etapa vizinha — "PENDÊNCIA
                DOCUMENTAL / AGUARDANDO…" cobria a etapa seguinte inteira. */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, width: 92, flexShrink: 0 }}>
              <button
                onClick={() => canChange && onChangeStatus(step.key as ProjectStatus)}
                disabled={!canChange}
                title={step.label}
                style={{
                  width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: done ? dotColor : active ? '#fff' : 'rgba(255,255,255,0.12)',
                  border: done ? `2.5px solid ${dotColor}` : active ? `2.5px solid ${dotColor}` : '2.5px solid rgba(255,255,255,0.15)',
                  boxShadow: active ? `0 0 0 4px ${step.isRejection ? 'rgba(226,75,74,0.15)' : 'rgba(245,168,0,0.15)'}` : 'none',
                  cursor: canChange ? 'pointer' : 'default',
                  transition: 'all 0.15s',
                  color: done ? '#1A1A1A' : active ? '#1A1A1A' : 'rgba(255,255,255,0.3)',
                }}
              >
                {done && <Check size={11} strokeWidth={3} />}
              </button>
              <span
                title={step.label}
                style={{
                  fontSize: 9, fontWeight: done ? 500 : active ? 600 : 400,
                  color: done ? dotColor : active ? (step.isRejection ? '#E24B4A' : '#fff') : 'rgba(255,255,255,0.3)',
                  letterSpacing: '0.01em',
                  // quebra em até 2 linhas e corta com reticências no que passar;
                  // o texto completo fica no `title` (aparece ao passar o mouse)
                  width: '100%', textAlign: 'center', lineHeight: 1.25,
                  display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                  overflow: 'hidden', overflowWrap: 'anywhere',
                }}
              >
                {step.label}
              </span>
            </div>
            {/* Connector line (right of step, except last) */}
            {!isLast && (
              <div style={{ flex: 1, height: 2, background: done ? dotColor : 'rgba(255,255,255,0.1)', marginTop: 11, minWidth: 12 }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Checklist Dialog ───────────────────────────────────────────────────────────
function ChecklistBlockDialog({ fromStatus, toStatus, presentDocs, onClose, onGoToDocs }: {
  fromStatus: string;
  toStatus: string;
  presentDocs: string[];
  onClose: () => void;
  onGoToDocs: () => void;
}) {
  const { data: checklists = [] } = useStageChecklists();
  const rule = checklists.find(c => c.from_status === fromStatus && c.to_status === toStatus);
  if (!rule) return null;
  const required = rule.required_documents || [];
  const missing = required.filter(d => !presentDocs.includes(d));
  const present = required.filter(d => presentDocs.includes(d));
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(26,26,26,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
      <div style={{ background: '#fff', borderRadius: 12, padding: 24, maxWidth: 420, width: '90%', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <AlertTriangle size={20} color="#E24B4A" />
          <h3 style={{ fontSize: 15, fontWeight: 700, color: '#1A1A1A' }}>Documentos obrigatórios pendentes</h3>
        </div>
        {missing.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <p style={{ fontSize: 12, color: '#999', marginBottom: 8 }}>Faltando:</p>
            {missing.map(d => (
              <div key={d} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}>
                <X size={14} color="#E24B4A" />
                <span style={{ fontSize: 13, color: '#333' }}>{DOC_TYPE_LABELS[d] || d}</span>
              </div>
            ))}
          </div>
        )}
        {present.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <p style={{ fontSize: 12, color: '#999', marginBottom: 8 }}>Já enviados:</p>
            {present.map(d => (
              <div key={d} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}>
                <Check size={14} color="#22C55E" />
                <span style={{ fontSize: 13, color: '#888' }}>{DOC_TYPE_LABELS[d] || d}</span>
              </div>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button onClick={onGoToDocs} style={{ flex: 1, padding: '9px 0', borderRadius: 7, background: '#F5A800', border: 'none', color: '#1A1A1A', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
            Ir para documentos
          </button>
          <button onClick={onClose} style={{ padding: '9px 16px', borderRadius: 7, background: '#F0F0F0', border: 'none', color: '#555', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function parseCoordsModal(value: string | null | undefined): { lat: number; lng: number } | null {
  if (!value) return null;
  const parts = value.split(',').map(s => parseFloat(s.trim()));
  if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
    return { lat: parts[0], lng: parts[1] };
  }
  return null;
}

// ── Tab: General ───────────────────────────────────────────────────────────────
/**
 * Bloco de equipamento (inversor ou módulo) do modal.
 *
 * Em edição, o campo Modelo é um combobox do catálogo — assim dá para trocar
 * o equipamento por um já cadastrado sem redigitar, e escolher um item
 * preenche marca e potência de uma vez. Digitar livre continua permitido,
 * para quem tem um equipamento fora do catálogo.
 */
function EquipmentBlock<T extends Record<string, string>>({
  titulo, type, campos, labels, isEditing, form, setForm,
}: {
  titulo: string;
  type: 'inverter' | 'module';
  campos: string[];
  labels: Record<string, string>;
  isEditing: boolean;
  form: T;
  setForm: React.Dispatch<React.SetStateAction<T>>;
}) {
  const campoModelo = `${type}_model`;
  const campoMarca = `${type}_brand`;
  const campoPotencia = `${type}_power`;

  return (
    <div style={{ background: '#F8F8F8', borderRadius: 10, padding: '16px 20px', border: '1px solid #EFEFEF' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
        <p style={{ fontSize: 11, fontWeight: 700, color: '#888', margin: 0 }}>{titulo}</p>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {campos.map(k => (
          <div key={k} style={{
            display: 'flex', flexDirection: isEditing ? 'column' : 'row',
            justifyContent: 'space-between', alignItems: isEditing ? 'flex-start' : 'center',
            gap: isEditing ? 3 : 0,
          }}>
            <span style={{
              fontSize: 11, color: '#aaa', fontWeight: 600, textTransform: 'uppercase',
              letterSpacing: '0.05em', whiteSpace: 'nowrap', flexShrink: 0,
            }}>{labels[k]}</span>

            {!isEditing ? (
              form[k]
                ? <span style={{
                    fontSize: 13, fontWeight: 500, color: '#1A1A1A', textAlign: 'right',
                    overflowWrap: 'anywhere', wordBreak: 'break-word', minWidth: 0, paddingLeft: 8,
                  }}>{form[k]}</span>
                : <em style={{ color: '#ccc', fontSize: 12 }}>—</em>
            ) : k === campoModelo ? (
              <div style={{ width: '100%' }}>
                <EquipmentModelCombobox
                  type={type}
                  brand={form[campoMarca]}
                  value={form[k]}
                  onType={v => setForm(f => ({ ...f, [k]: v }))}
                  onSelect={sel => setForm(f => ({
                    ...f,
                    [campoMarca]: sel.brand,
                    [campoModelo]: sel.model,
                    ...(sel.power != null ? { [campoPotencia]: String(sel.power) } : {}),
                  }))}
                  placeholder="Buscar no catálogo ou digitar…"
                />
              </div>
            ) : (
              <input
                value={form[k]}
                onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))}
                style={{
                  width: '100%', padding: '5px 8px', borderRadius: 6,
                  border: '1px solid #E0E0E0', fontSize: 13, color: '#1A1A1A', outline: 'none',
                }}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * "Antes da Revisão N" — o que o projeto tinha ANTES da revisão vigente.
 *
 * O card de equipamentos passou a mostrar a revisão atual (que é o correto:
 * é ela que vale para diagrama e documentos), e com isso o dado original
 * sumia da tela. Este bloco devolve o histórico sem obrigar a trocar de aba:
 * lista SÓ o que mudou, de → para (pedido do usuário, ago/2026).
 */
const CAMPOS_EQUIP: [string, string][] = [
  ['inverter_brand', 'Inversor — Marca'],
  ['inverter_model', 'Inversor — Modelo'],
  ['inverter_power', 'Inversor — Potência (kW)'],
  ['inverter_quantity', 'Inversor — Quantidade'],
  ['module_brand', 'Módulos — Marca'],
  ['module_model', 'Módulos — Modelo'],
  ['module_power', 'Módulos — Potência (Wp)'],
  ['module_quantity', 'Módulos — Quantidade'],
  ['total_installed_power', 'Potência total (kWp)'],
];

function AntesDaRevisao({ original, atual, numero }: {
  original: Record<string, unknown>;
  atual: Record<string, unknown> | undefined;
  numero: number;
}) {
  const mudancas = CAMPOS_EQUIP
    .map(([chave, rotulo]) => ({
      rotulo,
      de: original?.[chave] ?? null,
      para: atual?.[chave] ?? null,
    }))
    .filter(m => String(m.de ?? '') !== String(m.para ?? ''));

  if (mudancas.length === 0) return null;

  return (
    <div style={{ marginTop: 14, border: '1px solid #E6E6E6', borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ padding: '7px 12px', background: '#FAFAFA', borderBottom: '1px solid #EEE' }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#555' }}>
          Antes da Revisão {numero}
        </span>
        <span style={{ fontSize: 10.5, color: '#999', marginLeft: 8 }}>
          {mudancas.length} alteração(ões) — o card acima mostra o que vale hoje
        </span>
      </div>
      <div style={{ padding: '6px 12px' }}>
        {mudancas.map(m => (
          <div key={m.rotulo} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', padding: '3px 0', fontSize: 11.5 }}>
            <span style={{ color: '#777', minWidth: 175 }}>{m.rotulo}</span>
            <span style={{ color: '#B3261E', textDecoration: 'line-through' }}>{String(m.de ?? '—')}</span>
            <span style={{ color: '#999' }}>→</span>
            <span style={{ color: '#0F6E56', fontWeight: 600 }}>{String(m.para ?? '—')}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Anexo dentro do comentário. Imagem vira MINIATURA clicável; o resto continua
 * como link com clipe.
 *
 * O nome do arquivo sozinho não diz nada quando a conversa tem várias fotos da
 * obra — a miniatura resolve sem precisar abrir uma a uma (pedido do usuário,
 * ago/2026). A URL é assinada e temporária, por isso é buscada por anexo e só
 * quando é imagem.
 */
function AnexoDoComentario({ nome, doc, onAbrir }: {
  nome: string;
  doc: { file_url: string; file_name: string } | null;
  onAbrir: () => void;
}) {
  const ehImagem = /\.(png|jpe?g|gif|webp|bmp|avif)$/i.test(nome);
  const { data: url } = useDocumentUrl(ehImagem && doc ? doc.file_url : undefined);

  if (doc && ehImagem && url) {
    return (
      <button
        onClick={onAbrir}
        title={`Abrir ${nome}`}
        style={{
          display: 'block', padding: 0, margin: '4px 0', border: '1px solid #E6E6E6',
          borderRadius: 8, overflow: 'hidden', background: '#fff', cursor: 'pointer', lineHeight: 0,
        }}
      >
        <img
          src={url}
          alt={nome}
          style={{ maxWidth: 220, maxHeight: 160, objectFit: 'cover', display: 'block' }}
        />
      </button>
    );
  }

  return (
    <button
      onClick={onAbrir}
      disabled={!doc}
      title={doc ? 'Abrir arquivo' : 'Arquivo não encontrado'}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        background: 'none', border: 'none', padding: '2px 0',
        font: 'inherit', textAlign: 'left',
        color: doc ? '#185FA5' : '#999',
        textDecoration: doc ? 'underline' : 'none',
        cursor: doc ? 'pointer' : 'default',
      }}
    >
      <Paperclip size={12} style={{ flexShrink: 0 }} /> {nome}
    </button>
  );
}

/**
 * Categoria do padrão de entrada em que o projeto se enquadra.
 *
 * Por padrão é derivada das regras da concessionária
 * (`concessionaire_entry_rules`) cruzando FASE + DISJUNTOR do projeto, pela
 * mesma `resolveEntryRule` que o diagrama unifilar, a geração de documentos e
 * o pacote do instalador usam — se divergisse daquilo, a tela mentiria sobre
 * o desenho.
 *
 * Mas pode ser DEFINIDA À MÃO: no aumento de carga pedido junto com o projeto
 * solar, a UC sai de 63A bifásico e vai para 80A trifásico, e é a categoria
 * nova que vale. A escolha grava `entry_rule_id` e vence a automática em todos
 * os consumidores; a tela continua mostrando o que a regra diria, para a
 * diferença ficar à vista.
 *
 * O casamento automático tem saídas aproximadas (sem fase, sem disjuntor,
 * disjuntor acima da maior categoria). Em vez de esconder, cada uma é dita em
 * uma linha: o projetista precisa saber quando a classificação é um palpite.
 */
function EntryStandardBadge({
  concessionaireId, concessionaireName, phaseType, breakerCurrent,
  entryRuleId, isEditing, onChangeEntryRule,
}: {
  concessionaireId?: string;
  concessionaireName: string;
  phaseType: string;
  breakerCurrent: string;
  entryRuleId: string;
  isEditing: boolean;
  onChangeEntryRule: (id: string) => void;
}) {
  const { data: rules = [], isLoading } = useEntryRules(concessionaireId);
  const { user: usuarioAtual } = useAuth();
  // Quem NÃO administra concessionárias não deve receber instrução de ir
  // cadastrá-las: para a empresa integradora, a tela nem existe no menu.
  const podeConfigurar = usuarioAtual?.role === 'admin' || usuarioAtual?.role === 'staff';

  const caixa = (conteudo: React.ReactNode, tom: 'ok' | 'aviso' = 'ok') => (
    <div style={{
      marginTop: 14, padding: '10px 14px', borderRadius: 8,
      background: tom === 'ok' ? '#FFFBF0' : '#FAFAFA',
      border: `0.5px solid ${tom === 'ok' ? '#F5A800' : '#E0E0E0'}`,
    }}>
      <p style={{ fontSize: 11, color: '#aaa', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 6px' }}>
        Padrão de entrada
      </p>
      {conteudo}
    </div>
  );

  const nota = (txt: string) => (
    <p style={{ fontSize: 11, color: '#8a8a8a', margin: '6px 0 0', lineHeight: 1.5 }}>{txt}</p>
  );

  if (!concessionaireId) {
    return caixa(nota(
      podeConfigurar
        ? 'Concessionária ainda não definida no projeto — sem ela não dá para classificar o padrão de entrada.'
        : 'A concessionária deste projeto ainda não foi definida pela equipe, então o padrão de entrada não está classificado.'
    ), 'aviso');
  }
  if (isLoading) return null;
  if (rules.length === 0) {
    return caixa(nota(
      podeConfigurar
        ? `${concessionaireName || 'Esta concessionária'} não tem regras de padrão de entrada cadastradas. `
          + 'Cadastre em Concessionárias → Padrão de entrada para o projeto ser classificado.'
        : `A classificação do padrão de entrada da ${concessionaireName || 'concessionária'} ainda não está `
          + 'disponível. O cadastro é feito pela equipe responsável pela homologação.'
    ), 'aviso');
  }

  const automatica = matchEntryRule(rules, phaseType, breakerCurrent);
  const escolhida = entryRuleId ? rules.find(r => r.id === entryRuleId) ?? null : null;
  const rule = escolhida ?? automatica;
  if (!rule) return caixa(nota('Nenhuma categoria compatível encontrada nas regras desta concessionária.'), 'aviso');

  const amps = parseInt((breakerCurrent || '').replace(/[^\d]/g, ''), 10);
  const semFase = !phaseType;
  const semDisjuntor = isNaN(amps);
  // Os avisos de classificação aproximada só valem quando ela está no comando.
  const automatico = !escolhida;
  const acimaDoMaior = automatico && !semDisjuntor && rule.disjuntor < amps;

  const descrever = (r: typeof rule) =>
    `${r.categoria} · ${r.disjuntor}A${r.classe ? ` · ${r.classe}` : ''}`;

  const chip = (rotulo: string, valor: string) => (
    <div key={rotulo}>
      <p style={{ fontSize: 10, color: '#aaa', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', margin: 0 }}>{rotulo}</p>
      <p style={{ fontSize: 13, fontWeight: 600, color: '#1A1A1A', margin: '2px 0 0' }}>{valor}</p>
    </div>
  );

  const detalhes = [
    chip('Disjuntor da categoria', `${rule.disjuntor}A`),
    ...(rule.bitola ? [chip('Bitola', `${rule.bitola} mm²`)] : []),
    ...(rule.classe ? [chip('Classe', rule.classe)] : []),
    ...(rule.caixa_medicao ? [chip('Caixa de medição', rule.caixa_medicao)] : []),
    ...Object.entries(rule.extra ?? {}).map(([label, val]) => chip(label, val)),
  ];

  return caixa(
    <>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <span style={{
          fontSize: 15, fontWeight: 700, color: '#1A1A1A', background: '#FEF3D0',
          border: '0.5px solid #F5A800', borderRadius: 6, padding: '2px 10px',
        }}>
          Categoria {rule.categoria}
        </span>
        <span style={{ fontSize: 12, color: '#8a8a8a' }}>
          {automatico
            ? `pela regra da ${concessionaireName || 'concessionária'}`
            : 'definida à mão (aumento de carga)'}
        </span>
      </div>

      {isEditing && (
        <div style={{ marginTop: 10 }}>
          <p style={{ fontSize: 10, color: '#aaa', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', margin: '0 0 4px' }}>
            Categoria do projeto
          </p>
          <select
            value={entryRuleId}
            onChange={e => onChangeEntryRule(e.target.value)}
            style={{ width: '100%', maxWidth: 380, padding: '6px 8px', borderRadius: 6, border: '1px solid #E0E0E0', fontSize: 13, color: '#1A1A1A', outline: 'none', boxSizing: 'border-box', background: '#fff' }}
          >
            <option value="">
              {automatica
                ? `Automático pela fase e disjuntor — ${descrever(automatica)}`
                : 'Automático pela fase e disjuntor'}
            </option>
            {rules.map(r => (
              <option key={r.id} value={r.id}>{descrever(r)}</option>
            ))}
          </select>
          <p style={{ fontSize: 11, color: '#8a8a8a', margin: '6px 0 0', lineHeight: 1.5 }}>
            Use quando houver aumento de carga junto com o projeto: a categoria
            escolhida passa a valer no diagrama unifilar, nos formulários e no
            memorial.
          </p>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10, marginTop: 10 }}>
        {detalhes}
      </div>

      {/* Escolhida à mão: mostra o que a regra diria, para a diferença aparecer. */}
      {!automatico && automatica && automatica.id !== rule.id && nota(
        `Pela fase e disjuntor cadastrados (${phaseType ? phaseLabelOf(phaseType) : 'sem fase'}` +
        `${semDisjuntor ? '' : `, ${amps}A`}), a classificação automática seria ${descrever(automatica)}.`
      )}

      {automatico && (semFase && semDisjuntor
        ? nota('Classificação aproximada: o projeto está sem a fase e sem o disjuntor, então esta é a primeira categoria da lista.')
        : semFase
          ? nota('Classificação aproximada: sem a fase informada, o enquadramento usou só o disjuntor.')
          : semDisjuntor
            ? nota('Classificação aproximada: sem o disjuntor informado, esta é a menor categoria da fase.')
            : null)}
      {acimaDoMaior && nota(
        `Atenção: o disjuntor do projeto (${amps}A) passa da maior categoria cadastrada para esta fase (${rule.disjuntor}A).`
      )}
    </>
  );
}

/** Rótulo legível da fase gravada (monofasico → Monofásico). */
function phaseLabelOf(raw: string): string {
  const s = String(raw ?? '').toLowerCase();
  if (s.includes('tri')) return 'trifásico';
  if (s.includes('bi')) return 'bifásico';
  if (s.includes('mono')) return 'monofásico';
  return raw;
}

function TabGeneral({ project, isEditing, onSave, onCancel, onEdit }: {
  project: ProjectWithDetails;
  isEditing: boolean;
  onSave: (gd: Record<string, any>, eq: Record<string, any>) => void;
  onCancel: () => void;
  onEdit: () => void;
}) {
  // ── Protocol state ──────────────────────────────────────────────────────────
  const [protocolDialogOpen, setProtocolDialogOpen] = useState(false);
  const [showProtocolHistory, setShowProtocolHistory] = useState(false);
  const { data: protocols = [] } = useProjectProtocols(project.id);
  const registerProtocol = useRegisterProtocol();
  const { data: revisions = [] } = useProjectRevisions(project.id);
  const currentRevision = revisions.find(r => r.is_current);
  const revisionNumber = currentRevision?.revision_number ?? 1;
  const protocolNumber = (project as any).protocol_number as string | null;

  const handleProtocolConfirm = async (data: import('./ProtocolDialog').ProtocolData) => {
    await registerProtocol.mutateAsync({
      projectId: project.id,
      revisionNumber,
      protocolNumber: data.protocol_number,
      noProtocol: data.no_protocol,
      noProtocolReason: data.no_protocol_reason,
      newStatus: project.status as string,
    });
    setProtocolDialogOpen(false);
  };
  const gd = project.generalData;
  const eq = project.equipment;

  const [form, setForm] = useState({
    holder_name: gd?.holder_name || '',
    holder_cpf_cnpj: gd?.holder_cpf_cnpj || '',
    uc_number: gd?.uc_number || '',
    holder_phone: gd?.holder_phone || '',
    holder_email: gd?.holder_email || '',
    circuit_breaker_current: gd?.circuit_breaker_current || '',
    phase_type: gd?.phase_type || '',
    entry_rule_id: (gd as any)?.entry_rule_id || '',
    address: gd?.address || '',
    address_number: gd?.address_number || '',
    address_complement: gd?.address_complement || '',
    neighborhood: gd?.neighborhood || '',
    cep: gd?.cep || '',
    city: gd?.city || '',
    state: gd?.state || '',
    inverter_brand: eq?.inverter_brand || '',
    inverter_model: eq?.inverter_model || '',
    inverter_power: eq?.inverter_power?.toString() || '',
    inverter_quantity: eq?.inverter_quantity?.toString() || '',
    module_brand: eq?.module_brand || '',
    module_model: eq?.module_model || '',
    module_power: eq?.module_power?.toString() || '',
    module_quantity: eq?.module_quantity?.toString() || '',
  });

  const [coordinates, setCoordinates] = useState<string>(gd?.coordinates || '');
  const [isGeocoding, setIsGeocoding] = useState(false);

  // O `useState` acima roda UMA vez, na montagem. Sem isto o card congelava no
  // primeiro valor que chegou — normalmente o do cache — e nunca acompanhava a
  // atualização: com revisão, mostrava o equipamento ANTIGO enquanto o bloco
  // "Antes da Revisão" já calculava com o novo, e os dois se contradiziam na
  // mesma tela (relato do usuário, ago/2026 — PRJ-49561).
  //
  // Não re-semeia durante a edição: sobrescreveria o que está sendo digitado.
  useEffect(() => {
    if (isEditing) return;
    setForm({
      holder_name: gd?.holder_name || '',
      holder_cpf_cnpj: gd?.holder_cpf_cnpj || '',
      uc_number: gd?.uc_number || '',
      holder_phone: gd?.holder_phone || '',
      holder_email: gd?.holder_email || '',
      circuit_breaker_current: gd?.circuit_breaker_current || '',
      phase_type: gd?.phase_type || '',
      entry_rule_id: (gd as any)?.entry_rule_id || '',
      address: gd?.address || '',
      address_number: gd?.address_number || '',
      address_complement: gd?.address_complement || '',
      neighborhood: gd?.neighborhood || '',
      cep: gd?.cep || '',
      city: gd?.city || '',
      state: gd?.state || '',
      inverter_brand: eq?.inverter_brand || '',
      inverter_model: eq?.inverter_model || '',
      inverter_power: eq?.inverter_power?.toString() || '',
      inverter_quantity: eq?.inverter_quantity?.toString() || '',
      module_brand: eq?.module_brand || '',
      module_model: eq?.module_model || '',
      module_power: eq?.module_power?.toString() || '',
      module_quantity: eq?.module_quantity?.toString() || '',
    });
    setCoordinates(gd?.coordinates || '');
  }, [gd, eq, isEditing]);

  const totalPower = (parseFloat(form.module_power || '0') * parseInt(form.module_quantity || '0', 10)) / 1000;

  const field = (label: string, key: keyof typeof form) => (
    <div key={key} style={{ minWidth: 0 }}>
      <p style={{ fontSize: 11, color: '#aaa', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>{label}</p>
      {isEditing ? (
        <input
          value={form[key]}
          onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
          style={{ width: '100%', padding: '6px 8px', borderRadius: 6, border: '1px solid #E0E0E0', fontSize: 13, color: '#1A1A1A', outline: 'none', boxSizing: 'border-box' }}
        />
      ) : (
        form[key]
          ? <p style={{ fontSize: 14, fontWeight: 500, color: '#1A1A1A', overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{form[key]}</p>
          : <em style={{ color: '#ccc', fontSize: 13 }}>Não informado</em>
      )}
    </div>
  );

  // Fase do padrão de entrada. Os valores gravados são sempre minúsculos e sem
  // acento (monofasico/bifasico/trifasico) — é o que o NewProject grava e o que
  // o Kanban e o Motor de Engenharia comparam. `phase_type` está em SKIP_KEYS
  // do textCase, então o upperize do salvamento não encosta nele.
  const PHASE_OPTIONS: [string, string][] = [
    ['monofasico', 'Monofásico'],
    ['bifasico', 'Bifásico'],
    ['trifasico', 'Trifásico'],
  ];
  const phaseLabel = (raw: string) =>
    PHASE_OPTIONS.find(([v]) => v === raw)?.[1]
    ?? (raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : '');

  const phaseField = () => (
    <div style={{ minWidth: 0 }}>
      <p style={{ fontSize: 11, color: '#aaa', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Fase</p>
      {isEditing ? (
        <select
          value={form.phase_type}
          onChange={e => setForm(f => ({ ...f, phase_type: e.target.value }))}
          style={{ width: '100%', padding: '6px 8px', borderRadius: 6, border: '1px solid #E0E0E0', fontSize: 13, color: '#1A1A1A', outline: 'none', boxSizing: 'border-box', background: '#fff' }}
        >
          <option value="">Não informado</option>
          {PHASE_OPTIONS.map(([val, label]) => <option key={val} value={val}>{label}</option>)}
        </select>
      ) : (
        form.phase_type
          ? <p style={{ fontSize: 14, fontWeight: 500, color: '#1A1A1A' }}>{phaseLabel(form.phase_type)}</p>
          : <em style={{ color: '#ccc', fontSize: 13 }}>Não informado</em>
      )}
    </div>
  );

  const { isMobile } = useWindowSize();

  const handleGeocode = async () => {
    setIsGeocoding(true);
    try {
      const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string;
      if (!apiKey) { toast.error('Chave da API do Google Maps não configurada'); return; }
      const q = [form.address, form.address_number, form.neighborhood, form.city, form.state, 'Brasil']
        .filter(Boolean).join(', ');
      const resp = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(q)}&key=${apiKey}`
      );
      const data = await resp.json();
      if (data.status === 'OK' && data.results[0]) {
        const loc = data.results[0].geometry.location;
        const coords = `${loc.lat.toFixed(6)}, ${loc.lng.toFixed(6)}`;
        setCoordinates(coords);
        toast.success('Localização encontrada!');
      } else {
        toast.error('Endereço não encontrado pelo geocodificador');
      }
    } catch {
      toast.error('Erro ao geocodificar endereço');
    } finally {
      setIsGeocoding(false);
    }
  };

  // Section title helper
  const SectionTitle = ({ title }: { title: string }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 14 }}>
      <p style={{ fontSize: 11, fontWeight: 600, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0, whiteSpace: 'nowrap' }}>{title}</p>
      <div style={{ flex: 1, height: 0.5, background: '#F0F0F0' }} />
    </div>
  );

  return (
    <div style={{ padding: '24px 28px', flex: 1 }}>
      {/* Titular */}
      <div style={{ marginBottom: 24 }}>
        <SectionTitle title="Titular e UC" />
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, minmax(0, 1fr))', gap: '14px' }}>
          {/* Row 1: Nome(span2), CPF, UC */}
          <div style={{ gridColumn: isMobile ? 'span 2' : 'span 2' }}>
            {field('Nome do titular', 'holder_name')}
          </div>
          {field('CPF / CNPJ', 'holder_cpf_cnpj')}
          {field('Número UC', 'uc_number')}
          {/* Row 2: Telefone, Email, Disjuntor, Fase */}
          {field('Telefone', 'holder_phone')}
          {field('E-mail', 'holder_email')}
          {field('Disjuntor (A)', 'circuit_breaker_current')}
          {phaseField()}
          {/* Row 3: UF, Endereço(span2), Número */}
          {field('UF', 'state')}
          <div style={{ gridColumn: 'span 2' }}>
            {field('Endereço', 'address')}
          </div>
          {field('Número', 'address_number')}
          {/* Row 4: Complemento, Bairro, CEP, Cidade */}
          {field('Complemento', 'address_complement')}
          {field('Bairro', 'neighborhood')}
          {field('CEP', 'cep')}
          {field('Cidade', 'city')}
        </div>

        <EntryStandardBadge
          concessionaireId={(project as any).concessionaire_id ?? undefined}
          concessionaireName={(project as any).concessionaireName || ''}
          phaseType={form.phase_type}
          breakerCurrent={form.circuit_breaker_current}
          entryRuleId={form.entry_rule_id}
          isEditing={isEditing}
          onChangeEntryRule={id => setForm(f => ({ ...f, entry_rule_id: id }))}
        />
      </div>

      {/* ── Seção Protocolo ─────────────────────────────────────────────────── */}
      {protocolNumber && (
        <div style={{ marginBottom: 24 }}>
          <div
            style={{
              background: '#E6F1FB',
              border: '0.5px solid #378ADD',
              borderRadius: 8,
              padding: '10px 14px',
            }}
          >
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <Hash size={12} color="#185FA5" />
                <span style={{ fontSize: 10, fontWeight: 700, color: '#185FA5', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Protocolo
                </span>
              </div>
              <button
                onClick={() => setProtocolDialogOpen(true)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 4,
                  padding: '3px 8px', borderRadius: 5, border: '0.5px solid #378ADD',
                  background: 'transparent', color: '#185FA5', fontSize: 10, fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                <Pencil size={9} />
                Editar
              </button>
            </div>

            {/* Número atual */}
            <div>
              <p style={{ fontSize: 9, color: '#4A7BB5', margin: '0 0 2px' }}>Número atual</p>
              <p style={{ fontSize: 14, fontWeight: 700, color: '#1A1A1A', margin: 0 }}>
                {protocolNumber}
              </p>
            </div>

            {/* Histórico expansível */}
            {protocols.length > 0 && (
              <div style={{ marginTop: 10, borderTop: '0.5px solid rgba(55,138,221,0.25)', paddingTop: 8 }}>
                <button
                  onClick={() => setShowProtocolHistory(v => !v)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, color: '#185FA5', fontWeight: 600, padding: 0, display: 'flex', alignItems: 'center', gap: 4 }}
                >
                  {showProtocolHistory ? '▲' : '▼'} Ver histórico ({protocols.length} registro{protocols.length !== 1 ? 's' : ''})
                </button>
                {showProtocolHistory && (
                  <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {protocols.map(p => (
                      <div
                        key={p.id}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 6,
                          fontSize: 10, color: '#555', padding: '4px 6px',
                          background: 'rgba(255,255,255,0.5)', borderRadius: 5,
                        }}
                      >
                        <span style={{ fontWeight: 700, color: '#185FA5', whiteSpace: 'nowrap' }}>
                          Rev. {p.revision_number}
                        </span>
                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {p.no_protocol ? (p.no_protocol_reason || 'Sem protocolo') : (p.protocol_number || '—')}
                        </span>
                        {p.registrar && (
                          <span style={{ color: '#888', whiteSpace: 'nowrap' }}>
                            {(p.registrar as any)?.name?.split(' ')[0] || ''}
                          </span>
                        )}
                        <span style={{ color: '#aaa', whiteSpace: 'nowrap' }}>
                          {format(new Date(p.registered_at), 'dd/MM/yy', { locale: ptBR })}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Botão para registrar protocolo se ainda não tem */}
      {!protocolNumber && (
        <div style={{ marginBottom: 16 }}>
          <button
            onClick={() => setProtocolDialogOpen(true)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '7px 14px', borderRadius: 7, border: '0.5px dashed #378ADD',
              background: 'transparent', color: '#378ADD', fontSize: 11, fontWeight: 600, cursor: 'pointer',
            }}
          >
            <Hash size={12} />
            Registrar número de protocolo
          </button>
        </div>
      )}

      {/* ProtocolDialog para edição no modal */}
      {protocolDialogOpen && (
        <ProtocolDialog
          open={protocolDialogOpen}
          onOpenChange={setProtocolDialogOpen}
          projectId={project.id}
          projectCode={project.code}
          concessionaireName={(project as any).concessionaireName || ''}
          currentRevisionNumber={revisionNumber}
          initialProtocolNumber={protocolNumber}
          onConfirm={handleProtocolConfirm}
          onCancel={() => setProtocolDialogOpen(false)}
        />
      )}

      {/* Equipamentos */}
      <div>
        <SectionTitle title="Equipamentos" />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <EquipmentBlock
            titulo="INVERSOR" type="inverter"
            campos={["inverter_brand", "inverter_model", "inverter_power", "inverter_quantity"]}
            labels={{ inverter_brand: "Marca", inverter_model: "Modelo", inverter_power: "Potência (kW)", inverter_quantity: "Quantidade" }}
            isEditing={isEditing} form={form} setForm={setForm}
          />
          <EquipmentBlock
            titulo="MÓDULOS" type="module"
            campos={["module_brand", "module_model", "module_power", "module_quantity"]}
            labels={{ module_brand: "Marca", module_model: "Modelo", module_power: "Potência (Wp)", module_quantity: "Quantidade" }}
            isEditing={isEditing} form={form} setForm={setForm}
          />
        </div>
        {totalPower > 0 && (
          <div style={{ marginTop: 14, display: 'inline-flex', alignItems: 'center', gap: 6, background: '#FEF3D0', borderRadius: 8, padding: '12px 20px' }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: '#854F0B' }}>Potência total: {totalPower.toFixed(2)} kWp</span>
          </div>
        )}
        {project.currentRevisionNumber && project.previous?.equipment && (
          <AntesDaRevisao
            original={project.previous.equipment as unknown as Record<string, unknown>}
            atual={project.equipment as unknown as Record<string, unknown> | undefined}
            numero={project.currentRevisionNumber}
          />
        )}
      </div>

      {/* Observações do Formulário */}
      {(gd as any)?.observations && (
        <div style={{ marginTop: 20 }}>
          <SectionTitle title="Observações do Formulário" />
          <div style={{ background: '#FFFBEB', border: '1px solid #F59E0B', borderRadius: 10, padding: '12px 16px', display: 'flex', gap: 10 }}>
            <FileText size={16} style={{ color: '#F59E0B', flexShrink: 0, marginTop: 2 }} />
            <p style={{ fontSize: 13, color: '#78350F', lineHeight: 1.6, margin: 0 }}>{(gd as any).observations}</p>
          </div>
        </div>
      )}

      {/* Localização */}
      <div style={{ marginTop: 20 }}>
        <SectionTitle title="Localização" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* Coordinates input */}
          <div>
            <p style={{ fontSize: 11, color: '#aaa', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Coordenadas (lat, lng)</p>
            {isEditing ? (
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  value={coordinates}
                  onChange={e => setCoordinates(e.target.value)}
                  placeholder="-15.780000, -47.929200"
                  style={{ flex: 1, padding: '6px 8px', borderRadius: 6, border: '1px solid #E0E0E0', fontSize: 13, color: '#1A1A1A', outline: 'none' }}
                />
                <button
                  onClick={handleGeocode}
                  disabled={isGeocoding}
                  title="Geocodificar pelo endereço"
                  style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid #F5A800', background: '#FFFBEB', color: '#854F0B', fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}
                >
                  {isGeocoding ? <Loader2 size={12} className="animate-spin" /> : <MapPin size={12} />}
                  Geocodificar
                </button>
              </div>
            ) : coordinates ? (
              <p style={{ fontSize: 13, fontWeight: 500, color: '#1A1A1A', display: 'flex', alignItems: 'center', gap: 5 }}>
                <MapPin size={13} style={{ color: '#F5A800' }} />
                {coordinates}
              </p>
            ) : (
              <em style={{ color: '#ccc', fontSize: 13 }}>Nenhuma coordenada registrada</em>
            )}
          </div>

          {/* Static map */}
          {(() => {
            const coords = parseCoordsModal(coordinates);
            const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string;
            if (!coords || !apiKey) return null;
            const mapUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${coords.lat},${coords.lng}&zoom=15&size=600x220&markers=color:orange%7Clabel:P%7C${coords.lat},${coords.lng}&scale=2&key=${apiKey}`;
            return (
              <div style={{ borderRadius: 10, overflow: 'hidden', border: '1px solid #E5E7EB', marginTop: 4 }}>
                <img
                  src={mapUrl}
                  alt="Localização do projeto"
                  style={{ width: '100%', display: 'block', maxHeight: 200, objectFit: 'cover' }}
                  onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
                <div style={{ padding: '6px 10px', background: '#F8F8F8', borderTop: '1px solid #F0F0F0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 11, color: '#999' }}>{coords.lat.toFixed(6)}, {coords.lng.toFixed(6)}</span>
                  <a
                    href={`https://maps.google.com/?q=${coords.lat},${coords.lng}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ fontSize: 11, color: '#F5A800', fontWeight: 600, textDecoration: 'none' }}
                  >
                    Ver no Google Maps ↗
                  </a>
                </div>
              </div>
            );
          })()}
        </div>
      </div>

      {isEditing && (
        <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
          <button
            onClick={() => onSave(
              {
                holder_name: form.holder_name,
                holder_cpf_cnpj: form.holder_cpf_cnpj,
                uc_number: form.uc_number,
                holder_phone: form.holder_phone,
                holder_email: form.holder_email,
                circuit_breaker_current: form.circuit_breaker_current,
                phase_type: form.phase_type || null,
                entry_rule_id: form.entry_rule_id || null,
                address: form.address,
                address_number: form.address_number,
                address_complement: form.address_complement,
                neighborhood: form.neighborhood,
                cep: form.cep,
                city: form.city,
                state: form.state,
                coordinates: coordinates || null,
              },
              {
                inverter_brand: form.inverter_brand,
                inverter_model: form.inverter_model,
                inverter_power: parseFloat(form.inverter_power) || null,
                inverter_quantity: parseInt(form.inverter_quantity, 10) || null,
                module_brand: form.module_brand,
                module_model: form.module_model,
                module_power: parseFloat(form.module_power) || null,
                module_quantity: parseInt(form.module_quantity, 10) || null,
                total_installed_power: totalPower,
              }
            )}
            style={{ flex: 1, padding: '8px 0', borderRadius: 7, background: '#F5A800', border: 'none', color: '#1A1A1A', fontWeight: 700, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
          >
            <Save size={14} /> Salvar
          </button>
          <button onClick={onCancel} style={{ padding: '8px 16px', borderRadius: 7, background: '#F0F0F0', border: 'none', color: '#555', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
            Cancelar
          </button>
        </div>
      )}
    </div>
  );
}

// ── Tab: Documents ─────────────────────────────────────────────────────────────
function TabDocuments({ project, canUpload }: { project: ProjectWithDetails; canUpload: boolean }) {
  const { data: documents = [] } = useDocuments(project.id);
  const uploadDocument = useUploadDocument();
  const [selectedDoc, setSelectedDoc] = useState<typeof documents[0] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { isMobile } = useWindowSize();

  const fromForm = documents.filter(d => d.document_type !== 'other_photos');
  const added = documents.filter(d => d.document_type === 'other_photos');

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !project.company_id) return;
    await uploadDocument.mutateAsync({
      projectId: project.id,
      companyId: project.company_id,
      file,
      documentType: 'other_photos' as DocumentType,
    });
    e.target.value = '';
  };

  const docIcon = (fileName: string) => {
    if (/\.pdf$/i.test(fileName)) return <FileText size={16} color="#E24B4A" />;
    return <Image size={16} color="#185FA5" />;
  };

  const renderGroup = (title: string, docs: typeof documents) => (
    docs.length > 0 && (
      <div style={{ marginBottom: 8 }}>
        <p style={{ fontSize: 10, fontWeight: 700, color: '#999', textTransform: 'uppercase', letterSpacing: '0.06em', padding: '6px 12px' }}>{title}</p>
        {docs.map(doc => (
          <button
            key={doc.id}
            onClick={() => setSelectedDoc(doc)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 12px', border: 'none', textAlign: 'left', cursor: 'pointer', borderRadius: 0,
              background: selectedDoc?.id === doc.id ? '#FEF3D0' : 'transparent',
              borderLeft: selectedDoc?.id === doc.id ? '3px solid #F5A800' : '3px solid transparent',
              transition: 'background 0.1s',
            }}
          >
            {docIcon(doc.file_name)}
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 12, fontWeight: 500, color: '#1A1A1A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {DOC_TYPE_LABELS[doc.document_type] || doc.file_name}
              </p>
              <p style={{ fontSize: 10, color: '#999' }}>
                {format(new Date(doc.created_at), 'dd/MM/yyyy')}
              </p>
            </div>
          </button>
        ))}
      </div>
    )
  );

  // On mobile: show list OR preview (not side-by-side)
  const showList = !isMobile || !selectedDoc;
  const showPreview = !isMobile || !!selectedDoc;

  return (
    <div style={{ display: 'flex', flex: 1, minHeight: 0, flexDirection: isMobile ? 'column' : 'row', overflow: 'hidden' }}>
      {/* List */}
      {showList && (
        <div style={{ width: isMobile ? '100%' : 260, flexShrink: 0, borderRight: isMobile ? 'none' : '1px solid #F0F0F0', borderBottom: isMobile ? '1px solid #F0F0F0' : 'none', overflowY: 'auto', display: 'flex', flexDirection: 'column', maxHeight: isMobile ? '50%' : undefined }}>
          {documents.length === 0 ? (
            <p style={{ padding: 16, fontSize: 12, color: '#999', textAlign: 'center' }}>Nenhum documento</p>
          ) : (
            <>
              {renderGroup('Do formulário', fromForm)}
              {renderGroup('Adicionados', added)}
            </>
          )}
          {canUpload && (
            <div style={{ marginTop: 'auto', padding: 10, borderTop: '1px solid #F0F0F0' }}>
              <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png" style={{ display: 'none' }} onChange={handleUpload} />
              <button
                onClick={() => fileRef.current?.click()}
                disabled={uploadDocument.isPending}
                style={{ width: '100%', padding: '8px 0', borderRadius: 7, border: '1px dashed #E0E0E0', background: '#FAFAFA', color: '#888', fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
              >
                {uploadDocument.isPending ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                Adicionar documento
              </button>
            </div>
          )}
        </div>
      )}

      {/* Preview */}
      {showPreview && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: isMobile ? 0 : 340 }}>
          {selectedDoc ? (
            <>
              {isMobile && (
                <button onClick={() => setSelectedDoc(null)} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', border: 'none', background: '#F8F8F8', borderBottom: '1px solid #F0F0F0', cursor: 'pointer', fontSize: 12, color: '#666', fontWeight: 600 }}>
                  ← Voltar à lista
                </button>
              )}
              <DocPreview filePath={selectedDoc.file_url} fileName={selectedDoc.file_name} />
            </>
          ) : (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              <FileText size={36} style={{ color: '#E0E0E0' }} />
              <p style={{ fontSize: 12, color: '#999' }}>Selecione um documento para visualizar</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Tab: Comments ──────────────────────────────────────────────────────────────
function TabComments({ project }: { project: ProjectWithDetails }) {
  const { data: comments = [] } = useComments(project.id);
  const { data: documents = [] } = useDocuments(project.id);
  const addComment    = useAddComment();
  const uploadDocument = useUploadDocument();
  const [message,     setMessage]     = useState('');
  const [attachments, setAttachments] = useState<File[]>([]);
  const [isDragging,  setIsDragging]  = useState(false);
  const [isSending,   setIsSending]   = useState(false);
  const [previewDoc,  setPreviewDoc]  = useState<{ file_url: string; file_name: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  useWindowSize();

  // Resolve o documento correspondente a um nome exibido em "📎 nome" no comentário.
  // O comentário guarda o nome original; o documento guarda o nome sanitizado.
  const resolveDoc = (displayName: string) => {
    const target = sanitizeFileName(displayName.trim());
    return documents.find(d => d.file_name === target)
        || documents.find(d => sanitizeFileName(d.file_name) === target)
        || documents.find(d => d.file_name.endsWith(target))
        || null;
  };

  const canSend = !isSending && (message.trim().length > 0 || attachments.length > 0);

  const addFiles = (files: FileList | File[]) => {
    const arr = Array.from(files);
    setAttachments(a => [...a, ...arr]);
  };

  /**
   * Colar com Ctrl+V — print de tela, foto copiada do explorador, arquivo.
   *
   * Imagem vinda da área de transferência chega SEM nome útil (o navegador
   * manda "image.png" toda vez). Renomeia com data e hora, senão a aba
   * Documentos vira uma pilha de "image.png" indistinguíveis.
   */
  const handlePaste = (e: React.ClipboardEvent) => {
    const arquivos = Array.from(e.clipboardData?.files ?? []);
    if (arquivos.length === 0) return;
    e.preventDefault();
    const carimbo = format(new Date(), 'yyyy-MM-dd_HH-mm-ss');
    addFiles(arquivos.map(f => (
      /^image\.\w+$/i.test(f.name)
        ? new File([f], `colado_${carimbo}.${f.name.split('.').pop()}`, { type: f.type })
        : f
    )));
  };

  const handleSend = async () => {
    if (!canSend) return;
    setIsSending(true);
    try {
      // 1. Fazer upload de cada anexo como documento do projeto
      const uploadedNames: string[] = [];
      for (const file of attachments) {
        await uploadDocument.mutateAsync({
          projectId:    project.id,
          companyId:    project.company_id!,
          file,
          documentType: 'other_photos', // tipo genérico para anexos de comentário
        });
        uploadedNames.push(file.name);
      }

      // 2. Montar mensagem final (texto + nomes dos arquivos)
      let finalMessage = message.trim();
      if (uploadedNames.length > 0) {
        const fileLines = uploadedNames.map(n => `📎 ${n}`).join('\n');
        finalMessage = finalMessage ? `${finalMessage}\n${fileLines}` : fileLines;
      }

      // 3. Enviar comentário
      if (finalMessage) {
        await addComment.mutateAsync({ projectId: project.id, message: finalMessage });
      }

      setMessage('');
      setAttachments([]);
    } catch {
      // erros tratados pelos hooks (toast já exibido)
    } finally {
      setIsSending(false);
    }
  };

  // Drag-and-drop handlers
  const handleDragOver  = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
  // Só desliga o realce quando o ponteiro sai do PAINEL, não a cada elemento
  // filho que ele atravessa — senão pisca o tempo todo durante o arrasto.
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setIsDragging(false);
  };
  const handleDrop      = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files);
  };

  const avatar = (role: string | undefined) => {
    const cfg = ROLE_COLORS[role || 'admin'];
    return (
      <div style={{ width: 32, height: 32, borderRadius: '50%', background: cfg.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 12, fontWeight: 700, color: cfg.color }}>
        {cfg.label[0]}
      </div>
    );
  };

  return (
    // Arrastar e colar valem no PAINEL INTEIRO, não só na faixa de escrever:
    // quem arrasta uma foto mira na conversa, não num campo de 40px de altura
    // (pedido do usuário, ago/2026). `onPaste` aqui pega o Ctrl+V mesmo quando
    // o cursor não está dentro do campo de texto.
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onPaste={handlePaste}
      style={{
        display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0,
        position: 'relative',
        outline: isDragging ? '2px dashed #F5A800' : 'none',
        outlineOffset: -2,
        background: isDragging ? '#FFFBF0' : undefined,
      }}
    >
      {/* Lista de comentários */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {comments.length === 0 && (
          <p style={{ textAlign: 'center', color: '#999', fontSize: 13, marginTop: 40 }}>Nenhum comentário ainda</p>
        )}
        {comments.map(c => {
          const cfg = ROLE_COLORS[c.userRole || 'admin'];
          return (
            <div key={c.id} style={{ display: 'flex', gap: 10 }}>
              {avatar(c.userRole)}
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#1A1A1A' }}>{c.userName}</span>
                  <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 20, background: cfg.bg, color: cfg.color, fontWeight: 600 }}>{cfg.label}</span>
                  <span style={{ fontSize: 10, color: '#999' }}>
                    {formatDistanceToNow(new Date(c.created_at), { addSuffix: true, locale: ptBR })}
                  </span>
                </div>
                <div style={{ fontSize: 13, color: '#333', lineHeight: 1.5 }}>
                  {c.message.split('\n').map((line, idx) => {
                    const att = line.match(/^\s*📎\s*(.+?)\s*$/);
                    if (att) {
                      const name = att[1];
                      const doc = resolveDoc(name);
                      return (
                        <AnexoDoComentario
                          key={idx}
                          nome={name}
                          doc={doc}
                          onAbrir={() => doc && setPreviewDoc(doc)}
                        />
                      );
                    }
                    return <div key={idx} style={{ whiteSpace: 'pre-wrap' }}>{line}</div>;
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Área de input — arrastar/colar são tratados no painel inteiro (acima) */}
      <div
        style={{
          borderTop: `1px solid ${isDragging ? '#F5A800' : '#F0F0F0'}`,
          padding: '12px 16px',
          background: isDragging ? '#FFFBF0' : '#FAFAFA',
          transition: 'background 0.15s, border-color 0.15s',
        }}
      >
        {/* Indicador de drag */}
        {isDragging && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            padding: '8px', marginBottom: 8, borderRadius: 7,
            border: '2px dashed #F5A800', color: '#854F0B', fontSize: 12, fontWeight: 600,
          }}>
            <Paperclip size={13} /> Solte o arquivo para anexar
          </div>
        )}

        {/* Preview dos anexos */}
        {attachments.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
            {attachments.map((f, i) => (
              <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#FEF3D0', border: '1px solid #F5D580', borderRadius: 20, padding: '3px 10px', fontSize: 11, color: '#854F0B' }}>
                📎 {f.name}
                <button
                  onClick={() => setAttachments(a => a.filter((_, j) => j !== i))}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: '#B87A00', display: 'flex' }}
                >
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <textarea
            value={message}
            onChange={e => setMessage(e.target.value)}
            placeholder={isDragging ? 'Solte o arquivo aqui...' : 'Escreva um comentário ou arraste um arquivo...'}
            rows={2}
            disabled={isSending}
            style={{
              flex: 1, resize: 'none', padding: '8px 10px', borderRadius: 7,
              border: `1px solid ${isDragging ? '#F5A800' : '#E0E0E0'}`,
              fontSize: 13, color: '#1A1A1A', outline: 'none', fontFamily: 'inherit',
              background: isSending ? '#F8F8F8' : '#fff',
              transition: 'border-color 0.15s',
            }}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <input
              ref={fileRef}
              type="file"
              multiple
              style={{ display: 'none' }}
              onChange={e => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }}
            />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={isSending}
              title="Anexar arquivo"
              style={{ padding: '7px 9px', borderRadius: 7, border: '1px solid #E0E0E0', background: '#fff', cursor: isSending ? 'default' : 'pointer', display: 'flex', alignItems: 'center', color: '#888' }}
            >
              <Paperclip size={14} />
            </button>
            <button
              onClick={handleSend}
              disabled={!canSend}
              title="Enviar"
              style={{
                padding: '7px 12px', borderRadius: 7, border: 'none',
                background: canSend ? '#F5A800' : '#F0F0F0',
                color: canSend ? '#1A1A1A' : '#BBB',
                cursor: canSend ? 'pointer' : 'default',
                display: 'flex', alignItems: 'center', gap: 4, fontWeight: 700, fontSize: 12,
              }}
            >
              {isSending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
            </button>
          </div>
        </div>

        <p style={{ fontSize: 10, color: '#bbb', margin: '6px 0 0', textAlign: 'right' }}>
          Arraste arquivos ou clique em 📎 · Enter para enviar · Shift+Enter nova linha
        </p>
      </div>

      {/* Visualizador inline de anexo (abre na própria página) */}
      {previewDoc && (
        <div
          onClick={() => setPreviewDoc(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 100,
            background: 'rgba(0,0,0,0.6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: '#fff', borderRadius: 12, overflow: 'hidden',
              width: 'min(900px, 92vw)', height: '85vh',
              display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'flex-end', padding: 6, borderBottom: '1px solid #F0F0F0' }}>
              <button
                onClick={() => setPreviewDoc(null)}
                title="Fechar"
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6, color: '#666', display: 'flex' }}
              >
                <X size={18} />
              </button>
            </div>
            <DocPreview filePath={previewDoc.file_url} fileName={previewDoc.file_name} />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tab: Financeiro ────────────────────────────────────────────────────────────
function TabFinanceiro({ project, isAdmin }: { project: ProjectWithDetails; isAdmin: boolean }) {
  const fin = project.financials;
  const projectValue = Number(fin?.project_value || 0);
  const paidValue = Number(fin?.paid_value || 0);
  const balance = Math.max(0, projectValue - paidValue);
  const paymentStatus = fin?.payment_status || 'pending';
  const pctPaid = projectValue > 0 ? Math.min(100, (paidValue / projectValue) * 100) : 0;

  const { data: history = [] } = usePaymentHistory(project.id);
  const addPayment = useAddPaymentHistory();
  const updateValue = useUpdateProjectValue();
  const reversePayment = useReverseSinglePayment();

  // Pagamentos já estornados (não permitem novo estorno)
  const reversedIds = new Set(
    history.filter(h => h.entry_type === 'reversal' && h.reverses_payment_id)
           .map(h => h.reverses_payment_id as string)
  );

  const handleReverse = async (payment: PaymentHistoryEntry) => {
    if (!confirm(`Estornar o pagamento de ${fmt(payment.amount)}? O saldo em aberto voltará a subir.`)) return;
    await reversePayment.mutateAsync({ payment });
  };

  const [editingValue, setEditingValue] = useState(false);
  const [newValue, setNewValue] = useState(projectValue.toString());
  const [payAmt, setPayAmt] = useState('');
  const [payDate, setPayDate] = useState(new Date().toISOString().split('T')[0]);
  const [payNote, setPayNote] = useState('');

  const fmt = formatCurrency;
  const statusBadge: Record<string, { bg: string; color: string; label: string }> = {
    pending: { bg: '#FEF3D0', color: '#854F0B', label: 'Pendente' },
    partial: { bg: '#FEF3D0', color: '#854F0B', label: 'Parc. Pago' },
    paid:    { bg: '#E1F5EE', color: '#0F6E56', label: 'Quitado' },
  };
  const badge = statusBadge[paymentStatus] || statusBadge.pending;

  if (!isAdmin) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, minHeight: 0, gap: 12, color: '#999' }}>
        <Lock size={32} style={{ color: '#E0E0E0' }} />
        <p style={{ fontSize: 13, textAlign: 'center', maxWidth: 260 }}>
          Você não tem permissão para visualizar informações financeiras deste projeto.
        </p>
      </div>
    );
  }

  const handleSaveValue = async () => {
    const v = parseFloat(newValue.replace(',', '.'));
    if (!v || v <= 0) return;
    await updateValue.mutateAsync({ projectId: project.id, projectValue: v });
    setEditingValue(false);
  };

  const handleAddPayment = async () => {
    const amt = parseFloat(payAmt.replace(',', '.'));
    if (!amt || amt <= 0) return;
    if (amt > balance + 0.01) { return; }
    await addPayment.mutateAsync({ projectId: project.id, amount: amt, paymentDate: payDate, notes: payNote });
    setPayAmt('');
    setPayNote('');
    setPayDate(new Date().toISOString().split('T')[0]);
  };

  return (
    <div style={{ padding: '16px 20px', overflowY: 'auto', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* 3.1 Valor Total Card */}
      <div style={{ background: '#1A1A1A', borderRadius: 10, padding: '14px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginBottom: 4 }}>Valor Total do Projeto</p>
            {editingValue ? (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input
                  value={newValue}
                  onChange={e => setNewValue(e.target.value)}
                  style={{ width: 130, padding: '5px 8px', borderRadius: 6, border: '1px solid #F5A800', background: '#242424', color: '#F5A800', fontSize: 16, fontWeight: 700, outline: 'none' }}
                  autoFocus
                />
                <button onClick={handleSaveValue} disabled={updateValue.isPending} style={{ padding: '5px 10px', borderRadius: 6, background: '#F5A800', border: 'none', color: '#1A1A1A', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
                  {updateValue.isPending ? '...' : 'Salvar'}
                </button>
                <button onClick={() => setEditingValue(false)} style={{ padding: '5px 8px', borderRadius: 6, background: 'rgba(255,255,255,0.08)', border: 'none', color: '#fff', fontSize: 12, cursor: 'pointer' }}>
                  Cancelar
                </button>
              </div>
            ) : (
              <p style={{ fontSize: 22, fontWeight: 700, color: '#F5A800', lineHeight: 1 }}>{fmt(projectValue)}</p>
            )}
            <p style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', marginTop: 4 }}>
              {pctPaid.toFixed(0)}% pago · {fmt(balance)} em aberto
            </p>
          </div>
          <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: badge.bg, color: badge.color, flexShrink: 0 }}>
            {badge.label}
          </span>
        </div>
        {/* Payment progress bar */}
        <div style={{ height: 6, background: '#333', borderRadius: 3, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${pctPaid}%`, background: '#F5A800', borderRadius: 3, transition: 'width 0.4s' }} />
        </div>
        {/* Edit value button */}
        {!editingValue && (
          <button
            onClick={() => { setNewValue(projectValue.toString()); setEditingValue(true); }}
            style={{ marginTop: 10, display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 6, border: '0.5px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.6)', fontSize: 11, cursor: 'pointer' }}
          >
            <Pencil size={10} /> Editar valor do projeto
          </button>
        )}
      </div>

      {/* 3.2 Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
        {[
          { label: 'Valor Total', value: fmt(projectValue), color: '#1A1A1A' },
          { label: 'Total Pago', value: fmt(paidValue), color: '#2D6A4F' },
          { label: 'Saldo em Aberto', value: fmt(balance), color: balance === 0 ? '#2D6A4F' : '#D85A30' },
        ].map(card => (
          <div key={card.label} style={{ background: '#F8F8F8', borderRadius: 8, padding: '10px 12px', border: '0.5px solid #EFEFEF' }}>
            <p style={{ fontSize: 10, color: '#999', marginBottom: 4 }}>{card.label}</p>
            <p style={{ fontSize: 13, fontWeight: 700, color: card.color }}>{card.value}</p>
          </div>
        ))}
      </div>

      {/* 3.3 Registrar Pagamento */}
      <div style={{ background: '#F8F8F8', borderRadius: 10, border: '0.5px solid #EFEFEF', overflow: 'hidden' }}>
        <div style={{ padding: '12px 14px', borderBottom: '1px solid #EFEFEF', display: 'flex', alignItems: 'center', gap: 8 }}>
          <DollarSign size={14} style={{ color: '#F5A800' }} />
          <p style={{ fontSize: 13, fontWeight: 700, color: '#1A1A1A' }}>Registrar Pagamento</p>
        </div>
        <div style={{ padding: '14px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 12px', marginBottom: 10 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                <p style={{ fontSize: 10, color: '#999', textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0 }}>Valor recebido (R$)</p>
                {balance > 0 && (
                  <button
                    type="button"
                    onClick={() => setPayAmt(balance.toFixed(2))}
                    style={{ fontSize: 10, fontWeight: 700, color: '#0F6E56', background: '#E1F5EE', border: 'none', borderRadius: 5, padding: '2px 7px', cursor: 'pointer' }}
                  >
                    Quitar total · {fmt(balance)}
                  </button>
                )}
              </div>
              <input
                type="number"
                value={payAmt}
                onChange={e => setPayAmt(e.target.value)}
                placeholder="0,00"
                min="0"
                max={balance}
                style={{ width: '100%', padding: '7px 9px', borderRadius: 7, border: '1px solid #E0E0E0', fontSize: 13, outline: 'none', background: '#fff' }}
              />
            </div>
            <div>
              <p style={{ fontSize: 10, color: '#999', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Data do pagamento</p>
              <input
                type="date"
                value={payDate}
                onChange={e => setPayDate(e.target.value)}
                style={{ width: '100%', padding: '7px 9px', borderRadius: 7, border: '1px solid #E0E0E0', fontSize: 13, outline: 'none', background: '#fff' }}
              />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <p style={{ fontSize: 10, color: '#999', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Observação (opcional)</p>
              <input
                value={payNote}
                onChange={e => setPayNote(e.target.value)}
                placeholder="Ex: Entrada via PIX, parcela 1..."
                style={{ width: '100%', padding: '7px 9px', borderRadius: 7, border: '1px solid #E0E0E0', fontSize: 13, outline: 'none', background: '#fff' }}
              />
            </div>
          </div>
          <p style={{ fontSize: 10, color: '#aaa', marginBottom: 12 }}>
            💡 Se valor pago = valor total, status muda para Quitado
          </p>
          <button
            onClick={handleAddPayment}
            disabled={addPayment.isPending || !payAmt || parseFloat(payAmt) <= 0}
            style={{ width: '100%', padding: '9px 0', borderRadius: 7, background: payAmt && parseFloat(payAmt) > 0 ? '#F5A800' : '#E0E0E0', border: 'none', color: payAmt && parseFloat(payAmt) > 0 ? '#1A1A1A' : '#999', fontWeight: 600, fontSize: 13, cursor: payAmt && parseFloat(payAmt) > 0 ? 'pointer' : 'default' }}
          >
            {addPayment.isPending ? 'Registrando...' : 'Confirmar Pagamento'}
          </button>
        </div>
      </div>

      {/* 3.4 Histórico de Pagamentos */}
      <div style={{ border: '0.5px solid #EFEFEF', borderRadius: 10, overflow: 'hidden' }}>
        <div style={{ background: '#FAFAFA', borderBottom: '1px solid #F0F0F0', padding: '10px 14px' }}>
          <p style={{ fontSize: 10, fontWeight: 700, color: '#999', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Histórico de Pagamentos</p>
        </div>
        <div style={{ padding: '4px 0' }}>
          {/* Criação do projeto */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 14px', borderBottom: '1px solid #F8F8F8' }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#F5A800', flexShrink: 0, marginTop: 4 }} />
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: 12, fontWeight: 600, color: '#1A1A1A' }}>Projeto criado · Valor definido: {fmt(projectValue)}</p>
              <p style={{ fontSize: 10, color: '#999', marginTop: 2 }}>
                {project.created_at ? new Date(project.created_at).toLocaleDateString('pt-BR') : '—'}
              </p>
            </div>
          </div>

          {history.length === 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '20px 14px', color: '#CCC' }}>
              <Clock size={20} />
              <p style={{ fontSize: 12, color: '#aaa' }}>Nenhum pagamento registrado ainda</p>
            </div>
          )}
          {history.map(h => {
            const isReversal = h.entry_type === 'reversal';
            const alreadyReversed = reversedIds.has(h.id);
            const dotColor = isReversal ? '#E24B4A' : '#2D6A4F';
            return (
              <div key={h.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 14px', borderBottom: '1px solid #F8F8F8' }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: dotColor, flexShrink: 0, marginTop: 4 }} />
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: 12, fontWeight: 600, color: isReversal ? '#E24B4A' : '#1A1A1A' }}>
                    {isReversal ? 'Estorno' : 'Pagamento registrado'}
                  </p>
                  <p style={{ fontSize: 10, color: '#999', marginTop: 2 }}>
                    {new Date(h.payment_date + 'T12:00:00').toLocaleDateString('pt-BR')}
                  </p>
                  {h.notes && <p style={{ fontSize: 11, color: '#888', marginTop: 2 }}>{h.notes}</p>}
                  {!isReversal && !alreadyReversed && (
                    <button
                      onClick={() => handleReverse(h)}
                      disabled={reversePayment.isPending}
                      style={{ marginTop: 5, display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 600, color: '#E24B4A', background: 'none', border: '0.5px solid #F3C9C9', borderRadius: 5, padding: '2px 8px', cursor: 'pointer' }}
                    >
                      <RotateCcw size={9} /> Estornar
                    </button>
                  )}
                  {!isReversal && alreadyReversed && (
                    <span style={{ marginTop: 5, display: 'inline-block', fontSize: 10, color: '#aaa', fontStyle: 'italic' }}>Estornado</span>
                  )}
                </div>
                <p style={{ fontSize: 13, fontWeight: 700, color: dotColor, flexShrink: 0 }}>
                  {isReversal ? '− ' : '+ '}{fmt(Math.abs(h.amount))}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Tab: History ───────────────────────────────────────────────────────────────
function TabHistory({ projectId }: { projectId: string }) {
  const { data: history = [] } = useProjectHistory(projectId);
  return (
    <div style={{ padding: '16px 20px', overflowY: 'auto', flex: 1, minHeight: 0 }}>
      {history.length === 0 && (
        <p style={{ textAlign: 'center', color: '#999', fontSize: 13, marginTop: 40 }}>Sem histórico</p>
      )}
      <div style={{ position: 'relative', paddingLeft: 24 }}>
        <div style={{ position: 'absolute', left: 7, top: 6, bottom: 0, width: 2, background: '#F0F0F0' }} />
        {history.map((h, i) => (
          <div key={h.id} style={{ position: 'relative', marginBottom: 16 }}>
            <div style={{ position: 'absolute', left: -20, top: 4, width: 12, height: 12, borderRadius: '50%', background: i === 0 ? '#F5A800' : '#E0E0E0', border: '2px solid #fff', boxShadow: i === 0 ? '0 0 0 2px #F5A800' : 'none' }} />
            <div style={{ background: '#F8F8F8', borderRadius: 8, padding: '10px 12px' }}>
              <p style={{ fontSize: 12, fontWeight: 700, color: '#1A1A1A', marginBottom: 2 }}>{h.action}</p>
              {h.description && <p style={{ fontSize: 11, color: '#666', marginBottom: 4 }}>{h.description}</p>}
              <div style={{ display: 'flex', gap: 8, fontSize: 10, color: '#999' }}>
                {h.user_name && <span>{h.user_name}</span>}
                <span>{format(new Date(h.created_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Tab Tarefas ────────────────────────────────────────────────────────────────
const TASK_PRIORITY_CFG: Record<TaskPriority, { label: string; color: string; bg: string }> = {
  low:    { label: 'Baixa',   color: '#2D6A4F', bg: '#E1F5EE' },
  medium: { label: 'Média',   color: '#F5A800', bg: '#FEF3D0' },
  high:   { label: 'Alta',    color: '#D85A30', bg: '#FFF0E6' },
  urgent: { label: 'Urgente', color: '#E24B4A', bg: '#FCEBEB' },
};

function formatTaskDate(dateStr: string) {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('pt-BR');
}

function TabTarefas({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const { data: tasks = [], isLoading } = useProjectTasks(projectId);
  const updateTask = useUpdateTask();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | undefined>(undefined);
  const today = new Date().toISOString().split('T')[0];

  const open  = tasks.filter(t => t.status !== 'completed');
  const done  = tasks.filter(t => t.status === 'completed');

  function handleToggle(task: Task) {
    if (task.status === 'completed') return;
    updateTask.mutate({ id: task.id, status: 'completed' });
  }

  function openCreate() { setEditingTask(undefined); setDialogOpen(true); }
  function openEdit(t: Task) { setEditingTask(t); setDialogOpen(true); }

  return (
    <div style={{ padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#1A1A1A' }}>Tarefas do projeto</span>
        {canEdit && (
          <button
            onClick={openCreate}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '6px 14px', borderRadius: 8, border: 'none',
              background: '#F5A800', color: '#fff', fontSize: 12, fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            <Plus size={13} />
            + Tarefa
          </button>
        )}
      </div>

      {isLoading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '32px 0' }}>
          <Loader2 size={22} className="animate-spin" style={{ color: '#F5A800' }} />
        </div>
      ) : tasks.length === 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '32px 0', gap: 8 }}>
          <CheckSquare size={32} style={{ color: '#E0E0E0' }} />
          <span style={{ fontSize: 13, color: '#aaa' }}>Nenhuma tarefa para este projeto</span>
          {canEdit && (
            <button onClick={openCreate} style={{ marginTop: 4, padding: '6px 16px', borderRadius: 8, border: 'none', background: '#F5A800', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
              Criar tarefa
            </button>
          )}
        </div>
      ) : (
        <>
          {/* Open tasks */}
          {open.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {open.map(task => {
                const p = TASK_PRIORITY_CFG[task.priority];
                const overdue = task.due_date && task.due_date < today && task.status !== 'completed';
                return (
                  <div
                    key={task.id}
                    style={{
                      display: 'flex', alignItems: 'flex-start', gap: 10,
                      padding: '10px 12px', borderRadius: 10,
                      border: '1px solid #F0F0F0', background: '#FAFAFA',
                      borderLeft: `3px solid ${p.bg}`,
                    }}
                  >
                    <button onClick={() => handleToggle(task)} style={{ padding: 0, border: 'none', background: 'none', cursor: 'pointer', color: '#CCC', marginTop: 2 }}>
                      <Circle size={16} />
                    </button>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: '#1A1A1A' }}>{task.title}</span>
                        {canEdit && (
                          <button onClick={() => openEdit(task)} style={{ padding: 0, border: 'none', background: 'none', cursor: 'pointer', color: '#ccc' }}>
                            <Pencil size={12} />
                          </button>
                        )}
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 5 }}>
                        <span style={{ padding: '1px 8px', borderRadius: 99, fontSize: 11, fontWeight: 600, color: p.color, background: p.bg }}>{p.label}</span>
                        {task.assignee && (
                          <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 11, color: '#999' }}>
                            <UserIcon size={10} /> {task.assignee.name}
                          </span>
                        )}
                        {task.due_date && (
                          <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 11, fontWeight: 600, color: overdue ? '#E24B4A' : '#999' }}>
                            <Calendar size={10} /> {formatTaskDate(task.due_date)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Completed tasks */}
          {done.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#999', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                Concluídas ({done.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {done.map(task => (
                  <div
                    key={task.id}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '8px 12px', borderRadius: 10,
                      border: '1px solid #F0F0F0', background: '#FAFAFA',
                      opacity: 0.6,
                    }}
                  >
                    <CheckCircle2 size={16} style={{ color: '#2D6A4F', flexShrink: 0 }} />
                    <span style={{ fontSize: 12, color: '#666', textDecoration: 'line-through' }}>{task.title}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <TaskDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        task={editingTask}
        defaultProjectId={projectId}
      />
    </div>
  );
}

// ── Main Modal ─────────────────────────────────────────────────────────────────
export function ProjectModal({ projectId, onClose, initialTab = 'geral', viewAsCompany = false }: ProjectModalProps) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { getCompanyDisplayName } = useCompanyDisplay();
  const { isMobile, isTablet } = useWindowSize();
  // Simulando a empresa, ninguém é admin nem projetista: tudo o que depende
  // disso (abas, botões, edição, exclusão) se fecha de uma vez, sem depender de
  // eu lembrar de cada ponto.
  const isAdmin = user?.role === 'admin' && !viewAsCompany;
  const isStaff = user?.role === 'staff' && !viewAsCompany;
  const hasDiagramEngineAccess = useDiagramEngineAccess() && !viewAsCompany;
  const canEdit = isAdmin || isStaff;

  // Pedido de vistoria: só faz sentido consultar na visão do cliente.
  const { data: vistoria } = useVistoriaStatus(projectId, !canEdit);
  const solicitarVistoria = useSolicitarVistoria();

  const { data: project, isLoading } = useProject(projectId);
  const { data: assignments = [], isLoading: loadingAssignments } = useProjectAssignments(projectId);
  // Projetista com acesso restrito só pode abrir projetos atribuídos a ele
  // (ele pode chegar aqui por outras telas, como a de e-mails do Claudinho)
  // **ou** de uma empresa ligada a ele — o vínculo vale igual à atribuição, e
  // sem isto o projeto aparecia na lista e o modal barrava na cara (ago/2026).
  const restrictedStaff = isStaff && user?.staffAccessMode === 'assigned_only';
  const { data: minhasEmpresas = [], isLoading: loadingEmpresas } = useMinhasEmpresasDeStaff();
  const daMinhaEmpresa =
    !!project?.company_id && minhasEmpresas.some(v => v.company_id === project.company_id);
  const accessDenied =
    restrictedStaff && !loadingAssignments && !loadingEmpresas && !isLoading
    && !assignments.some(a => a.staff_user_id === user?.id)
    && !daMinhaEmpresa;

  useEffect(() => {
    if (accessDenied && projectId) {
      void logSystemEvent('forbidden_access', 'Tentou abrir projeto não atribuído', { projectId });
    }
  }, [accessDenied, projectId]);
  const { data: documents = [] } = useDocuments(projectId);
  const { data: checklists = [] } = useStageChecklists();
  const updateStatus = useUpdateProjectStatus();
  const updateData = useUpdateProjectData();

  const [activeTab, setActiveTab] = useState(initialTab);
  const [isEditing, setIsEditing] = useState(false);
  const [showGenDoc, setShowGenDoc] = useState(false);
  const [showInstaller, setShowInstaller] = useState(false);
  const [showStaffDialog, setShowStaffDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [checklistBlock, setChecklistBlock] = useState<{ from: string; to: string } | null>(null);
  const [showNewRevision, setShowNewRevision] = useState(false);
  const [selectedRevisionId, setSelectedRevisionId] = useState<string | null>(null);
  const moreRef = useRef<HTMLDivElement>(null);

  const { data: revisions = [] } = useProjectRevisions(project?.id);
  const { data: rejectionColumn } = useRejectionColumn();
  const isRejected = project?.status === (rejectionColumn?.status_key ?? 'rejected');
  const currentRevision = revisions.find(r => r.is_current) ?? revisions[revisions.length - 1];
  const selectedRevision = selectedRevisionId
    ? revisions.find(r => r.id === selectedRevisionId)
    : currentRevision;

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!showMoreMenu) return;
    const handler = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setShowMoreMenu(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showMoreMenu]);

  const handleStatusChange = useCallback((toStatus: ProjectStatus) => {
    if (!project) return;
    const fromStatus = project.status;
    if (fromStatus === toStatus) return;

    // Check checklist
    const rule = checklists.find(c => c.from_status === fromStatus && c.to_status === toStatus);
    if (rule && rule.enabled && rule.required_documents.length > 0) {
      const presentDocTypes = documents.map(d => d.document_type);
      const missing = rule.required_documents.filter(d => !presentDocTypes.includes(d as DocumentType));
      if (missing.length > 0) {
        setChecklistBlock({ from: fromStatus, to: toStatus });
        return;
      }
    }

    updateStatus.mutate({ projectId: project.id, status: toStatus });
  }, [project, checklists, documents, updateStatus]);

  const handleSaveData = useCallback(async (generalData: Record<string, any>, equipment: Record<string, any>) => {
    if (!project) return;
    await updateData.mutateAsync({ projectId: project.id, generalData, equipment });
    setIsEditing(false);
  }, [project, updateData]);

  const TABS = [
    { id: 'geral', label: isMobile ? 'Geral' : 'Geral & Comentários', icon: <FileText size={13} style={{ marginRight: 5 }} /> },
    { id: 'documentos', label: 'Documentos', icon: <Paperclip size={13} style={{ marginRight: 5 }} /> },
    ...(canEdit ? [{ id: 'tarefas', label: 'Tarefas', icon: <CheckSquare size={13} style={{ marginRight: 5 }} /> }] : []),
    // A empresa integradora fica só com Geral & Comentários e Documentos
    // (decisão do usuário, set/2026). Financeiro dela vive em /company/financial,
    // e o Histórico registra ação interna da equipe. Antes disto a busca da
    // Topbar já abria o modal para a empresa com estas duas abas à mostra.
    // Financeiro é só do ADMIN: o projetista não deve ver valor de projeto
    // (decisão do usuário, set/2026) — a tela /admin/financial já era
    // exclusiva dele, e esta aba era a brecha que restava.
    ...(isAdmin ? [{ id: 'financeiro', label: 'Financeiro', icon: <DollarSign size={13} style={{ marginRight: 5 }} /> }] : []),
    ...(canEdit ? [{ id: 'historico', label: 'Histórico', icon: <Clock size={13} style={{ marginRight: 5 }} /> }] : []),
    // Notificações da concessionária — mesmo público da tela de E-mails
    ...(canEdit
      ? [{ id: 'notificacoes', label: isMobile ? 'Notif.' : 'Notificações', icon: <Mail size={13} style={{ marginRight: 5 }} /> }]
      : []),
    // Alpha interno do CAD Engine — restrito por enquanto ao mesmo público do
    // motor de templates de diagrama (ver useDiagramEngineAccess): projetista
    // e admin da GD Manager (o master, que é admin da GD Manager, já cai aqui).
    ...(hasDiagramEngineAccess ? [{ id: 'unifilar', label: 'Unifilar', icon: <FlaskConical size={13} style={{ marginRight: 5 }} /> }] : []),
  ];

  const statusCfg: Record<string, { color: string; bg: string }> = {
    pending:       { color: '#666', bg: '#F0F0F0' },
    analysis:      { color: '#185FA5', bg: '#E6F1FB' },
    documentation: { color: '#854F0B', bg: '#FEF3D0' },
    approval:      { color: '#854F0B', bg: '#FEF3D0' },
    approved:      { color: '#0F6E56', bg: '#E1F5EE' },
    rejected:      { color: '#A32D2D', bg: '#FCEBEB' },
    completed:     { color: '#F5A800', bg: '#1A1A1A' },
  };
  const sCfg = statusCfg[project?.status || 'pending'] ?? statusCfg.pending;

  return (
    <>
      {/* Overlay */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          background: 'rgba(26,26,26,0.70)',
          backdropFilter: 'blur(2px)',
        }}
      />

      {/* Modal wrapper - handles centering */}
      <div
        style={{
          position: 'fixed', inset: 0, zIndex: 1001,
          display: 'flex', alignItems: 'flex-start',
          justifyContent: 'center',
          overflowY: 'auto', padding: '24px 16px',
          boxSizing: 'border-box',
        }}
        onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      >
        {/* Modal box */}
        <div
          style={{
            background: '#fff', borderRadius: 16,
            width: '95vw', maxWidth: 1280,
            minHeight: '85vh',
            display: 'flex', flexDirection: 'column',
            overflow: 'hidden',
            boxShadow: '0 24px 80px rgba(0,0,0,0.35)',
            margin: 'auto',
          }}
          onClick={e => e.stopPropagation()}
        >
          {isLoading || (!project && !accessDenied) ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 60 }}>
              <Loader2 size={28} className="animate-spin" style={{ color: '#F5A800' }} />
            </div>
          ) : accessDenied ? (
            /* Staff com acesso restrito tentando abrir projeto que não é dele
               (ex.: clicando num e-mail da tela do Claudinho). */
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 48, gap: 14, textAlign: 'center' }}>
              <Lock size={34} style={{ color: '#E0E0E0' }} />
              <p style={{ fontSize: 16, fontWeight: 700, color: '#1A1A1A' }}>Projeto não atribuído a você</p>
              <p style={{ fontSize: 13, color: '#777', maxWidth: 340, lineHeight: 1.6 }}>
                Este projeto não está sob sua responsabilidade, por isso os detalhes não podem ser abertos.
                Se você precisa acompanhá-lo, peça a um administrador para atribuí-lo a você.
              </p>
              <button
                onClick={onClose}
                style={{ marginTop: 4, padding: '8px 18px', borderRadius: 8, background: '#F5A800', border: 'none', color: '#1A1A1A', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
              >
                Fechar
              </button>
            </div>
          ) : !project ? null : (
            <>
              {/* Header */}
              <div style={{ background: '#1A1A1A', padding: '20px 28px', flexShrink: 0 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
                  {/* Left: project info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontFamily: 'monospace', fontSize: 20, fontWeight: 700, color: '#fff', marginBottom: 3 }}>
                      {project.code}
                    </p>
                    <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.55)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {project.generalData?.holder_name || project.title}
                    </p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                      {/* status badge */}
                      <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 20, background: sCfg.bg, color: sCfg.color }}>
                        {STATUS_LABELS[project.status]}
                      </span>
                      {/* concessionaire badge */}
                      {project.concessionaireName && (
                        <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 20, background: 'rgba(245,168,0,0.2)', color: '#F5A800', border: '0.5px solid rgba(245,168,0,0.3)' }}>
                          {project.concessionaireName}
                        </span>
                      )}
                      {/* company badge */}
                      {project.companyName && (
                        <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 20, background: 'rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.6)' }}>
                          {getCompanyDisplayName(project.companyName)}
                        </span>
                      )}
                      {/* revision badge */}
                      {revisions.length > 1 && currentRevision && (
                        <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 20, background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.6)' }}>
                          Rev. {currentRevision.revision_number}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Right: action buttons */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    {/* Pedido de vistoria — ação DO CLIENTE. Só aparece na visão
                        da empresa; quem clica de fato precisa ser a empresa dona
                        (no "Ver como empresa" fica à mostra, mas desabilitado,
                        porque ali o admin está conferindo a tela, não pedindo). */}
                    {!canEdit && vistoria?.permitido && (() => {
                      const jaAberta = !!vistoria.aberta;
                      const naEtapa = !!vistoria.etapa_ok;
                      const souEmpresa = user?.role === 'company' && !viewAsCompany;
                      const liberado = naEtapa && !jaAberta && souEmpresa;
                      const motivo = jaAberta
                        ? `Vistoria já solicitada${vistoria.em ? ` em ${new Date(vistoria.em).toLocaleDateString('pt-BR')}` : ''}`
                        : !naEtapa
                          ? 'Disponível quando o projeto chegar à etapa Aprovado'
                          : !souEmpresa
                            ? 'Ação disponível no acesso da empresa'
                            : 'Avisa a equipe de que o projeto está pronto para a vistoria';
                      return (
                        <button
                          onClick={() => { if (liberado) solicitarVistoria.mutate(project.id); }}
                          disabled={!liberado || solicitarVistoria.isPending}
                          title={motivo}
                          style={{
                            display: 'inline-flex', alignItems: 'center', gap: 5,
                            padding: '7px 14px', borderRadius: 8, border: 'none',
                            fontSize: 12, fontWeight: 600,
                            background: liberado ? '#F5A800' : 'rgba(255,255,255,0.10)',
                            color: liberado ? '#1A1A1A' : 'rgba(255,255,255,0.55)',
                            cursor: liberado ? 'pointer' : 'not-allowed',
                          }}
                        >
                          <Search size={13} />
                          {!isMobile && (jaAberta ? 'Vistoria solicitada' : 'Solicitar vistoria')}
                        </button>
                      );
                    })()}

                    {canEdit && (
                      <button
                        onClick={() => { setIsEditing(v => !v); setActiveTab('geral'); }}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '7px 14px', borderRadius: 8, border: 'none', background: isEditing ? '#F5A800' : 'rgba(255,255,255,0.10)', color: isEditing ? '#1A1A1A' : '#fff', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}
                      >
                        <Pencil size={13} /> {!isMobile && 'Editar'}
                      </button>
                    )}
                    {/* Ferramentas da equipe. Ficaram sem trava de papel enquanto
                        a empresa só alcançava o modal pela busca da Topbar; agora
                        que o modal é o caminho normal dela (set/2026), apareceriam
                        para o cliente: geração de documento da concessionária,
                        pacote do instalador e atribuição de projetista. */}
                    {canEdit && (
                      <button
                        onClick={() => setShowInstaller(true)}
                        title="Baixar pacote instalador"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '7px 14px', borderRadius: 8, border: 'none', background: 'rgba(255,255,255,0.10)', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
                      >
                        <PackageIcon size={13} /> {!isMobile && 'Pacote'}
                      </button>
                    )}
                    {canEdit && (
                      <button
                        onClick={() => setShowGenDoc(true)}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '7px 14px', borderRadius: 8, border: 'none', background: '#F5A800', color: '#1A1A1A', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
                      >
                        <FileOutput size={13} /> {!isMobile && 'Gerar Doc.'}
                      </button>
                    )}

                    {/* ⋯ menu */}
                    {canEdit && (
                    <div ref={moreRef} style={{ position: 'relative' }}>
                      <button
                        onClick={() => setShowMoreMenu(v => !v)}
                        style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, borderRadius: 8, border: 'none', background: 'rgba(255,255,255,0.10)', color: '#fff', cursor: 'pointer' }}
                      >
                        <MoreVertical size={15} />
                      </button>
                      {showMoreMenu && (
                        <div style={{ position: 'absolute', top: 'calc(100% + 6px)', right: 0, background: '#fff', borderRadius: 9, border: '0.5px solid #E0E0E0', boxShadow: '0 8px 20px rgba(0,0,0,0.10)', minWidth: 190, zIndex: 10, overflow: 'hidden' }}>
                          <button onClick={() => { setShowMoreMenu(false); setShowStaffDialog(true); }} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '10px 14px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 12, color: '#333', textAlign: 'left' }}>
                            <Users size={13} /> Atribuir Projetista
                          </button>
                          {/* "Ver página completa" levava ao ProjectDetail, que
                              foi aposentado (set/2026): agora /project/:id abre
                              este mesmo modal, então o item só daria uma volta. */}
                          {isAdmin && (
                            <>
                              <div style={{ height: 1, background: '#F0F0F0', margin: '4px 0' }} />
                              <button onClick={() => { setShowMoreMenu(false); setShowDeleteDialog(true); }} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '10px 14px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 12, color: '#E24B4A', textAlign: 'left' }}>
                                <Trash2 size={13} /> Excluir Projeto
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                    )}

                    {/* × close */}
                    <button
                      onClick={onClose}
                      style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, borderRadius: '50%', border: 'none', background: 'rgba(255,255,255,0.10)', color: '#fff', cursor: 'pointer', fontSize: 16 }}
                    >
                      <X size={15} />
                    </button>
                  </div>
                </div>
              </div>

              {/* Revision selector — shown when project has more than one revision */}
              {revisions.length > 1 && (
                <RevisionSelector
                  revisions={revisions}
                  selectedRevisionId={selectedRevision?.id ?? null}
                  onSelectRevision={setSelectedRevisionId}
                  onNewRevision={() => setShowNewRevision(true)}
                  projectStatus={project.status}
                  userRole={user?.role}
                  rejectionStatusKey={rejectionColumn?.status_key}
                />
              )}

              {/* Progress bar */}
              <ProgressBar
                currentStatus={project.status}
                canChange={canEdit}
                onChangeStatus={handleStatusChange}
              />

              {/* Tabs */}
              <div style={{ background: '#FAFAFA', borderBottom: '1px solid #F0F0F0', display: 'flex', padding: '0 28px', gap: 0, flexShrink: 0, overflowX: 'auto', scrollbarWidth: 'none' }}>
                {TABS.map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    style={{
                      display: 'inline-flex', alignItems: 'center',
                      padding: isMobile ? '10px 12px' : '12px 16px',
                      border: 'none', background: 'none', cursor: 'pointer',
                      fontSize: 13,
                      fontWeight: activeTab === tab.id ? 700 : 500,
                      color: activeTab === tab.id ? '#F5A800' : '#666',
                      borderBottom: activeTab === tab.id ? '2.5px solid #F5A800' : '2.5px solid transparent',
                      whiteSpace: 'nowrap', flexShrink: 0,
                    }}
                  >
                    {tab.icon}{tab.label}
                  </button>
                ))}
              </div>

              {/* Tab Content */}
              <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                {activeTab === 'geral' && !isMobile && (
                  /* ── Desktop: split pane Geral (left) + Comentários (right) ── */
                  <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
                    {/* Left column — General data */}
                    <div style={{ flex: '0 0 55%', borderRight: '1px solid #F0F0F0', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
                      {revisions.length > 1 && (
                        <div style={{ padding: '16px 28px 0' }}>
                          <RevisionTimeline revisions={revisions} />
                        </div>
                      )}
                      <TabGeneral
                        project={project}
                        isEditing={isEditing}
                        onSave={handleSaveData}
                        onCancel={() => setIsEditing(false)}
                        onEdit={() => setIsEditing(true)}
                      />
                    </div>
                    {/* Right column — Comments */}
                    <div style={{ flex: '0 0 45%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                      <div style={{ padding: '10px 16px', borderBottom: '1px solid #F0F0F0', display: 'flex', alignItems: 'center', gap: 6, background: '#FAFAFA' }}>
                        <Send size={12} style={{ color: '#F5A800' }} />
                        <span style={{ fontSize: 11, fontWeight: 700, color: '#999', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Comentários</span>
                      </div>
                      <TabComments project={project} />
                    </div>
                  </div>
                )}
                {activeTab === 'geral' && isMobile && (
                  /* ── Mobile: stacked (general then comments) ── */
                  <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
                    {revisions.length > 1 && (
                      <div style={{ padding: '12px 16px 0' }}>
                        <RevisionTimeline revisions={revisions} />
                      </div>
                    )}
                    <TabGeneral
                      project={project}
                      isEditing={isEditing}
                      onSave={handleSaveData}
                      onCancel={() => setIsEditing(false)}
                      onEdit={() => setIsEditing(true)}
                    />
                    <div style={{ borderTop: '4px solid #F0F0F0', background: '#FAFAFA' }}>
                      <div style={{ padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Send size={12} style={{ color: '#F5A800' }} />
                        <span style={{ fontSize: 11, fontWeight: 700, color: '#999', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Comentários</span>
                      </div>
                    </div>
                    <TabComments project={project} />
                  </div>
                )}
                {activeTab === 'documentos' && (
                  <TabDocuments project={project} canUpload={canEdit} />
                )}
                {activeTab === 'tarefas' && (
                  <TabTarefas projectId={project.id} canEdit={canEdit} />
                )}
                {/* `isAdmin` também aqui, e não só no botão da aba: `initialTab`
                    pode chegar por fora, e o conteúdo não deve depender de a
                    aba ter sido escondida. */}
                {activeTab === 'financeiro' && isAdmin && (
                  <TabFinanceiro project={project} isAdmin={isAdmin} />
                )}
                {activeTab === 'historico' && (
                  <TabHistory projectId={project.id} />
                )}
                {activeTab === 'notificacoes' && (
                  <ProjectEmailsTab projectId={project.id} />
                )}

                {activeTab === 'unifilar' && hasDiagramEngineAccess && (
                  <UnifilarTab project={project} />
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Sub-dialogs */}
      {project && showInstaller && (
        <InstallerPackageDialog
          open={showInstaller}
          onClose={() => setShowInstaller(false)}
          project={project}
        />
      )}
      {project && showGenDoc && (
        <GenerateDocumentDialog
          open={showGenDoc}
          onOpenChange={setShowGenDoc}
          project={project}
          revisionData={selectedRevision ? {
            general_data: selectedRevision.general_data,
            equipment: selectedRevision.equipment,
          } : undefined}
        />
      )}
      {project && showStaffDialog && (
        <StaffAssignmentDialog open={showStaffDialog} onOpenChange={setShowStaffDialog} projectId={project.id} projectCode={project.code} />
      )}
      {project && showDeleteDialog && (
        <DeleteProjectDialog
          open={showDeleteDialog}
          onOpenChange={setShowDeleteDialog}
          projectId={project.id}
          projectCode={project.code}
          companyName={project.companyName}
          onSuccess={() => { onClose(); }}
        />
      )}
      {checklistBlock && project && (
        <ChecklistBlockDialog
          fromStatus={checklistBlock.from}
          toStatus={checklistBlock.to}
          presentDocs={documents.map(d => d.document_type)}
          onClose={() => setChecklistBlock(null)}
          onGoToDocs={() => { setChecklistBlock(null); setActiveTab('documentos'); }}
        />
      )}
      {project && showNewRevision && (
        <NewRevisionDialog
          open={showNewRevision}
          onOpenChange={setShowNewRevision}
          project={project}
          currentRevision={currentRevision}
          nextRevisionNumber={(currentRevision?.revision_number ?? 0) + 1}
        />
      )}
    </>
  );
}
