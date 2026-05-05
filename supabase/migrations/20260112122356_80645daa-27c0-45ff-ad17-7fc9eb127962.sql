-- ============================================
-- GD MANAGER - MODELO DE DADOS COMPLETO
-- ============================================

-- 1. ENUM TYPES
CREATE TYPE public.user_role AS ENUM ('admin', 'staff', 'company');
CREATE TYPE public.project_status AS ENUM ('pending', 'analysis', 'documentation', 'approval', 'approved', 'completed');
CREATE TYPE public.project_source AS ENUM ('company_login', 'public_form', 'admin');
CREATE TYPE public.document_type AS ENUM ('energy_bill_generator', 'energy_bill_beneficiaries', 'holder_document', 'entrance_standard_photo', 'breaker_photo', 'other_photos');
CREATE TYPE public.payment_status AS ENUM ('pending', 'partial', 'paid');

-- 2. TABELA: companies (PRIMEIRO - pois users depende dela)
CREATE TABLE public.companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  cnpj TEXT NOT NULL UNIQUE,
  contact_name TEXT NOT NULL,
  contact_email TEXT NOT NULL,
  contact_phone TEXT,
  public_form_token TEXT NOT NULL UNIQUE DEFAULT gen_random_uuid()::text,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- 3. TABELA: profiles (para dados adicionais de usuário)
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  role public.user_role NOT NULL DEFAULT 'company',
  company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  avatar_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- 4. TABELA: user_roles (para controle de acesso seguro)
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.user_role NOT NULL,
  UNIQUE (user_id, role)
);

-- 5. TABELA: projects
CREATE TABLE public.projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE DEFAULT 'PRJ-' || LPAD(FLOOR(RANDOM() * 100000)::TEXT, 5, '0'),
  title TEXT NOT NULL,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  status public.project_status NOT NULL DEFAULT 'pending',
  source public.project_source NOT NULL DEFAULT 'public_form',
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- 6. TABELA: project_general_data (dados do formulário)
CREATE TABLE public.project_general_data (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL UNIQUE REFERENCES public.projects(id) ON DELETE CASCADE,
  holder_name TEXT NOT NULL,
  holder_cpf_cnpj TEXT NOT NULL,
  holder_email TEXT,
  holder_phone TEXT,
  address TEXT NOT NULL,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  uc_number TEXT NOT NULL,
  utility_company TEXT NOT NULL,
  phase_type TEXT,
  is_rural BOOLEAN NOT NULL DEFAULT false,
  has_beneficiaries BOOLEAN NOT NULL DEFAULT false,
  coordinates TEXT,
  circuit_breaker_current TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- 7. TABELA: project_equipment
CREATE TABLE public.project_equipment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL UNIQUE REFERENCES public.projects(id) ON DELETE CASCADE,
  inverter_brand TEXT,
  inverter_model TEXT NOT NULL,
  inverter_power NUMERIC,
  inverter_quantity INTEGER DEFAULT 1,
  module_brand TEXT,
  module_model TEXT,
  module_power NUMERIC,
  module_quantity INTEGER NOT NULL,
  total_installed_power NUMERIC NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- 8. TABELA: documents
CREATE TABLE public.documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  document_type public.document_type NOT NULL,
  file_name TEXT NOT NULL,
  file_url TEXT NOT NULL,
  file_type TEXT,
  uploaded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- 9. TABELA: comments
CREATE TABLE public.comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- 10. TABELA: project_financials
CREATE TABLE public.project_financials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL UNIQUE REFERENCES public.projects(id) ON DELETE CASCADE,
  project_value NUMERIC NOT NULL DEFAULT 0,
  paid_value NUMERIC NOT NULL DEFAULT 0,
  payment_status public.payment_status NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- 11. TABELA: project_history
CREATE TABLE public.project_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  description TEXT NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  user_name TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- ============================================
-- TRIGGERS E FUNCTIONS
-- ============================================

-- Function para atualizar updated_at
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers de updated_at
CREATE TRIGGER update_companies_updated_at
  BEFORE UPDATE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_projects_updated_at
  BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_project_financials_updated_at
  BEFORE UPDATE ON public.project_financials
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Function para criar profile automaticamente ao signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, name, email, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'name', NEW.email),
    NEW.email,
    COALESCE((NEW.raw_user_meta_data ->> 'role')::public.user_role, 'company')
  );
  
  -- Também insere na tabela user_roles
  INSERT INTO public.user_roles (user_id, role)
  VALUES (
    NEW.id,
    COALESCE((NEW.raw_user_meta_data ->> 'role')::public.user_role, 'company')
  );
  
  RETURN NEW;
END;
$$;

-- Trigger para criar profile ao signup
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Function segura para verificar role (evita recursão RLS)
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.user_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;

-- Function para obter role do usuário
CREATE OR REPLACE FUNCTION public.get_user_role(_user_id UUID)
RETURNS public.user_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.user_roles WHERE user_id = _user_id LIMIT 1
$$;

-- Function para obter company_id do usuário
CREATE OR REPLACE FUNCTION public.get_user_company_id(_user_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT company_id FROM public.profiles WHERE id = _user_id LIMIT 1
$$;

-- ============================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================

-- Enable RLS em todas as tabelas
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_general_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_equipment ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_financials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_history ENABLE ROW LEVEL SECURITY;

-- ============================================
-- POLICIES: companies
-- ============================================
CREATE POLICY "Admin/Staff can view all companies"
  ON public.companies FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin') OR 
    public.has_role(auth.uid(), 'staff')
  );

CREATE POLICY "Company users can view their own company"
  ON public.companies FOR SELECT
  TO authenticated
  USING (id = public.get_user_company_id(auth.uid()));

CREATE POLICY "Admin can insert companies"
  ON public.companies FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admin can update companies"
  ON public.companies FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admin can delete companies"
  ON public.companies FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Policy para acesso público ao token (para formulário público)
CREATE POLICY "Anyone can lookup company by public token"
  ON public.companies FOR SELECT
  TO anon
  USING (true);

-- ============================================
-- POLICIES: profiles
-- ============================================
CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (id = auth.uid());

CREATE POLICY "Admin can view all profiles"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Staff can view all profiles"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'staff'));

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (id = auth.uid());

CREATE POLICY "Admin can update any profile"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- ============================================
-- POLICIES: user_roles
-- ============================================
CREATE POLICY "Admin can view all roles"
  ON public.user_roles FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users can view own role"
  ON public.user_roles FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Admin can manage roles"
  ON public.user_roles FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- ============================================
-- POLICIES: projects
-- ============================================
CREATE POLICY "Admin/Staff can view all projects"
  ON public.projects FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin') OR 
    public.has_role(auth.uid(), 'staff')
  );

CREATE POLICY "Company can view own projects"
  ON public.projects FOR SELECT
  TO authenticated
  USING (company_id = public.get_user_company_id(auth.uid()));

CREATE POLICY "Admin/Staff can insert projects"
  ON public.projects FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin') OR 
    public.has_role(auth.uid(), 'staff')
  );

CREATE POLICY "Company can insert own projects"
  ON public.projects FOR INSERT
  TO authenticated
  WITH CHECK (company_id = public.get_user_company_id(auth.uid()));

CREATE POLICY "Anonymous can insert projects via public form"
  ON public.projects FOR INSERT
  TO anon
  WITH CHECK (source = 'public_form');

CREATE POLICY "Admin/Staff can update projects"
  ON public.projects FOR UPDATE
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin') OR 
    public.has_role(auth.uid(), 'staff')
  );

CREATE POLICY "Admin can delete projects"
  ON public.projects FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- ============================================
-- POLICIES: project_general_data
-- ============================================
CREATE POLICY "Admin/Staff can view all project data"
  ON public.project_general_data FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin') OR 
    public.has_role(auth.uid(), 'staff')
  );

CREATE POLICY "Company can view own project data"
  ON public.project_general_data FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p 
      WHERE p.id = project_id 
      AND p.company_id = public.get_user_company_id(auth.uid())
    )
  );

CREATE POLICY "Authenticated can insert project data"
  ON public.project_general_data FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Anonymous can insert project data"
  ON public.project_general_data FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "Admin/Staff can update project data"
  ON public.project_general_data FOR UPDATE
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin') OR 
    public.has_role(auth.uid(), 'staff')
  );

-- ============================================
-- POLICIES: project_equipment
-- ============================================
CREATE POLICY "Admin/Staff can view all equipment"
  ON public.project_equipment FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin') OR 
    public.has_role(auth.uid(), 'staff')
  );

CREATE POLICY "Company can view own equipment"
  ON public.project_equipment FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p 
      WHERE p.id = project_id 
      AND p.company_id = public.get_user_company_id(auth.uid())
    )
  );

CREATE POLICY "Authenticated can insert equipment"
  ON public.project_equipment FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Anonymous can insert equipment"
  ON public.project_equipment FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "Admin/Staff can update equipment"
  ON public.project_equipment FOR UPDATE
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin') OR 
    public.has_role(auth.uid(), 'staff')
  );

-- ============================================
-- POLICIES: documents
-- ============================================
CREATE POLICY "Admin/Staff can view all documents"
  ON public.documents FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin') OR 
    public.has_role(auth.uid(), 'staff')
  );

CREATE POLICY "Company can view own documents"
  ON public.documents FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p 
      WHERE p.id = project_id 
      AND p.company_id = public.get_user_company_id(auth.uid())
    )
  );

CREATE POLICY "Authenticated can insert documents"
  ON public.documents FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Anonymous can insert documents"
  ON public.documents FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "Admin/Staff can update documents"
  ON public.documents FOR UPDATE
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin') OR 
    public.has_role(auth.uid(), 'staff')
  );

CREATE POLICY "Admin can delete documents"
  ON public.documents FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- ============================================
-- POLICIES: comments
-- ============================================
CREATE POLICY "Admin/Staff can view all comments"
  ON public.comments FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin') OR 
    public.has_role(auth.uid(), 'staff')
  );

CREATE POLICY "Company can view own project comments"
  ON public.comments FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p 
      WHERE p.id = project_id 
      AND p.company_id = public.get_user_company_id(auth.uid())
    )
  );

CREATE POLICY "Authenticated can insert comments"
  ON public.comments FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own comments"
  ON public.comments FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Admin can delete any comment"
  ON public.comments FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users can delete own comments"
  ON public.comments FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- ============================================
-- POLICIES: project_financials
-- ============================================
CREATE POLICY "Admin/Staff can view all financials"
  ON public.project_financials FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin') OR 
    public.has_role(auth.uid(), 'staff')
  );

CREATE POLICY "Company can view own financials"
  ON public.project_financials FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p 
      WHERE p.id = project_id 
      AND p.company_id = public.get_user_company_id(auth.uid())
    )
  );

CREATE POLICY "Admin/Staff can insert financials"
  ON public.project_financials FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin') OR 
    public.has_role(auth.uid(), 'staff')
  );

CREATE POLICY "Admin/Staff can update financials"
  ON public.project_financials FOR UPDATE
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin') OR 
    public.has_role(auth.uid(), 'staff')
  );

-- ============================================
-- POLICIES: project_history
-- ============================================
CREATE POLICY "Admin/Staff can view all history"
  ON public.project_history FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin') OR 
    public.has_role(auth.uid(), 'staff')
  );

CREATE POLICY "Company can view own project history"
  ON public.project_history FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p 
      WHERE p.id = project_id 
      AND p.company_id = public.get_user_company_id(auth.uid())
    )
  );

CREATE POLICY "Authenticated can insert history"
  ON public.project_history FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Anonymous can insert history"
  ON public.project_history FOR INSERT
  TO anon
  WITH CHECK (true);

-- ============================================
-- INDEXES para performance
-- ============================================
CREATE INDEX idx_projects_company_id ON public.projects(company_id);
CREATE INDEX idx_projects_status ON public.projects(status);
CREATE INDEX idx_profiles_company_id ON public.profiles(company_id);
CREATE INDEX idx_documents_project_id ON public.documents(project_id);
CREATE INDEX idx_comments_project_id ON public.comments(project_id);
CREATE INDEX idx_project_history_project_id ON public.project_history(project_id);
CREATE INDEX idx_companies_public_form_token ON public.companies(public_form_token);