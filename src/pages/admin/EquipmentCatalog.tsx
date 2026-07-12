import { useState } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  useEquipmentCatalog, useDeleteEquipment,
  downloadEquipmentDoc, EquipmentType, EquipmentCatalogItem,
} from '@/hooks/useEquipmentCatalog';
import { EquipmentFormDialog } from '@/components/equipment/EquipmentFormDialog';
import { buildEquipmentDocName } from '@/lib/equipmentDocs';
import { Cpu, PanelTop, Plus, Pencil, Trash2, FileText, FileCheck, Loader2, Search, Download } from 'lucide-react';

const TYPE_META: Record<EquipmentType, { label: string; icon: React.ElementType; unit: string }> = {
  inverter: { label: 'Inversores', icon: Cpu, unit: 'kW' },
  module: { label: 'Módulos', icon: PanelTop, unit: 'Wp' },
};

export default function EquipmentCatalog() {
  const [type, setType] = useState<EquipmentType>('inverter');
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<EquipmentCatalogItem | null>(null);

  const { data: items = [], isLoading } = useEquipmentCatalog(type);
  const deleteEquip = useDeleteEquipment();

  const filtered = items.filter(i =>
    `${i.brand} ${i.model}`.toLowerCase().includes(search.toLowerCase()));

  const openNew = () => { setEditing(null); setDialogOpen(true); };
  const openEdit = (item: EquipmentCatalogItem) => { setEditing(item); setDialogOpen(true); };

  return (
    <MainLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Equipamentos</h1>
            <p className="text-muted-foreground">Biblioteca de inversores e módulos com datasheet e INMETRO</p>
          </div>
          <Button variant="cta" onClick={openNew}><Plus className="w-4 h-4" /> Novo equipamento</Button>
        </div>

        {/* Abas de tipo */}
        <div className="flex gap-2">
          {(Object.keys(TYPE_META) as EquipmentType[]).map(t => {
            const M = TYPE_META[t];
            const active = type === t;
            return (
              <button
                key={t}
                onClick={() => setType(t)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors border ${active ? 'border-primary bg-primary/5 text-foreground' : 'border-border text-muted-foreground hover:bg-muted/40'}`}
              >
                <M.icon className="w-4 h-4" /> {M.label}
              </button>
            );
          })}
        </div>

        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Buscar por marca ou modelo..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10" />
        </div>

        {isLoading ? (
          <div className="flex justify-center py-16"><Loader2 className="w-7 h-7 animate-spin text-primary" /></div>
        ) : (
          <div className="bg-card rounded-xl border border-border overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="py-3 px-4 text-sm font-medium text-muted-foreground">Marca</th>
                  <th className="py-3 px-4 text-sm font-medium text-muted-foreground">Modelo</th>
                  <th className="py-3 px-4 text-sm font-medium text-muted-foreground">Potência</th>
                  <th className="py-3 px-4 text-sm font-medium text-muted-foreground">Documentos</th>
                  <th className="py-3 px-4 text-right text-sm font-medium text-muted-foreground">Ações</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(item => (
                  <tr key={item.id} className="border-b border-border/50 hover:bg-muted/20">
                    <td className="py-3 px-4 text-sm font-medium text-card-foreground">{item.brand}</td>
                    <td className="py-3 px-4 text-sm text-muted-foreground" style={{ overflowWrap: 'anywhere' }}>{item.model}</td>
                    <td className="py-3 px-4 text-sm text-muted-foreground">{item.power != null ? `${item.power} ${TYPE_META[type].unit}` : '—'}</td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <DocChip label="Datasheet" path={item.datasheet_url} fileName={buildEquipmentDocName('datasheet', item.brand, item.model)} icon={FileText} />
                        <DocChip label="INMETRO" path={item.inmetro_url} fileName={buildEquipmentDocName('inmetro', item.brand, item.model)} icon={FileCheck} />
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="icon" onClick={() => openEdit(item)} title="Editar"><Pencil className="w-4 h-4" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => { if (confirm(`Remover ${item.brand} ${item.model} do catálogo?`)) deleteEquip.mutate(item.id); }} title="Remover"><Trash2 className="w-4 h-4" /></Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={5} className="py-10 text-center text-muted-foreground text-sm">Nenhum equipamento cadastrado</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {dialogOpen && (
        <EquipmentFormDialog type={type} editing={editing} onClose={() => setDialogOpen(false)} />
      )}
    </MainLayout>
  );
}

function DocChip({ label, path, fileName, icon: Icon }: { label: string; path: string | null; fileName: string; icon: React.ElementType }) {
  if (!path) return <span className="inline-flex items-center gap-1 text-xs text-muted-foreground/50"><Icon className="w-3.5 h-3.5" /> {label}: —</span>;
  return (
    <button onClick={() => downloadEquipmentDoc(path, fileName)} title={`Baixar ${label}`}
      className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
      <Icon className="w-3.5 h-3.5" /> {label} <Download className="w-3 h-3" />
    </button>
  );
}
