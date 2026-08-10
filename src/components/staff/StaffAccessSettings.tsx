import { useState, useEffect } from 'react';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Database } from '@/integrations/supabase/types';

type StaffAccessMode = Database['public']['Enums']['staff_access_mode'];

interface StaffAccessSettingsProps {
  staffAccessMode: StaffAccessMode | null;
  hideCompanyName: boolean;
  /** Empresas ligadas ao projetista (só valem no modo "apenas atribuídos"). */
  companyIds?: string[];
  /** Empresas do tenant, pra montar a lista. */
  companies?: { id: string; name: string }[];
  onChange: (settings: {
    staffAccessMode: StaffAccessMode;
    hideCompanyName: boolean;
    companyIds: string[];
  }) => void;
  disabled?: boolean;
}

export function StaffAccessSettings({
  staffAccessMode,
  hideCompanyName,
  companyIds = [],
  companies = [],
  onChange,
  disabled = false,
}: StaffAccessSettingsProps) {
  const [mode, setMode] = useState<StaffAccessMode>(staffAccessMode || 'global');
  const [hideCompany, setHideCompany] = useState(hideCompanyName || false);
  const [empresas, setEmpresas] = useState<string[]>(companyIds);

  useEffect(() => {
    setMode(staffAccessMode || 'global');
    setHideCompany(hideCompanyName || false);
  }, [staffAccessMode, hideCompanyName]);

  useEffect(() => { setEmpresas(companyIds); }, [companyIds.join(',')]);

  const handleModeChange = (value: StaffAccessMode) => {
    setMode(value);
    onChange({ staffAccessMode: value, hideCompanyName: hideCompany, companyIds: empresas });
  };

  const handleHideCompanyChange = (checked: boolean) => {
    setHideCompany(checked);
    onChange({ staffAccessMode: mode, hideCompanyName: checked, companyIds: empresas });
  };

  const alternarEmpresa = (id: string) => {
    const proximo = empresas.includes(id) ? empresas.filter(e => e !== id) : [...empresas, id];
    setEmpresas(proximo);
    onChange({ staffAccessMode: mode, hideCompanyName: hideCompany, companyIds: proximo });
  };

  return (
    <div className="space-y-4 pt-2 border-t border-border/50">
      <h4 className="text-sm font-medium text-muted-foreground">Configurações de Acesso (Staff)</h4>
      
      <div className="space-y-2">
        <Label>Modo de Acesso</Label>
        <div className="grid grid-cols-2 gap-2">
          {([
            { value: 'global', label: 'Acesso Global', sub: 'Visualiza todos os projetos' },
            { value: 'assigned_only', label: 'Apenas Atribuídos', sub: 'Somente projetos designados' },
          ] as { value: StaffAccessMode; label: string; sub: string }[]).map(opt => (
            <button
              key={opt.value}
              type="button"
              disabled={disabled}
              onClick={() => handleModeChange(opt.value)}
              className={[
                'py-2 px-3 rounded-md border text-left text-sm transition-colors',
                mode === opt.value
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-background border-input hover:bg-muted text-foreground',
                disabled ? 'opacity-50 cursor-not-allowed' : '',
              ].join(' ')}
            >
              <div className="font-medium leading-tight">{opt.label}</div>
              <div className={['text-xs mt-0.5 leading-tight', mode === opt.value ? 'text-primary-foreground/70' : 'text-muted-foreground'].join(' ')}>{opt.sub}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Empresas do projetista — só fazem sentido no modo restrito, porque no
          global ele já enxerga tudo. Ligar uma empresa vale pra TODO projeto
          dela, inclusive os que chegarem depois: é o que dispensa atribuir
          projeto a projeto. */}
      {mode === 'assigned_only' && (
        <div className="space-y-2">
          <Label>Empresas atendidas por este projetista</Label>
          <p className="text-xs text-muted-foreground">
            Ele passa a ver todos os projetos das empresas marcadas — os de hoje e os
            que chegarem depois — além dos projetos atribuídos a ele individualmente.
          </p>
          {companies.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">Nenhuma empresa cadastrada.</p>
          ) : (
            <div className="max-h-40 overflow-y-auto rounded-md border border-input divide-y divide-border/50">
              {companies.map(c => (
                <button
                  key={c.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => alternarEmpresa(c.id)}
                  className={[
                    'w-full flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors',
                    empresas.includes(c.id) ? 'bg-primary/10 text-foreground' : 'hover:bg-muted',
                    disabled ? 'opacity-50 cursor-not-allowed' : '',
                  ].join(' ')}
                >
                  <span
                    className={[
                      'w-4 h-4 rounded border flex items-center justify-center text-[10px] shrink-0',
                      empresas.includes(c.id) ? 'bg-primary border-primary text-primary-foreground' : 'border-input',
                    ].join(' ')}
                  >
                    {empresas.includes(c.id) ? '✓' : ''}
                  </span>
                  {c.name}
                </button>
              ))}
            </div>
          )}
          {empresas.length > 1 && hideCompany && (
            <p className="text-xs text-amber-600">
              Com o nome da empresa oculto e mais de uma empresa marcada, este projetista
              não poderá criar projetos — não teria como escolher a empresa certa.
            </p>
          )}
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label>Ocultar Nome da Empresa</Label>
          <p className="text-xs text-muted-foreground">
            Esconde o nome da empresa nos projetos
          </p>
        </div>
        <Switch
          checked={hideCompany}
          onCheckedChange={handleHideCompanyChange}
          disabled={disabled}
        />
      </div>
    </div>
  );
}
