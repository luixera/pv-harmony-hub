import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';

export interface FormField {
  id: string;
  form_config_id: string;
  field_key: string;
  field_label: string;
  field_type: 'text' | 'number' | 'email' | 'phone' | 'cpf' | 'cnpj' | 'cep' | 'select' | 'radio' | 'checkbox' | 'textarea' | 'file' | 'date';
  is_required: boolean;
  is_visible: boolean;
  helper_text: string | null;
  placeholder: string | null;
  order_index: number;
  field_group: string | null;
  options: unknown | null;
  created_at: string;
  rules?: FormFieldRule[];
}

export interface FormFieldRule {
  id: string;
  field_id: string;
  condition_field_key: string;
  condition_operator: 'equals' | 'not_equals' | 'contains' | 'is_checked' | 'is_not_checked' | 'is_empty' | 'is_not_empty';
  condition_value: string | null;
  action: 'show' | 'hide' | 'require' | 'optional';
  created_at: string;
}

export interface FormConfig {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  fields?: FormField[];
}

// Fetch active form configuration with fields and rules
export function useActiveFormConfig() {
  return useQuery({
    queryKey: ['active-form-config'],
    queryFn: async () => {
      // Fetch active config
      const { data: config, error: configError } = await supabase
        .from('form_configs')
        .select('*')
        .eq('is_active', true)
        .single();

      if (configError) throw configError;

      // Fetch fields for this config
      const { data: fields, error: fieldsError } = await supabase
        .from('form_fields')
        .select('*')
        .eq('form_config_id', config.id)
        .order('order_index', { ascending: true });

      if (fieldsError) throw fieldsError;

      // Fetch rules for all fields
      const fieldIds = fields?.map(f => f.id) || [];
      let rules: FormFieldRule[] = [];
      
      if (fieldIds.length > 0) {
        const { data: rulesData, error: rulesError } = await supabase
          .from('form_field_rules')
          .select('*')
          .in('field_id', fieldIds);

        if (rulesError) throw rulesError;
        rules = (rulesData || []) as FormFieldRule[];
      }

      // Attach rules to their fields
      const fieldsWithRules = fields?.map(field => ({
        ...field,
        rules: rules.filter(r => r.field_id === field.id)
      })) as FormField[];

      return {
        ...config,
        fields: fieldsWithRules
      } as FormConfig;
    }
  });
}

// Fetch all form configurations (for admin)
export function useFormConfigs() {
  return useQuery({
    queryKey: ['form-configs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('form_configs')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as FormConfig[];
    }
  });
}

// Fetch a specific form configuration with all details
export function useFormConfigDetails(configId: string | null) {
  return useQuery({
    queryKey: ['form-config', configId],
    queryFn: async () => {
      if (!configId) return null;

      const { data: config, error: configError } = await supabase
        .from('form_configs')
        .select('*')
        .eq('id', configId)
        .single();

      if (configError) throw configError;

      const { data: fields, error: fieldsError } = await supabase
        .from('form_fields')
        .select('*')
        .eq('form_config_id', configId)
        .order('order_index', { ascending: true });

      if (fieldsError) throw fieldsError;

      const fieldIds = fields?.map(f => f.id) || [];
      let rules: FormFieldRule[] = [];
      
      if (fieldIds.length > 0) {
        const { data: rulesData, error: rulesError } = await supabase
          .from('form_field_rules')
          .select('*')
          .in('field_id', fieldIds);

        if (rulesError) throw rulesError;
        rules = (rulesData || []) as FormFieldRule[];
      }

      const fieldsWithRules = fields?.map(field => ({
        ...field,
        rules: rules.filter(r => r.field_id === field.id)
      })) as FormField[];

      return {
        ...config,
        fields: fieldsWithRules
      } as FormConfig;
    },
    enabled: !!configId
  });
}

// Create a new form configuration
export function useCreateFormConfig() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: { name: string; description?: string }) => {
      const { data: config, error } = await supabase
        .from('form_configs')
        .insert({
          name: data.name,
          description: data.description || null,
          is_active: false
        })
        .select()
        .single();

      if (error) throw error;
      return config as FormConfig;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['form-configs'] });
      toast({
        title: 'Configuração criada',
        description: 'A nova configuração foi criada com sucesso.'
      });
    },
    onError: (error) => {
      toast({
        title: 'Erro ao criar configuração',
        description: error.message,
        variant: 'destructive'
      });
    }
  });
}

// Update form field
export function useUpdateFormField() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: { id: string; updates: Partial<Omit<FormField, 'id' | 'form_config_id' | 'created_at' | 'rules' | 'options'>> }) => {
      const { error } = await supabase
        .from('form_fields')
        .update(data.updates)
        .eq('id', data.id);

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      // Force immediate refetch of all related queries
      queryClient.invalidateQueries({ 
        queryKey: ['form-config'],
        refetchType: 'all'
      });
      queryClient.invalidateQueries({ 
        queryKey: ['active-form-config'],
        refetchType: 'all'
      });
    },
    onError: (error) => {
      toast({
        title: 'Erro ao atualizar campo',
        description: error.message,
        variant: 'destructive'
      });
    }
  });
}

// Batch update field order
export function useUpdateFieldOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (fields: { id: string; order_index: number }[]) => {
      for (const field of fields) {
        const { error } = await supabase
          .from('form_fields')
          .update({ order_index: field.order_index })
          .eq('id', field.id);

        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['form-config'] });
      queryClient.invalidateQueries({ queryKey: ['active-form-config'] });
    }
  });
}

// Activate a form configuration
export function useActivateFormConfig() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (configId: string) => {
      const { error } = await supabase
        .from('form_configs')
        .update({ is_active: true })
        .eq('id', configId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['form-configs'] });
      queryClient.invalidateQueries({ queryKey: ['active-form-config'] });
      toast({
        title: 'Configuração ativada',
        description: 'A configuração foi ativada com sucesso. Todos os formulários agora usarão esta configuração.'
      });
    },
    onError: (error) => {
      toast({
        title: 'Erro ao ativar configuração',
        description: error.message,
        variant: 'destructive'
      });
    }
  });
}

// Duplicate a form configuration
export function useDuplicateFormConfig() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (sourceConfigId: string) => {
      // Get source config
      const { data: sourceConfig, error: configError } = await supabase
        .from('form_configs')
        .select('*')
        .eq('id', sourceConfigId)
        .single();

      if (configError) throw configError;

      // Create new config
      const { data: newConfig, error: newConfigError } = await supabase
        .from('form_configs')
        .insert({
          name: `${sourceConfig.name} (Cópia)`,
          description: sourceConfig.description,
          is_active: false
        })
        .select()
        .single();

      if (newConfigError) throw newConfigError;

      // Get source fields
      const { data: sourceFields, error: fieldsError } = await supabase
        .from('form_fields')
        .select('*')
        .eq('form_config_id', sourceConfigId);

      if (fieldsError) throw fieldsError;

      // Copy fields
      if (sourceFields && sourceFields.length > 0) {
        const newFields = sourceFields.map(field => ({
          form_config_id: newConfig.id,
          field_key: field.field_key,
          field_label: field.field_label,
          field_type: field.field_type,
          is_required: field.is_required,
          is_visible: field.is_visible,
          helper_text: field.helper_text,
          placeholder: field.placeholder,
          order_index: field.order_index,
          field_group: field.field_group,
          options: field.options
        }));

        const { data: insertedFields, error: insertError } = await supabase
          .from('form_fields')
          .insert(newFields)
          .select();

        if (insertError) throw insertError;

        // Copy rules
        for (const sourceField of sourceFields) {
          const { data: sourceRules } = await supabase
            .from('form_field_rules')
            .select('*')
            .eq('field_id', sourceField.id);

          if (sourceRules && sourceRules.length > 0) {
            const newField = insertedFields?.find(f => f.field_key === sourceField.field_key);
            if (newField) {
              const newRules = sourceRules.map(rule => ({
                field_id: newField.id,
                condition_field_key: rule.condition_field_key,
                condition_operator: rule.condition_operator,
                condition_value: rule.condition_value,
                action: rule.action
              }));

              await supabase.from('form_field_rules').insert(newRules);
            }
          }
        }
      }

      return newConfig;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['form-configs'] });
      toast({
        title: 'Configuração duplicada',
        description: 'A configuração foi duplicada com sucesso.'
      });
    },
    onError: (error) => {
      toast({
        title: 'Erro ao duplicar configuração',
        description: error.message,
        variant: 'destructive'
      });
    }
  });
}

// Add a rule to a field
export function useAddFieldRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: Omit<FormFieldRule, 'id' | 'created_at'>) => {
      const { error } = await supabase
        .from('form_field_rules')
        .insert(data);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['form-config'] });
      queryClient.invalidateQueries({ queryKey: ['active-form-config'] });
    }
  });
}

// Delete a rule
export function useDeleteFieldRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (ruleId: string) => {
      const { error } = await supabase
        .from('form_field_rules')
        .delete()
        .eq('id', ruleId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['form-config'] });
      queryClient.invalidateQueries({ queryKey: ['active-form-config'] });
    }
  });
}
