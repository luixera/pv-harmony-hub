import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useSaveEquipment, EquipmentType, EquipmentCatalogItem } from '@/hooks/useEquipmentCatalog';
import { Upload, Loader2 } from 'lucide-react';

const UNIT: Record<EquipmentType, string> = { inverter: 'kW', module: 'Wp' };

interface Props {
  type: EquipmentType;
  editing?: EquipmentCatalogItem | null;
  initialBrand?: string;
  initialModel?: string;
  onClose: () => void;
  onSaved?: (item: { id: string; brand: string; model: string; power: number | null }) => void;
}

export function EquipmentFormDialog({ type, editing, initialBrand, initialModel, onClose, onSaved }: Props) {
  const save = useSaveEquipment();
  const [brand, setBrand] = useState(editing?.brand ?? initialBrand ?? '');
  const [model, setModel] = useState(editing?.model ?? initialModel ?? '');
  const [power, setPower] = useState(editing?.power != null ? String(editing.power) : '');
  const [datasheetFile, setDatasheetFile] = useState<File | null>(null);
  const [inmetroFile, setInmetroFile] = useState<File | null>(null);
  const dsRef = useRef<HTMLInputElement>(null);
  const inRef = useRef<HTMLInputElement>(null);

  const handleSave = async () => {
    if (!brand.trim() || !model.trim()) return;
    const powerNum = power.trim() === '' ? null : Number(power.replace(',', '.'));
    const id = await save.mutateAsync({
      id: editing?.id, type, brand, model, power: powerNum,
      datasheetFile, inmetroFile,
      datasheet_url: editing?.datasheet_url ?? null,
      inmetro_url: editing?.inmetro_url ?? null,
    });
    onSaved?.({ id, brand: brand.trim(), model: model.trim(), power: powerNum });
    onClose();
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? 'Editar equipamento' : `Novo ${type === 'inverter' ? 'inversor' : 'módulo'}`}</DialogTitle>
          <DialogDescription>Cadastre o modelo e anexe datasheet e INMETRO</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2"><Label>Marca *</Label><Input value={brand} onChange={e => setBrand(e.target.value)} placeholder="Ex: Growatt" /></div>
            <div className="space-y-2"><Label>Potência ({UNIT[type]})</Label><Input inputMode="decimal" value={power} onChange={e => setPower(e.target.value)} placeholder={type === 'inverter' ? '5' : '550'} /></div>
          </div>
          <div className="space-y-2"><Label>Modelo *</Label><Input value={model} onChange={e => setModel(e.target.value)} placeholder="Ex: MIN 5000TL-X" /></div>

          <FileRow label="Datasheet (PDF ou imagem)" file={datasheetFile} existing={editing?.datasheet_url} inputRef={dsRef} onPick={setDatasheetFile} />
          <FileRow label="Certificado INMETRO (PDF ou imagem)" file={inmetroFile} existing={editing?.inmetro_url} inputRef={inRef} onPick={setInmetroFile} />
          <p className="text-[11px] text-muted-foreground">
            Aceita PDF, JPG ou PNG. Imagens são convertidas em PDF automaticamente, e o arquivo é renomeado no padrão <strong>TIPO MARCA MODELO</strong>.
          </p>
        </div>
        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button variant="cta" onClick={handleSave} disabled={save.isPending || !brand.trim() || !model.trim()}>
            {save.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {editing ? 'Salvar' : 'Cadastrar'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function FileRow({ label, file, existing, inputRef, onPick }: {
  label: string; file: File | null; existing?: string | null;
  inputRef: React.RefObject<HTMLInputElement>; onPick: (f: File | null) => void;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <input ref={inputRef} type="file" accept=".pdf,.jpg,.jpeg,.png,image/jpeg,image/png,application/pdf" className="hidden" onChange={e => onPick(e.target.files?.[0] ?? null)} />
      <button type="button" onClick={() => inputRef.current?.click()}
        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-border bg-muted/30 text-sm text-muted-foreground hover:bg-muted/50">
        <Upload className="w-4 h-4" />
        {file ? file.name : existing ? 'Substituir arquivo (já anexado)' : 'Selecionar PDF'}
      </button>
    </div>
  );
}
