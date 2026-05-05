import { useState, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { FormConfig, FormField } from '@/hooks/useFormConfig';
import { AlertCircle, Upload } from 'lucide-react';
import { cn } from '@/lib/utils';

interface FormPreviewProps {
  config: FormConfig;
}

const brazilianStates = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA',
  'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN',
  'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'
];

const fieldGroupLabels: Record<string, string> = {
  titular: 'Dados do Titular',
  endereco: 'Endereço do Imóvel',
  unidade_consumidora: 'Dados da Unidade Consumidora',
  inversor: 'Inversor',
  modulo: 'Módulos Fotovoltaicos',
  anexos: 'Anexos e Observações'
};

const tabGroups = {
  'Informações do Titular': ['titular', 'endereco', 'unidade_consumidora'],
  'Lista de Equipamentos': ['inversor', 'modulo'],
  'Anexos e Observações': ['anexos']
};

export function FormPreview({ config }: FormPreviewProps) {
  const [formValues, setFormValues] = useState<Record<string, string | boolean>>({});
  const [currentTab, setCurrentTab] = useState(0);

  const tabs = Object.keys(tabGroups);

  // Calculate field visibility and requirements based on rules
  const fieldStates = useMemo(() => {
    const states: Record<string, { visible: boolean; required: boolean }> = {};
    
    config.fields?.forEach((field) => {
      let visible = field.is_visible;
      let required = field.is_required;

      // Process rules
      field.rules?.forEach((rule) => {
        const conditionValue = formValues[rule.condition_field_key];
        let conditionMet = false;

        switch (rule.condition_operator) {
          case 'is_checked':
            conditionMet = conditionValue === true;
            break;
          case 'is_not_checked':
            conditionMet = conditionValue !== true;
            break;
          case 'is_empty':
            conditionMet = !conditionValue || conditionValue === '';
            break;
          case 'is_not_empty':
            conditionMet = !!conditionValue && conditionValue !== '';
            break;
          case 'equals':
            conditionMet = conditionValue === rule.condition_value;
            break;
          case 'not_equals':
            conditionMet = conditionValue !== rule.condition_value;
            break;
          case 'contains':
            conditionMet = typeof conditionValue === 'string' && 
              conditionValue.includes(rule.condition_value || '');
            break;
        }

        if (conditionMet) {
          switch (rule.action) {
            case 'show':
              visible = true;
              break;
            case 'hide':
              visible = false;
              break;
            case 'require':
              required = true;
              break;
            case 'optional':
              required = false;
              break;
          }
        }
      });

      states[field.field_key] = { visible, required };
    });

    return states;
  }, [config.fields, formValues]);

  const handleValueChange = (fieldKey: string, value: string | boolean) => {
    setFormValues(prev => ({ ...prev, [fieldKey]: value }));
  };

  const renderField = (field: FormField) => {
    const state = fieldStates[field.field_key];
    if (!state?.visible) return null;

    const value = formValues[field.field_key];

    return (
      <div key={field.id} className="space-y-2">
        <div className="flex items-center gap-2">
          <Label htmlFor={field.field_key} className={cn(
            state.required && "after:content-['*'] after:ml-0.5 after:text-destructive"
          )}>
            {field.field_label}
          </Label>
          {field.rules && field.rules.length > 0 && (
            <Badge variant="outline" className="text-xs">Condicional</Badge>
          )}
        </div>
        
        {renderFieldInput(field, value, state.required)}
        
        {field.helper_text && (
          <p className="text-xs text-muted-foreground">{field.helper_text}</p>
        )}
      </div>
    );
  };

  const renderFieldInput = (field: FormField, value: string | boolean | undefined, required: boolean) => {
    switch (field.field_type) {
      case 'text':
      case 'email':
      case 'phone':
      case 'cpf':
      case 'cnpj':
      case 'cep':
        return (
          <Input
            id={field.field_key}
            type={field.field_type === 'email' ? 'email' : 'text'}
            placeholder={field.placeholder || ''}
            value={value as string || ''}
            onChange={(e) => handleValueChange(field.field_key, e.target.value)}
            className="bg-background"
          />
        );

      case 'number':
        return (
          <Input
            id={field.field_key}
            type="number"
            placeholder={field.placeholder || ''}
            value={value as string || ''}
            onChange={(e) => handleValueChange(field.field_key, e.target.value)}
            className="bg-background"
          />
        );

      case 'textarea':
        return (
          <Textarea
            id={field.field_key}
            placeholder={field.placeholder || ''}
            value={value as string || ''}
            onChange={(e) => handleValueChange(field.field_key, e.target.value)}
            className="bg-background"
            rows={4}
          />
        );

      case 'checkbox':
        return (
          <div className="flex items-center gap-2">
            <Checkbox
              id={field.field_key}
              checked={value as boolean || false}
              onCheckedChange={(checked) => handleValueChange(field.field_key, checked as boolean)}
            />
            <Label htmlFor={field.field_key} className="text-sm font-normal cursor-pointer">
              {field.helper_text || 'Sim'}
            </Label>
          </div>
        );

      case 'radio':
        if (field.field_key === 'phase_type') {
          return (
            <RadioGroup
              value={value as string || ''}
              onValueChange={(val) => handleValueChange(field.field_key, val)}
              className="flex gap-4"
            >
              {['Monofásico', 'Bifásico', 'Trifásico'].map((option) => (
                <div key={option} className="flex items-center gap-2">
                  <RadioGroupItem value={option} id={`${field.field_key}-${option}`} />
                  <Label htmlFor={`${field.field_key}-${option}`} className="font-normal">
                    {option}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          );
        }
        return null;

      case 'select':
        if (field.field_key === 'state') {
          return (
            <Select
              value={value as string || ''}
              onValueChange={(val) => handleValueChange(field.field_key, val)}
            >
              <SelectTrigger className="bg-background">
                <SelectValue placeholder="Selecione o estado" />
              </SelectTrigger>
              <SelectContent>
                {brazilianStates.map((state) => (
                  <SelectItem key={state} value={state}>{state}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          );
        }
        return null;

      case 'file':
        return (
          <div className="border-2 border-dashed rounded-lg p-4 text-center bg-muted/50 hover:bg-muted transition-colors cursor-pointer">
            <Upload className="w-6 h-6 mx-auto text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">
              Clique para selecionar ou arraste um arquivo
            </p>
          </div>
        );

      default:
        return (
          <Input
            id={field.field_key}
            placeholder={field.placeholder || ''}
            value={value as string || ''}
            onChange={(e) => handleValueChange(field.field_key, e.target.value)}
            className="bg-background"
          />
        );
    }
  };

  // Group fields by tab
  const getFieldsForTab = (tabIndex: number) => {
    const tabName = tabs[tabIndex];
    const groups = tabGroups[tabName as keyof typeof tabGroups] || [];
    
    return config.fields?.filter(field => 
      groups.includes(field.field_group || '')
    ) || [];
  };

  const currentFields = getFieldsForTab(currentTab);
  const groupedFields = currentFields.reduce((acc, field) => {
    const group = field.field_group || 'outros';
    if (!acc[group]) acc[group] = [];
    acc[group].push(field);
    return acc;
  }, {} as Record<string, FormField[]>);

  return (
    <div className="space-y-6">
      {/* Info Banner */}
      <div className="flex items-start gap-3 p-4 rounded-lg bg-amber-500/10 border border-amber-500/20">
        <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
        <div className="text-sm">
          <p className="font-medium text-amber-600">Preview do Formulário</p>
          <p className="text-muted-foreground">
            Este é um preview de como o formulário será exibido para usuários. 
            Campos condicionais são calculados em tempo real conforme você preenche.
          </p>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-2 border-b">
        {tabs.map((tab, index) => (
          <button
            key={tab}
            onClick={() => setCurrentTab(index)}
            className={cn(
              "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
              currentTab === index
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Form Fields */}
      <div className="space-y-6">
        {Object.entries(groupedFields).map(([group, fields]) => (
          <Card key={group}>
            <CardHeader className="pb-4">
              <CardTitle className="text-lg">{fieldGroupLabels[group] || group}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {fields
                .sort((a, b) => a.order_index - b.order_index)
                .map(renderField)}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Navigation Buttons */}
      <div className="flex justify-between pt-4">
        <Button
          variant="outline"
          onClick={() => setCurrentTab(prev => Math.max(0, prev - 1))}
          disabled={currentTab === 0}
        >
          Voltar
        </Button>
        <Button
          onClick={() => setCurrentTab(prev => Math.min(tabs.length - 1, prev + 1))}
          disabled={currentTab === tabs.length - 1}
        >
          Continuar
        </Button>
      </div>
    </div>
  );
}
