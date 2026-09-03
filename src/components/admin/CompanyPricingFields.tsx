import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Plus, Trash2, Bolt, CircleDollarSign, CalendarClock, Layers, Pencil } from 'lucide-react';

export type PricingType = 'manual' | 'fixed' | 'per_kwp' | 'tiered_kwp' | 'tiered_flat' | 'monthly';

export interface PricingTierRow { up_to: string; rate: string }
/** Faixa com preço fixo: de/até potência → valor único do projeto. */
export interface PricingFlatRow { from: string; to: string; price: string }

export interface PricingState {
  pricing_type: PricingType;
  pricing_fixed_value: string;
  pricing_kwp_rate: string;
  pricing_tiers: PricingTierRow[];
  pricing_flat_tiers: PricingFlatRow[];
  pricing_monthly_value: string;
  pricing_monthly_limit: string;
  pricing_excess_value: string;
  /** Dia do vencimento da mensalidade (1-31). Vazio = ultimo dia do mes. */
  pricing_due_day: string;
}

export const emptyPricing: PricingState = {
  pricing_type: 'manual',
  pricing_fixed_value: '',
  pricing_kwp_rate: '',
  pricing_tiers: [{ up_to: '', rate: '' }],
  pricing_flat_tiers: [{ from: '', to: '', price: '' }],
  pricing_monthly_value: '',
  pricing_monthly_limit: '',
  pricing_excess_value: '',
  pricing_due_day: '',
};

const TYPES: { value: PricingType; label: string; desc: string; icon: React.ElementType }[] = [
  { value: 'manual', label: 'Manual', desc: 'Digita o valor em cada projeto (como hoje)', icon: Pencil },
  { value: 'fixed', label: 'Valor fixo por projeto', desc: 'Todo projeto vale o mesmo', icon: CircleDollarSign },
  { value: 'per_kwp', label: 'Valor por kWp', desc: 'Potência × valor por kWp', icon: Bolt },
  { value: 'tiered_kwp', label: 'Faixas por kWp', desc: 'Valor por kWp muda conforme a potência', icon: Layers },
  { value: 'tiered_flat', label: 'Faixa de potência (preço fixo)', desc: 'De X até Y kWp → um valor fechado por projeto', icon: Layers },
  { value: 'monthly', label: 'Assinatura mensal', desc: 'Mensalidade cobre até N projetos/mês', icon: CalendarClock },
];

/** Converte o estado (strings) para o payload numérico salvo em companies. */
export function pricingToPayload(p: PricingState): Record<string, unknown> {
  const num = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')));
  let tiers: Record<string, number | null>[] = [];
  if (p.pricing_type === 'tiered_kwp') {
    tiers = p.pricing_tiers
      .filter(t => t.rate.trim() !== '')
      .map(t => ({ up_to: t.up_to.trim() === '' ? null : Number(t.up_to.replace(',', '.')), rate: Number(t.rate.replace(',', '.')) }));
  } else if (p.pricing_type === 'tiered_flat') {
    tiers = p.pricing_flat_tiers
      .filter(t => t.price.trim() !== '')
      .map(t => ({
        from: t.from.trim() === '' ? 0 : Number(t.from.replace(',', '.')),
        to: t.to.trim() === '' ? null : Number(t.to.replace(',', '.')),
        price: Number(t.price.replace(',', '.')),
      }));
  }
  return {
    pricing_type: p.pricing_type,
    pricing_fixed_value: p.pricing_type === 'fixed' ? num(p.pricing_fixed_value) : null,
    pricing_kwp_rate: p.pricing_type === 'per_kwp' ? num(p.pricing_kwp_rate) : null,
    pricing_tiers: tiers,
    pricing_monthly_value: p.pricing_type === 'monthly' ? num(p.pricing_monthly_value) : null,
    pricing_monthly_limit: p.pricing_type === 'monthly' ? (p.pricing_monthly_limit.trim() === '' ? null : parseInt(p.pricing_monthly_limit)) : null,
    pricing_excess_value: p.pricing_type === 'monthly' ? num(p.pricing_excess_value) : null,
    // Vencimento so faz sentido na assinatura; vazio = ultimo dia do mes
    pricing_due_day: p.pricing_type === 'monthly' && p.pricing_due_day.trim() !== ''
      ? Math.min(31, Math.max(1, parseInt(p.pricing_due_day, 10) || 1))
      : null,
  };
}

/** Extrai o estado de precificação de um registro de empresa (campos podem não existir nos tipos gerados). */
export function pricingFromCompany(c: Record<string, unknown> | null | undefined): PricingState {
  if (!c) return { ...emptyPricing };
  const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));
  const rawTiers = Array.isArray(c.pricing_tiers) ? (c.pricing_tiers as Record<string, unknown>[]) : [];
  const ptype = (c.pricing_type as PricingType) || 'manual';
  // O mesmo jsonb guarda dois formatos; separa por tipo de precificação.
  const kwpTiers = ptype === 'tiered_kwp'
    ? rawTiers.map(t => ({ up_to: t.up_to == null ? '' : String(t.up_to), rate: String(t.rate ?? '') }))
    : [];
  const flatTiers = ptype === 'tiered_flat'
    ? rawTiers.map(t => ({ from: t.from == null ? '' : String(t.from), to: t.to == null ? '' : String(t.to), price: String(t.price ?? '') }))
    : [];
  return {
    pricing_type: ptype,
    pricing_fixed_value: s(c.pricing_fixed_value),
    pricing_kwp_rate: s(c.pricing_kwp_rate),
    pricing_tiers: kwpTiers.length ? kwpTiers : [{ up_to: '', rate: '' }],
    pricing_flat_tiers: flatTiers.length ? flatTiers : [{ from: '', to: '', price: '' }],
    pricing_monthly_value: s(c.pricing_monthly_value),
    pricing_monthly_limit: s(c.pricing_monthly_limit),
    pricing_due_day: s(c.pricing_due_day),
    pricing_excess_value: s(c.pricing_excess_value),
  };
}

export function CompanyPricingFields({ value, onChange }: { value: PricingState; onChange: (p: PricingState) => void }) {
  const set = (patch: Partial<PricingState>) => onChange({ ...value, ...patch });

  const setTier = (i: number, patch: Partial<PricingTierRow>) => {
    const tiers = value.pricing_tiers.map((t, idx) => (idx === i ? { ...t, ...patch } : t));
    set({ pricing_tiers: tiers });
  };
  const addTier = () => set({ pricing_tiers: [...value.pricing_tiers, { up_to: '', rate: '' }] });
  const removeTier = (i: number) => set({ pricing_tiers: value.pricing_tiers.filter((_, idx) => idx !== i) });

  const setFlat = (i: number, patch: Partial<PricingFlatRow>) => {
    set({ pricing_flat_tiers: value.pricing_flat_tiers.map((t, idx) => (idx === i ? { ...t, ...patch } : t)) });
  };
  const addFlat = () => set({ pricing_flat_tiers: [...value.pricing_flat_tiers, { from: '', to: '', price: '' }] });
  const removeFlat = (i: number) => set({ pricing_flat_tiers: value.pricing_flat_tiers.filter((_, idx) => idx !== i) });

  return (
    <div className="pt-3 border-t border-border space-y-3">
      <Label className="text-sm font-semibold">Precificação dos projetos</Label>

      {/* Seletor de tipo */}
      <div className="grid grid-cols-1 gap-1.5">
        {TYPES.map(t => {
          const active = value.pricing_type === t.value;
          return (
            <button
              key={t.value}
              type="button"
              onClick={() => set({ pricing_type: t.value })}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors border ${active ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/40'}`}
            >
              <t.icon className={`w-4 h-4 flex-shrink-0 ${active ? 'text-primary' : 'text-muted-foreground'}`} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-foreground">{t.label}</div>
                <div className="text-xs text-muted-foreground">{t.desc}</div>
              </div>
              {active && <div className="w-2 h-2 rounded-full bg-primary flex-shrink-0" />}
            </button>
          );
        })}
      </div>

      {/* Campos por tipo */}
      {value.pricing_type === 'fixed' && (
        <div className="space-y-2">
          <Label className="text-xs">Valor por projeto (R$)</Label>
          <Input inputMode="decimal" value={value.pricing_fixed_value} onChange={e => set({ pricing_fixed_value: e.target.value })} placeholder="250,00" />
        </div>
      )}

      {value.pricing_type === 'per_kwp' && (
        <div className="space-y-2">
          <Label className="text-xs">Valor por kWp (R$)</Label>
          <Input inputMode="decimal" value={value.pricing_kwp_rate} onChange={e => set({ pricing_kwp_rate: e.target.value })} placeholder="60,00" />
        </div>
      )}

      {value.pricing_type === 'tiered_kwp' && (
        <div className="space-y-2">
          <Label className="text-xs">Faixas — valor por kWp conforme a potência</Label>
          <div className="space-y-2">
            {value.pricing_tiers.map((tier, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground w-8">até</span>
                <Input inputMode="decimal" value={tier.up_to} onChange={e => setTier(i, { up_to: e.target.value })} placeholder="5" className="w-20" />
                <span className="text-xs text-muted-foreground">kWp →</span>
                <span className="text-xs text-muted-foreground">R$</span>
                <Input inputMode="decimal" value={tier.rate} onChange={e => setTier(i, { rate: e.target.value })} placeholder="70,00" className="flex-1" />
                <span className="text-xs text-muted-foreground">/kWp</span>
                <Button type="button" variant="ghost" size="icon" onClick={() => removeTier(i)} disabled={value.pricing_tiers.length <= 1}>
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            ))}
          </div>
          <Button type="button" variant="outline" size="sm" onClick={addTier} className="w-full">
            <Plus className="w-4 h-4 mr-1" /> Adicionar faixa
          </Button>
          <p className="text-[11px] text-muted-foreground">
            Deixe o campo "até" vazio na última faixa para valer <strong>acima de tudo</strong>. Ex.: até 5 kWp → R$70; (vazio) → R$55.
          </p>
        </div>
      )}

      {value.pricing_type === 'tiered_flat' && (
        <div className="space-y-2">
          <Label className="text-xs">Faixas de potência — cada faixa tem um valor fechado</Label>
          <div className="space-y-2">
            {value.pricing_flat_tiers.map((tier, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">de</span>
                <Input inputMode="decimal" value={tier.from} onChange={e => setFlat(i, { from: e.target.value })} placeholder="0" className="w-16" />
                <span className="text-xs text-muted-foreground">até</span>
                <Input inputMode="decimal" value={tier.to} onChange={e => setFlat(i, { to: e.target.value })} placeholder="5" className="w-16" />
                <span className="text-xs text-muted-foreground">kWp = R$</span>
                <Input inputMode="decimal" value={tier.price} onChange={e => setFlat(i, { price: e.target.value })} placeholder="250,00" className="flex-1" />
                <Button type="button" variant="ghost" size="icon" onClick={() => removeFlat(i)} disabled={value.pricing_flat_tiers.length <= 1}>
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            ))}
          </div>
          <Button type="button" variant="outline" size="sm" onClick={addFlat} className="w-full">
            <Plus className="w-4 h-4 mr-1" /> Adicionar faixa
          </Button>
          <p className="text-[11px] text-muted-foreground">
            Ex.: de 0 até 5 kWp → R$250; de 5 até 10 → R$350; de 10 até (vazio) → R$500.
            Deixe o "até" da última faixa vazio para <strong>sem limite superior</strong>. No valor exato do limite (ex.: 5 kWp), vale a faixa que termina nele.
          </p>
        </div>
      )}

      {value.pricing_type === 'monthly' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Mensalidade (R$)</Label>
              <Input inputMode="decimal" value={value.pricing_monthly_value} onChange={e => set({ pricing_monthly_value: e.target.value })} placeholder="1200,00" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Projetos cobertos/mês</Label>
              <Input inputMode="numeric" value={value.pricing_monthly_limit} onChange={e => set({ pricing_monthly_limit: e.target.value })} placeholder="20" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Dia do vencimento</Label>
              <Input inputMode="numeric" value={value.pricing_due_day}
                onChange={e => set({ pricing_due_day: e.target.value.replace(/[^0-9]/g, '').slice(0, 2) })}
                placeholder="30" />
              <p className="text-[10px] text-muted-foreground">Vazio = último dia do mês. Dia 30 em fevereiro cai no dia 28.</p>
            </div>
            <div className="space-y-1" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Valor por projeto excedente (R$)</Label>
            <Input inputMode="decimal" value={value.pricing_excess_value} onChange={e => set({ pricing_excess_value: e.target.value })} placeholder="180,00" />
          </div>
          <p className="text-[11px] text-muted-foreground">
            Dentro do limite, o valor do projeto é R$0 (coberto pela mensalidade). Acima do limite, cada projeto recebe o valor excedente.
          </p>
        </div>
      )}

      {value.pricing_type !== 'manual' && (
        <p className="text-[11px] text-muted-foreground">
          O valor será preenchido automaticamente ao entrar um projeto — e continua editável no financeiro.
        </p>
      )}
    </div>
  );
}
