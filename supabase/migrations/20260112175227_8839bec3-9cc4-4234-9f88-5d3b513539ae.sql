-- Tabela financials (controle financeiro por projeto)
CREATE TABLE public.financials (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_value NUMERIC(12,2) NOT NULL DEFAULT 0,
  amount_paid NUMERIC(12,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'partial', 'paid')),
  due_date DATE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT unique_project_financial UNIQUE (project_id),
  CONSTRAINT amount_paid_not_greater_than_value CHECK (amount_paid <= project_value)
);

-- Tabela financial_payments (histórico de pagamentos)
CREATE TABLE public.financial_payments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  financial_id UUID NOT NULL REFERENCES public.financials(id) ON DELETE CASCADE,
  payment_date DATE NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.financials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_payments ENABLE ROW LEVEL SECURITY;

-- RLS Policies for financials
-- Admin: acesso total
CREATE POLICY "Admin full access to financials"
ON public.financials
FOR ALL
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Company: apenas visualização dos próprios dados
CREATE POLICY "Company can view own financials"
ON public.financials
FOR SELECT
USING (
  public.has_role(auth.uid(), 'company') 
  AND company_id = public.get_user_company_id(auth.uid())
);

-- RLS Policies for financial_payments
-- Admin: acesso total
CREATE POLICY "Admin full access to financial_payments"
ON public.financial_payments
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.financials f
    WHERE f.id = financial_id
    AND public.has_role(auth.uid(), 'admin')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.financials f
    WHERE f.id = financial_id
    AND public.has_role(auth.uid(), 'admin')
  )
);

-- Company: apenas visualização dos próprios pagamentos
CREATE POLICY "Company can view own payments"
ON public.financial_payments
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.financials f
    WHERE f.id = financial_id
    AND f.company_id = public.get_user_company_id(auth.uid())
    AND public.has_role(auth.uid(), 'company')
  )
);

-- Trigger para atualizar updated_at
CREATE TRIGGER update_financials_updated_at
BEFORE UPDATE ON public.financials
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Função para recalcular status financeiro após pagamento
CREATE OR REPLACE FUNCTION public.recalculate_financial_status()
RETURNS TRIGGER AS $$
DECLARE
  total_paid NUMERIC(12,2);
  project_val NUMERIC(12,2);
  new_status TEXT;
BEGIN
  -- Calcular total pago
  SELECT COALESCE(SUM(amount), 0) INTO total_paid
  FROM public.financial_payments
  WHERE financial_id = NEW.financial_id;
  
  -- Buscar valor do projeto
  SELECT project_value INTO project_val
  FROM public.financials
  WHERE id = NEW.financial_id;
  
  -- Determinar status
  IF total_paid = 0 THEN
    new_status := 'pending';
  ELSIF total_paid >= project_val THEN
    new_status := 'paid';
  ELSE
    new_status := 'partial';
  END IF;
  
  -- Atualizar financials
  UPDATE public.financials
  SET amount_paid = total_paid,
      status = new_status,
      updated_at = now()
  WHERE id = NEW.financial_id;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Trigger para recalcular após inserção de pagamento
CREATE TRIGGER recalculate_financial_after_payment
AFTER INSERT ON public.financial_payments
FOR EACH ROW
EXECUTE FUNCTION public.recalculate_financial_status();