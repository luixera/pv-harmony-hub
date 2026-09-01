-- ─────────────────────────────────────────────────────────────────────────────
-- Categoria do padrão de entrada escolhida à mão
--
-- A categoria era 100% derivada (fase + disjuntor da UC de hoje). Não dava
-- conta do caso real de AUMENTO DE CARGA pedido junto com o projeto solar: o
-- cliente sai de 63A bifásico e vai para 80A trifásico, e é a categoria NOVA
-- que tem de valer no diagrama, nos formulários e no memorial.
--
-- Aponta para a regra escolhida (e não para o texto da categoria) porque é
-- dela que saem bitola, classe, caixa de medição e as colunas customizadas.
-- Regra apagada → volta sozinho para a classificação automática.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.project_general_data
  ADD COLUMN IF NOT EXISTS entry_rule_id UUID
    REFERENCES public.concessionaire_entry_rules(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.project_general_data.entry_rule_id IS
  'Categoria do padrão de entrada definida à mão (aumento de carga). Nulo = classificação automática por fase + disjuntor.';
