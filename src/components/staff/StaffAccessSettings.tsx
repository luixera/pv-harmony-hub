import { useState, useEffect } from 'react';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
        <Select value={mode} onValueChange={handleModeChange} disabled={disabled}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="global">
              <div className="flex flex-col">
                <span>Acesso Global</span>
                <span className="text-xs text-muted-foreground">
                  Visualiza todos os projetos
                </span>
              </div>
            </SelectItem>
            <SelectItem value="assigned_only">
              <div className="flex flex-col">
                <span>Apenas Projetos Atribuídos</span>
                <span className="text-xs text-muted-foreground">
                  Visualiza apenas projetos designados
                </span>
              </div>
            </SelectItem>
          </SelectContent>
        </Select>
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
