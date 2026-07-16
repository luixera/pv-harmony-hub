import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PlugZap, Plus, Trash2, Loader2, Info, Wand2 } from 'lucide-react';
import { EnergyConcessionaire } from '@/hooks/useEnergyConcessionaires';
import { useEntryRules, useSaveEntryRules, EntryRuleDraft } from '@/hooks/useEntryRules';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

interface EntryRulesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  concessionaire: EnergyConcessionaire | null;
}

/** Linha em edição na tabela. */
interface DraftRow {
  id?: string;
  categoria: string;
  num_fases: string;
  bitola: string;
  disjuntor: string;
  classe: string;
  caixa_medicao: string;
}

const EMPTY_ROW: DraftRow = { categoria: '', num_fases: '', bitola: '', disjuntor: '', classe: '', caixa_medicao: '' };

/** Exemplo real da CPFL — ponto de partida editável. */
const CPFL_PRESET: DraftRow[] = [
  { categoria: 'B1', num_fases: '2', bitola: '16', disjuntor: '63',  classe: 'BIFÁSICO',  caixa_medicao: 'TIPO II' },
  { categoria: 'B2', num_fases: '2', bitola: '25', disjuntor: '80',  classe: 'BIFÁSICO',  caixa_medicao: 'TIPO II' },
  { categoria: 'C1', num_fases: '3', bitola: '16', disjuntor: '63',  classe: 'TRIFÁSICO', caixa_medicao: 'TIPO II' },
  { categoria: 'C2', num_fases: '3', bitola: '25', disjuntor: '80',  classe: 'TRIFÁSICO', caixa_medicao: 'TIPO II' },
  { categoria: 'C3', num_fases: '3', bitola: '35', disjuntor: '100', classe: 'TRIFÁSICO', caixa_medicao: 'TIPO II' },
  { categoria: 'C4', num_fases: '3', bitola: '50', disjuntor: '125', classe: 'TRIFÁSICO', caixa_medicao: 'TIPO III' },
  { categoria: 'C5', num_fases: '3', bitola: '75', disjuntor: '150', classe: 'TRIFÁSICO', caixa_medicao: 'TIPO III' },
  { categoria: 'C6', num_fases: '3', bitola: '95', disjuntor: '200', classe: 'TRIFÁSICO', caixa_medicao: 'CAIXA H' },
];

export function EntryRulesDialog({ open, onOpenChange, concessionaire }: EntryRulesDialogProps) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const { data: rules = [], isLoading } = useEntryRules(concessionaire?.id);
  const saveRules = useSaveEntryRules();

  const [rows, setRows] = useState<DraftRow[]>([]);
  const [deletedIds, setDeletedIds] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);

  // Carrega as regras salvas quando o dialog abre / dados chegam
  useEffect(() => {
    if (!open) return;
    setRows(rules.map(r => ({
      id: r.id,
      categoria: r.categoria,
      num_fases: r.num_fases != null ? String(r.num_fases) : '',
      bitola: r.bitola ?? '',
      disjuntor: String(r.disjuntor),
      classe: r.classe ?? '',
      caixa_medicao: r.caixa_medicao ?? '',
    })));
    setDeletedIds([]);
    setDirty(false);
  }, [open, rules]);

  const updateRow = (i: number, field: keyof DraftRow, value: string) => {
    setRows(prev => prev.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)));
    setDirty(true);
  };

  const addRow = () => { setRows(prev => [...prev, { ...EMPTY_ROW }]); setDirty(true); };

  const removeRow = (i: number) => {
    const row = rows[i];
    if (row.id) setDeletedIds(prev => [...prev, row.id!]);
    setRows(prev => prev.filter((_, idx) => idx !== i));
    setDirty(true);
  };

  const applyPreset = () => {
    // preserva ids das linhas atuais para exclusão
    setDeletedIds(prev => [...prev, ...rows.filter(r => r.id).map(r => r.id!)]);
    setRows(CPFL_PRESET.map(r => ({ ...r })));
    setDirty(true);
    toast.info('Modelo CPFL carregado — revise e salve');
  };

  const handleSave = async () => {
    if (!concessionaire) return;
    // validação
    for (const r of rows) {
      if (!r.categoria.trim()) { toast.error('Toda linha precisa de uma categoria'); return; }
      if (!r.disjuntor.trim() || isNaN(parseInt(r.disjuntor, 10))) {
        toast.error(`Disjuntor inválido na categoria ${r.categoria}`); return;
      }
    }
    const drafts: EntryRuleDraft[] = rows.map((r, i) => ({
      id: r.id,
      concessionaire_id: concessionaire.id,
      categoria: r.categoria,
      num_fases: r.num_fases ? parseInt(r.num_fases, 10) : null,
      bitola: r.bitola || null,
      disjuntor: parseInt(r.disjuntor, 10),
      classe: r.classe || null,
      caixa_medicao: r.caixa_medicao || null,
      sort_order: i,
    }));
    await saveRules.mutateAsync({ concessionaireId: concessionaire.id, rules: drafts, deletedIds });
    setDirty(false);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PlugZap className="w-5 h-5 text-primary" />
            Regras padrão de entrada - {concessionaire?.name}
          </DialogTitle>
          <DialogDescription>
            Categorias do padrão de entrada desta concessionária. O sistema encontra a categoria do projeto
            pela fase + disjuntor e preenche as variáveis automaticamente nos documentos.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="space-y-4">
            {/* Ações */}
            {isAdmin && (
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={addRow} className="gap-1">
                  <Plus className="w-4 h-4" /> Adicionar categoria
                </Button>
                {rows.length === 0 && (
                  <Button variant="outline" size="sm" onClick={applyPreset} className="gap-1">
                    <Wand2 className="w-4 h-4" /> Usar modelo (CPFL)
                  </Button>
                )}
              </div>
            )}

            {/* Tabela editável */}
            {rows.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <PlugZap className="w-10 h-10 mx-auto mb-2 opacity-50" />
                <p className="text-sm">Nenhuma regra cadastrada{isAdmin ? ' — adicione categorias ou use o modelo' : ''}</p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/50 text-left">
                      <th className="px-2 py-2 font-medium text-xs">Categoria</th>
                      <th className="px-2 py-2 font-medium text-xs">Nº de fases</th>
                      <th className="px-2 py-2 font-medium text-xs">Bitola (mm²)</th>
                      <th className="px-2 py-2 font-medium text-xs">Disjuntor (A)</th>
                      <th className="px-2 py-2 font-medium text-xs">Classe</th>
                      <th className="px-2 py-2 font-medium text-xs">Caixa de medição</th>
                      {isAdmin && <th className="px-1 py-2 w-9" />}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, i) => (
                      <tr key={row.id ?? `new-${i}`} className="border-t">
                        <td className="px-1 py-1">
                          <Input value={row.categoria} onChange={e => updateRow(i, 'categoria', e.target.value)}
                            disabled={!isAdmin} placeholder="B1" className="h-8 text-sm w-20" />
                        </td>
                        <td className="px-1 py-1">
                          <Select value={row.num_fases || undefined} onValueChange={v => updateRow(i, 'num_fases', v)} disabled={!isAdmin}>
                            <SelectTrigger className="h-8 text-sm w-20"><SelectValue placeholder="—" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="1">1</SelectItem>
                              <SelectItem value="2">2</SelectItem>
                              <SelectItem value="3">3</SelectItem>
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="px-1 py-1">
                          <Input value={row.bitola} onChange={e => updateRow(i, 'bitola', e.target.value)}
                            disabled={!isAdmin} placeholder="16" className="h-8 text-sm w-20" />
                        </td>
                        <td className="px-1 py-1">
                          <Input value={row.disjuntor} onChange={e => updateRow(i, 'disjuntor', e.target.value)}
                            disabled={!isAdmin} placeholder="63" className="h-8 text-sm w-20" />
                        </td>
                        <td className="px-1 py-1">
                          <Select value={row.classe || undefined} onValueChange={v => updateRow(i, 'classe', v)} disabled={!isAdmin}>
                            <SelectTrigger className="h-8 text-sm w-32"><SelectValue placeholder="—" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="MONOFÁSICO">MONOFÁSICO</SelectItem>
                              <SelectItem value="BIFÁSICO">BIFÁSICO</SelectItem>
                              <SelectItem value="TRIFÁSICO">TRIFÁSICO</SelectItem>
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="px-1 py-1">
                          <Input value={row.caixa_medicao} onChange={e => updateRow(i, 'caixa_medicao', e.target.value)}
                            disabled={!isAdmin} placeholder="TIPO II" className="h-8 text-sm w-28" />
                        </td>
                        {isAdmin && (
                          <td className="px-1 py-1">
                            <Button size="icon" variant="ghost" onClick={() => removeRow(i)}
                              className="h-8 w-8 text-destructive hover:text-destructive">
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Variáveis geradas */}
            <div className="rounded-lg border bg-muted/30 p-3 space-y-1.5">
              <div className="flex items-center gap-2">
                <Info className="w-4 h-4 text-primary" />
                <p className="text-xs font-medium">Variáveis geradas nos documentos a partir dessas regras</p>
              </div>
              <p className="text-[11px] text-muted-foreground font-mono">
                {'{categoria_padrao}'} · {'{num_fases_padrao}'} · {'{bitola_cabo}'} · {'{disjuntor_padrao}'} · {'{classe_padrao}'} · {'{caixa_medicao}'}
              </p>
              <p className="text-[11px] text-muted-foreground">
                Ex.: projeto bifásico com disjuntor 63A → categoria B1, bitola 16 mm², caixa TIPO II.
              </p>
            </div>

            {/* Salvar */}
            {isAdmin && (
              <div className="flex justify-end gap-3">
                <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
                <Button onClick={handleSave} disabled={saveRules.isPending || !dirty}>
                  {saveRules.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Salvar regras
                </Button>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
