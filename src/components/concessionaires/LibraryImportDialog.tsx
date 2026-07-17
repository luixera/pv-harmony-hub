import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, Library, CheckCircle2, RefreshCw, FileText, PlugZap, Package } from 'lucide-react';
import { useConcessionaireLibrary, useImportLibrary, LibraryItem } from '@/hooks/useConcessionaireLibrary';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function LibraryImportDialog({ open, onOpenChange }: Props) {
  const { data: items = [], isLoading } = useConcessionaireLibrary();
  const importLib = useImportLibrary();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Pré-seleciona o que ainda não veio e o que tem atualização
  useEffect(() => {
    if (!open || items.length === 0) return;
    setSelected(new Set(items.filter(i => !i.imported || i.has_update).map(i => i.source_id)));
  }, [open, items]);

  const toggle = (id: string) => setSelected(prev => {
    const n = new Set(prev);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });

  const pending = items.filter(i => !i.imported || i.has_update);
  const handleImport = async () => {
    await importLib.mutateAsync([...selected]);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Library className="w-5 h-5 text-primary" /> Biblioteca GD Manager
          </DialogTitle>
          <DialogDescription>
            Traga concessionárias já configuradas — com templates, regras de padrão de entrada e
            pacote do projetista. A cópia é <b>sua</b>: editar aqui não afeta a biblioteca.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-10">
            Nenhum item disponível na biblioteca.
          </p>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">
                {pending.length > 0
                  ? `${pending.length} item(ns) para importar ou atualizar`
                  : 'Tudo em dia com a biblioteca'}
              </span>
              <div className="flex gap-2">
                <button className="text-primary hover:underline" onClick={() => setSelected(new Set(items.map(i => i.source_id)))}>Todas</button>
                <button className="text-muted-foreground hover:underline" onClick={() => setSelected(new Set())}>Nenhuma</button>
              </div>
            </div>

            <div className="space-y-1.5 max-h-[46vh] overflow-y-auto pr-1">
              {items.map(item => (
                <LibraryRow key={item.source_id} item={item} checked={selected.has(item.source_id)} onToggle={() => toggle(item.source_id)} />
              ))}
            </div>

            <div className="flex justify-end gap-3 pt-1">
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button onClick={handleImport} disabled={importLib.isPending || selected.size === 0} className="gap-2">
                {importLib.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Library className="w-4 h-4" />}
                Importar {selected.size} selecionada(s)
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Reimportar uma concessionária <b>substitui</b> os templates, regras e pacote dela pela versão da biblioteca.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function LibraryRow({ item, checked, onToggle }: { item: LibraryItem; checked: boolean; onToggle: () => void }) {
  const status = item.has_update
    ? { label: 'Atualização disponível', cls: 'bg-amber-500/15 text-amber-600', icon: RefreshCw }
    : item.imported
      ? { label: 'Em dia', cls: 'bg-emerald-500/15 text-emerald-600', icon: CheckCircle2 }
      : { label: 'Nova', cls: 'bg-primary/15 text-primary', icon: Library };
  const StatusIcon = status.icon;

  return (
    <label className="flex items-center gap-3 p-2.5 rounded-lg border bg-card cursor-pointer hover:bg-accent/30">
      <input type="checkbox" checked={checked} onChange={onToggle} className="w-4 h-4 accent-primary" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{item.name}</span>
          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full flex items-center gap-1 ${status.cls}`}>
            <StatusIcon className="w-2.5 h-2.5" /> {status.label}
          </span>
        </div>
        <div className="flex items-center gap-3 mt-0.5 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1"><FileText className="w-3 h-3" /> {item.templates} template(s)</span>
          <span className="flex items-center gap-1"><PlugZap className="w-3 h-3" /> {item.entry_rules} regra(s)</span>
          <span className="flex items-center gap-1"><Package className="w-3 h-3" /> {item.package_items} item(ns)</span>
        </div>
      </div>
    </label>
  );
}
