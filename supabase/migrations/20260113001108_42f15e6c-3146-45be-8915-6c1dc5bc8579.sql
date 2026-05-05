-- ===========================================================
-- MÓDULO DE CONFIGURAÇÃO DINÂMICA DE KANBAN
-- ===========================================================

-- 1. Criar tabela kanban_models
CREATE TABLE public.kanban_models (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.kanban_models ENABLE ROW LEVEL SECURITY;

-- RLS Policies for kanban_models
CREATE POLICY "Admin can manage kanban_models"
ON public.kanban_models FOR ALL
USING (has_role(auth.uid(), 'admin'::user_role))
WITH CHECK (has_role(auth.uid(), 'admin'::user_role));

CREATE POLICY "Authenticated users can view active kanban_models"
ON public.kanban_models FOR SELECT
USING (is_active = true);

-- 2. Criar tabela kanban_columns
CREATE TABLE public.kanban_columns (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  kanban_model_id UUID NOT NULL REFERENCES public.kanban_models(id) ON DELETE CASCADE,
  status_key TEXT NOT NULL,
  status_label TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT 'bg-muted',
  order_index INTEGER NOT NULL DEFAULT 0,
  is_initial BOOLEAN NOT NULL DEFAULT false,
  is_final BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(kanban_model_id, status_key)
);

-- Enable RLS
ALTER TABLE public.kanban_columns ENABLE ROW LEVEL SECURITY;

-- RLS Policies for kanban_columns
CREATE POLICY "Admin can manage kanban_columns"
ON public.kanban_columns FOR ALL
USING (has_role(auth.uid(), 'admin'::user_role))
WITH CHECK (has_role(auth.uid(), 'admin'::user_role));

CREATE POLICY "Authenticated users can view columns of active models"
ON public.kanban_columns FOR SELECT
USING (EXISTS (
  SELECT 1 FROM public.kanban_models km
  WHERE km.id = kanban_columns.kanban_model_id AND km.is_active = true
));

-- 3. Criar tabela company_kanban_model (associação empresa-modelo)
CREATE TABLE public.company_kanban_model (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  kanban_model_id UUID NOT NULL REFERENCES public.kanban_models(id) ON DELETE RESTRICT,
  assigned_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  assigned_by UUID REFERENCES public.profiles(id),
  UNIQUE(company_id)
);

-- Enable RLS
ALTER TABLE public.company_kanban_model ENABLE ROW LEVEL SECURITY;

-- RLS Policies for company_kanban_model
CREATE POLICY "Admin can manage company_kanban_model"
ON public.company_kanban_model FOR ALL
USING (has_role(auth.uid(), 'admin'::user_role))
WITH CHECK (has_role(auth.uid(), 'admin'::user_role));

CREATE POLICY "Users can view company kanban model"
ON public.company_kanban_model FOR SELECT
USING (
  has_role(auth.uid(), 'admin'::user_role) OR
  has_role(auth.uid(), 'staff'::user_role) OR
  company_id = get_user_company_id(auth.uid())
);

-- 4. Adicionar kanban_model_id à tabela projects
ALTER TABLE public.projects 
ADD COLUMN kanban_model_id UUID REFERENCES public.kanban_models(id);

-- 5. Criar índices para performance
CREATE INDEX idx_kanban_columns_model ON public.kanban_columns(kanban_model_id);
CREATE INDEX idx_kanban_columns_order ON public.kanban_columns(kanban_model_id, order_index);
CREATE INDEX idx_company_kanban_model_company ON public.company_kanban_model(company_id);
CREATE INDEX idx_projects_kanban_model ON public.projects(kanban_model_id);

-- 6. Criar função helper para obter modelo de kanban de uma empresa
CREATE OR REPLACE FUNCTION public.get_company_kanban_model_id(_company_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN (
    SELECT kanban_model_id 
    FROM public.company_kanban_model 
    WHERE company_id = _company_id
  );
END;
$$;

-- 7. Criar função para obter colunas do kanban por modelo
CREATE OR REPLACE FUNCTION public.get_kanban_columns(_model_id UUID)
RETURNS TABLE(
  id UUID,
  status_key TEXT,
  status_label TEXT,
  color TEXT,
  order_index INTEGER,
  is_initial BOOLEAN,
  is_final BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    kc.id,
    kc.status_key,
    kc.status_label,
    kc.color,
    kc.order_index,
    kc.is_initial,
    kc.is_final
  FROM public.kanban_columns kc
  WHERE kc.kanban_model_id = _model_id
  ORDER BY kc.order_index;
END;
$$;

-- 8. Criar trigger para atualizar updated_at em kanban_models
CREATE TRIGGER update_kanban_models_updated_at
BEFORE UPDATE ON public.kanban_models
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- 9. Criar modelo padrão de Kanban com as colunas existentes
DO $$
DECLARE
  default_model_id UUID;
BEGIN
  -- Criar modelo padrão
  INSERT INTO public.kanban_models (name, description, is_active)
  VALUES ('Modelo Padrão', 'Fluxo padrão do sistema com 6 etapas', true)
  RETURNING id INTO default_model_id;
  
  -- Criar colunas do modelo padrão (baseado no enum project_status existente)
  INSERT INTO public.kanban_columns (kanban_model_id, status_key, status_label, color, order_index, is_initial, is_final) VALUES
  (default_model_id, 'pending', 'Aguardando', 'bg-muted', 0, true, false),
  (default_model_id, 'analysis', 'Em Análise', 'bg-kanban-analysis', 1, false, false),
  (default_model_id, 'documentation', 'Documentação', 'bg-kanban-progress', 2, false, false),
  (default_model_id, 'approval', 'Aprovação', 'bg-kanban-progress', 3, false, false),
  (default_model_id, 'approved', 'Aprovado', 'bg-kanban-approved', 4, false, false),
  (default_model_id, 'completed', 'Concluído', 'bg-kanban-completed', 5, false, true);
END $$;