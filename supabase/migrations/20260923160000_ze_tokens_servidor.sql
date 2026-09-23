-- Zé — o extrato precisa dos tokens também quando não há usuário logado.
--
-- `update_ai_usage_tokens` filtra por `tenant_id = get_user_tenant_id(auth.uid())`.
-- O cérebro do Zé roda com service role (sem sessão): auth.uid() é nulo, o
-- WHERE não casa com nada e o UPDATE não faz NADA — sem erro, sem aviso. O
-- lançamento ficava no extrato com model/tokens nulos e caía na estimativa
-- genérica de US$ 0,02 em vez do custo real.
--
-- Mesmo remédio de `consume_ai_quota_servidor`: o tenant vem por parâmetro.
-- NOME NOVO, não sobrecarga — sobrecarga por assinatura já pregou peça neste
-- projeto (ver ai_call_cost_usd).

CREATE OR REPLACE FUNCTION public.update_ai_usage_tokens_servidor(
  _log_id UUID, _tenant UUID, _model TEXT, _input_tokens INTEGER, _output_tokens INTEGER)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _ok BOOLEAN;
BEGIN
  UPDATE public.ai_usage_log
     SET model = _model, input_tokens = _input_tokens, output_tokens = _output_tokens
   WHERE id = _log_id AND tenant_id = _tenant
  RETURNING TRUE INTO _ok;
  RETURN coalesce(_ok, FALSE);
END;
$$;
REVOKE ALL ON FUNCTION public.update_ai_usage_tokens_servidor(UUID, UUID, TEXT, INTEGER, INTEGER)
  FROM PUBLIC, anon, authenticated;

SELECT 'ze_tokens_servidor aplicada' AS resultado;
