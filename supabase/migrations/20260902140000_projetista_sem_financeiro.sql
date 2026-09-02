-- ─────────────────────────────────────────────────────────────────────────────
-- Projetista (staff) não acessa mais dados financeiros
--
-- Decisão do usuário (set/2026): "o projetista não deve ter acesso a
-- informações do financeiro". A tela /admin/financial e os relatórios já eram
-- exclusivos do admin, e a aba Financeiro do modal do projeto acabou de ser
-- fechada para ele — mas isso sozinho seria só cosmético: no banco havia
-- políticas dando SELECT a `staff` em project_financials e financials, então
-- o dado continuaria acessível pela API com a sessão do projetista.
--
-- Removidas as quatro políticas de leitura de staff (as variantes 'global' e
-- 'assigned_only'). Admin e empresa seguem intactos: o admin vê tudo do
-- tenant, a empresa vê o próprio financeiro em /company/financial. A escrita
-- de staff em project_financials NÃO é tocada aqui — o valor do projeto ainda
-- é gravado pelo fluxo de criação, que roda com a sessão de quem cadastra.
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Staff with global access can view all financials"
  ON public.project_financials;
DROP POLICY IF EXISTS "Staff with restricted access can view assigned financials"
  ON public.project_financials;

DROP POLICY IF EXISTS "Staff with global access can view all financials legacy"
  ON public.financials;
DROP POLICY IF EXISTS "Staff with restricted access can view assigned financials legac"
  ON public.financials;
