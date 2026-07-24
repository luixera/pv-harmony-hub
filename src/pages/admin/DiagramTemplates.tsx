import { useEffect, useRef, useState } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  ArrowLeft, Copy, FileUp, FlaskConical, HardHat, LayoutTemplate, Loader2, Pencil, Plus, ShieldAlert, Sparkles, Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { useDiagramEngineAccess } from '@/hooks/useDiagramEngineAccess';
import {
  useCreateDiagramTemplate, useDeleteDiagramTemplate, useDiagramTemplates,
  useDuplicateDiagramTemplate, useUpdateDiagramTemplate,
} from '@/hooks/useDiagramTemplates';
import { useDiagramRecognition } from '@/hooks/useDiagramRecognition';
import { useDiagramReview } from '@/hooks/useDiagramReview';
import { DiagramEditor } from '@/components/diagrams/DiagramEditor';
import {
  buildSceneFromPlacement, buildSceneFromRecognition, DiagramSceneState, sceneStateToRecognitionInput,
} from '@/utils/cadEngine/editableLayout';
import { sceneToJpegDataUrl } from '@/utils/cadEngine/exportPng';
import { renderPdfFirstPageToDataUrl } from '@/utils/pdfPreview';
import { TechnicalJsonMvp } from '@/utils/cadEngine/types';
import { buildSampleValues } from '@/utils/projectValues';

/** JSON técnico "vazio" pra renderizar cenas de modelo (sem projeto por trás). */
const TEMPLATE_BASE_JSON: TechnicalJsonMvp = {
  documentId: 'template',
  title: { projectCode: 'MODELO', holderName: '—', concessionaire: '—', installedPower: '—', date: '—' },
  components: [],
  connections: [],
};

/**
 * Motor de templates de diagrama unifilar — aba própria, fora do modal de
 * projeto. Cria/edita/duplica/exclui modelos reutilizáveis de diagrama
 * (`diagram_templates`), usando o mesmo `DiagramEditor` do modal do
 * projeto. Editar um template aqui NUNCA afeta o que já foi editado num
 * projeto específico (localStorage do `UnifilarTab`) — são fontes de dados
 * completamente separadas.
 *
 * Restrito por enquanto à GD Manager (ver `useDiagramEngineAccess`); RLS por
 * tenant já está pronto para abrir a todos os tenants no futuro.
 */
export default function DiagramTemplates() {
  const hasAccess = useDiagramEngineAccess();
  const { data: templates = [], isLoading } = useDiagramTemplates();
  const createTemplate = useCreateDiagramTemplate();
  const updateTemplate = useUpdateDiagramTemplate();
  const deleteTemplate = useDeleteDiagramTemplate();
  const duplicateTemplate = useDuplicateDiagramTemplate();
  const recognizeDiagram = useDiagramRecognition();
  const reviewDiagram = useDiagramReview();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [previewSample, setPreviewSample] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importName, setImportName] = useState('');
  const [importFile, setImportFile] = useState<File | null>(null);
  /** Avisos do último reconhecimento — mostrados no editor ao abrir o modelo recém-criado. */
  const [importWarnings, setImportWarnings] = useState<string[] | null>(null);
  /** Notas do engenheiro revisor (IA), chaveadas pelo id do modelo — a importação
   *  seta as notas E troca o selectedId no mesmo lote; chavear evita que o efeito
   *  de troca de modelo apague as notas recém-criadas. */
  const [reviewNotes, setReviewNotes] = useState<{ id: string; notes: string[] } | null>(null);
  /** Estado ao vivo do editor (o autosave é debounced — a query pode estar atrasada). */
  const latestStateRef = useRef<DiagramSceneState | null>(null);
  /** Cena aplicada por uma revisão sob demanda — versionada pra forçar o reseed do editor. */
  const [reviewedState, setReviewedState] = useState<{ v: number; state: DiagramSceneState } | null>(null);

  const selected = templates.find(t => t.id === selectedId) ?? null;

  const debounceRef = useRef<number | null>(null);
  useEffect(() => () => { if (debounceRef.current) window.clearTimeout(debounceRef.current); }, []);

  // Trocar de modelo zera o estado ao vivo e a cena de revisão aplicada.
  // (reviewNotes não precisa: é chaveado pelo id do modelo.)
  useEffect(() => {
    latestStateRef.current = null;
    setReviewedState(null);
  }, [selectedId]);

  if (!hasAccess) {
    return (
      <MainLayout>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '80px 20px', textAlign: 'center' }}>
          <ShieldAlert size={32} style={{ color: '#999' }} />
          <p style={{ color: '#666', fontSize: 14, maxWidth: 420 }}>
            O motor de templates de diagrama está restrito, por enquanto, à GD Manager.
          </p>
        </div>
      </MainLayout>
    );
  }

  const handleCreate = async () => {
    if (!newName.trim()) return;
    const created = await createTemplate.mutateAsync({ name: newName.trim(), description: newDescription.trim() || undefined });
    setCreateOpen(false);
    setNewName(''); setNewDescription('');
    setSelectedId(created.id);
  };

  const handleImport = async () => {
    if (!importFile || !importName.trim()) return;
    try {
      // reconhecimento (IA) e render do PDF original (underlay) em paralelo —
      // o underlay é opcional: se falhar, a importação segue sem ele
      const isPdf = importFile.type === 'application/pdf' || importFile.name.toLowerCase().endsWith('.pdf');
      const [result, underlayHref] = await Promise.all([
        recognizeDiagram.mutateAsync(importFile),
        isPdf ? renderPdfFirstPageToDataUrl(importFile) : Promise.resolve(null),
      ]);
      const sceneData = buildSceneFromRecognition(result.components, result.connections, result.groups);

      // ── 2ª passada: o ENGENHEIRO REVISOR (IA) compara o original com o nosso
      // redesenho e corrige tipos/posições/ligações. Best-effort: se falhar, a
      // importação segue com a 1ª passada.
      let notes: string[] = [];
      let finalResult = result;
      if (underlayHref) {
        try {
          const renderUrl = await sceneToJpegDataUrl(buildSceneFromPlacement(TEMPLATE_BASE_JSON, sceneData));
          const reviewed = await reviewDiagram.mutateAsync({
            originalDataUrl: underlayHref,
            renderDataUrl: renderUrl,
            current: { components: result.components, connections: result.connections, groups: result.groups },
          });
          finalResult = { ...reviewed, warnings: result.warnings };
          const revised = buildSceneFromRecognition(reviewed.components, reviewed.connections, reviewed.groups);
          sceneData.placements = revised.placements;
          sceneData.connections = revised.connections;
          sceneData.groups = revised.groups;
          notes = reviewed.notes;
        } catch (e) {
          console.error('revisão do engenheiro falhou — mantendo a 1ª passada', e);
          notes = ['A revisão automática do engenheiro (2ª passada) falhou — resultado da 1ª passada mantido.'];
        }
      }

      if (underlayHref) {
        // encaixa a página original dentro da área da moldura, centralizada
        const dims = await new Promise<{ w: number; h: number }>(res => {
          const img = new Image();
          img.onload = () => res({ w: img.width, h: img.height });
          img.onerror = () => res({ w: 297, h: 210 });
          img.src = underlayHref;
        });
        const maxW = 273, maxH = 158; // dentro da moldura, acima do carimbo
        const s = Math.min(maxW / dims.w, maxH / dims.h);
        const w = dims.w * s, h = dims.h * s;
        sceneData.photos = [{
          id: `underlay-${Date.now()}`, href: underlayHref, underlay: true,
          x: 12 + (maxW - w) / 2, y: 12 + (maxH - h) / 2, w, h,
        }];
      }
      // insert único, já com a cena reconhecida — evita um 2º passo (update) que,
      // se falhar, deixaria um modelo órfão criado vazio (bug real corrigido aqui)
      const created = await createTemplate.mutateAsync({ name: importName.trim(), sceneData });
      setImportOpen(false);
      setImportName(''); setImportFile(null);
      setImportWarnings(finalResult.warnings.length > 0 ? finalResult.warnings : []);
      setReviewNotes(notes.length > 0 ? { id: created.id, notes } : null);
      setSelectedId(created.id);
      toast.success(`${finalResult.components.length} componente(s) reconhecido(s) e revisados — confira contra o original no fundo`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao reconhecer o diagrama');
    }
  };

  const handleRename = (id: string, currentName: string) => {
    const name = window.prompt('Nome do modelo:', currentName);
    if (!name || !name.trim()) return;
    updateTemplate.mutate({ id, name: name.trim() });
  };

  const handleDelete = (id: string, name: string) => {
    if (!confirm(`Excluir o modelo "${name}"? Essa ação não pode ser desfeita.`)) return;
    deleteTemplate.mutate(id);
    if (selectedId === id) setSelectedId(null);
  };

  const handleStateChange = (state: DiagramSceneState) => {
    if (!selected) return;
    latestStateRef.current = state; // o revisor de IA usa o estado ao vivo, não o autosave atrasado
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      updateTemplate.mutate({ id: selected.id, sceneData: state, silent: true });
    }, 800);
  };

  /**
   * "Revisão do engenheiro" sob demanda: manda pro revisor de IA o PDF
   * original (o underlay já renderizado), um JPEG do estado ATUAL do
   * diagrama e o JSON correspondente; aplica a cena corrigida preservando
   * fotos/underlay, textos e dados da folha.
   */
  const handleEngineerReview = async () => {
    if (!selected) return;
    const current = latestStateRef.current ?? selected.scene_data;
    const underlay = current.photos.find(p => p.underlay);
    if (!underlay) return;
    if (!confirm('Pedir a revisão do engenheiro (IA)? Componentes, ligações e grupos serão substituídos pela versão revisada (fotos, textos e dados da folha ficam). Ligações em derivação (ponta sobre outra linha) não entram na revisão.')) return;
    try {
      const renderUrl = await sceneToJpegDataUrl(buildSceneFromPlacement(TEMPLATE_BASE_JSON, current));
      const reviewed = await reviewDiagram.mutateAsync({
        originalDataUrl: underlay.href,
        renderDataUrl: renderUrl,
        current: sceneStateToRecognitionInput(current),
      });
      const revised = buildSceneFromRecognition(reviewed.components, reviewed.connections, reviewed.groups);
      const newState: DiagramSceneState = {
        ...revised,
        photos: current.photos,
        texts: current.texts,
        sheet: current.sheet,
      };
      await updateTemplate.mutateAsync({ id: selected.id, sceneData: newState, silent: true });
      latestStateRef.current = newState;
      setReviewedState(prev => ({ v: (prev?.v ?? 0) + 1, state: newState }));
      setReviewNotes({
        id: selected.id,
        notes: reviewed.notes.length > 0 ? reviewed.notes : ['O engenheiro revisor não encontrou nada pra corrigir.'],
      });
      toast.success('Revisão aplicada — confira contra o original no fundo');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro na revisão do engenheiro');
    }
  };

  // ── Editando um modelo ────────────────────────────────────────────────────
  if (selected) {
    const editorScene = reviewedState?.state ?? selected.scene_data;
    const hasUnderlay = (editorScene.photos ?? []).some(p => p.underlay);
    const selectedNotes = reviewNotes?.id === selected.id ? reviewNotes.notes : null;
    const templateJson: TechnicalJsonMvp = {
      documentId: selected.id,
      title: {
        projectCode: 'MODELO', holderName: selected.name,
        concessionaire: selected.description || '—', installedPower: '—', date: '—',
      },
      components: [],
      connections: [],
    };
    const banner = (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
        {selectedNotes !== null && (
          <div style={{
            display: 'flex', alignItems: 'flex-start', gap: 10, background: '#FFF7E6',
            border: '1px solid #FDE1A8', borderRadius: 10, padding: '10px 14px', flexWrap: 'wrap',
          }}>
            <HardHat size={15} style={{ color: '#B45309', flexShrink: 0, marginTop: 1 }} />
            <div style={{ fontSize: 12, color: '#92400E', flex: 1, minWidth: 240 }}>
              <p style={{ margin: 0 }}><strong>Revisão do engenheiro (IA):</strong></p>
              <ul style={{ margin: '4px 0 0', paddingLeft: 16 }}>
                {selectedNotes.map((n, i) => <li key={i}>{n}</li>)}
              </ul>
            </div>
            <button
              onClick={() => setReviewNotes(null)}
              style={{ background: 'none', border: 'none', color: '#B45309', fontSize: 12, cursor: 'pointer', padding: 0 }}
            >
              fechar
            </button>
          </div>
        )}
        {importWarnings !== null && (
          <div style={{
            display: 'flex', alignItems: 'flex-start', gap: 10, background: '#F3EAFF',
            border: '1px solid #DCC8FA', borderRadius: 10, padding: '10px 14px', flexWrap: 'wrap',
          }}>
            <Sparkles size={15} style={{ color: '#6D28D9', flexShrink: 0, marginTop: 1 }} />
            <div style={{ fontSize: 12, color: '#6D28D9', flex: 1, minWidth: 240 }}>
              <p style={{ margin: 0 }}>
                <strong>Reconhecido automaticamente a partir do PDF.</strong> A IA identificou
                os componentes e as ligações, mas posições, rotações e legendas ainda precisam
                da sua revisão antes de usar este modelo.
              </p>
              {importWarnings.length > 0 && (
                <p style={{ margin: '4px 0 0' }}>
                  Ignorado no reconhecimento: {importWarnings.join('; ')}
                </p>
              )}
            </div>
          </div>
        )}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, background: '#EAF3FF',
          border: '1px solid #BFDBFE', borderRadius: 10, padding: '10px 14px', flexWrap: 'wrap',
        }}>
          <LayoutTemplate size={15} style={{ color: '#1D4ED8', flexShrink: 0 }} />
          <p style={{ fontSize: 12, color: '#1D4ED8', margin: 0, flex: 1, minWidth: 240 }}>
            <strong>Editando o modelo "{selected.name}".</strong> Legendas com tags do projeto
            (ex.: <code>{'{marca_inversor}'}</code>) ficam salvas cruas aqui — cada projeto que
            importar este modelo resolve com os próprios dados. Salva automaticamente.
          </p>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#1D4ED8', whiteSpace: 'nowrap', cursor: 'pointer' }}>
            <input type="checkbox" checked={previewSample} onChange={e => setPreviewSample(e.target.checked)} />
            <Sparkles size={12} /> Pré-visualizar com dados de exemplo
          </label>
        </div>
      </div>
    );
    return (
      <MainLayout>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <Button variant="ghost" size="sm" onClick={() => { setSelectedId(null); setImportWarnings(null); }}>
            <ArrowLeft className="w-4 h-4 mr-1" /> Modelos
          </Button>
          {hasUnderlay && (
            <Button
              variant="outline" size="sm"
              onClick={handleEngineerReview}
              disabled={reviewDiagram.isPending}
              title="A IA compara o diagrama atual com o documento original ao fundo e corrige componentes, ligações e grupos"
            >
              {reviewDiagram.isPending
                ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Revisando…</>
                : <><HardHat className="w-4 h-4 mr-1" /> Revisão do engenheiro</>}
            </Button>
          )}
        </div>
        <DiagramEditor
          stateKey={`${selected.id}:r${reviewedState?.v ?? 0}`}
          json={templateJson}
          initialState={editorScene}
          tagValues={previewSample ? buildSampleValues() : undefined}
          onStateChange={handleStateChange}
          downloadBaseName={selected.name}
          banner={banner}
          resetConfirmMessage="Limpar tudo neste modelo? Todos os componentes, ligações, fotos e textos serão perdidos."
        />
      </MainLayout>
    );
  }

  // ── Lista de modelos ──────────────────────────────────────────────────────
  return (
    <MainLayout>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#1A1A1A', display: 'flex', alignItems: 'center', gap: 8 }}>
            <LayoutTemplate size={20} style={{ color: '#F5A800' }} /> Modelos de Diagrama Unifilar
          </h1>
          <p style={{ fontSize: 13, color: '#666', marginTop: 2 }}>
            Monte modelos reutilizáveis aqui; no projeto, é só importar o modelo pronto em vez de montar do zero.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="outline" onClick={() => setImportOpen(true)}>
            <FileUp className="w-4 h-4 mr-1" /> Importar de PDF
          </Button>
          <Button onClick={() => setCreateOpen(true)} style={{ background: '#F5A800', color: '#1A1A1A' }}>
            <Plus className="w-4 h-4 mr-1" /> Novo modelo
          </Button>
        </div>
      </div>

      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, background: '#FFF7E6',
        border: '1px solid #FDE4A8', borderRadius: 10, padding: '10px 14px', margin: '16px 0',
      }}>
        <FlaskConical size={15} style={{ color: '#854F0B', flexShrink: 0 }} />
        <p style={{ fontSize: 12, color: '#854F0B', margin: 0 }}>
          <strong>Alpha interno.</strong> "Importar de PDF" usa IA de visão pra reconhecer
          componentes e ligações — não é pixel-perfect, sempre revise no editor antes de usar o
          modelo. Os modelos também podem ser montados manualmente com o mesmo editor do
          diagrama do projeto.
        </p>
      </div>

      {isLoading ? (
        <div style={{ padding: 60, textAlign: 'center' }}><Loader2 size={22} className="animate-spin" style={{ color: '#F5A800' }} /></div>
      ) : templates.length === 0 ? (
        <div style={{ padding: '60px 20px', textAlign: 'center', color: '#999' }}>
          <LayoutTemplate size={32} style={{ margin: '0 auto 10px', opacity: 0.4 }} />
          <p style={{ fontSize: 14 }}>Nenhum modelo ainda. Crie o primeiro pra começar.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
          {templates.map(t => (
            <div
              key={t.id}
              style={{ border: '1px solid #E0E0E0', borderRadius: 12, padding: 16, background: '#fff', cursor: 'pointer' }}
              onClick={() => setSelectedId(t.id)}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ minWidth: 0 }}>
                  <p style={{ fontSize: 14, fontWeight: 700, color: '#1A1A1A', marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</p>
                  {t.description && <p style={{ fontSize: 12, color: '#777', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.description}</p>}
                </div>
              </div>
              <p style={{ fontSize: 11, color: '#aaa', marginTop: 8 }}>
                {t.scene_data.placements.length} componente{t.scene_data.placements.length === 1 ? '' : 's'} · atualizado {new Date(t.updated_at).toLocaleDateString('pt-BR')}
              </p>
              <div style={{ display: 'flex', gap: 4, marginTop: 12 }} onClick={e => e.stopPropagation()}>
                <Button variant="ghost" size="sm" title="Renomear" onClick={() => handleRename(t.id, t.name)}>
                  <Pencil className="w-3.5 h-3.5" />
                </Button>
                <Button variant="ghost" size="sm" title="Duplicar" onClick={() => duplicateTemplate.mutate(t)}>
                  <Copy className="w-3.5 h-3.5" />
                </Button>
                <Button variant="ghost" size="sm" title="Excluir" onClick={() => handleDelete(t.id, t.name)} style={{ color: '#A32D2D' }}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Novo modelo de diagrama</DialogTitle>
          </DialogHeader>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <Label htmlFor="tpl-name">Nome</Label>
              <Input id="tpl-name" value={newName} onChange={e => setNewName(e.target.value)} placeholder="Ex.: Monofásico com DPS duplo" autoFocus />
            </div>
            <div>
              <Label htmlFor="tpl-desc">Descrição (opcional)</Label>
              <Textarea id="tpl-desc" value={newDescription} onChange={e => setNewDescription(e.target.value)} placeholder="Quando usar este modelo" rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancelar</Button>
            <Button onClick={handleCreate} disabled={!newName.trim() || createTemplate.isPending} style={{ background: '#F5A800', color: '#1A1A1A' }}>
              {createTemplate.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Criar e abrir'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={importOpen} onOpenChange={o => { if (!recognizeDiagram.isPending) setImportOpen(o); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Importar modelo de um PDF</DialogTitle>
          </DialogHeader>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p style={{ fontSize: 12, color: '#777' }}>
              Envie o PDF (ou uma foto) de um diagrama unifilar já aprovado. A IA reconhece os
              componentes e as ligações e monta um modelo inicial — você revisa e ajusta no
              editor antes de usar.
            </p>
            <div>
              <Label htmlFor="tpl-import-name">Nome do modelo</Label>
              <Input id="tpl-import-name" value={importName} onChange={e => setImportName(e.target.value)} placeholder="Ex.: ENEL trifásico com DPS duplo" autoFocus />
            </div>
            <div>
              <Label htmlFor="tpl-import-file">Arquivo (PDF, JPG ou PNG)</Label>
              <Input
                id="tpl-import-file" type="file" accept="application/pdf,image/jpeg,image/png"
                onChange={e => setImportFile(e.target.files?.[0] ?? null)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)} disabled={recognizeDiagram.isPending}>Cancelar</Button>
            <Button
              onClick={handleImport}
              disabled={!importName.trim() || !importFile || recognizeDiagram.isPending}
              style={{ background: '#F5A800', color: '#1A1A1A' }}
            >
              {recognizeDiagram.isPending ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <FileUp className="w-4 h-4 mr-1.5" />}
              {recognizeDiagram.isPending ? 'Reconhecendo…' : 'Reconhecer e criar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
}
