import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Loader2, Save, Undo2, Wand2, Eye, Code2, CheckCircle2, AlertTriangle, FileText,
} from 'lucide-react';
import {
  ConcessionaireTemplate, downloadTemplateBuffer, overwriteTemplate,
  backupTemplateOnce, hasTemplateBackup, restoreTemplateBackup,
} from '@/hooks/useConcessionaireTemplates';
import { detectTemplateTags, renameTagsInDocx, generateDocxFromTemplate } from '@/utils/docxGenerator';
import {
  TEMPLATE_VARIABLES, KNOWN_TEMPLATE_KEYS, buildSampleValues, suggestTemplateKey,
} from '@/utils/projectValues';
import { toast } from 'sonner';

interface TemplateEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template: ConcessionaireTemplate | null;
  concessionaireId: string;
}

type ViewMode = 'tags' | 'sample';

interface TagInfo {
  name: string;
  known: boolean;
  suggestion: string | null;
  rename: string | null; // renomeio pendente escolhido pelo usuário
}

/** Converte um buffer .docx em HTML de prévia via mammoth. */
async function docxToHtml(buffer: ArrayBuffer): Promise<string> {
  const mammoth = await import('mammoth');
  const result = await mammoth.convertToHtml(
    { arrayBuffer: buffer },
    {
      styleMap: [
        "p[style-name='Heading 1'] => h1",
        "p[style-name='Heading 2'] => h2",
        'b => strong', 'i => em',
      ],
    },
  );
  return result.value;
}

/** Destaca as {tags} no HTML da prévia (verde = conhecida, âmbar = desconhecida). */
function highlightTags(html: string, pending: Record<string, string>): string {
  return html.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (_, tag: string) => {
    const effective = pending[tag] ?? tag;
    const known = KNOWN_TEMPLATE_KEYS.has(effective);
    const style = known
      ? 'background:rgba(16,185,129,0.18);color:#047857;border:1px solid rgba(16,185,129,0.4);'
      : 'background:rgba(245,158,11,0.18);color:#B45309;border:1px solid rgba(245,158,11,0.5);';
    return `<mark style="${style}border-radius:4px;padding:0 3px;font-family:monospace;font-size:0.85em;">{${effective}}</mark>`;
  });
}

export function TemplateEditorDialog({ open, onOpenChange, template, concessionaireId }: TemplateEditorDialogProps) {
  const qc = useQueryClient();
  const [loading, setLoading] = useState(true);
  const [buffer, setBuffer] = useState<ArrayBuffer | null>(null); // buffer consolidado atual (sem renames pendentes)
  const [tags, setTags] = useState<TagInfo[]>([]);
  const [html, setHtml] = useState('');
  const [mode, setMode] = useState<ViewMode>('tags');
  const [saving, setSaving] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [backupExists, setBackupExists] = useState(false);

  const displayName = template ? template.name.replace(/^\d+_/, '') : '';
  const pendingMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const t of tags) if (t.rename) m[t.name] = t.rename;
    return m;
  }, [tags]);
  const pendingCount = Object.keys(pendingMap).length;
  const unknownCount = tags.filter(t => !t.known && !t.rename).length;

  // ── Carrega o template ao abrir ─────────────────────────────────────────────
  useEffect(() => {
    if (!open || !template) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setMode('tags');
      try {
        const raw = await downloadTemplateBuffer(template.path);
        // consolida fragmentos em memória → prévia e análise ficam consistentes
        const consolidated = renameTagsInDocx(raw, {});
        const { tags: names } = await detectTemplateTags(consolidated);
        const infos: TagInfo[] = names.map(name => ({
          name,
          known: KNOWN_TEMPLATE_KEYS.has(name),
          suggestion: KNOWN_TEMPLATE_KEYS.has(name) ? null : suggestTemplateKey(name),
          rename: null,
        }));
        const previewHtml = await docxToHtml(consolidated);
        const backup = await hasTemplateBackup(template.path);
        if (cancelled) return;
        setBuffer(consolidated);
        setTags(infos);
        setHtml(previewHtml);
        setBackupExists(backup);
      } catch (err) {
        console.error('[TemplateEditor] erro ao carregar', err);
        toast.error('Erro ao carregar o template');
        onOpenChange(false);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, template?.path]);

  // ── Prévia com dados de exemplo ─────────────────────────────────────────────
  const [sampleHtml, setSampleHtml] = useState('');
  useEffect(() => {
    if (mode !== 'sample' || !buffer) return;
    let cancelled = false;
    (async () => {
      try {
        const withRenames = pendingCount > 0 ? renameTagsInDocx(buffer, pendingMap) : buffer;
        const filled = await generateDocxFromTemplate(withRenames, buildSampleValues());
        const h = await docxToHtml(await filled.arrayBuffer());
        if (!cancelled) setSampleHtml(h);
      } catch (err) {
        console.error('[TemplateEditor] prévia exemplo', err);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, buffer, pendingMap]);

  const setRename = (tagName: string, to: string | null) => {
    setTags(prev => prev.map(t => (t.name === tagName ? { ...t, rename: to } : t)));
  };

  const fixAll = () => {
    let n = 0;
    setTags(prev => prev.map(t => {
      if (!t.known && !t.rename && t.suggestion) { n++; return { ...t, rename: t.suggestion }; }
      return t;
    }));
    setTimeout(() => toast.info(n > 0 ? `${n} correção(ões) preparada(s) — revise e salve` : 'Nenhuma sugestão automática disponível'), 0);
  };

  const copyTag = (name: string) => {
    navigator.clipboard.writeText(`{${name}}`);
    toast.success(`{${name}} copiado`);
  };

  // ── Salvar correções ────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!template || !buffer) return;
    setSaving(true);
    try {
      await backupTemplateOnce(template.path); // guarda o original na 1ª edição
      const corrected = renameTagsInDocx(buffer, pendingMap);
      await overwriteTemplate(template.path, corrected);
      qc.invalidateQueries({ queryKey: ['concessionaire-templates', concessionaireId] });
      toast.success('Template corrigido e salvo');
      // recarrega estado local
      const { tags: names } = await detectTemplateTags(corrected);
      setBuffer(corrected);
      setTags(names.map(name => ({
        name,
        known: KNOWN_TEMPLATE_KEYS.has(name),
        suggestion: KNOWN_TEMPLATE_KEYS.has(name) ? null : suggestTemplateKey(name),
        rename: null,
      })));
      setHtml(await docxToHtml(corrected));
      setBackupExists(true);
    } catch (err) {
      console.error('[TemplateEditor] erro ao salvar', err);
      toast.error('Erro ao salvar o template');
    } finally {
      setSaving(false);
    }
  };

  // ── Restaurar original ──────────────────────────────────────────────────────
  const handleRestore = async () => {
    if (!template) return;
    if (!confirm('Restaurar o arquivo originalmente enviado? As correções feitas no sistema serão desfeitas.')) return;
    setRestoring(true);
    try {
      await restoreTemplateBackup(template.path);
      qc.invalidateQueries({ queryKey: ['concessionaire-templates', concessionaireId] });
      toast.success('Original restaurado');
      // recarrega
      const raw = await downloadTemplateBuffer(template.path);
      const consolidated = renameTagsInDocx(raw, {});
      const { tags: names } = await detectTemplateTags(consolidated);
      setBuffer(consolidated);
      setTags(names.map(name => ({
        name,
        known: KNOWN_TEMPLATE_KEYS.has(name),
        suggestion: KNOWN_TEMPLATE_KEYS.has(name) ? null : suggestTemplateKey(name),
        rename: null,
      })));
      setHtml(await docxToHtml(consolidated));
    } catch (err) {
      console.error('[TemplateEditor] erro ao restaurar', err);
      toast.error('Erro ao restaurar o original');
    } finally {
      setRestoring(false);
    }
  };

  const previewHtml = mode === 'tags' ? highlightTags(html, pendingMap) : sampleHtml;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-5xl max-h-[92vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-primary" />
            Editor de Template — {displayName}
          </DialogTitle>
          <DialogDescription>
            Corrija tags sem sair do sistema. A formatação do documento não é alterada — apenas os nomes das tags.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="w-7 h-7 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="flex flex-col lg:flex-row gap-4 flex-1 min-h-0">

            {/* ── Prévia ── */}
            <div className="flex-1 min-w-0 flex flex-col min-h-0">
              <div className="flex items-center gap-2 mb-2">
                <Button size="sm" variant={mode === 'tags' ? 'default' : 'outline'} onClick={() => setMode('tags')} className="gap-1 h-8">
                  <Code2 className="w-3.5 h-3.5" /> Tags
                </Button>
                <Button size="sm" variant={mode === 'sample' ? 'default' : 'outline'} onClick={() => setMode('sample')} className="gap-1 h-8">
                  <Eye className="w-3.5 h-3.5" /> Preenchido (exemplo)
                </Button>
                <p className="text-[11px] text-muted-foreground ml-auto hidden sm:block">Prévia aproximada — a formatação final é a do Word</p>
              </div>
              <div className="flex-1 min-h-[300px] overflow-y-auto rounded-lg border bg-white text-black p-6 text-sm leading-relaxed [&_table]:border-collapse [&_td]:border [&_td]:border-gray-300 [&_td]:px-2 [&_th]:border [&_th]:border-gray-300 [&_th]:px-2 [&_p]:mb-2 [&_h1]:text-lg [&_h1]:font-bold [&_h2]:font-bold"
                dangerouslySetInnerHTML={{ __html: previewHtml || '<p style="color:#999">Sem conteúdo para exibir</p>' }}
              />
            </div>

            {/* ── Painel de tags ── */}
            <div className="w-full lg:w-80 flex-shrink-0 flex flex-col gap-3 min-h-0">
              <div className="rounded-lg border p-3 space-y-2 overflow-y-auto flex-1 min-h-[200px]">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Tags no documento ({tags.length})
                  </p>
                  {unknownCount > 0 && (
                    <Button size="sm" variant="outline" onClick={fixAll} className="h-7 gap-1 text-[11px]">
                      <Wand2 className="w-3 h-3" /> Corrigir tudo
                    </Button>
                  )}
                </div>

                {tags.length === 0 && (
                  <p className="text-xs text-muted-foreground py-4 text-center">
                    Nenhuma tag encontrada — este template é um formulário sem preenchimento automático.
                  </p>
                )}

                {tags.map(t => {
                  const resolved = t.rename ?? t.name;
                  const ok = t.known || !!t.rename;
                  return (
                    <div key={t.name} className={`rounded-md border p-2 ${ok ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-amber-500/40 bg-amber-500/5'}`}>
                      <div className="flex items-center gap-1.5">
                        {ok
                          ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
                          : <AlertTriangle className="w-3.5 h-3.5 text-amber-600 flex-shrink-0" />}
                        <button
                          type="button"
                          onClick={() => copyTag(resolved)}
                          title="Clique para copiar"
                          className="text-[11px] font-mono truncate hover:underline"
                        >
                          {`{${t.name}}`}
                        </button>
                        {t.rename && (
                          <span className="text-[10px] font-mono text-emerald-700 truncate">→ {`{${t.rename}}`}</span>
                        )}
                      </div>

                      {!t.known && (
                        <div className="mt-1.5 flex items-center gap-1.5">
                          <Select
                            value={t.rename ?? undefined}
                            onValueChange={v => setRename(t.name, v)}
                          >
                            <SelectTrigger className="h-7 text-[11px] flex-1">
                              <SelectValue placeholder={t.suggestion ? `Sugestão: {${t.suggestion}}` : 'Trocar por…'} />
                            </SelectTrigger>
                            <SelectContent className="max-h-60">
                              {TEMPLATE_VARIABLES.map(v => (
                                <SelectItem key={v.key} value={v.key} className="text-xs font-mono">
                                  {`{${v.key}}`} <span className="text-muted-foreground font-sans">— {v.desc}</span>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {t.rename && (
                            <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => setRename(t.name, null)}>
                              ✕
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Ações */}
              <div className="space-y-2">
                {pendingCount > 0 && (
                  <p className="text-[11px] text-muted-foreground text-center">
                    {pendingCount} correção(ões) pendente(s) — salve para aplicar no arquivo
                  </p>
                )}
                <Button onClick={handleSave} disabled={saving || pendingCount === 0} className="w-full gap-2">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Salvar correções no template
                </Button>
                {backupExists && (
                  <Button variant="outline" onClick={handleRestore} disabled={restoring} className="w-full gap-2">
                    {restoring ? <Loader2 className="w-4 h-4 animate-spin" /> : <Undo2 className="w-4 h-4" />}
                    Restaurar original enviado
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
