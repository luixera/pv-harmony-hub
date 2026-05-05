import { useState, useRef } from 'react';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  FileText, Loader2, Download, FileOutput,
  AlertTriangle, Eye, Pencil, Info, X,
} from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { toast } from 'sonner';
import {
  useConcessionaireTemplates,
  downloadTemplateBuffer,
  ConcessionaireTemplate,
} from '@/hooks/useConcessionaireTemplates';
import { ProjectWithDetails } from '@/hooks/useProjects';
import { RevisionGeneralData, RevisionEquipment } from '@/hooks/useProjectRevisions';
import { useDocumentPreview } from '@/hooks/useDocumentPreview';

// ─── Types ────────────────────────────────────────────────────────────────────

interface RevisionData {
  general_data?: RevisionGeneralData;
  equipment?: RevisionEquipment;
  revision_number?: number;
}

interface GenerateDocumentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: ProjectWithDetails;
  revisionData?: RevisionData;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const styledHtml = (html: string) => `
  <style>
    h1 { font-size:16px; font-weight:700; text-align:center; margin-bottom:8px; color:#1A1A1A; }
    h2 { font-size:13px; font-weight:700; margin:12px 0 6px; color:#1A1A1A; }
    p  { font-size:12px; margin-bottom:6px; line-height:1.6; color:#333; }
    table { width:100%; border-collapse:collapse; margin-bottom:10px; }
    td, th { border:0.5px solid #E0E0E0; padding:6px 10px; font-size:11px; }
    th { background:#F8F8F8; font-weight:600; }
    strong { font-weight:700; }
    em { font-style:italic; }
  </style>
  ${html}
`;

function SidebarRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: 9, color: '#aaa', textTransform: 'uppercase', letterSpacing: '.04em', fontWeight: 600 }}>
        {label}
      </span>
      <span style={{ fontSize: 11, color: '#1A1A1A', fontWeight: 500, lineHeight: 1.3 }}>
        {value}
      </span>
    </div>
  );
}

function SidebarCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: '#fff', borderRadius: 9, border: '0.5px solid #EFEFEF', overflow: 'hidden' }}>
      <div style={{ padding: '6px 10px', background: '#F0F0F0', fontSize: 9, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: '.04em' }}>
        {title}
      </div>
      <div style={{ padding: '10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {children}
      </div>
    </div>
  );
}

// ─── Inline keyframe injection (once) ─────────────────────────────────────────
const STYLE_ID = 'doc-preview-keyframes';
if (!document.getElementById(STYLE_ID)) {
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    @keyframes dp-spin { to { transform: rotate(360deg) } }
    @keyframes dp-progress { from { width:0% } to { width:90% } }
  `;
  document.head.appendChild(style);
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function GenerateDocumentDialog({
  open,
  onOpenChange,
  project,
  revisionData,
}: GenerateDocumentDialogProps) {
  // ── Existing state (unchanged) ──────────────────────────────────────────────
  const [selectedTemplate, setSelectedTemplate] = useState<ConcessionaireTemplate | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  const { data: templates = [], isLoading } = useConcessionaireTemplates(
    project.concessionaire_id ?? undefined,
  );

  // ── Preview state (new) ─────────────────────────────────────────────────────
  const preview = useDocumentPreview();
  const previewRef = useRef<HTMLDivElement>(null);

  // Derive display name from selected template
  const getDisplayName = (name: string) => name.replace(/^\d+_/, '');
  const templateDisplayName = selectedTemplate ? getDisplayName(selectedTemplate.name) : '';
  const fileName = `${project?.code ?? 'documento'}_${templateDisplayName || 'requerimento'}`;

  // ── Template data builder (unchanged) ──────────────────────────────────────
  const buildTemplateData = () => {
    const g = revisionData?.general_data ?? project.generalData;
    const e = revisionData?.equipment ?? project.equipment;

    return {
      codigo_projeto:    project.code ?? '',
      empresa:           project.companyName ?? '',
      concessionaria:    project.concessionaireName ?? g?.utility_company ?? '',
      data_criacao:      format(new Date(project.created_at), 'dd/MM/yyyy', { locale: ptBR }),

      nome_titular:      g?.holder_name ?? '',
      cpf_cnpj:          g?.holder_cpf_cnpj ?? '',
      email_titular:     g?.holder_email ?? '',
      telefone_titular:  g?.holder_phone ?? '',

      endereco:          g?.address ?? '',
      cidade:            g?.city ?? '',
      estado:            g?.state ?? '',
      endereco_completo: g ? `${g.address}, ${g.city}/${g.state}` : '',
      uc:                g?.uc_number ?? '',
      fase:              g?.phase_type ?? '',
      disjuntor:         g?.circuit_breaker_current ?? '',
      rural:             g?.is_rural ? 'Sim' : 'Não',
      coordenadas:       g?.coordinates ?? '',

      marca_modulo:      e?.module_brand ?? '',
      modelo_modulo:     e?.module_model ?? '',
      potencia_modulo:   e?.module_power != null ? `${e.module_power} W` : '',
      qtd_modulos:       String(e?.module_quantity ?? 0),
      marca_inversor:    e?.inverter_brand ?? '',
      modelo_inversor:   e?.inverter_model ?? '',
      potencia_inversor: e?.inverter_power != null ? `${e.inverter_power} kW` : '',
      qtd_inversores:    String(e?.inverter_quantity ?? 1),
      potencia_total:    e?.total_installed_power != null ? `${e.total_installed_power} kWp` : '',
    };
  };

  // ── Generate: fill template → preview (instead of direct download) ──────────
  const handleGenerate = async () => {
    if (!selectedTemplate) return;
    setIsGenerating(true);

    try {
      const buffer = await downloadTemplateBuffer(selectedTemplate.path);
      const zip = new PizZip(buffer);
      const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });

      doc.render(buildTemplateData());

      const blob = doc.getZip().generate({
        type: 'blob',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });

      // Hand off to preview hook instead of direct download
      await preview.generatePreview(blob);

    } catch (error) {
      console.error('Error generating document:', error);
      toast.error('Erro ao gerar documento. Verifique se o template é válido.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleOpenChange = (value: boolean) => {
    if (!value) {
      setSelectedTemplate(null);
      preview.reset();
    }
    onOpenChange(value);
  };

  // ── Toolbar execCommand helper ──────────────────────────────────────────────
  const exec = (cmd: string) => {
    document.execCommand(cmd, false, undefined);
    previewRef.current?.focus();
  };

  // ── Sidebar data (mirrors buildTemplateData) ────────────────────────────────
  const g = revisionData?.general_data ?? project.generalData;
  const e = revisionData?.equipment ?? project.equipment;

  // ============================================================
  //  RENDER
  // ============================================================

  // ── IDLE: original template selector UI ────────────────────────────────────
  if (preview.step === 'idle') {
    return (
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileOutput className="w-5 h-5 text-primary" />
              Gerar Documento
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Selecione um template para gerar o documento preenchido com os dados do projeto{' '}
              <strong>{project.code}</strong>.
            </p>

            {revisionData && (
              <div style={{
                background: '#FEF3D0', border: '0.5px solid #F5A800',
                borderRadius: 7, padding: '5px 10px',
                fontSize: 10, color: '#854F0B', fontWeight: 600,
              }}>
                📋 Gerando com dados da Revisão {revisionData.revision_number ?? ''}
              </div>
            )}

            {!project.concessionaire_id ? (
              <div className="text-center py-8 text-muted-foreground">
                <FileText className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <p className="text-sm">Este projeto não possui concessionária vinculada.</p>
              </div>
            ) : isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : templates.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <FileText className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <p className="text-sm">
                  Nenhum template cadastrado para{' '}
                  <strong>{project.concessionaireName ?? 'esta concessionária'}</strong>.
                </p>
                <p className="text-xs mt-1">
                  Acesse Concessionárias → Templates para adicionar modelos.
                </p>
              </div>
            ) : (
              <ScrollArea className="h-[260px]">
                <div className="space-y-2">
                  {templates.map((template) => (
                    <button
                      key={template.path}
                      type="button"
                      onClick={() => setSelectedTemplate(template)}
                      className={`w-full flex items-center gap-3 p-3 rounded-lg border text-left transition-colors ${
                        selectedTemplate?.path === template.path
                          ? 'border-primary bg-primary/10'
                          : 'bg-card hover:bg-accent/50'
                      }`}
                    >
                      <FileText className="w-4 h-4 text-blue-500 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">
                          {getDisplayName(template.name)}
                        </p>
                        {template.created_at && (
                          <p className="text-xs text-muted-foreground">
                            {format(new Date(template.created_at), 'dd/MM/yyyy', { locale: ptBR })}
                          </p>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              </ScrollArea>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => handleOpenChange(false)}>
              Cancelar
            </Button>
            <Button
              onClick={handleGenerate}
              disabled={!selectedTemplate || isGenerating}
              className="gap-2"
            >
              {isGenerating ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Eye className="w-4 h-4" />
              )}
              {isGenerating ? 'Processando…' : 'Visualizar prévia'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  // ── LOADING ─────────────────────────────────────────────────────────────────
  if (preview.step === 'loading') {
    return (
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-sm">
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 20px', gap: 20 }}>
            {/* Spinner */}
            <div style={{
              width: 40, height: 40, borderRadius: '50%',
              border: '3px solid #F0F0F0',
              borderTopColor: '#F5A800',
              animation: 'dp-spin 0.8s linear infinite',
            }} />
            {/* Progress bar */}
            <div style={{ width: 240, height: 5, background: '#F0F0F0', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{
                height: '100%', borderRadius: 3, background: '#F5A800',
                animation: 'dp-progress 2s ease-in-out forwards',
              }} />
            </div>
            <p style={{ fontSize: 13, color: '#888', textAlign: 'center' }}>
              Processando template e preenchendo dados…
            </p>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // ── ERROR ────────────────────────────────────────────────────────────────────
  if (preview.step === 'error') {
    return (
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-sm">
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, padding: '32px 20px' }}>
            <AlertTriangle size={40} style={{ color: '#D85A30' }} />
            <p style={{ fontSize: 14, fontWeight: 700, color: '#1A1A1A', textAlign: 'center' }}>
              Não foi possível gerar a prévia
            </p>
            {preview.errorMessage && (
              <p style={{ fontSize: 12, color: '#888', textAlign: 'center' }}>
                {preview.errorMessage}
              </p>
            )}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
              {preview.docxBlob && (
                <button
                  onClick={() => preview.downloadDocx(fileName)}
                  style={{ padding: '9px 16px', borderRadius: 8, background: '#F5A800', border: 'none', color: '#1A1A1A', fontWeight: 700, fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
                >
                  <Download size={13} /> Baixar sem prévia
                </button>
              )}
              <button
                onClick={() => preview.reset()}
                style={{ padding: '9px 16px', borderRadius: 8, background: '#fff', border: '0.5px solid #E0E0E0', color: '#555', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}
              >
                Tentar novamente
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // ── PREVIEW ──────────────────────────────────────────────────────────────────
  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="p-0 overflow-hidden gap-0"
        style={{ width: '95vw', maxWidth: 1200, height: '92vh', display: 'flex', flexDirection: 'column' }}
      >
        {/* ── Header ── */}
        <div style={{ background: '#1A1A1A', padding: '14px 20px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
          {/* Left: title + subtitle */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: '#FEF3D0', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <FileOutput size={15} style={{ color: '#854F0B' }} />
            </div>
            <div style={{ minWidth: 0 }}>
              <p style={{ fontSize: 14, fontWeight: 700, color: '#fff', margin: 0 }}>Prévia do Documento</p>
              <p style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {templateDisplayName}{project.concessionaireName ? ` — ${project.concessionaireName}` : ''} · {project.code}
              </p>
            </div>
          </div>

          {/* Right: edit/preview toggle + close */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            {/* Toggle tabs */}
            <div style={{ display: 'flex', background: 'rgba(255,255,255,0.1)', borderRadius: 8, padding: 3, gap: 2 }}>
              {[
                { label: 'Editar', value: true, icon: <Pencil size={11} /> },
                { label: 'Prévia', value: false, icon: <Eye size={11} /> },
              ].map(tab => (
                <button
                  key={String(tab.value)}
                  onClick={() => preview.setEditing(tab.value)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 5,
                    padding: '5px 10px', borderRadius: 6, border: 'none', cursor: 'pointer',
                    fontSize: 11, fontWeight: 600, transition: 'all .15s',
                    background: preview.isEditing === tab.value ? '#fff' : 'transparent',
                    color: preview.isEditing === tab.value ? '#1A1A1A' : 'rgba(255,255,255,0.5)',
                  }}
                >
                  {tab.icon}{tab.label}
                </button>
              ))}
            </div>
            {/* Close */}
            <button
              onClick={() => preview.reset()}
              style={{ width: 28, height: 28, borderRadius: '50%', border: 'none', background: 'rgba(255,255,255,0.1)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
            >
              <X size={13} />
            </button>
          </div>
        </div>

        {/* ── Editing toolbar ── */}
        {preview.isEditing && (
          <div style={{ background: '#F8F8F8', borderBottom: '1px solid #F0F0F0', padding: '7px 16px', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, flexWrap: 'wrap' }}>
            {/* Separator helper */}
            {(() => {
              const Sep = () => <div style={{ width: 1, height: 18, background: '#E0E0E0', margin: '0 4px' }} />;

              return (
                <>
                  <span style={{ fontSize: 10, color: '#aaa', fontWeight: 600, marginRight: 2 }}>Texto:</span>
                  {[
                    { label: 'B', cmd: 'bold',      style: { fontWeight: 700 } },
                    { label: 'I', cmd: 'italic',    style: { fontStyle: 'italic' } },
                    { label: 'U', cmd: 'underline', style: { textDecoration: 'underline' } },
                  ].map(btn => (
                    <button key={btn.cmd} onMouseDown={e => { e.preventDefault(); exec(btn.cmd); }}
                      style={{ width: 26, height: 26, borderRadius: 5, border: '0.5px solid #E0E0E0', background: '#fff', cursor: 'pointer', fontSize: 11, ...btn.style, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {btn.label}
                    </button>
                  ))}

                  <Sep />
                  <span style={{ fontSize: 10, color: '#aaa', fontWeight: 600, marginRight: 2 }}>Alinhamento:</span>
                  {[
                    { label: '⬛', cmd: 'justifyLeft',   title: 'Alinhar à esquerda' },
                    { label: '☰', cmd: 'justifyCenter', title: 'Centralizar' },
                    { label: '⬛', cmd: 'justifyRight',  title: 'Alinhar à direita' },
                  ].map((btn, i) => (
                    <button key={btn.cmd} onMouseDown={e => { e.preventDefault(); exec(btn.cmd); }}
                      title={btn.title}
                      style={{ width: 26, height: 26, borderRadius: 5, border: '0.5px solid #E0E0E0', background: '#fff', cursor: 'pointer', fontSize: i === 0 ? 9 : 13, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {i === 0 ? '←' : i === 1 ? '≡' : '→'}
                    </button>
                  ))}

                  <Sep />
                  {[
                    { label: '↩', cmd: 'undo', title: 'Desfazer' },
                    { label: '↪', cmd: 'redo', title: 'Refazer' },
                  ].map(btn => (
                    <button key={btn.cmd} onMouseDown={e => { e.preventDefault(); exec(btn.cmd); }}
                      title={btn.title}
                      style={{ width: 26, height: 26, borderRadius: 5, border: '0.5px solid #E0E0E0', background: '#fff', cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {btn.label}
                    </button>
                  ))}

                  <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5, padding: '3px 10px', borderRadius: 20, background: '#FEF3D0', border: '0.5px solid #F5A800' }}>
                    <Pencil size={10} style={{ color: '#854F0B' }} />
                    <span style={{ fontSize: 11, color: '#854F0B', fontWeight: 600 }}>Modo edição ativo</span>
                  </div>
                </>
              );
            })()}
          </div>
        )}

        {/* ── Main area: sidebar | document ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', flex: 1, overflow: 'hidden', minHeight: 0 }}>

          {/* Sidebar */}
          <div style={{ background: '#F8F8F8', borderRight: '0.5px solid #F0F0F0', padding: 14, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <SidebarCard title="Dados do projeto">
              <SidebarRow label="Titular" value={g?.holder_name} />
              <SidebarRow label="CPF / CNPJ" value={g?.holder_cpf_cnpj} />
              <SidebarRow label="Número UC" value={g?.uc_number} />
              <SidebarRow label="Concessionária" value={g?.utility_company ?? project.concessionaireName} />
              <SidebarRow label="Endereço" value={g?.address} />
              <SidebarRow label="Cidade / UF" value={g?.city && g?.state ? `${g.city}/${g.state}` : undefined} />
              <SidebarRow label="Disjuntor (A)" value={g?.circuit_breaker_current} />
              <SidebarRow label="Tipo de fase" value={g?.phase_type} />
            </SidebarCard>

            <SidebarCard title="Equipamentos">
              <SidebarRow label="Inversor" value={e?.inverter_brand && e?.inverter_model ? `${e.inverter_brand} ${e.inverter_model}` : (e?.inverter_model ?? undefined)} />
              <SidebarRow label="Qtd. inversores" value={e?.inverter_quantity != null ? String(e.inverter_quantity) : undefined} />
              <SidebarRow label="Módulo" value={e?.module_brand && e?.module_model ? `${e.module_brand} ${e.module_model}` : (e?.module_model ?? undefined)} />
              <SidebarRow label="Qtd. módulos" value={e?.module_quantity != null ? String(e.module_quantity) : undefined} />
              {e?.total_installed_power != null && (
                <div style={{ background: '#FEF3D0', borderRadius: 7, padding: '7px 9px', display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontSize: 9, color: '#aaa', textTransform: 'uppercase', letterSpacing: '.04em', fontWeight: 600 }}>Potência total</span>
                  <span style={{ fontSize: 13, color: '#F5A800', fontWeight: 700 }}>{e.total_installed_power} kWp</span>
                </div>
              )}
            </SidebarCard>

            {/* Editing tip */}
            {preview.isEditing && (
              <div style={{ background: '#FEF3D0', border: '0.5px solid #F5A800', borderRadius: 9, padding: 10 }}>
                <p style={{ fontSize: 10, color: '#B87A20', lineHeight: 1.5, margin: 0 }}>
                  <strong>💡 Dica</strong><br />
                  Clique diretamente no texto do documento para editar. Use a barra de formatação acima para negrito, itálico e alinhamento.
                </p>
              </div>
            )}
          </div>

          {/* Document preview area */}
          <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
            {/* Sub-header */}
            <div style={{ padding: '7px 16px', background: '#FAFAFA', borderBottom: '0.5px solid #F0F0F0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Eye size={12} style={{ color: '#888' }} />
                <span style={{ fontSize: 11, color: '#555' }}>
                  {preview.isEditing ? 'Clique nos campos para editar' : 'Modo leitura'}
                </span>
                <span style={{
                  fontSize: 9, fontWeight: 600, padding: '2px 8px', borderRadius: 20,
                  background: preview.isEditing ? '#FEF3D0' : '#E1F5EE',
                  color: preview.isEditing ? '#854F0B' : '#0F6E56',
                }}>
                  {preview.isEditing ? '✏ Editável' : '👁 Apenas leitura'}
                </span>
              </div>
              <span style={{ fontSize: 10, color: '#aaa' }}>
                Campos em amarelo = preenchidos automaticamente
              </span>
            </div>

            {/* Document scroll area */}
            <div style={{ flex: 1, overflowY: 'auto', padding: 24, background: '#E8E8E8', display: 'flex', justifyContent: 'center' }}>
              {/* A4 sheet */}
              <div style={{ background: '#fff', maxWidth: 680, width: '100%', minHeight: 500, borderRadius: 4, boxShadow: '0 2px 12px rgba(0,0,0,0.12)', padding: '48px 52px', position: 'relative' }}>
                {/* Watermark */}
                <div
                  data-watermark="true"
                  style={{ position: 'absolute', top: 20, right: 20, background: '#FEF3D0', border: '0.5px solid #F5A800', borderRadius: 6, padding: '3px 8px', fontSize: 9, fontWeight: 700, color: '#854F0B', opacity: 0.7 }}
                >
                  RASCUNHO
                </div>

                {/* Content */}
                <div
                  ref={previewRef}
                  contentEditable={preview.isEditing}
                  suppressContentEditableWarning
                  dangerouslySetInnerHTML={{ __html: styledHtml(preview.htmlContent) }}
                  style={{ outline: 'none', lineHeight: 1.6, fontSize: 12, color: '#1A1A1A' }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* ── Footer ── */}
        <div style={{ background: '#F8F8F8', borderTop: '1px solid #F0F0F0', padding: '11px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          {/* Left: info */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#888' }}>
            <Info size={12} style={{ color: '#aaa', flexShrink: 0 }} />
            <span>Campos em </span>
            <span style={{ background: 'rgba(245,168,0,0.2)', color: '#854F0B', fontWeight: 600, padding: '0 5px', borderRadius: 4 }}>amarelo</span>
            <span> foram preenchidos automaticamente</span>
          </div>

          {/* Right: actions */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              onClick={() => preview.reset()}
              style={{ padding: '7px 14px', borderRadius: 8, border: '0.5px solid #E0E0E0', background: '#fff', color: '#555', fontSize: 11, fontWeight: 500, cursor: 'pointer' }}
            >
              Cancelar
            </button>

            <div style={{ width: 1, height: 20, background: '#E0E0E0' }} />

            {/* Download .DOCX */}
            <button
              onClick={() => preview.downloadDocx(fileName)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 8, border: 'none', background: '#2B579A', color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
            >
              <Download size={13} /> Baixar .DOCX
            </button>

            {/* Download .PDF */}
            <button
              onClick={() => previewRef.current && preview.downloadPdf(fileName, previewRef.current)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 8, border: 'none', background: '#E24B4A', color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
            >
              <Download size={13} /> Baixar .PDF
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
