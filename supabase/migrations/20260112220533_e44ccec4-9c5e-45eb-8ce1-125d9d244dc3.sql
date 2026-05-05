-- Create enum for field types
CREATE TYPE field_type AS ENUM (
  'text',
  'number',
  'email',
  'phone',
  'cpf',
  'cnpj',
  'cep',
  'select',
  'radio',
  'checkbox',
  'textarea',
  'file',
  'date'
);

-- Create enum for condition operators
CREATE TYPE condition_operator AS ENUM (
  'equals',
  'not_equals',
  'contains',
  'is_checked',
  'is_not_checked',
  'is_empty',
  'is_not_empty'
);

-- Create enum for field actions
CREATE TYPE field_action AS ENUM (
  'show',
  'hide',
  'require',
  'optional'
);

-- Table: form_configs - Global form configurations
CREATE TABLE public.form_configs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT false,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.form_configs ENABLE ROW LEVEL SECURITY;

-- RLS policies for form_configs
CREATE POLICY "Admin can manage form_configs"
ON public.form_configs
FOR ALL
USING (has_role(auth.uid(), 'admin'::user_role))
WITH CHECK (has_role(auth.uid(), 'admin'::user_role));

CREATE POLICY "Anyone can view active form_config"
ON public.form_configs
FOR SELECT
USING (is_active = true);

-- Table: form_fields - Individual field configurations
CREATE TABLE public.form_fields (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  form_config_id UUID NOT NULL REFERENCES public.form_configs(id) ON DELETE CASCADE,
  field_key TEXT NOT NULL,
  field_label TEXT NOT NULL,
  field_type field_type NOT NULL,
  is_required BOOLEAN NOT NULL DEFAULT false,
  is_visible BOOLEAN NOT NULL DEFAULT true,
  helper_text TEXT,
  placeholder TEXT,
  order_index INTEGER NOT NULL DEFAULT 0,
  field_group TEXT,
  options JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(form_config_id, field_key)
);

-- Enable RLS
ALTER TABLE public.form_fields ENABLE ROW LEVEL SECURITY;

-- RLS policies for form_fields
CREATE POLICY "Admin can manage form_fields"
ON public.form_fields
FOR ALL
USING (has_role(auth.uid(), 'admin'::user_role))
WITH CHECK (has_role(auth.uid(), 'admin'::user_role));

CREATE POLICY "Anyone can view fields of active config"
ON public.form_fields
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.form_configs fc
    WHERE fc.id = form_fields.form_config_id AND fc.is_active = true
  )
);

-- Table: form_field_rules - Conditional rules between fields
CREATE TABLE public.form_field_rules (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  field_id UUID NOT NULL REFERENCES public.form_fields(id) ON DELETE CASCADE,
  condition_field_key TEXT NOT NULL,
  condition_operator condition_operator NOT NULL,
  condition_value TEXT,
  action field_action NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.form_field_rules ENABLE ROW LEVEL SECURITY;

-- RLS policies for form_field_rules
CREATE POLICY "Admin can manage form_field_rules"
ON public.form_field_rules
FOR ALL
USING (has_role(auth.uid(), 'admin'::user_role))
WITH CHECK (has_role(auth.uid(), 'admin'::user_role));

CREATE POLICY "Anyone can view rules of active config"
ON public.form_field_rules
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.form_fields ff
    JOIN public.form_configs fc ON fc.id = ff.form_config_id
    WHERE ff.id = form_field_rules.field_id AND fc.is_active = true
  )
);

-- Add form_config_id to projects table for versioning
ALTER TABLE public.projects 
ADD COLUMN form_config_id UUID REFERENCES public.form_configs(id);

-- Create function to ensure only one active config
CREATE OR REPLACE FUNCTION ensure_single_active_form_config()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_active = true THEN
    UPDATE public.form_configs
    SET is_active = false, updated_at = now()
    WHERE id != NEW.id AND is_active = true;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Create trigger for single active config
CREATE TRIGGER trigger_ensure_single_active_form_config
BEFORE INSERT OR UPDATE ON public.form_configs
FOR EACH ROW
WHEN (NEW.is_active = true)
EXECUTE FUNCTION ensure_single_active_form_config();

-- Create function to update updated_at
CREATE OR REPLACE FUNCTION update_form_configs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Create trigger for updated_at
CREATE TRIGGER trigger_update_form_configs_updated_at
BEFORE UPDATE ON public.form_configs
FOR EACH ROW
EXECUTE FUNCTION update_form_configs_updated_at();

-- Insert default form configuration with all current fields
INSERT INTO public.form_configs (id, name, description, is_active)
VALUES (
  'a0000000-0000-0000-0000-000000000001',
  'Configuração Padrão',
  'Configuração inicial do formulário de projetos',
  true
);

-- Insert default fields for the configuration
INSERT INTO public.form_fields (form_config_id, field_key, field_label, field_type, is_required, is_visible, helper_text, order_index, field_group) VALUES
-- Aba 1: Informações do Titular
('a0000000-0000-0000-0000-000000000001', 'holder_name', 'Nome do Titular', 'text', true, true, 'Nome completo conforme documento', 1, 'titular'),
('a0000000-0000-0000-0000-000000000001', 'holder_cpf_cnpj', 'CPF', 'cpf', true, true, 'Apenas números', 2, 'titular'),
('a0000000-0000-0000-0000-000000000001', 'address', 'Endereço', 'text', true, true, 'Rua/Avenida e número', 3, 'endereco'),
('a0000000-0000-0000-0000-000000000001', 'address_number', 'Número', 'text', true, true, NULL, 4, 'endereco'),
('a0000000-0000-0000-0000-000000000001', 'neighborhood', 'Bairro', 'text', true, true, NULL, 5, 'endereco'),
('a0000000-0000-0000-0000-000000000001', 'cep', 'CEP', 'cep', true, true, 'Apenas números', 6, 'endereco'),
('a0000000-0000-0000-0000-000000000001', 'city', 'Cidade', 'text', true, true, NULL, 7, 'endereco'),
('a0000000-0000-0000-0000-000000000001', 'state', 'Estado', 'select', true, true, NULL, 8, 'endereco'),
('a0000000-0000-0000-0000-000000000001', 'uc_number', 'Número da UC', 'text', true, true, 'Número da unidade consumidora', 9, 'unidade_consumidora'),
('a0000000-0000-0000-0000-000000000001', 'phase_type', 'Classe de Atendimento', 'radio', true, true, NULL, 10, 'unidade_consumidora'),
('a0000000-0000-0000-0000-000000000001', 'is_rural', 'Projeto Rural', 'checkbox', false, true, 'Marque se o projeto é em área rural', 11, 'unidade_consumidora'),
('a0000000-0000-0000-0000-000000000001', 'coordinates', 'Coordenadas', 'text', false, true, 'Latitude e longitude do local', 12, 'unidade_consumidora'),
-- Aba 2: Equipamentos
('a0000000-0000-0000-0000-000000000001', 'inverter_brand', 'Marca do Inversor', 'text', true, true, NULL, 13, 'inversor'),
('a0000000-0000-0000-0000-000000000001', 'inverter_model', 'Modelo do Inversor', 'text', true, true, NULL, 14, 'inversor'),
('a0000000-0000-0000-0000-000000000001', 'inverter_power', 'Potência do Inversor (W)', 'number', true, true, NULL, 15, 'inversor'),
('a0000000-0000-0000-0000-000000000001', 'inverter_quantity', 'Quantidade de Inversores', 'number', true, true, NULL, 16, 'inversor'),
('a0000000-0000-0000-0000-000000000001', 'module_brand', 'Marca do Módulo', 'text', true, true, NULL, 17, 'modulo'),
('a0000000-0000-0000-0000-000000000001', 'module_model', 'Modelo do Módulo', 'text', true, true, NULL, 18, 'modulo'),
('a0000000-0000-0000-0000-000000000001', 'module_power', 'Potência do Módulo (W)', 'number', true, true, NULL, 19, 'modulo'),
('a0000000-0000-0000-0000-000000000001', 'module_quantity', 'Quantidade de Módulos', 'number', true, true, NULL, 20, 'modulo'),
-- Aba 3: Anexos
('a0000000-0000-0000-0000-000000000001', 'energy_bill_generator', 'Conta de Energia (Geradora)', 'file', true, true, 'Conta de energia da unidade geradora', 21, 'anexos'),
('a0000000-0000-0000-0000-000000000001', 'has_beneficiaries', 'Existem Beneficiárias?', 'checkbox', false, true, NULL, 22, 'anexos'),
('a0000000-0000-0000-0000-000000000001', 'energy_bill_beneficiaries', 'Conta de Energia (Beneficiárias)', 'file', false, true, 'Contas de energia das unidades beneficiárias', 23, 'anexos'),
('a0000000-0000-0000-0000-000000000001', 'holder_document', 'Documento do Titular', 'file', true, true, 'Documento com foto do titular', 24, 'anexos'),
('a0000000-0000-0000-0000-000000000001', 'entrance_standard_photo', 'Foto do Padrão de Entrada', 'file', true, true, NULL, 25, 'anexos'),
('a0000000-0000-0000-0000-000000000001', 'no_breaker_photo', 'Não tenho foto do disjuntor', 'checkbox', false, true, NULL, 26, 'anexos'),
('a0000000-0000-0000-0000-000000000001', 'circuit_breaker_photo', 'Foto do Disjuntor', 'file', false, true, NULL, 27, 'anexos'),
('a0000000-0000-0000-0000-000000000001', 'circuit_breaker_current', 'Corrente do Disjuntor (A)', 'text', false, true, 'Informe a corrente se não tiver foto', 28, 'anexos'),
('a0000000-0000-0000-0000-000000000001', 'other_photos', 'Outras Fotos', 'file', false, true, 'Telhado, quadro geral, transformador', 29, 'anexos'),
('a0000000-0000-0000-0000-000000000001', 'observations', 'Observações', 'textarea', false, true, 'Informações adicionais para o projetista', 30, 'anexos');

-- Insert default conditional rules
INSERT INTO public.form_field_rules (field_id, condition_field_key, condition_operator, action)
SELECT ff.id, 'is_rural', 'is_checked', 'show'
FROM public.form_fields ff
WHERE ff.field_key = 'coordinates' AND ff.form_config_id = 'a0000000-0000-0000-0000-000000000001';

INSERT INTO public.form_field_rules (field_id, condition_field_key, condition_operator, action)
SELECT ff.id, 'has_beneficiaries', 'is_checked', 'require'
FROM public.form_fields ff
WHERE ff.field_key = 'energy_bill_beneficiaries' AND ff.form_config_id = 'a0000000-0000-0000-0000-000000000001';

INSERT INTO public.form_field_rules (field_id, condition_field_key, condition_operator, action)
SELECT ff.id, 'no_breaker_photo', 'is_checked', 'hide'
FROM public.form_fields ff
WHERE ff.field_key = 'circuit_breaker_photo' AND ff.form_config_id = 'a0000000-0000-0000-0000-000000000001';

INSERT INTO public.form_field_rules (field_id, condition_field_key, condition_operator, action)
SELECT ff.id, 'no_breaker_photo', 'is_checked', 'require'
FROM public.form_fields ff
WHERE ff.field_key = 'circuit_breaker_current' AND ff.form_config_id = 'a0000000-0000-0000-0000-000000000001';