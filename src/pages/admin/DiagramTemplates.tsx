import { useEffect, useRef, useState } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  ArrowLeft, Copy, FlaskConical, LayoutTemplate, Loader2, Pencil, Plus, ShieldAlert, Sparkles, Trash2,
} from 'lucide-react';
import { useDiagramEngineAccess } from '@/hooks/useDiagramEngineAccess';
import {
  useCreateDiagramTemplate, useDeleteDiagramTemplate, useDiagramTemplates,
  useDuplicateDiagramTemplate, useUpdateDiagramTemplate,
} from '@/hooks/useDiagramTemplates';
import { DiagramEditor } from '@/components/diagrams/DiagramEditor';
import { DiagramSceneState } from '@/utils/cadEngine/editableLayout';
import { TechnicalJsonMvp } from '@/utils/cadEngine/types';
import { buildSampleValues } from '@/utils/projectValues';

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

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [previewSample, setPreviewSample] = useState(false);

  const selected = templates.find(t => t.id === selectedId) ?? null;

  const debounceRef = useRef<number | null>(null);
  useEffect(() => () => { if (debounceRef.current) window.clearTimeout(debounceRef.current); }, []);

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
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      updateTemplate.mutate({ id: selected.id, sceneData: state, silent: true });
    }, 800);
  };

  // ── Editando um modelo ────────────────────────────────────────────────────
  if (selected) {
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
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, background: '#EAF3FF',
        border: '1px solid #BFDBFE', borderRadius: 10, padding: '10px 14px', marginBottom: 16, flexWrap: 'wrap',
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
    );
    return (
      <MainLayout>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <Button variant="ghost" size="sm" onClick={() => setSelectedId(null)}>
            <ArrowLeft className="w-4 h-4 mr-1" /> Modelos
          </Button>
        </div>
        <DiagramEditor
          stateKey={selected.id}
          json={templateJson}
          initialState={selected.scene_data}
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
        <Button onClick={() => setCreateOpen(true)} style={{ background: '#F5A800', color: '#1A1A1A' }}>
          <Plus className="w-4 h-4 mr-1" /> Novo modelo
        </Button>
      </div>

      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, background: '#FFF7E6',
        border: '1px solid #FDE4A8', borderRadius: 10, padding: '10px 14px', margin: '16px 0',
      }}>
        <FlaskConical size={15} style={{ color: '#854F0B', flexShrink: 0 }} />
        <p style={{ fontSize: 12, color: '#854F0B', margin: 0 }}>
          <strong>Alpha interno.</strong> Reconhecimento automático a partir de um PDF enviado
          ainda não existe — fica pra uma etapa futura dedicada. Por enquanto, os modelos são
          montados manualmente com o mesmo editor do diagrama do projeto.
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
    </MainLayout>
  );
}
