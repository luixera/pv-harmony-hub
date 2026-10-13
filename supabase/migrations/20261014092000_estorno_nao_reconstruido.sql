-- ============================================================================
-- RECEBIMENTO RECONSTRUÍDO NÃO SE ESTORNA (14/10/2026)
--
-- Encontrado ao verificar a tela: o cartão reconstruído mostrava "Estornar o
-- recebimento inteiro". Estornar ali lançaria contrapartidas NEGATIVAS em
-- pagamentos reais — e quem clicasse achando que estava desfazendo a
-- RECONSTRUÇÃO estaria desfazendo DINHEIRO.
--
-- O agrupamento é derivado: para reverter um pagamento antigo o caminho
-- continua sendo o estorno dentro do projeto, onde ele foi lançado; para
-- desfazer a reconstrução existe `recebimento_reconstrucao_desfazer()`.
--
-- A tela já esconde o botão, mas tela não é guarda. Em vez de reescrever
-- `recebimento_estornar` inteira (copiar função grande foi justamente o que
-- quase introduziu um desvio no extrato nesta mesma rodada), a trava é um
-- gatilho: pequeno, cirúrgico e independente da função.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_barra_estorno_reconstruido()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NEW.reversed_at IS NOT NULL AND OLD.reversed_at IS NULL
     AND OLD.origin = 'reconstruido' THEN
    RAISE EXCEPTION
      'Este recebimento foi reconstruído do histórico e não pode ser estornado. Para reverter um pagamento, use o estorno dentro do projeto.';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_barra_estorno_reconstruido ON public.financial_receipts;
CREATE TRIGGER trg_barra_estorno_reconstruido
  BEFORE UPDATE ON public.financial_receipts
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_barra_estorno_reconstruido();
