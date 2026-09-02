-- ─────────────────────────────────────────────────────────────────────────────
-- Empresa integradora passa a LER as regras de padrão de entrada do tenant
--
-- A tabela tinha política para admin (tudo) e projetista (leitura), e nenhuma
-- para `company`. Resultado no modal do acesso da empresa: a consulta voltava
-- vazia e o bloco concluía "esta concessionária não tem regras cadastradas",
-- mandando o CLIENTE cadastrar em uma tela que ele nem enxerga — quando as
-- regras existem e são justamente as do tenant dele (relato do usuário,
-- set/2026, PRJ-33808 na CPFL).
--
-- São dados de referência da concessionária (categoria, disjuntor, bitola,
-- classe, caixa de medição) — a mesma informação que já sai impressa no
-- diagrama e nos formulários do projeto dela. O isolamento continua garantido
-- pela política RESTRICTIVE `tenant_isolation`, que vale junto com esta:
-- a empresa só enxerga as regras do próprio tenant. Leitura apenas.
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Company can view entry_rules" ON public.concessionaire_entry_rules;
CREATE POLICY "Company can view entry_rules"
  ON public.concessionaire_entry_rules
  FOR SELECT
  USING (public.has_role(auth.uid(), 'company'::user_role));
