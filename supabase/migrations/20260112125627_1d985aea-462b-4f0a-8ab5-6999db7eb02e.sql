-- Atualizar usuário para admin
UPDATE public.profiles 
SET role = 'admin', name = 'Admin Teste'
WHERE email = 'luizaugusto716@gmail.com';

UPDATE public.user_roles
SET role = 'admin'
WHERE user_id = 'df6086a1-afdb-47c9-b723-886f51fdd5e3';

-- Criar empresas de teste
INSERT INTO public.companies (name, cnpj, contact_name, contact_email, contact_phone, active)
VALUES 
  ('Solar Tech LTDA', '12.345.678/0001-90', 'Ricardo Almeida', 'contato@solartech.com.br', '(11) 99999-0001', true),
  ('Energia Verde ME', '98.765.432/0001-10', 'Juliana Costa', 'solar@energiaverde.com', '(11) 99999-0002', true),
  ('FV Solutions', '11.222.333/0001-44', 'Marcos Pereira', 'projetos@fvsolutions.com.br', '(21) 98888-1234', true)
ON CONFLICT DO NOTHING;