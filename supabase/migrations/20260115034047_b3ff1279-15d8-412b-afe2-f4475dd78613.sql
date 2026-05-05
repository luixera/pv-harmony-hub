-- ============================================
-- MÓDULO DE CONCESSIONÁRIAS DE ENERGIA
-- ============================================

-- 1. Tabela de Concessionárias
CREATE TABLE public.energy_concessionaires (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Habilitar RLS
ALTER TABLE public.energy_concessionaires ENABLE ROW LEVEL SECURITY;

-- Policies para energy_concessionaires
-- Admin pode fazer tudo
CREATE POLICY "Admin full access to energy_concessionaires"
ON public.energy_concessionaires
FOR ALL
USING (has_role(auth.uid(), 'admin'))
WITH CHECK (has_role(auth.uid(), 'admin'));

-- Staff pode visualizar todas
CREATE POLICY "Staff can view energy_concessionaires"
ON public.energy_concessionaires
FOR SELECT
USING (has_role(auth.uid(), 'staff'));

-- Qualquer um pode ver concessionárias ativas (para formulário público)
CREATE POLICY "Anyone can view active energy_concessionaires"
ON public.energy_concessionaires
FOR SELECT
USING (is_active = true);

-- 2. Tabela de Documentos da Concessionária
CREATE TABLE public.concessionaire_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  concessionaire_id UUID NOT NULL REFERENCES public.energy_concessionaires(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_type TEXT,
  uploaded_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Habilitar RLS
ALTER TABLE public.concessionaire_documents ENABLE ROW LEVEL SECURITY;

-- Policies para concessionaire_documents
-- Admin pode fazer tudo
CREATE POLICY "Admin full access to concessionaire_documents"
ON public.concessionaire_documents
FOR ALL
USING (has_role(auth.uid(), 'admin'))
WITH CHECK (has_role(auth.uid(), 'admin'));

-- Staff pode visualizar
CREATE POLICY "Staff can view concessionaire_documents"
ON public.concessionaire_documents
FOR SELECT
USING (has_role(auth.uid(), 'staff'));

-- 3. Adicionar coluna concessionaire_id na tabela projects
ALTER TABLE public.projects 
ADD COLUMN concessionaire_id UUID REFERENCES public.energy_concessionaires(id);

-- 4. Criar bucket de storage para documentos das concessionárias
INSERT INTO storage.buckets (id, name, public)
VALUES ('concessionaire-documents', 'concessionaire-documents', false);

-- 5. Policies de storage para o bucket
-- Admin pode fazer upload/download/delete
CREATE POLICY "Admin can manage concessionaire documents"
ON storage.objects
FOR ALL
USING (bucket_id = 'concessionaire-documents' AND has_role(auth.uid(), 'admin'))
WITH CHECK (bucket_id = 'concessionaire-documents' AND has_role(auth.uid(), 'admin'));

-- Staff pode baixar (SELECT)
CREATE POLICY "Staff can view concessionaire documents"
ON storage.objects
FOR SELECT
USING (bucket_id = 'concessionaire-documents' AND has_role(auth.uid(), 'staff'));

-- 6. Trigger para updated_at em energy_concessionaires
CREATE TRIGGER update_energy_concessionaires_updated_at
BEFORE UPDATE ON public.energy_concessionaires
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();