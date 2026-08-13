-- O extrato de IA calcula pelos tokens reais quando eles chegam; o CASE de
-- baixo é o palpite usado quando o registro de tokens falhou (é best-effort na
-- edge function). Sem esta linha, uma leitura de datasheet — Opus + PDF —
-- entrava no extrato como 0,02 (preço estimado do Claudinho, que roda em
-- Haiku), subestimando o consumo.
--
-- ATENÇÃO à ORDEM DOS PARÂMETROS: a função é `(_model, _in, _out, _kind)`,
-- não `(_kind, _model, _in, _out)`. Escrever na ordem "natural" cria uma
-- SOBRECARGA nova em vez de substituir — o `create or replace` casa por
-- assinatura, e o extrato continuaria chamando a antiga. A linha de `drop`
-- abaixo limpa exatamente essa sobrecarga, caso tenha sido criada.
drop function if exists public.ai_call_cost_usd(text, text, integer, integer);

create or replace function public.ai_call_cost_usd(_model text, _in integer, _out integer, _kind text)
returns numeric
language sql
immutable
as $$
  SELECT CASE
    WHEN _in IS NOT NULL AND _out IS NOT NULL THEN
      CASE
        WHEN _model LIKE '%opus%'   THEN _in * 5.0/1000000  + _out * 25.0/1000000
        WHEN _model LIKE '%haiku%'  THEN _in * 1.0/1000000  + _out * 5.0/1000000
        WHEN _model LIKE '%sonnet%' THEN _in * 3.0/1000000  + _out * 15.0/1000000
        ELSE _in * 5.0/1000000 + _out * 25.0/1000000
      END
    ELSE CASE
      WHEN _kind LIKE 'diagram_%'      THEN 0.30  -- Opus + PDF/imagens + thinking
      WHEN _kind = 'datasheet_extract' THEN 0.10  -- Opus + PDF de poucas páginas
      ELSE 0.02                                   -- Claudinho (Haiku)
    END
  END;
$$;
