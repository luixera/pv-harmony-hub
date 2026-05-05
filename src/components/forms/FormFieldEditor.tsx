import { useState, useEffect, useRef } from 'react';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { Card, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { 
  FormConfig, 
  FormField, 
  useUpdateFormField, 
  useUpdateFieldOrder,
  useAddFieldRule,
  useDeleteFieldRule
} from '@/hooks/useFormConfig';
import { 
  GripVertical, 
  ChevronDown, 
  Eye, 
  EyeOff, 
  Asterisk,
  Link2,
  Trash2,
  Plus,
  Loader2
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from '@/hooks/use-toast';

interface FormFieldEditorProps {
  config: FormConfig;
}

const fieldTypeLabels: Record<string, string> = {
  text: 'Texto',
  number: 'Número',
  email: 'E-mail',
  phone: 'Telefone',
  cpf: 'CPF',
  cnpj: 'CNPJ',
  cep: 'CEP',
  select: 'Seleção',
  radio: 'Radio',
  checkbox: 'Checkbox',
  textarea: 'Área de texto',
  file: 'Arquivo',
  date: 'Data'
};

const fieldGroupLabels: Record<string, string> = {
  titular: 'Dados do Titular',
  endereco: 'Endereço',
  unidade_consumidora: 'Unidade Consumidora',
  inversor: 'Inversor',
  modulo: 'Módulos Fotovoltaicos',
  anexos: 'Anexos'
};

const conditionOperatorLabels: Record<string, string> = {
  equals: 'Igual a',
  not_equals: 'Diferente de',
  contains: 'Contém',
  is_checked: 'Está marcado',
  is_not_checked: 'Não está marcado',
  is_empty: 'Está vazio',
  is_not_empty: 'Não está vazio'
};

const actionLabels: Record<string, string> = {
  show: 'Exibir campo',
  hide: 'Ocultar campo',
  require: 'Tornar obrigatório',
  optional: 'Tornar opcional'
};

export function FormFieldEditor({ config }: FormFieldEditorProps) {
  const updateField = useUpdateFormField();
  const updateOrder = useUpdateFieldOrder();
  const addRule = useAddFieldRule();
  const deleteRule = useDeleteFieldRule();
  const [expandedFields, setExpandedFields] = useState<string[]>([]);
  
  // Track which specific field is being updated
  const [updatingFieldId, setUpdatingFieldId] = useState<string | null>(null);
  
  // Local state for debounced text inputs
  const [localLabels, setLocalLabels] = useState<Record<string, string>>({});
  const [localHelperTexts, setLocalHelperTexts] = useState<Record<string, string>>({});
  const debounceTimerRef = useRef<Record<string, NodeJS.Timeout>>({});
  const initializedConfigRef = useRef<string | null>(null);

  // Initialize local state when config changes (only once per config)
  useEffect(() => {
    if (config.fields && config.id !== initializedConfigRef.current) {
      const labels: Record<string, string> = {};
      const helpers: Record<string, string> = {};
      config.fields.forEach(field => {
        labels[field.id] = field.field_label;
        helpers[field.id] = field.helper_text || '';
      });
      setLocalLabels(labels);
      setLocalHelperTexts(helpers);
      initializedConfigRef.current = config.id;
    }
  }, [config.fields, config.id]);

  // Group fields by field_group
  const groupedFields = config.fields?.reduce((acc, field) => {
    const group = field.field_group || 'outros';
    if (!acc[group]) acc[group] = [];
    acc[group].push(field);
    return acc;
  }, {} as Record<string, FormField[]>) || {};

  const handleDragEnd = (result: DropResult) => {
    if (!result.destination || !config.fields) return;

    const items = Array.from(config.fields);
    const [reorderedItem] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reorderedItem);

    // Update order indices
    const updates = items.map((item, index) => ({
      id: item.id,
      order_index: index + 1
    }));

    updateOrder.mutate(updates);
  };

  const toggleFieldExpansion = (fieldId: string) => {
    setExpandedFields(prev => 
      prev.includes(fieldId) 
        ? prev.filter(id => id !== fieldId)
        : [...prev, fieldId]
    );
  };

  const handleToggleRequired = (field: FormField) => {
    setUpdatingFieldId(field.id);
    updateField.mutate({
      id: field.id,
      updates: { is_required: !field.is_required }
    }, {
      onSuccess: () => {
        setUpdatingFieldId(null);
        toast({
          title: 'Campo atualizado',
          description: `"${field.field_label}" agora é ${!field.is_required ? 'obrigatório' : 'opcional'}.`
        });
      },
      onError: () => {
        setUpdatingFieldId(null);
      }
    });
  };

  const handleToggleVisible = (field: FormField) => {
    setUpdatingFieldId(field.id);
    updateField.mutate({
      id: field.id,
      updates: { is_visible: !field.is_visible }
    }, {
      onSuccess: () => {
        setUpdatingFieldId(null);
        toast({
          title: 'Campo atualizado',
          description: `"${field.field_label}" agora está ${!field.is_visible ? 'visível' : 'oculto'}.`
        });
      },
      onError: () => {
        setUpdatingFieldId(null);
      }
    });
  };

  const handleUpdateLabel = (field: FormField, label: string) => {
    setLocalLabels(prev => ({ ...prev, [field.id]: label }));
    
    // Clear existing timer
    if (debounceTimerRef.current[`label-${field.id}`]) {
      clearTimeout(debounceTimerRef.current[`label-${field.id}`]);
    }
    
    // Set new debounced save
    debounceTimerRef.current[`label-${field.id}`] = setTimeout(() => {
      if (label !== field.field_label) {
        updateField.mutate({
          id: field.id,
          updates: { field_label: label }
        }, {
          onSuccess: () => {
            toast({
              title: 'Label atualizado',
              description: 'O label do campo foi salvo automaticamente.'
            });
          }
        });
      }
    }, 800);
  };

  const handleUpdateHelperText = (field: FormField, text: string) => {
    setLocalHelperTexts(prev => ({ ...prev, [field.id]: text }));
    
    // Clear existing timer
    if (debounceTimerRef.current[`helper-${field.id}`]) {
      clearTimeout(debounceTimerRef.current[`helper-${field.id}`]);
    }
    
    // Set new debounced save
    debounceTimerRef.current[`helper-${field.id}`] = setTimeout(() => {
      if (text !== (field.helper_text || '')) {
        updateField.mutate({
          id: field.id,
          updates: { helper_text: text || null }
        }, {
          onSuccess: () => {
            toast({
              title: 'Texto de ajuda atualizado',
              description: 'O texto de ajuda foi salvo automaticamente.'
            });
          }
        });
      }
    }, 800);
  };

  const handleAddRule = (fieldId: string, conditionFieldKey: string, operator: string, action: string) => {
    addRule.mutate({
      field_id: fieldId,
      condition_field_key: conditionFieldKey,
      condition_operator: operator as FormField['rules'][0]['condition_operator'],
      condition_value: null,
      action: action as FormField['rules'][0]['action']
    });
    toast({
      title: 'Regra adicionada',
      description: 'A regra condicional foi adicionada com sucesso.'
    });
  };

  const handleDeleteRule = (ruleId: string) => {
    deleteRule.mutate(ruleId);
    toast({
      title: 'Regra removida',
      description: 'A regra condicional foi removida.'
    });
  };

  const allFields = config.fields || [];

  return (
    <div className="space-y-6">
      {Object.entries(groupedFields).map(([group, fields]) => (
        <div key={group} className="space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            {fieldGroupLabels[group] || group}
          </h3>
          
          <DragDropContext onDragEnd={handleDragEnd}>
            <Droppable droppableId={group}>
              {(provided) => (
                <div
                  {...provided.droppableProps}
                  ref={provided.innerRef}
                  className="space-y-2"
                >
                  {fields.sort((a, b) => a.order_index - b.order_index).map((field, index) => (
                    <Draggable key={field.id} draggableId={field.id} index={index}>
                      {(provided, snapshot) => (
                        <div
                          ref={provided.innerRef}
                          {...provided.draggableProps}
                          className={cn(
                            "transition-shadow",
                            snapshot.isDragging && "shadow-lg"
                          )}
                        >
                          <Collapsible 
                            open={expandedFields.includes(field.id)}
                            onOpenChange={() => toggleFieldExpansion(field.id)}
                          >
                            <Card className={cn(
                              "transition-all",
                              !field.is_visible && "opacity-50"
                            )}>
                              <CollapsibleTrigger asChild>
                                <CardContent className="p-3 cursor-pointer">
                                  <div className="flex items-center gap-3">
                                    <div
                                      {...provided.dragHandleProps}
                                      className="cursor-grab active:cursor-grabbing p-1 hover:bg-muted rounded"
                                    >
                                      <GripVertical className="w-4 h-4 text-muted-foreground" />
                                    </div>
                                    
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center gap-2">
                                        <span className="font-medium truncate">
                                          {field.field_label}
                                        </span>
                                        <Badge variant="outline" className="text-xs">
                                          {fieldTypeLabels[field.field_type] || field.field_type}
                                        </Badge>
                                        {field.is_required && (
                                          <Asterisk className="w-3 h-3 text-destructive" />
                                        )}
                                        {!field.is_visible && (
                                          <EyeOff className="w-3 h-3 text-muted-foreground" />
                                        )}
                                        {field.rules && field.rules.length > 0 && (
                                          <Badge variant="secondary" className="text-xs">
                                            <Link2 className="w-3 h-3 mr-1" />
                                            {field.rules.length} regra(s)
                                          </Badge>
                                        )}
                                      </div>
                                      <p className="text-xs text-muted-foreground truncate">
                                        {field.field_key}
                                      </p>
                                    </div>
                                    
                                      <div className="flex items-center gap-4">
                                      <div className="flex items-center gap-2">
                                        <Label htmlFor={`visible-${field.id}`} className="text-xs text-muted-foreground">
                                          Visível
                                        </Label>
                                        <Switch
                                          id={`visible-${field.id}`}
                                          checked={field.is_visible}
                                          onCheckedChange={() => handleToggleVisible(field)}
                                          onClick={(e) => e.stopPropagation()}
                                          disabled={updatingFieldId === field.id}
                                        />
                                      </div>
                                      
                                      <div className="flex items-center gap-2">
                                        <Label htmlFor={`required-${field.id}`} className="text-xs text-muted-foreground">
                                          Obrigatório
                                        </Label>
                                        <Switch
                                          id={`required-${field.id}`}
                                          checked={field.is_required}
                                          onCheckedChange={() => handleToggleRequired(field)}
                                          onClick={(e) => e.stopPropagation()}
                                          disabled={updatingFieldId === field.id}
                                        />
                                      </div>
                                      
                                      {updatingFieldId === field.id && (
                                        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                                      )}
                                      
                                      <ChevronDown className={cn(
                                        "w-4 h-4 text-muted-foreground transition-transform",
                                        expandedFields.includes(field.id) && "rotate-180"
                                      )} />
                                    </div>
                                  </div>
                                </CardContent>
                              </CollapsibleTrigger>
                              
                              <CollapsibleContent>
                                <CardContent className="pt-0 pb-4 px-4 border-t">
                                  <div className="grid gap-4 pt-4">
                                    <div className="grid gap-2">
                                      <Label>Label do Campo</Label>
                                      <Input
                                        value={localLabels[field.id] ?? field.field_label}
                                        onChange={(e) => handleUpdateLabel(field, e.target.value)}
                                      />
                                      <p className="text-xs text-muted-foreground">Salvo automaticamente ao parar de digitar</p>
                                    </div>
                                    
                                    <div className="grid gap-2">
                                      <Label>Texto de Ajuda</Label>
                                      <Input
                                        value={localHelperTexts[field.id] ?? field.helper_text ?? ''}
                                        onChange={(e) => handleUpdateHelperText(field, e.target.value)}
                                        placeholder="Texto exibido abaixo do campo..."
                                      />
                                      <p className="text-xs text-muted-foreground">Salvo automaticamente ao parar de digitar</p>
                                    </div>
                                    
                                    {/* Conditional Rules */}
                                    <div className="space-y-3">
                                      <div className="flex items-center justify-between">
                                        <Label>Regras Condicionais</Label>
                                      </div>
                                      
                                      {field.rules && field.rules.length > 0 && (
                                        <div className="space-y-2">
                                          {field.rules.map((rule) => (
                                            <div 
                                              key={rule.id}
                                              className="flex items-center gap-2 p-2 bg-muted rounded-lg text-sm"
                                            >
                                              <span>Quando</span>
                                              <Badge variant="outline">{rule.condition_field_key}</Badge>
                                              <span>{conditionOperatorLabels[rule.condition_operator]}</span>
                                              <span>→</span>
                                              <Badge variant="secondary">{actionLabels[rule.action]}</Badge>
                                              <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-6 w-6 ml-auto"
                                                onClick={() => handleDeleteRule(rule.id)}
                                              >
                                                <Trash2 className="w-3 h-3" />
                                              </Button>
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                      
                                      {/* Add Rule Form */}
                                      <AddRuleForm 
                                        fieldId={field.id}
                                        allFields={allFields}
                                        currentFieldKey={field.field_key}
                                        onAddRule={handleAddRule}
                                      />
                                    </div>
                                  </div>
                                </CardContent>
                              </CollapsibleContent>
                            </Card>
                          </Collapsible>
                        </div>
                      )}
                    </Draggable>
                  ))}
                  {provided.placeholder}
                </div>
              )}
            </Droppable>
          </DragDropContext>
        </div>
      ))}
    </div>
  );
}

interface AddRuleFormProps {
  fieldId: string;
  allFields: FormField[];
  currentFieldKey: string;
  onAddRule: (fieldId: string, conditionFieldKey: string, operator: string, action: string) => void;
}

function AddRuleForm({ fieldId, allFields, currentFieldKey, onAddRule }: AddRuleFormProps) {
  const [conditionField, setConditionField] = useState('');
  const [operator, setOperator] = useState('');
  const [action, setAction] = useState('');
  const [showForm, setShowForm] = useState(false);

  const availableFields = allFields.filter(f => f.field_key !== currentFieldKey);

  const handleSubmit = () => {
    if (!conditionField || !operator || !action) return;
    onAddRule(fieldId, conditionField, operator, action);
    setConditionField('');
    setOperator('');
    setAction('');
    setShowForm(false);
  };

  if (!showForm) {
    return (
      <Button
        variant="outline"
        size="sm"
        className="w-full"
        onClick={() => setShowForm(true)}
      >
        <Plus className="w-4 h-4 mr-2" />
        Adicionar Regra
      </Button>
    );
  }

  return (
    <div className="p-3 border rounded-lg space-y-3 bg-muted/50">
      <div className="grid gap-3 md:grid-cols-3">
        <div className="space-y-1">
          <Label className="text-xs">Quando o campo</Label>
          <Select value={conditionField} onValueChange={setConditionField}>
            <SelectTrigger>
              <SelectValue placeholder="Selecione..." />
            </SelectTrigger>
            <SelectContent>
              {availableFields.map((f) => (
                <SelectItem key={f.field_key} value={f.field_key}>
                  {f.field_label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        
        <div className="space-y-1">
          <Label className="text-xs">Condição</Label>
          <Select value={operator} onValueChange={setOperator}>
            <SelectTrigger>
              <SelectValue placeholder="Selecione..." />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(conditionOperatorLabels).map(([key, label]) => (
                <SelectItem key={key} value={key}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        
        <div className="space-y-1">
          <Label className="text-xs">Ação</Label>
          <Select value={action} onValueChange={setAction}>
            <SelectTrigger>
              <SelectValue placeholder="Selecione..." />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(actionLabels).map(([key, label]) => (
                <SelectItem key={key} value={key}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={() => setShowForm(false)}>
          Cancelar
        </Button>
        <Button 
          size="sm" 
          onClick={handleSubmit}
          disabled={!conditionField || !operator || !action}
        >
          Adicionar
        </Button>
      </div>
    </div>
  );
}
