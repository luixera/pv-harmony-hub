import { useState, useEffect } from 'react';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Database } from '@/integrations/supabase/types';

type StaffAccessMode = Database['public']['Enums']['staff_access_mode'];

interface StaffAccessSettingsProps {
  staffAccessMode: StaffAccessMode | null;
  hideCompanyName: boolean;
  onChange: (settings: { staffAccessMode: StaffAccessMode; hideCompanyName: boolean }) => void;
  disabled?: boolean;
}

export function StaffAccessSettings({
  staffAccessMode,
  hideCompanyName,
  onChange,
  disabled = false,
}: StaffAccessSettingsProps) {
  const [mode, setMode] = useState<StaffAccessMode>(staffAccessMode || 'global');
  const [hideCompany, setHideCompany] = useState(hideCompanyName || false);

  useEffect(() => {
    setMode(staffAccessMode || 'global');
    setHideCompany(hideCompanyName || false);
  }, [staffAccessMode, hideCompanyName]);

  const handleModeChange = (value: StaffAccessMode) => {
    setMode(value);
    onChange({ staffAccessMode: value, hideCompanyName: hideCompany });
  };

  const handleHideCompanyChange = (checked: boolean) => {
    setHideCompany(checked);
    onChange({ staffAccessMode: mode, hideCompanyName: checked });
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
