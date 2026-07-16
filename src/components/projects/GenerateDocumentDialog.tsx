import { useState, useRef, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  FileText, Loader2, Download, FileOutput,
  AlertTriangle, Eye, Info, X, RotateCcw,
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
import { detectTemplateTags, generateDocxFromTemplate } from '@/utils/docxGenerator';
import { useEntryRules, matchEntryRule, entryRuleValues } from '@/hooks/useEntryRules';
import { logEvent } from '@/lib/tracking';

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

// ─── Tag → human-readable label ───────────────────────────────────────────────

const TAG_LABELS: Record<string, string> = {
  codigo_projeto:    'Código do projeto',
  empresa:           'Empresa',
  concessionaria:    'Concessionária',
  nome_titular:      'Nome do titular',
  cpf_cnpj:          'CPF / CNPJ',
  telefone_titular:  'Telefone',
  email_titular:     'E-mail',
  endereco:          'Endereço',
  cidade:            'Cidade',
  estado:            'Estado / UF',
  uf:                'UF',
  cep:               'CEP',
  endereco_completo: 'Endereço completo',
  uc:                'Número da UC',
  numero_uc:         'Número da UC',
  disjuntor:         'Disjuntor (A)',
  fase:              'Tipo de fase',
  tipo_fase:         'Tipo de fase',
  rural:             'Área rural',
  coordenadas:       'Coordenadas GPS',
  marca_inversor:    'Inversor — Marca',
  modelo_inversor:   'Inversor — Modelo',
  potencia_inversor: 'Inversor — Potência',
  qtd_inversores:    'Inversor — Qtd.',
  marca_modulo:      'Módulo — Marca',
  modelo_modulo:     'Módulo — Modelo',
  potencia_modulo:   'Módulo — Potência',
  qtd_modulos:       'Módulo — Qtd.',
  potencia_total:    'Potência total',
  kwp:               'kWp instalado',
  data:              'Data',
  data_emissao:      'Data de emissão',
  data_atual:        'Data atual',
  data_criacao:      'Data de criação',
};

// ─── Scoped CSS for mammoth HTML output ───────────────────────────────────────

const buildStyledHtml = (html: string) => `
  <style>
    .doc-content {
      font-family: Arial, sans-serif;
      font-size: 11px;
      color: #1A1A1A;
      line-height: 1.6;
    }
    .doc-content h1 {
      font-size: 14px; font-weight: 700;
      margin: 16px 0 8px; color: #1A1A1A;
    }
    .doc-content h2 {
      font-size: 12px; font-weight: 700;
      margin: 12px 0 6px;
    }
    .doc-content p { margin-bottom: 6px; }
    .doc-content table {
      width: 100%; border-collapse: collapse;
      margin-bottom: 12px; font-size: 10px;
    }
    .doc-content td, .doc-content th {
      border: 0.5px solid #CCCCCC;
      padding: 5px 8px; vertical-align: top;
    }
    .doc-content th { background: #F0F0F0; font-weight: 600; }
    .doc-content img { max-width: 100%; height: auto; }
    .doc-content strong { font-weight: 700; }
    .doc-content em { font-style: italic; }
  </style>
  <div class="doc-content">${html}</div>
`;

// ─── Inline keyframe injection (once) ─────────────────────────────────────────

const STYLE_ID = 'doc-preview-keyframes';
if (!document.getElementById(STYLE_ID)) {
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = `
    @keyframes dp-spin     { to { transform: rotate(360deg) } }
    @keyframes dp-progress { from { width:0% } to { width:90% } }
  `;
  document.head.appendChild(s);
}

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

// ─── Main Component ───────────────────────────────────────────────────────────

export function GenerateDocumentDialog({
  open,
  onOpenChange,
  project,
  revisionData,
}: GenerateDocumentDialogProps) {
  // ── Template selector state ────────────────────────────────────────────────
  const [selectedTemplate, setSelectedTemplate] =
    useState<ConcessionaireTemplate | null>(null);
  const [isGenerating,     setIsGenerating]     = useState(false);

  // ── Download loading states ────────────────────────────────────────────────
  const [isDownloading,    setIsDownloading]    = useState(false);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);

  // ── Editable field state ───────────────────────────────────────────────────
  const [originalValues, setOriginalValues] = useState<Record<string, string>>({});
  const [editedValues,   setEditedValues]   = useState<Record<string, string>>({});
  const [templateTags,   setTemplateTags]   = useState<string[]>([]);
  const [templateBuffer, setTemplateBuffer] = useState<ArrayBuffer | null>(null);
  const [isRegenerating, setIsRegenerating] = useState(false);

  const { data: templates = [], isLoading } = useConcessionaireTemplates(
    project.concessionaire_id ?? undefined,
  );
  const { data: entryRules = [] } = useEntryRules(project.concessionaire_id ?? undefined);

  const preview    = useDocumentPreview();
  const previewRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Derive display name
  const getDisplayName = (name: string) => name.replace(/^\d+_/, '');
  const templateDisplayName = selectedTemplate
    ? getDisplayName(selectedTemplate.name) : '';
  const fileName = `${project?.code ?? 'documento'}_${templateDisplayName || 'requerimento'}`;

  // ── Computed: how many fields were edited ──────────────────────────────────
  const editCount = Object.entries(editedValues)
    .filter(([k, v]) => v !== originalValues[k]).length;

  // ── Template values builder ────────────────────────────────────────────────
  const buildProjectValues = (): Record<string, string> => {
    const g = revisionData?.general_data ?? project.generalData ?? {};
    const e = revisionData?.equipment    ?? project.equipment    ?? {};
    const today = format(new Date(), 'dd/MM/yyyy', { locale: ptBR });

    const endereco_completo = [
      g.address, g.city, g.state,
      g.cep ? `CEP: ${g.cep}` : '',
    ].filter(Boolean).join(', ');

    // Padrão de entrada da concessionária (categoria resolvida por fase + disjuntor)
    const entryRule = matchEntryRule(entryRules, g.phase_type, g.circuit_breaker_current);

    return {
      ...entryRuleValues(entryRule),
      codigo_projeto:    project.code              ?? '',
      empresa:           project.companyName       ?? '',
      concessionaria:    project.concessionaireName ?? g.utility_company ?? '',
      nome_titular:      g.holder_name             ?? '',
      cpf_cnpj:          g.holder_cpf_cnpj         ?? '',
      email_titular:     g.holder_email            ?? '',
      telefone_titular:  g.holder_phone            ?? '',
      endereco:          g.address                 ?? '',
      cidade:            g.city                    ?? '',
      estado:            g.state                   ?? '',
      uf:                g.state                   ?? '',
      cep:               g.cep                     ?? '',
      endereco_completo,
      uc:                g.uc_number               ?? '',
      numero_uc:         g.uc_number               ?? '',
      disjuntor:         g.circuit_breaker_current ?? '',
      fase:              g.phase_type              ?? '',
      tipo_fase:         g.phase_type              ?? '',
      rural:             g.is_rural ? 'Sim' : 'Não',
      coordenadas:       g.coordinates             ?? '',
      marca_inversor:    e.inverter_brand          ?? '',
      modelo_inversor:   e.inverter_model          ?? '',
      potencia_inversor: e.inverter_power   != null ? `${e.inverter_power} kW`   : '',
      qtd_inversores:    String(e.inverter_quantity ?? ''),
      marca_modulo:      e.module_brand            ?? '',
      modelo_modulo:     e.module_model            ?? '',
      potencia_modulo:   e.module_power    != null ? `${e.module_power} Wp`      : '',
      qtd_modulos:       String(e.module_quantity  ?? ''),
      potencia_total:    e.total_installed_power != null
        ? `${e.total_installed_power} kWp` : '',
      kwp:               String(e.total_installed_power ?? ''),
      data:              today,
      data_emissao:      today,
      data_atual:        today,
      data_criacao:      format(new Date(project.created_at), 'dd/MM/yyyy', { locale: ptBR }),
    };
  };

  // ── Debounced reactive preview ─────────────────────────────────────────────
  useEffect(() => {
    if (!templateBuffer || preview.isFormTemplate) return;
    if (Object.keys(editedValues).length === 0)    return;

    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setIsRegenerating(true);
      try {
        const blob        = await generateDocxFromTemplate(templateBuffer, editedValues);
        const arrayBuffer = await blob.arrayBuffer();
        const mammoth     = await import('mammoth');
        const result      = await mammoth.convertToHtml({ arrayBuffer });
        preview.updateHtml(result.value);
      } catch (err) {
        console.error('[GenerateDoc] Erro ao atualizar prévia:', err);
      } finally {
        setIsRegenerating(false);
      }
    }, 600);

    return () => clearTimeout(debounceRef.current);
  }, [editedValues]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Generate ───────────────────────────────────────────────────────────────
  const handleGenerate = async () => {
    if (!selectedTemplate) return;
    setIsGenerating(true);
    logEvent('doc_generated', { project_id: project.id, code: project.code, template: selectedTemplate.name });

    try {
      const buffer = await downloadTemplateBuffer(selectedTemplate.path);
      const { hasTags, tags } = await detectTemplateTags(buffer);
      console.log('[GenerateDoc] hasTags:', hasTags, '| tags:', tags);

      if (hasTags) {
        const values = buildProjectValues();
        console.log('[GenerateDoc] Valores do projeto:', values);

        setOriginalValues(values);
        setEditedValues({ ...values });
        setTemplateTags(tags);
        setTemplateBuffer(buffer);

        const blob = await generateDocxFromTemplate(buffer, values);
        await preview.generatePreview(blob, values, buffer, false);
      } else {
        setOriginalValues({});
        setEditedValues({});
        setTemplateTags([]);
        setTemplateBuffer(buffer);

        const blob = new Blob([buffer], { type: DOCX_MIME });
        await preview.generatePreview(blob, {}, buffer, true);
      }
    } catch (error) {
      console.error('[GenerateDoc] Erro:', error);
      toast.error('Erro ao gerar documento. Verifique se o template é válido.');
    } finally {
      setIsGenerating(false);
    }
  };

  // ── Field edit handler ─────────────────────────────────────────────────────
  const handleFieldEdit = (tag: string, newValue: string) => {
    setEditedValues(prev => ({ ...prev, [tag]: newValue }));
  };

  // ── DOCX download with edited values ──────────────────────────────────────
  const handleDownloadDocx = async () => {
    if (!templateBuffer) return;
    try {
      setIsDownloading(true);

      if (preview.isFormTemplate) {
        // Type B: plain form → download original blob unchanged
        preview.downloadDocx(fileName);
        toast.success('Documento .DOCX baixado!');
        return;
      }

      // Type A: re-generate with edited values
      const blob = await generateDocxFromTemplate(templateBuffer, editedValues);
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = editCount > 0
        ? `${fileName}_editado.docx`
        : `${fileName}.docx`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Documento .DOCX baixado!');
    } catch (err) {
      console.error(err);
      toast.error('Erro ao baixar .DOCX');
    } finally {
      setIsDownloading(false);
    }
  };

  // ── PDF download from current preview ─────────────────────────────────────
  const handleDownloadPdf = async () => {
    if (!previewRef.current) return;
    try {
      setIsDownloadingPdf(true);
      const html2pdf = (await import('html2pdf.js')).default;
      const clone    = previewRef.current.cloneNode(true) as HTMLElement;

      clone.querySelectorAll('[data-watermark]').forEach(el => el.remove());

      await html2pdf()
        .set({
          margin:     [15, 15, 15, 15],
          filename:   `${fileName}.pdf`,
          image:      { type: 'jpeg', quality: 0.98 },
          html2canvas: { scale: 2, useCORS: true, letterRendering: true },
          jsPDF:      { unit: 'mm', format: 'a4', orientation: 'portrait' as const },
        })
        .from(clone)
        .save();

      toast.success('PDF gerado com sucesso!');
    } catch (err) {
      console.error(err);
      toast.error('Erro ao gerar PDF');
    } finally {
      setIsDownloadingPdf(false);
    }
  };

  const handleOpenChange = (value: boolean) => {
    if (!value) {
      setSelectedTemplate(null);
      setOriginalValues({});
      setEditedValues({});
      setTemplateTags([]);
      setTemplateBuffer(null);
      preview.reset();
    }
    onOpenChange(value);
  };

  // ============================================================
  //  RENDER
  // ============================================================

  // ── IDLE: template selector ────────────────────────────────────────────────
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
                  {templates.map(template => (
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
              {isGenerating
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <Eye className="w-4 h-4" />}
              {isGenerating ? 'Processando…' : 'Visualizar prévia'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  // ── LOADING ──────────────────────────────────────────────────────────────────
  if (preview.step === 'loading') {
    return (
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-sm">
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px 20px', gap: 20 }}>
            <div style={{ width: 40, height: 40, borderRadius: '50%', border: '3px solid #F0F0F0', borderTopColor: '#F5A800', animation: 'dp-spin 0.8s linear infinite' }} />
            <div style={{ width: 240, height: 5, background: '#F0F0F0', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ height: '100%', borderRadius: 3, background: '#F5A800', animation: 'dp-progress 2s ease-in-out forwards' }} />
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
        style={{ width: '95vw', maxWidth: 1280, height: '92vh', display: 'flex', flexDirection: 'column' }}
      >
        {/* ── Header ── */}
        <div style={{ background: '#1A1A1A', padding: '14px 20px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: '#FEF3D0', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <FileOutput size={15} style={{ color: '#854F0B' }} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <p style={{ fontSize: 14, fontWeight: 700, color: '#fff', margin: 0 }}>Prévia do Documento</p>
                {/* Edit count badge */}
                {editCount > 0 && (
                  <span style={{ background: '#E1F5EE', color: '#0F6E56', fontSize: 10, fontWeight: 700, padding: '2px 9px', borderRadius: 20, border: '0.5px solid #9FE1CB' }}>
                    ✏ {editCount} campo{editCount !== 1 ? 's' : ''} editado{editCount !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
              <p style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {templateDisplayName}{project.concessionaireName ? ` — ${project.concessionaireName}` : ''} · {project.code}
                {preview.isFormTemplate && (
                  <span style={{ marginLeft: 6, background: 'rgba(55,138,221,0.3)', color: '#92C8F5', padding: '1px 6px', borderRadius: 4, fontSize: 9, fontWeight: 600 }}>
                    formulário
                  </span>
                )}
              </p>
            </div>
          </div>

          {/* Close */}
          <button
            onClick={() => handleOpenChange(false)}
            style={{ width: 28, height: 28, borderRadius: '50%', border: 'none', background: 'rgba(255,255,255,0.1)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}
          >
            <X size={13} />
          </button>
        </div>

        {/* ── Main area: sidebar | document ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', flex: 1, overflow: 'hidden', minHeight: 0 }}>

          {/* ── Editable Fields Sidebar ── */}
          <div style={{ background: '#F8F8F8', borderRight: '0.5px solid #F0F0F0', padding: '12px 12px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>

            {/* Sidebar header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: '.05em' }}>
                Editar campos
              </span>
              {editCount > 0 && (
                <span style={{ background: '#E1F5EE', color: '#0F6E56', fontSize: 9, fontWeight: 700, padding: '1px 7px', borderRadius: 20, border: '0.5px solid #9FE1CB' }}>
                  {editCount} editado{editCount !== 1 ? 's' : ''}
                </span>
              )}
            </div>

            {/* Form template: no editable fields */}
            {preview.isFormTemplate && (
              <div style={{ background: '#E6F1FB', border: '0.5px solid #378ADD', borderRadius: 8, padding: '8px 10px', fontSize: 10, color: '#185FA5', lineHeight: 1.5 }}>
                <Info size={12} style={{ display: 'inline', marginRight: 5 }} />
                <strong>Formulário sem tags.</strong> Este template não possui campos automáticos. Baixe o arquivo e preencha manualmente.
              </div>
            )}

            {/* Editable inputs for each detected tag */}
            {templateTags.map(tag => {
              const label      = TAG_LABELS[tag] ?? tag;
              const value      = editedValues[tag]   ?? '';
              const original   = originalValues[tag] ?? '';
              const isEdited   = value !== original;

              return (
                <div key={tag} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <label style={{ fontSize: 9, color: '#aaa', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', display: 'flex', alignItems: 'center', gap: 5 }}>
                    {label}
                    {isEdited && (
                      <span style={{ background: '#E1F5EE', color: '#0F6E56', fontSize: 8, fontWeight: 700, padding: '1px 5px', borderRadius: 10 }}>
                        editado
                      </span>
                    )}
                  </label>
                  <input
                    type="text"
                    value={value}
                    onChange={e => handleFieldEdit(tag, e.target.value)}
                    style={{
                      padding: '6px 9px',
                      borderRadius: 7,
                      border: isEdited ? '1px solid #2D6A4F' : '0.5px solid #E0E0E0',
                      fontSize: 11,
                      color: '#1A1A1A',
                      background: isEdited ? '#F0FFF8' : '#fff',
                      outline: 'none',
                      width: '100%',
                      boxSizing: 'border-box',
                      transition: 'border-color .15s, background .15s',
                    }}
                    onFocus={e => {
                      e.target.style.borderColor = '#F5A800';
                      e.target.style.boxShadow   = '0 0 0 2px rgba(245,168,0,0.14)';
                    }}
                    onBlur={e => {
                      e.target.style.borderColor = isEdited ? '#2D6A4F' : '#E0E0E0';
                      e.target.style.boxShadow   = 'none';
                    }}
                  />
                </div>
              );
            })}

            {/* Restore button */}
            {editCount > 0 && (
              <button
                onClick={() => setEditedValues({ ...originalValues })}
                style={{ marginTop: 4, padding: '7px', background: '#F0F0F0', border: 'none', borderRadius: 7, fontSize: 10, color: '#555', cursor: 'pointer', fontWeight: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}
              >
                <RotateCcw size={11} /> Restaurar valores originais
              </button>
            )}

            {/* Regenerating spinner */}
            {isRegenerating && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: '#888', padding: '6px 8px', background: '#FEF3D0', borderRadius: 7 }}>
                <div style={{ width: 12, height: 12, border: '2px solid #F0F0F0', borderTopColor: '#F5A800', borderRadius: '50%', animation: 'dp-spin 0.8s linear infinite', flexShrink: 0 }} />
                Atualizando prévia…
              </div>
            )}
          </div>

          {/* ── Document Preview Area ── */}
          <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
            {/* Sub-header */}
            <div style={{ padding: '7px 16px', background: '#FAFAFA', borderBottom: '0.5px solid #F0F0F0', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
              <Eye size={12} style={{ color: '#888' }} />
              <span style={{ fontSize: 11, color: '#555' }}>Prévia do documento</span>
              {isRegenerating && (
                <span style={{ fontSize: 9, color: '#854F0B', background: '#FEF3D0', padding: '1px 8px', borderRadius: 20, fontWeight: 600 }}>
                  ⟳ atualizando…
                </span>
              )}
              {!isRegenerating && editCount > 0 && (
                <span style={{ fontSize: 9, color: '#0F6E56', background: '#E1F5EE', padding: '1px 8px', borderRadius: 20, fontWeight: 600 }}>
                  ✓ prévia atualizada
                </span>
              )}
            </div>

            {/* Scroll area */}
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

                {/* Document content */}
                <div
                  ref={previewRef}
                  dangerouslySetInnerHTML={{ __html: buildStyledHtml(preview.htmlContent) }}
                  style={{ outline: 'none', userSelect: 'text', cursor: 'default' }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* ── Footer ── */}
        <div style={{ background: '#F8F8F8', borderTop: '1px solid #F0F0F0', padding: '11px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          {/* Left: hint */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#888' }}>
            <Info size={12} style={{ color: '#aaa', flexShrink: 0 }} />
            {templateTags.length > 0
              ? 'Edite os campos na barra lateral — a prévia atualiza automaticamente'
              : 'Baixe o documento e preencha manualmente'}
          </div>

          {/* Right: actions */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              onClick={() => handleOpenChange(false)}
              style={{ padding: '7px 14px', borderRadius: 8, border: '0.5px solid #E0E0E0', background: '#fff', color: '#555', fontSize: 11, fontWeight: 500, cursor: 'pointer' }}
            >
              Cancelar
            </button>

            <div style={{ width: 1, height: 20, background: '#E0E0E0' }} />

            {/* Download .DOCX */}
            <button
              onClick={handleDownloadDocx}
              disabled={isDownloading}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 8, border: 'none', background: isDownloading ? '#aaa' : '#2B579A', color: '#fff', fontSize: 11, fontWeight: 700, cursor: isDownloading ? 'not-allowed' : 'pointer' }}
            >
              {isDownloading
                ? <Loader2 size={13} className="animate-spin" />
                : <Download size={13} />}
              {isDownloading
                ? 'Gerando…'
                : editCount > 0 ? `Baixar .DOCX (${editCount} edit.)` : 'Baixar .DOCX'}
            </button>

            {/* Download .PDF */}
            <button
              onClick={handleDownloadPdf}
              disabled={isDownloadingPdf}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 8, border: 'none', background: isDownloadingPdf ? '#aaa' : '#E24B4A', color: '#fff', fontSize: 11, fontWeight: 700, cursor: isDownloadingPdf ? 'not-allowed' : 'pointer' }}
            >
              {isDownloadingPdf
                ? <Loader2 size={13} className="animate-spin" />
                : <Download size={13} />}
              {isDownloadingPdf ? 'Gerando PDF…' : 'Baixar .PDF'}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
