import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { useConcessionaireTemplates } from '@/hooks/useConcessionaireTemplates';
import {
  useInstallerPackage, useSaveInstallerPackage,
  useInstallerPreset, useSaveInstallerPreset,
  PackageItem, PackageSourceType, PROJECT_DOCUMENT_TYPES,
} from '@/hooks/useInstallerPackage';
import {
  FileText, Image, FileCheck, Cpu, ClipboardList, Plus, Trash2,
  ArrowUp, ArrowDown, Loader2, Download, Save, Crown, ShieldCheck,
} from 'lucide-react';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  concessionaire: { id: string; name: string } | null;
}

const SOURCE_META: Record<PackageSourceType, { label: string; icon: React.ElementType }> = {
  summary: { label: 'Resumo (cartilha do projeto)', icon: ClipboardList },
  project_document: { label: 'Documento do projeto', icon: Image },
  concessionaire_template: { label: 'Template da concessionária', icon: FileText },
  equipment_inmetro: { label: 'INMETRO do equipamento', icon: FileCheck },
  equipment_datasheet: { label: 'Datasheet do equipamento', icon: Cpu },
  equipment_afci: { label: 'Certificado AFCI (inversor)', icon: ShieldCheck },
};

const uid = () => Math.random().toString(36).slice(2, 10);

export function PacoteProjetistaDialog({ open, onOpenChange, concessionaire }: Props) {
  const { user } = useAuth();
  const isMaster = !!user?.isMaster;
  const { data: saved = [], isLoading } = useInstallerPackage(concessionaire?.id);
  const { data: preset } = useInstallerPreset(concessionaire?.name);
  const { data: templates = [] } = useConcessionaireTemplates(concessionaire?.id);
  const savePkg = useSaveInstallerPackage();
  const savePreset = useSaveInstallerPreset();

  const [items, setItems] = useState<PackageItem[]>([]);

  useEffect(() => { if (open) setItems(saved); }, [open, saved]);

  if (!concessionaire) return null;

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    setItems(next);
  };
  const remove = (i: number) => setItems(items.filter((_, idx) => idx !== i));
  const patch = (i: number, p: Partial<PackageItem>) =>
    setItems(items.map((it, idx) => (idx === i ? { ...it, ...p } : it)));

  const addItem = (source_type: PackageSourceType) => {
    const defaults: Record<PackageSourceType, Partial<PackageItem>> = {
      summary: { label: 'Resumo', ref: null },
      project_document: { label: 'CNH / Documento', ref: 'holder_document' },
      concessionaire_template: { label: 'Anexo', ref: templates[0]?.path ?? null },
      equipment_inmetro: { label: 'INMETRO inversor', ref: 'inverter' },
      equipment_datasheet: { label: 'Datasheet inversor', ref: 'inverter' },
      equipment_afci: { label: 'Certificado AFCI inversor', ref: 'inverter' },
    };
    setItems([...items, { id: uid(), required: true, source_type, ...defaults[source_type] } as PackageItem]);
  };

  const handleSave = async () => {
    await savePkg.mutateAsync({ concessionaireId: concessionaire.id, items });
    onOpenChange(false);
  };

  const importPreset = () => {
    if (!preset || preset.length === 0) { toast.info('Não há preset do master para esta concessionária'); return; }
    setItems(preset.map(p => ({ ...p, id: uid() })));
    toast.success('Preset do master carregado — salve para aplicar');
  };

  const saveAsPreset = async () => {
    await savePreset.mutateAsync({ concessionaireName: concessionaire.name, items });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Download className="w-5 h-5 text-primary" /> Pacote do Projetista — {concessionaire.name}</DialogTitle>
          <DialogDescription>Monte a lista ordenada de documentos que o projetista envia para esta concessionária.</DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
        ) : (
          <div className="space-y-3 py-2">
            {/* Lista de itens */}
            {items.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-6 border border-dashed border-border rounded-lg">
                Nenhum item ainda. Adicione abaixo ou importe o preset do master.
              </p>
            )}
            {items.map((item, i) => {
              const M = SOURCE_META[item.source_type];
              return (
                <div key={item.id} className="flex items-start gap-2 p-3 rounded-lg border border-border bg-card">
                  <div className="flex flex-col gap-0.5 pt-1">
                    <span className="text-xs font-mono text-muted-foreground text-center">{i}</span>
                    <button onClick={() => move(i, -1)} disabled={i === 0} className="text-muted-foreground hover:text-foreground disabled:opacity-30"><ArrowUp className="w-4 h-4" /></button>
                    <button onClick={() => move(i, 1)} disabled={i === items.length - 1} className="text-muted-foreground hover:text-foreground disabled:opacity-30"><ArrowDown className="w-4 h-4" /></button>
                  </div>
                  <div className="flex-1 min-w-0 space-y-2">
                    <div className="flex items-center gap-2">
                      <M.icon className="w-4 h-4 text-primary flex-shrink-0" />
                      <Input value={item.label} onChange={e => patch(i, { label: e.target.value })} placeholder="Rótulo do item" className="h-8" />
                    </div>
                    {/* Seletor da origem específica */}
                    {item.source_type === 'project_document' && (
                      <Select value={item.ref ?? ''} onValueChange={v => patch(i, { ref: v, label: PROJECT_DOCUMENT_TYPES.find(d => d.value === v)?.label ?? item.label })}>
                        <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {PROJECT_DOCUMENT_TYPES.map(d => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    )}
                    {item.source_type === 'concessionaire_template' && (
                      <Select value={item.ref ?? ''} onValueChange={v => patch(i, { ref: v })}>
                        <SelectTrigger className="h-8"><SelectValue placeholder="Escolha o template" /></SelectTrigger>
                        <SelectContent>
                          {templates.length === 0 && <SelectItem value="__none" disabled>Nenhum template — envie em "Templates"</SelectItem>}
                          {templates.map(t => <SelectItem key={t.path} value={t.path}>{t.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    )}
                    {(item.source_type === 'equipment_inmetro' || item.source_type === 'equipment_datasheet') && (
                      <Select value={item.ref ?? 'inverter'} onValueChange={v => {
                        const kind = item.source_type === 'equipment_inmetro' ? 'INMETRO' : 'Datasheet';
                        patch(i, { ref: v, label: `${kind} ${v === 'module' ? 'módulo' : 'inversor'}` });
                      }}>
                        <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="inverter">Do inversor</SelectItem>
                          <SelectItem value="module">Do módulo</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                    <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                      <input type="checkbox" checked={item.required} onChange={e => patch(i, { required: e.target.checked })} />
                      Obrigatório
                    </label>
                  </div>
                  <button onClick={() => remove(i)} className="text-muted-foreground hover:text-destructive pt-1"><Trash2 className="w-4 h-4" /></button>
                </div>
              );
            })}

            {/* Adicionar item */}
            <div className="flex flex-wrap gap-2 pt-1">
              {(Object.keys(SOURCE_META) as PackageSourceType[]).map(st => {
                const M = SOURCE_META[st];
                return (
                  <Button key={st} variant="outline" size="sm" onClick={() => addItem(st)} className="gap-1">
                    <Plus className="w-3.5 h-3.5" /> <M.icon className="w-3.5 h-3.5" /> {M.label}
                  </Button>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between gap-3 pt-2 border-t border-border flex-wrap">
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={importPreset} className="gap-1">
              <Download className="w-4 h-4" /> Importar preset do master
            </Button>
            {isMaster && (
              <Button variant="ghost" size="sm" onClick={saveAsPreset} disabled={savePreset.isPending} className="gap-1 text-primary">
                <Crown className="w-4 h-4" /> Salvar como preset do master
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button variant="cta" onClick={handleSave} disabled={savePkg.isPending}>
              {savePkg.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
              Salvar pacote
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
