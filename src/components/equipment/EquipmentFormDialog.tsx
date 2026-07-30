import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useSaveEquipment, useAfciDaMarca, EquipmentType, EquipmentCatalogItem } from '@/hooks/useEquipmentCatalog';
import { Upload, Loader2, SlidersHorizontal, ChevronDown, ChevronRight } from 'lucide-react';

const UNIT: Record<EquipmentType, string> = { inverter: 'kW', module: 'Wp' };

/** Campos do datasheet estruturado (tech_specs) que o Motor de Engenharia usa. */
/** Campos que só fazem sentido no MICROINVERSOR — ele não tem janela de
 *  string: cada módulo entra numa entrada CC própria, e o que limita o
 *  projeto é quantos micros vão no mesmo ramal CA. */
const MICRO_FIELDS = [
  { key: 'dc_inputs', label: 'Entradas CC (módulos por micro)', placeholder: '4' },
  { key: 'micro_max_per_branch', label: 'Máx. de micros no mesmo ramal', placeholder: '3' },
];

const TECH_FIELDS: Record<EquipmentType, { key: string; label: string; placeholder: string }[]> = {
  inverter: [
    { key: 'mppt_count', label: 'Nº de MPPTs', placeholder: '2' },
    { key: 'strings_per_mppt', label: 'Strings por MPPT', placeholder: '2' },
    { key: 'mppt_vmin_v', label: 'Tensão mín. MPPT (V)', placeholder: '200' },
    { key: 'mppt_vmax_v', label: 'Tensão máx. MPPT (V)', placeholder: '800' },
    { key: 'max_dc_voltage_v', label: 'Tensão CC máx. (V)', placeholder: '1000' },
    { key: 'max_mppt_current_a', label: 'Corrente máx./MPPT (A)', placeholder: '26' },
    // base EXATA do disjuntor de cada arranjo (sem ela, o motor estima pela potência)
    { key: 'max_ac_current_a', label: 'Corrente CA máx. de saída (A)', placeholder: '36.2' },
    // sem isto o motor DEDUZ a fase pela potência: um inversor monofásico de
    // 3kW numa UC trifásica já saiu calculado como trifásico (corrente 3× menor
    // e disjuntor subdimensionado). A fase é do INVERSOR, não do padrão da UC.
    { key: 'ac_phases', label: 'Fases na saída CA (1, 2 ou 3)', placeholder: '1' },
    { key: 'ac_voltage_v', label: 'Tensão CA de saída (V)', placeholder: '220' },
  ],
  module: [
    { key: 'voc_v', label: 'Voc (V)', placeholder: '49.9' },
    { key: 'vmp_v', label: 'Vmp (V)', placeholder: '41.9' },
    { key: 'isc_a', label: 'Isc (A)', placeholder: '13.9' },
    { key: 'imp_a', label: 'Imp (A)', placeholder: '13.1' },
  ],
};

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
  const [afciFile, setAfciFile] = useState<File | null>(null);
  const dsRef = useRef<HTMLInputElement>(null);
  const inRef = useRef<HTMLInputElement>(null);
  const afciRef = useRef<HTMLInputElement>(null);
  // Datasheet estruturado (Motor de Engenharia) — abre expandido se já tem dados
  const [specs, setSpecs] = useState<Record<string, string>>(() =>
    Object.fromEntries([...TECH_FIELDS[type], ...MICRO_FIELDS]
      .map(f => [f.key, editing?.tech_specs?.[f.key] != null ? String(editing.tech_specs[f.key]) : ''])));
  const [specsOpen, setSpecsOpen] = useState(() => Object.values(editing?.tech_specs ?? {}).some(v => v != null));
  // microinversor: muda o conjunto de regras do motor (entradas CC e ramal CA
  // no lugar de janela de string)
  const [isMicro, setIsMicro] = useState(() => Number(editing?.tech_specs?.['is_microinverter']) === 1);

  const isInverter = type === 'inverter';
  // AFCI é documento da marca: se a marca já tem, não precisa anexar de novo.
  const { data: afciHerdado } = useAfciDaMarca(isInverter ? brand : '');

  const handleSave = async () => {
    if (!brand.trim() || !model.trim()) return;
    const powerNum = power.trim() === '' ? null : Number(power.replace(',', '.'));
    // só campos numéricos válidos entram; tudo vazio → limpa (null)
    const relevantes = new Set([
      ...TECH_FIELDS[type].map(f => f.key),
      ...(isInverter && isMicro ? MICRO_FIELDS.map(f => f.key) : []),
    ]);
    const techEntries = Object.entries(specs)
      .filter(([k]) => relevantes.has(k))
      .map(([k, v]) => [k, Number(String(v).replace(',', '.'))] as const)
      .filter(([, v]) => Number.isFinite(v) && v > 0);
    // marcador de microinversor vai como 1 (o tech_specs só guarda números)
    if (isInverter && isMicro) techEntries.push(['is_microinverter', 1]);
    const tech_specs = techEntries.length > 0 ? Object.fromEntries(techEntries) : null;
    const id = await save.mutateAsync({
      id: editing?.id, type, brand, model, power: powerNum,
      datasheetFile, inmetroFile, afciFile,
      datasheet_url: editing?.datasheet_url ?? null,
      inmetro_url: editing?.inmetro_url ?? null,
      afci_url: editing?.afci_url ?? null,
      tech_specs,
    });
    onSaved?.({ id, brand: brand.trim(), model: model.trim(), power: powerNum });
    onClose();
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? 'Editar equipamento' : `Novo ${isInverter ? 'inversor' : 'módulo'}`}</DialogTitle>
          <DialogDescription>
            {isInverter
              ? 'Cadastre o modelo e anexe datasheet, INMETRO e certificado AFCI'
              : 'Cadastre o modelo e anexe datasheet e INMETRO'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2"><Label>Marca *</Label><Input value={brand} onChange={e => setBrand(e.target.value)} placeholder="Ex: Growatt" /></div>
            <div className="space-y-2"><Label>Potência ({UNIT[type]})</Label><Input inputMode="decimal" value={power} onChange={e => setPower(e.target.value)} placeholder={type === 'inverter' ? '5' : '550'} /></div>
          </div>
          <div className="space-y-2"><Label>Modelo *</Label><Input value={model} onChange={e => setModel(e.target.value)} placeholder="Ex: MIN 5000TL-X" /></div>

          <FileRow label="Datasheet (PDF ou imagem)" file={datasheetFile} existing={editing?.datasheet_url} inputRef={dsRef} onPick={setDatasheetFile} />
          <FileRow label="Certificado INMETRO (PDF ou imagem)" file={inmetroFile} existing={editing?.inmetro_url} inputRef={inRef} onPick={setInmetroFile} />
          {isInverter && (
            <>
              <FileRow
                label="Certificado AFCI (PDF ou imagem)"
                file={afciFile}
                existing={editing?.afci_url ?? afciHerdado ?? undefined}
                inputRef={afciRef}
                onPick={setAfciFile}
              />
              {/* O AFCI é da marca: se já existe um, este modelo herda. */}
              {!editing?.afci_url && afciHerdado && !afciFile && (
                <p className="text-[11px] text-emerald-700 -mt-2">
                  A marca <strong>{brand.trim()}</strong> já tem certificado AFCI cadastrado —
                  este modelo vai usar o mesmo. Só anexe se for enviar uma versão nova.
                </p>
              )}
            </>
          )}
          <p className="text-[11px] text-muted-foreground">
            Aceita PDF, JPG ou PNG. Imagens são convertidas em PDF automaticamente, e o arquivo é renomeado no padrão <strong>TIPO MARCA MODELO</strong>.
          </p>

          {/* Datasheet estruturado — alimenta o Motor de Engenharia */}
          <div className="rounded-lg border border-border">
            <button
              type="button"
              onClick={() => setSpecsOpen(o => !o)}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm font-medium text-foreground"
            >
              {specsOpen ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
              <SlidersHorizontal className="w-4 h-4 text-primary" /> Dados técnicos (Motor de Engenharia)
            </button>
            {specsOpen && (
              <div className="px-3 pb-3 space-y-2">
                <p className="text-[11px] text-muted-foreground -mt-1">
                  Com estes dados, as sugestões de strings do motor ficam exatas
                  (sem eles, o motor usa os valores-padrão das Regras de Engenharia e avisa).
                </p>
                {isInverter && (
                  <label className="flex items-start gap-2 rounded-md border border-border px-2 py-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isMicro}
                      onChange={e => setIsMicro(e.target.checked)}
                      className="mt-0.5"
                    />
                    <span className="text-xs">
                      <strong>É um microinversor</strong>
                      <span className="block text-[11px] text-muted-foreground">
                        Muda as regras do motor: cada módulo entra numa entrada CC do micro (não há string)
                        e o limite passa a ser quantos micros vão no mesmo ramal CA.
                      </span>
                    </span>
                  </label>
                )}
                <div className="grid grid-cols-2 gap-2">
                  {isInverter && isMicro && MICRO_FIELDS.map(f => (
                    <div key={f.key} className="space-y-1">
                      <Label className="text-xs">{f.label}</Label>
                      <Input
                        inputMode="decimal"
                        value={specs[f.key] ?? ''}
                        onChange={e => setSpecs(prev => ({ ...prev, [f.key]: e.target.value }))}
                        placeholder={f.placeholder}
                      />
                    </div>
                  ))}
                  {TECH_FIELDS[type]
                    // com microinversor a janela de string não se aplica
                    .filter(f => !(isInverter && isMicro && f.key !== 'max_ac_current_a'))
                    .map(f => (
                    <div key={f.key} className="space-y-1">
                      <Label className="text-xs">{f.label}</Label>
                      <Input
                        inputMode="decimal"
                        value={specs[f.key] ?? ''}
                        onChange={e => setSpecs(prev => ({ ...prev, [f.key]: e.target.value }))}
                        placeholder={f.placeholder}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
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
