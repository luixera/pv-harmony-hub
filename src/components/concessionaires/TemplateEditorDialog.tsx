import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Loader2, Save, Undo2, Wand2, Eye, Code2, CheckCircle2, AlertTriangle, FileText,
  RotateCcw, MousePointerClick, FormInput, Search,
} from 'lucide-react';
import {
  ConcessionaireTemplate, downloadTemplateBuffer, overwriteTemplate,
  backupTemplateOnce, hasTemplateBackup, restoreTemplateBackup,
} from '@/hooks/useConcessionaireTemplates';
import {
  detectTemplateTags, renameTagsInDocx, generateDocxFromTemplate,
  detectTemplateFields, insertTagsInFields, insertTagAtOccurrence, countTextOccurrences,
  TemplateField,
} from '@/utils/docxGenerator';
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

interface TagInfo {
  name: string;
  known: boolean;
  suggestion: string | null;
}

interface SelectionInfo {
  text: string;
  occurrence: number;
}

const toTagInfo = (name: string): TagInfo => ({
  name,
  known: KNOWN_TEMPLATE_KEYS.has(name),
  suggestion: KNOWN_TEMPLATE_KEYS.has(name) ? null : suggestTemplateKey(name),
});

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
function highlightTags(html: string): string {
  return html.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (_, tag: string) => {
    const known = KNOWN_TEMPLATE_KEYS.has(tag);
    const style = known
      ? 'background:rgba(16,185,129,0.18);color:#047857;border:1px solid rgba(16,185,129,0.4);'
      : 'background:rgba(245,158,11,0.18);color:#B45309;border:1px solid rgba(245,158,11,0.5);';
    return `<mark style="${style}border-radius:4px;padding:0 3px;font-family:monospace;font-size:0.85em;">{${tag}}</mark>`;
  });
}

/** Texto selecionado na prévia + qual ocorrência dele é (para achar no .docx). */
function readSelection(container: HTMLElement): SelectionInfo | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!container.contains(range.commonAncestorContainer)) return null;
  const text = sel.toString().trim();
  if (!text) return null;

  const pre = document.createRange();
  pre.selectNodeContents(container);
  pre.setEnd(range.startContainer, range.startOffset);
  const prefix = pre.toString();

  let occurrence = 0, from = 0, idx: number;
  while ((idx = prefix.indexOf(text, from)) !== -1) { occurrence++; from = idx + text.length; }
  return { text, occurrence };
}

export function TemplateEditorDialog({ open, onOpenChange, template, concessionaireId }: TemplateEditorDialogProps) {
  const qc = useQueryClient();
  const previewRef = useRef<HTMLDivElement>(null);

  const [loading, setLoading] = useState(true);
  const [buffer, setBuffer] = useState<ArrayBuffer | null>(null);
  const [history, setHistory] = useState<ArrayBuffer[]>([]);
  const [tags, setTags] = useState<TagInfo[]>([]);
  const [fields, setFields] = useState<TemplateField[]>([]);
  const [html, setHtml] = useState('');
  const [sampleHtml, setSampleHtml] = useState('');
  const [mode, setMode] = useState<'tags' | 'sample'>('tags');
  const [panel, setPanel] = useState<'tags' | 'fields'>('tags');
  const [selection, setSelection] = useState<SelectionInfo | null>(null);
  const [selVar, setSelVar] = useState<string>('');
  const [fieldSearch, setFieldSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [backupExists, setBackupExists] = useState(false);

  const displayName = template ? template.name.replace(/^\d+_/, '') : '';
  const dirty = history.length > 0;
  const unknownWithSuggestion = tags.filter(t => !t.known && t.suggestion).length;
  const visibleFields = fieldSearch.trim()
    ? fields.filter(f => f.label.toLowerCase().includes(fieldSearch.toLowerCase()))
    : fields;

  // ── Carrega o template ao abrir ─────────────────────────────────────────────
  useEffect(() => {
    if (!open || !template) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setMode('tags'); setPanel('tags');
      setHistory([]); setSelection(null); setSelVar(''); setFieldSearch('');
      try {
        const raw = await downloadTemplateBuffer(template.path);
        const consolidated = renameTagsInDocx(raw, {}); // junta fragmentos do Word
        const backup = await hasTemplateBackup(template.path);
        if (cancelled) return;
        setBuffer(consolidated);
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

  // ── Deriva tags, campos e prévia sempre que o buffer muda ───────────────────
  useEffect(() => {
    if (!buffer) return;
    let cancelled = false;
    (async () => {
      try {
        const { tags: names } = await detectTemplateTags(buffer);
        const detectedFields = detectTemplateFields(buffer);
        const previewHtml = await docxToHtml(buffer);
        if (cancelled) return;
        setTags(names.map(toTagInfo));
        setFields(detectedFields);
        setHtml(previewHtml);
      } catch (err) {
        console.error('[TemplateEditor] erro ao analisar', err);
      }
    })();
    return () => { cancelled = true; };
  }, [buffer]);

  // ── Prévia com dados de exemplo ─────────────────────────────────────────────
  useEffect(() => {
    if (mode !== 'sample' || !buffer) return;
    let cancelled = false;
    (async () => {
      try {
        const filled = await generateDocxFromTemplate(buffer, buildSampleValues());
        const h = await docxToHtml(await filled.arrayBuffer());
        if (!cancelled) setSampleHtml(h);
      } catch (err) {
        console.error('[TemplateEditor] prévia exemplo', err);
      }
    })();
    return () => { cancelled = true; };
  }, [mode, buffer]);

  // ── Mutações (imediatas, com desfazer) ──────────────────────────────────────
  const mutate = (next: ArrayBuffer) => {
    if (!buffer) return;
    setHistory(h => [...h, buffer]);
    setBuffer(next);
    setSelection(null);
  };

  const undo = () => {
    if (history.length === 0) return;
    setBuffer(history[history.length - 1]);
    setHistory(h => h.slice(0, -1));
    setSelection(null);
  };

  const renameTag = (from: string, to: string) => {
    if (!buffer) return;
    mutate(renameTagsInDocx(buffer, { [from]: to }));
    toast.success(`{${from}} → {${to}}`);
  };

  const fixAll = () => {
    if (!buffer) return;
    const mapping: Record<string, string> = {};
    for (const t of tags) if (!t.known && t.suggestion) mapping[t.name] = t.suggestion;
    const n = Object.keys(mapping).length;
    if (n === 0) { toast.info('Nenhuma sugestão automática disponível'); return; }
    mutate(renameTagsInDocx(buffer, mapping));
    toast.success(`${n} tag(s) corrigida(s)`);
  };

  const assignField = (field: TemplateField, tag: string) => {
    if (!buffer) return;
    mutate(insertTagsInFields(buffer, fields, { [field.id]: tag }));
    toast.success(`{${tag}} inserido em "${field.label}"`);
  };

  const insertAtSelection = (insertMode: 'replace' | 'after') => {
    if (!buffer || !selection || !selVar) return;
    const total = countTextOccurrences(buffer, selection.text);
    if (total === 0) {
      toast.error('Trecho não encontrado no arquivo — a prévia é aproximada. Selecione um trecho de texto simples.');
      return;
    }
    const occ = Math.min(selection.occurrence, total - 1);
    const res = insertTagAtOccurrence(buffer, selection.text, selVar, occ, insertMode);
    if (!res.ok) { toast.error('Não foi possível inserir neste trecho'); return; }
    mutate(res.buffer);
    setSelVar('');
    toast.success(`{${selVar}} inserido`);
  };

  // ── Salvar / restaurar ──────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!template || !buffer) return;
    setSaving(true);
    try {
      await backupTemplateOnce(template.path); // guarda o original na 1ª edição
      await overwriteTemplate(template.path, buffer);
      qc.invalidateQueries({ queryKey: ['concessionaire-templates', concessionaireId] });
      setHistory([]);
      setBackupExists(true);
      toast.success('Template salvo');
    } catch (err) {
      console.error('[TemplateEditor] erro ao salvar', err);
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Erro ao salvar o template: ${msg}`, { duration: 8000 });
    } finally {
      setSaving(false);
    }
  };

  const handleRestore = async () => {
    if (!template) return;
    if (!confirm('Restaurar o arquivo originalmente enviado? As alterações feitas no sistema serão desfeitas.')) return;
    setRestoring(true);
    try {
      await restoreTemplateBackup(template.path);
      qc.invalidateQueries({ queryKey: ['concessionaire-templates', concessionaireId] });
      const raw = await downloadTemplateBuffer(template.path);
      setBuffer(renameTagsInDocx(raw, {}));
      setHistory([]);
      toast.success('Original restaurado');
    } catch (err) {
      console.error('[TemplateEditor] erro ao restaurar', err);
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Erro ao restaurar o original: ${msg}`, { duration: 8000 });
    } finally {
      setRestoring(false);
    }
  };

  const previewHtml = mode === 'tags' ? highlightTags(html) : sampleHtml;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-5xl max-h-[92vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-primary" />
            Editor de Template — {displayName}
          </DialogTitle>
          <DialogDescription>
            Insira e corrija variáveis sem sair do sistema. A formatação do documento não é alterada.
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

              <div
                ref={previewRef}
                onMouseUp={() => { if (mode === 'tags') setSelection(readSelection(previewRef.current!)); }}
                className="flex-1 min-h-[300px] overflow-y-auto rounded-lg border bg-white text-black p-6 text-sm leading-relaxed [&_table]:border-collapse [&_td]:border [&_td]:border-gray-300 [&_td]:px-2 [&_th]:border [&_th]:border-gray-300 [&_th]:px-2 [&_p]:mb-2 [&_h1]:text-lg [&_h1]:font-bold [&_h2]:font-bold"
                dangerouslySetInnerHTML={{ __html: previewHtml || '<p style="color:#999">Sem conteúdo para exibir</p>' }}
              />

              {/* Inserção por trecho selecionado */}
              {mode === 'tags' && (
                <div className="mt-2 rounded-lg border bg-muted/40 p-2">
                  {selection ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[11px] text-muted-foreground shrink-0">Trecho:</span>
                      <code className="text-[11px] bg-background border rounded px-1.5 py-0.5 max-w-[180px] truncate">
                        {selection.text}
                      </code>
                      <Select value={selVar || undefined} onValueChange={setSelVar}>
                        <SelectTrigger className="h-7 text-[11px] w-44"><SelectValue placeholder="Escolha a variável…" /></SelectTrigger>
                        <SelectContent className="max-h-60">
                          {TEMPLATE_VARIABLES.map(v => (
                            <SelectItem key={v.key} value={v.key} className="text-xs font-mono">
                              {`{${v.key}}`} <span className="text-muted-foreground font-sans">— {v.desc}</span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button size="sm" className="h-7 text-[11px]" disabled={!selVar} onClick={() => insertAtSelection('replace')}>
                        Substituir
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 text-[11px]" disabled={!selVar} onClick={() => insertAtSelection('after')}>
                        Inserir depois
                      </Button>
                    </div>
                  ) : (
                    <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                      <MousePointerClick className="w-3.5 h-3.5" />
                      Selecione um trecho de texto na prévia para inserir uma variável ali.
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* ── Painel lateral ── */}
            <div className="w-full lg:w-80 flex-shrink-0 flex flex-col gap-3 min-h-0">
              {/* Abas */}
              <div className="flex gap-1.5">
                <Button size="sm" variant={panel === 'tags' ? 'default' : 'outline'} onClick={() => setPanel('tags')} className="flex-1 h-8 gap-1 text-[11px]">
                  <Code2 className="w-3.5 h-3.5" /> Tags ({tags.length})
                </Button>
                <Button size="sm" variant={panel === 'fields' ? 'default' : 'outline'} onClick={() => setPanel('fields')} className="flex-1 h-8 gap-1 text-[11px]">
                  <FormInput className="w-3.5 h-3.5" /> Campos ({fields.length})
                </Button>
              </div>

              <div className="rounded-lg border p-3 space-y-2 overflow-y-auto flex-1 min-h-[200px]">
                {/* ── Aba Tags ── */}
                {panel === 'tags' && (
                  <>
                    {unknownWithSuggestion > 0 && (
                      <Button size="sm" variant="outline" onClick={fixAll} className="w-full h-7 gap-1 text-[11px]">
                        <Wand2 className="w-3 h-3" /> Corrigir tudo ({unknownWithSuggestion})
                      </Button>
                    )}
                    {tags.length === 0 && (
                      <p className="text-xs text-muted-foreground py-4 text-center">
                        Nenhuma tag ainda. Use a aba <b>Campos</b> ou selecione um trecho na prévia para inserir variáveis.
                      </p>
                    )}
                    {tags.map(t => (
                      <div key={t.name} className={`rounded-md border p-2 ${t.known ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-amber-500/40 bg-amber-500/5'}`}>
                        <div className="flex items-center gap-1.5">
                          {t.known
                            ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
                            : <AlertTriangle className="w-3.5 h-3.5 text-amber-600 flex-shrink-0" />}
                          <button
                            type="button"
                            onClick={() => { navigator.clipboard.writeText(`{${t.name}}`); toast.success(`{${t.name}} copiado`); }}
                            title="Clique para copiar"
                            className="text-[11px] font-mono truncate hover:underline"
                          >
                            {`{${t.name}}`}
                          </button>
                        </div>
                        {!t.known && (
                          <Select value={undefined} onValueChange={v => renameTag(t.name, v)}>
                            <SelectTrigger className="h-7 text-[11px] mt-1.5">
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
                        )}
                      </div>
                    ))}
                  </>
                )}

                {/* ── Aba Campos ── */}
                {panel === 'fields' && (
                  <>
                    <p className="text-[11px] text-muted-foreground">
                      Campos em branco do formulário. Escolha a variável que entra em cada um.
                    </p>
                    {fields.length > 8 && (
                      <div className="relative">
                        <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          value={fieldSearch}
                          onChange={e => setFieldSearch(e.target.value)}
                          placeholder="Buscar campo pelo rótulo…"
                          className="h-7 pl-8 text-[11px]"
                        />
                      </div>
                    )}
                    {fields.length === 0 && (
                      <p className="text-xs text-muted-foreground py-4 text-center">
                        Nenhum campo em branco encontrado neste documento.
                      </p>
                    )}
                    {fields.length > 0 && visibleFields.length === 0 && (
                      <p className="text-xs text-muted-foreground py-4 text-center">
                        Nenhum campo encontrado para "{fieldSearch}"
                      </p>
                    )}
                    {visibleFields.map(f => (
                      <div key={f.id} className="rounded-md border p-2 space-y-1.5">
                        <p className="text-[11px] font-medium leading-snug">{f.label}</p>
                        <p className="text-[10px] text-muted-foreground italic truncate">
                          {f.kind === 'placeholder' ? f.currentText : '(célula vazia)'}
                        </p>
                        <Select value={undefined} onValueChange={v => assignField(f, v)}>
                          <SelectTrigger className="h-7 text-[11px]"><SelectValue placeholder="Inserir variável…" /></SelectTrigger>
                          <SelectContent className="max-h-60">
                            {TEMPLATE_VARIABLES.map(v => (
                              <SelectItem key={v.key} value={v.key} className="text-xs font-mono">
                                {`{${v.key}}`} <span className="text-muted-foreground font-sans">— {v.desc}</span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    ))}
                  </>
                )}
              </div>

              {/* Ações */}
              <div className="space-y-2">
                <div className="flex gap-2">
                  <Button variant="outline" onClick={undo} disabled={!dirty} className="gap-1.5 flex-1" title="Desfazer última alteração">
                    <Undo2 className="w-4 h-4" /> Desfazer
                  </Button>
                  <Button onClick={handleSave} disabled={saving || !dirty} className="gap-1.5 flex-1">
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Salvar
                  </Button>
                </div>
                {dirty && (
                  <p className="text-[11px] text-amber-600 text-center">
                    {history.length} alteração(ões) não salva(s)
                  </p>
                )}
                {backupExists && (
                  <Button variant="ghost" size="sm" onClick={handleRestore} disabled={restoring} className="w-full gap-1.5 text-[11px] text-muted-foreground">
                    {restoring ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
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
