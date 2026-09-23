-- Extrato de IA: preço por modelo, não por família
--
-- A função tratava todo "sonnet" como 3/15 (preço do Sonnet 4.6). O Sonnet 5
-- custa 2/10 — com o Zé indo para Sonnet 5, o painel passaria a cobrar 50% a
-- mais do que a Anthropic. Agora cada geração tem seu preço.
--
-- ARMADILHA (já mordeu neste projeto): a assinatura tem de ser IDÊNTICA —
-- (_model, _in, _out, _kind). Escrever na ordem "natural" cria uma SOBRECARGA
-- nova e o extrato segue chamando a antiga, sem erro nenhum. Depois de
-- aplicar, confira que só existe UMA entrada em pg_proc para o nome (o SELECT
-- no fim faz isso).
--
-- Preços por 1M de tokens (entrada/saída), tabela da Anthropic em set/2026:
--   Fable 5 / 5.1 ....... 10 / 50
--   Opus 5 / 4.8 / 4.7 ... 5 / 25
--   Sonnet 5 ............. 2 / 10
--   Sonnet 4.6 ........... 3 / 15
--   Haiku 4.5 ............ 1 / 5

-- O retorno original é NUMERIC: trocar por double precision faz o Postgres
-- exigir DROP (e o DROP derrubaria as views/chamadas que dependem dela).
CREATE OR REPLACE FUNCTION public.ai_call_cost_usd(_model TEXT, _in INTEGER, _out INTEGER, _kind TEXT)
RETURNS NUMERIC
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE
    WHEN _in IS NOT NULL AND _out IS NOT NULL THEN
      CASE
        -- do mais específico para o mais geral: 'sonnet-5' antes de 'sonnet'
        WHEN _model LIKE '%fable%' OR _model LIKE '%mythos%'
                                    THEN _in * 10.0/1000000 + _out * 50.0/1000000
        WHEN _model LIKE '%sonnet-5%' THEN _in *  2.0/1000000 + _out * 10.0/1000000
        WHEN _model LIKE '%sonnet%'   THEN _in *  3.0/1000000 + _out * 15.0/1000000
        WHEN _model LIKE '%opus%'     THEN _in *  5.0/1000000 + _out * 25.0/1000000
        WHEN _model LIKE '%haiku%'    THEN _in *  1.0/1000000 + _out *  5.0/1000000
        ELSE _in * 5.0/1000000 + _out * 25.0/1000000
      END
    ELSE CASE
      WHEN _kind LIKE 'diagram_%'      THEN 0.30  -- Opus + PDF/imagens + thinking
      WHEN _kind = 'datasheet_extract' THEN 0.10  -- Opus + PDF de poucas páginas
      WHEN _kind LIKE 'ze_%'           THEN 0.05  -- o Zé sempre manda tokens; isto é só rede de segurança
      ELSE 0.02                                   -- Claudinho (Haiku)
    END
  END;
$$;

-- O Zé passa a usar Sonnet 5 (decisão do usuário, 23/09): mesma capacidade de
-- conversa por ~1/3 do custo. Trocar de volta é mudar este campo.
UPDATE public.ze_config SET modelo_ia = 'claude-sonnet-5' WHERE modelo_ia = 'claude-opus-5';

SELECT 'funções com o nome ai_call_cost_usd: ' || count(*)::text
    || ' (tem de ser 1)'
    || E'\nconferência de preço — 1M entrada + 100k saída:'
    || E'\n  sonnet-5: US$ ' || round(public.ai_call_cost_usd('claude-sonnet-5', 1000000, 100000, 'ze_chat')::numeric, 2)
    || E'\n  sonnet-4-6: US$ ' || round(public.ai_call_cost_usd('claude-sonnet-4-6', 1000000, 100000, 'ze_chat')::numeric, 2)
    || E'\n  opus-5: US$ ' || round(public.ai_call_cost_usd('claude-opus-5', 1000000, 100000, 'ze_chat')::numeric, 2)
    || E'\n  haiku-4-5: US$ ' || round(public.ai_call_cost_usd('claude-haiku-4-5-20251001', 1000000, 100000, 'claudinho_analyze')::numeric, 2)
    || E'\nmodelo do Zé agora: ' || (SELECT modelo_ia FROM public.ze_config LIMIT 1)
   AS resultado
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'ai_call_cost_usd';
