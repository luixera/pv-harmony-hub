import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Upload, Trash2, FileText, Loader2, Info, Download, FlaskConical,
  CheckCircle2, AlertTriangle, Search, Copy, Pencil, HelpCircle, ChevronDown,
} from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  useConcessionaireTemplates,
  useUploadConcessionaireTemplate,
  useDeleteConcessionaireTemplate,
  downloadTemplateBuffer,
  ConcessionaireTemplate,
} from '@/hooks/useConcessionaireTemplates';
import { EnergyConcessionaire } from '@/hooks/useEnergyConcessionaires';
import { useAuth } from '@/contexts/AuthContext';
import { TemplateEditorDialog } from '@/components/concessionaires/TemplateEditorDialog';
import { detectTemplateTags, generateDocxFromTemplate } from '@/utils/docxGenerator';
import {
  TEMPLATE_VARIABLES, KNOWN_TEMPLATE_KEYS, buildSampleValues, suggestTemplateKey, TemplateVariable,
} from '@/utils/projectValues';
import { useEntryRules, entryRuleCustomColumns } from '@/hooks/useEntryRules';
import { toast } from 'sonner';

interface ConcessionaireTemplatesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  concessionaire: EnergyConcessionaire | null;
}

/** Resultado do raio-X de um template (só os nomes; known/suggestion no render). */
interface TagAnalysis {
  loading: boolean;
  tags: string[];
  isForm: boolean; // sem nenhuma tag → formulário puro
  error?: boolean;
}

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

export function ConcessionaireTemplatesDialog({
  open,
  onOpenChange,
  concessionaire,
}: ConcessionaireTemplatesDialogProps) {
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isAdmin = user?.role === 'admin';

  const { data: templates = [], isLoading } = useConcessionaireTemplates(concessionaire?.id);
  const uploadMutation = useUploadConcessionaireTemplate();
  const deleteMutation = useDeleteConcessionaireTemplate();

  // Colunas customizadas das regras de padrão de entrada desta concessionária
  // viram variáveis reconhecidas (ex.: coluna "Demanda" → {demanda}).
  const { data: entryRules = [] } = useEntryRules(concessionaire?.id);
  const customVars: TemplateVariable[] = entryRuleCustomColumns(entryRules).map(c => ({
    key: c.key, desc: `${c.label} (coluna do padrão de entrada)`, category: 'Padrão de entrada', example: '',
  }));
  const allVars: TemplateVariable[] = [...TEMPLATE_VARIABLES, ...customVars];
  const allKnown = new Set<string>([...KNOWN_TEMPLATE_KEYS, ...customVars.map(v => v.key)]);
  const suggestFor = (name: string) => (allKnown.has(name) ? null : suggestTemplateKey(name));

  // Raio-X das tags por template (path → análise)
  const [analyses, setAnalyses] = useState<Record<string, TagAnalysis>>({});
  const [busyPath, setBusyPath] = useState<string | null>(null); // download/teste em andamento
  const [varSearch, setVarSearch] = useState('');
  const [editing, setEditing] = useState<ConcessionaireTemplate | null>(null);
  const [showGuide, setShowGuide] = useState(false);

  // Analisa automaticamente os templates listados (com cache por path)
  useEffect(() => {
    if (!open) return;
    templates.forEach(async (t) => {
      if (analyses[t.path]) return;
      setAnalyses(prev => ({ ...prev, [t.path]: { loading: true, tags: [], isForm: false } }));
      try {
        const buffer = await downloadTemplateBuffer(t.path);
        const { tags } = await detectTemplateTags(buffer);
        setAnalyses(prev => ({
          ...prev,
          [t.path]: { loading: false, isForm: tags.length === 0, tags },
        }));
      } catch (err) {
        console.error('[Templates] Erro ao analisar', t.path, err);
        setAnalyses(prev => ({ ...prev, [t.path]: { loading: false, tags: [], isForm: false, error: true } }));
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, templates]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || !concessionaire) return;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      await uploadMutation.mutateAsync({ concessionaireId: concessionaire.id, file });
      // análise imediata: avisa se o arquivo tem tags não reconhecidas
      try {
        const { tags } = await detectTemplateTags(await file.arrayBuffer());
        const unknown = tags.filter(t => !allKnown.has(t));
        if (tags.length === 0) {
          toast.info(`${file.name}: sem tags — será tratado como formulário`);
        } else if (unknown.length > 0) {
          toast.warning(
            `${file.name}: ${unknown.length} tag(s) não reconhecida(s) — use o botão ✏️ para corrigir`,
            { duration: 7000 },
          );
        } else {
          toast.success(`${file.name}: ${tags.length} tag(s) reconhecida(s) ✓`);
        }
      } catch { /* análise é opcional */ }
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  /** Reanalisa um template (após edição no editor, por exemplo). */
  const invalidateAnalysis = (path: string) => {
    setAnalyses(prev => {
      const next = { ...prev };
      delete next[path];
      return next;
    });
  };

  const handleDelete = async (template: ConcessionaireTemplate) => {
    if (!concessionaire) return;
    if (!confirm(`Tem certeza que deseja excluir "${template.name}"?`)) return;
    await deleteMutation.mutateAsync({ concessionaireId: concessionaire.id, path: template.path });
  };

  const getDisplayName = (fileName: string) => fileName.replace(/^\d+_/, '');

  /** Baixa o template original (com as tags), preservando o nome amigável. */
  const handleDownload = async (template: ConcessionaireTemplate) => {
    setBusyPath(template.path);
    try {
      const buffer = await downloadTemplateBuffer(template.path);
      saveBlob(new Blob([buffer], { type: DOCX_MIME }), getDisplayName(template.name));
      toast.success('Template baixado');
    } catch (err) {
      console.error(err);
      toast.error('Erro ao baixar template');
    } finally {
      setBusyPath(null);
    }
  };

  /** Gera o documento com dados fictícios de exemplo, para validar o preenchimento. */
  const handleTestFill = async (template: ConcessionaireTemplate) => {
    setBusyPath(template.path);
    try {
      const buffer = await downloadTemplateBuffer(template.path);
      const { hasTags } = await detectTemplateTags(buffer);
      if (!hasTags) {
        toast.info('Este template não tem tags — é um formulário sem preenchimento automático.');
        return;
      }
      const blob = await generateDocxFromTemplate(buffer, buildSampleValues());
      saveBlob(blob, `TESTE_${getDisplayName(template.name)}`);
      toast.success('Documento de teste gerado com dados de exemplo');
    } catch (err) {
      console.error(err);
      toast.error('Erro ao gerar documento de teste');
    } finally {
      setBusyPath(null);
    }
  };

  const copyVar = (key: string) => {
    navigator.clipboard.writeText(`{${key}}`);
    toast.success(`{${key}} copiado — cole no Word`);
  };

  // Variáveis filtradas pela busca, agrupadas por categoria
  const filteredVars = allVars.filter(v =>
    !varSearch.trim() ||
    v.key.toLowerCase().includes(varSearch.toLowerCase()) ||
    v.desc.toLowerCase().includes(varSearch.toLowerCase())
  );
  const categories = [...new Set(filteredVars.map(v => v.category))];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-primary" />
            Templates de Documento - {concessionaire?.name}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Upload (admin only) */}
          {isAdmin && (
            <div>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".docx"
                onChange={handleFileChange}
                className="hidden"
              />
              <Button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadMutation.isPending}
                className="w-full gap-2"
              >
                {uploadMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Upload className="w-4 h-4" />
                )}
                Enviar Template (.docx)
              </Button>
            </div>
          )}

          {/* Templates list */}
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : templates.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <FileText className="w-12 h-12 mx-auto mb-2 opacity-50" />
              <p>Nenhum template cadastrado</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1">
              {templates.map((template) => {
                const a = analyses[template.path];
                const unknownCount = a?.tags.filter(name => !allKnown.has(name)).length ?? 0;
                const busy = busyPath === template.path;
                return (
                  <div
                    key={template.path}
                    className="p-3 rounded-lg border bg-card hover:bg-accent/30 transition-colors space-y-2"
                  >
                    <div className="flex items-center gap-3">
                      <FileText className="w-4 h-4 text-blue-500 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{getDisplayName(template.name)}</p>
                        {template.created_at && (
                          <p className="text-xs text-muted-foreground">
                            {format(new Date(template.created_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                          </p>
                        )}
                      </div>

                      {/* Status do raio-X */}
                      {a?.loading ? (
                        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          <Loader2 className="w-3 h-3 animate-spin" /> analisando…
                        </span>
                      ) : a?.isForm ? (
                        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground whitespace-nowrap">
                          Formulário (sem tags)
                        </span>
                      ) : a && unknownCount > 0 ? (
                        <span className="flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600 whitespace-nowrap">
                          <AlertTriangle className="w-3 h-3" /> {unknownCount} tag{unknownCount > 1 ? 's' : ''} desconhecida{unknownCount > 1 ? 's' : ''}
                        </span>
                      ) : a && !a.error ? (
                        <span className="flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 whitespace-nowrap">
                          <CheckCircle2 className="w-3 h-3" /> {a.tags.length} tags OK
                        </span>
                      ) : null}

                      <div className="flex items-center">
                        {isAdmin && (
                          <Button
                            size="icon"
                            variant="ghost"
                            title="Abrir no Editor de Template (corrigir tags)"
                            onClick={() => setEditing(template)}
                          >
                            <Pencil className="w-4 h-4" />
                          </Button>
                        )}
                        <Button
                          size="icon"
                          variant="ghost"
                          title="Testar preenchimento com dados de exemplo"
                          onClick={() => handleTestFill(template)}
                          disabled={busy}
                        >
                          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <FlaskConical className="w-4 h-4" />}
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          title="Baixar template original (com as tags)"
                          onClick={() => handleDownload(template)}
                          disabled={busy}
                        >
                          <Download className="w-4 h-4" />
                        </Button>
                        {isAdmin && (
                          <Button
                            size="icon"
                            variant="ghost"
                            title="Excluir template"
                            onClick={() => handleDelete(template)}
                            disabled={deleteMutation.isPending}
                            className="text-destructive hover:text-destructive"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    </div>

                    {/* Chips de tags detectadas (clique = copiar) */}
                    {a && !a.loading && a.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 pl-7">
                        {a.tags.map(name => {
                          const known = allKnown.has(name);
                          const suggestion = suggestFor(name);
                          return (
                          <button
                            key={name}
                            type="button"
                            onClick={() => copyVar(name)}
                            title={
                              (known
                                ? 'Tag reconhecida — será preenchida automaticamente'
                                : suggestion
                                  ? `Tag desconhecida — você quis dizer {${suggestion}}?`
                                  : 'Tag desconhecida — NÃO será preenchida') + ' · clique para copiar'
                            }
                            className={
                              'text-[10px] font-mono px-1.5 py-0.5 rounded border cursor-pointer hover:opacity-75 ' +
                              (known
                                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600'
                                : 'bg-amber-500/10 border-amber-500/40 text-amber-600')
                            }
                          >
                            {`{${name}}`}
                            {!known && suggestion && (
                              <span className="ml-1 opacity-80">→ {`{${suggestion}}`}?</span>
                            )}
                          </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Variables reference */}
          <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <Info className="w-4 h-4 text-primary" />
                <p className="text-sm font-medium">Variáveis disponíveis no template</p>
              </div>
              <div className="relative w-full sm:w-56">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={varSearch}
                  onChange={e => setVarSearch(e.target.value)}
                  placeholder="Buscar variável…"
                  className="h-8 pl-8 text-xs"
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Clique em uma variável para copiar e cole no arquivo .docx. Elas serão substituídas pelos dados do projeto ao gerar o documento.
            </p>
            <div className="max-h-56 overflow-y-auto space-y-3 pr-1">
              {categories.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-3">Nenhuma variável encontrada para "{varSearch}"</p>
              ) : categories.map(cat => (
                <div key={cat}>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">{cat}</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                    {filteredVars.filter(v => v.category === cat).map(v => (
                      <button
                        key={v.key}
                        type="button"
                        onClick={() => copyVar(v.key)}
                        title={`Exemplo: ${v.example} — clique para copiar`}
                        className="flex items-start gap-2 text-xs text-left rounded px-1 py-0.5 hover:bg-accent/60 transition-colors group"
                      >
                        <code className="bg-background border rounded px-1 py-0.5 text-primary font-mono whitespace-nowrap flex items-center gap-1">
                          {`{${v.key}}`}
                          <Copy className="w-2.5 h-2.5 opacity-0 group-hover:opacity-60" />
                        </code>
                        <span className="text-muted-foreground">{v.desc}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Guia rápido de criação no Word */}
          <div className="rounded-lg border">
            <button
              type="button"
              onClick={() => setShowGuide(s => !s)}
              className="w-full flex items-center gap-2 px-4 py-2.5 text-left"
            >
              <HelpCircle className="w-4 h-4 text-primary" />
              <span className="text-sm font-medium flex-1">Como criar um template no Word</span>
              <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${showGuide ? 'rotate-180' : ''}`} />
            </button>
            {showGuide && (
              <div className="px-4 pb-4 space-y-2 text-xs text-muted-foreground">
                <p><b className="text-foreground">1.</b> Monte o documento normalmente no Word (logos, tabelas, formatação — tudo é preservado).</p>
                <p><b className="text-foreground">2.</b> Onde entrar um dado do projeto, cole uma variável desta lista, ex.: <code className="bg-muted px-1 rounded">{'{nome_titular}'}</code>. Dica: <b>copie daqui e cole no Word</b> em vez de digitar — evita erros.</p>
                <p><b className="text-foreground">3.</b> Digite a tag de uma vez só, sem espaços dentro das chaves: <code className="bg-muted px-1 rounded">{'{cidade}'}</code> ✓ &nbsp;·&nbsp; <code className="bg-muted px-1 rounded">{'{ cidade }'}</code> ✗</p>
                <p><b className="text-foreground">4.</b> Salve como <b>.docx</b> e envie aqui. O sistema analisa as tags na hora e avisa se alguma não for reconhecida.</p>
                <p><b className="text-foreground">5.</b> Tag errada? Use o <Pencil className="w-3 h-3 inline" /> <b>Editor de Template</b> para corrigir sem voltar ao Word, e o <FlaskConical className="w-3 h-3 inline" /> para testar com dados de exemplo.</p>
              </div>
            )}
          </div>
        </div>

        {/* Editor de Template */}
        <TemplateEditorDialog
          open={!!editing}
          onOpenChange={(o) => {
            if (!o && editing) invalidateAnalysis(editing.path); // reanalisa após edição
            if (!o) setEditing(null);
          }}
          template={editing}
          concessionaireId={concessionaire?.id ?? ''}
        />
      </DialogContent>
    </Dialog>
  );
}
