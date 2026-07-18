import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PlugZap, Plus, Trash2, Loader2, Info, Wand2, Columns3, X } from 'lucide-react';
import { EnergyConcessionaire } from '@/hooks/useEnergyConcessionaires';
import { useEntryRules, useSaveEntryRules, EntryRuleDraft, slugifyColumn } from '@/hooks/useEntryRules';
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
  /** Valores das colunas customizadas: { "Rótulo": "valor" }. */
  extra: Record<string, string>;
}

const EMPTY_ROW: DraftRow = { categoria: '', num_fases: '', bitola: '', disjuntor: '', classe: '', caixa_medicao: '', extra: {} };

/** Exemplo real da CPFL — ponto de partida editável. */
const CPFL_PRESET: DraftRow[] = [
  { categoria: 'B1', num_fases: '2', bitola: '16', disjuntor: '63',  classe: 'BIFÁSICO',  caixa_medicao: 'TIPO II', extra: {} },
  { categoria: 'B2', num_fases: '2', bitola: '25', disjuntor: '80',  classe: 'BIFÁSICO',  caixa_medicao: 'TIPO II', extra: {} },
  { categoria: 'C1', num_fases: '3', bitola: '16', disjuntor: '63',  classe: 'TRIFÁSICO', caixa_medicao: 'TIPO II', extra: {} },
  { categoria: 'C2', num_fases: '3', bitola: '25', disjuntor: '80',  classe: 'TRIFÁSICO', caixa_medicao: 'TIPO II', extra: {} },
  { categoria: 'C3', num_fases: '3', bitola: '35', disjuntor: '100', classe: 'TRIFÁSICO', caixa_medicao: 'TIPO II', extra: {} },
  { categoria: 'C4', num_fases: '3', bitola: '50', disjuntor: '125', classe: 'TRIFÁSICO', caixa_medicao: 'TIPO III', extra: {} },
  { categoria: 'C5', num_fases: '3', bitola: '75', disjuntor: '150', classe: 'TRIFÁSICO', caixa_medicao: 'TIPO III', extra: {} },
  { categoria: 'C6', num_fases: '3', bitola: '95', disjuntor: '200', classe: 'TRIFÁSICO', caixa_medicao: 'CAIXA H', extra: {} },
];

export function EntryRulesDialog({ open, onOpenChange, concessionaire }: EntryRulesDialogProps) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const { data: rules = [], isLoading } = useEntryRules(concessionaire?.id);
  const saveRules = useSaveEntryRules();

  const [rows, setRows] = useState<DraftRow[]>([]);
  const [customCols, setCustomCols] = useState<string[]>([]); // rótulos das colunas extras
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
      extra: { ...(r.extra ?? {}) },
    })));
    // Colunas customizadas = união dos rótulos presentes nas linhas
    const cols = new Set<string>();
    for (const r of rules) for (const k of Object.keys(r.extra ?? {})) cols.add(k);
    setCustomCols([...cols]);
    setDeletedIds([]);
    setDirty(false);
  }, [open, rules]);

  const updateRow = (i: number, field: 'categoria' | 'num_fases' | 'bitola' | 'disjuntor' | 'classe' | 'caixa_medicao', value: string) => {
    setRows(prev => prev.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)));
    setDirty(true);
  };

  const updateExtra = (i: number, col: string, value: string) => {
    setRows(prev => prev.map((r, idx) => (idx === i ? { ...r, extra: { ...r.extra, [col]: value } } : r)));
    setDirty(true);
  };

  const addRow = () => {
    const extra: Record<string, string> = {};
    for (const c of customCols) extra[c] = '';
    setRows(prev => [...prev, { ...EMPTY_ROW, extra }]);
    setDirty(true);
  };

  const removeRow = (i: number) => {
    const row = rows[i];
    if (row.id) setDeletedIds(prev => [...prev, row.id!]);
    setRows(prev => prev.filter((_, idx) => idx !== i));
    setDirty(true);
  };

  const addColumn = () => {
    const label = window.prompt('Nome da nova coluna (ex.: Ramal de Entrada):')?.trim();
    if (!label) return;
    if (customCols.some(c => c.toLowerCase() === label.toLowerCase())) {
      toast.error('Já existe uma coluna com esse nome'); return;
    }
    const slug = slugifyColumn(label);
    if (!slug) { toast.error('Nome de coluna inválido'); return; }
    setCustomCols(prev => [...prev, label]);
    setRows(prev => prev.map(r => ({ ...r, extra: { ...r.extra, [label]: '' } })));
    setDirty(true);
    toast.success(`Coluna "${label}" adicionada → variável {${slug}}`);
  };

  const removeColumn = (label: string) => {
    if (!window.confirm(`Remover a coluna "${label}" de todas as linhas?`)) return;
    setCustomCols(prev => prev.filter(c => c !== label));
    setRows(prev => prev.map(r => {
      const { [label]: _, ...rest } = r.extra;
      return { ...r, extra: rest };
    }));
    setDirty(true);
  };

  const applyPreset = () => {
    // preserva ids das linhas atuais para exclusão
    setDeletedIds(prev => [...prev, ...rows.filter(r => r.id).map(r => r.id!)]);
    setRows(CPFL_PRESET.map(r => ({ ...r, extra: {} })));
    setCustomCols([]);
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
      // guarda só as colunas customizadas ativas
      extra: Object.fromEntries(customCols.map(c => [c, r.extra[c] ?? ''])),
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
                <Button variant="outline" size="sm" onClick={addColumn} className="gap-1">
                  <Columns3 className="w-4 h-4" /> Adicionar coluna
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
                      {customCols.map(col => (
                        <th key={col} className="px-2 py-2 font-medium text-xs whitespace-nowrap">
                          <span className="inline-flex items-center gap-1">
                            {col}
                            {isAdmin && (
                              <button type="button" onClick={() => removeColumn(col)} title="Remover coluna"
                                className="text-muted-foreground hover:text-destructive">
                                <X className="w-3 h-3" />
                              </button>
                            )}
                          </span>
                        </th>
                      ))}
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
                        {customCols.map(col => (
                          <td key={col} className="px-1 py-1">
                            <Input value={row.extra[col] ?? ''} onChange={e => updateExtra(i, col, e.target.value)}
                              disabled={!isAdmin} className="h-8 text-sm w-28" />
                          </td>
                        ))}
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
                {customCols.map(col => <span key={col}> · {`{${slugifyColumn(col)}}`}</span>)}
              </p>
              <p className="text-[11px] text-muted-foreground">
                Ex.: projeto bifásico com disjuntor 63A → categoria B1, bitola 16 mm², caixa TIPO II.
                {customCols.length > 0 && ' As colunas que você adicionar viram variáveis pelo nome (sem acento/espaços).'}
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
