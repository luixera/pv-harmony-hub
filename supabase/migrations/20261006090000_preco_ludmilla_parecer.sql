-- Extrato de IA: estimativa sem-tokens do `ludmilla_parecer`
--
-- Regra da casa: ao criar/trocar modelo de edge function, atualizar
-- ai_call_cost_usd. O kind `ludmilla_parecer` (edge function que lê o parecer de
-- acesso da concessionária) não estava na estimativa sem-tokens e caía no
-- ELSE 0.02, que é o ramo do Claudinho/Haiku — barato demais para uma leitura
-- Sonnet 5 de um PDF de várias páginas. O caso comparável é o
-- `datasheet_extract` (PDF + modelo grande), estimado em US$ 0,10.
--
-- A estimativa sem-tokens só vale quando a chamada NÃO devolveu usage (resposta
-- 200 ilegível, por exemplo). Com tokens reais, o preço por modelo manda — e ele
-- já está certo (sonnet-5 = 2/10), não se mexe nele aqui.
--
-- ARMADILHA (já mordeu neste projeto): a assinatura tem de ser IDÊNTICA —
-- (_model, _in, _out, _kind). Escrever na ordem "natural" cria uma SOBRECARGA
-- nova e o extrato segue chamando a antiga, sem erro nenhum. Por isso a função
-- vem copiada INTEIRA da migração mais recente (20260923180000_preco_por_modelo)
-- com só o ramo novo acrescentado: CREATE OR REPLACE troca o corpo todo, e
-- reescrever de memória perderia lógica. O SELECT no fim confere que só existe
-- UMA entrada em pg_proc para o nome.
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
      WHEN _kind = 'ludmilla_parecer'  THEN 0.10  -- Sonnet 5 + PDF do parecer de acesso
      WHEN _kind LIKE 'ze_%'           THEN 0.05  -- o Zé sempre manda tokens; isto é só rede de segurança
      ELSE 0.02                                   -- Claudinho (Haiku)
    END
  END;
$$;

-- Conferência (só o ÚLTIMO SELECT com linhas aparece na saída da CLI).
SELECT 'funções com o nome ai_call_cost_usd: ' || count(*)::text
    || ' (tem de ser 1)'
    || E'\nestimativa SEM tokens:'
    || E'\n  ludmilla_parecer: US$ ' || public.ai_call_cost_usd('claude-sonnet-5', NULL, NULL, 'ludmilla_parecer')::text
    || ' (tem de ser 0.10 — era 0.02 pelo ELSE)'
    || E'\n  datasheet_extract: US$ ' || public.ai_call_cost_usd('claude-opus-5', NULL, NULL, 'datasheet_extract')::text
    || E'\n  kind desconhecido: US$ ' || public.ai_call_cost_usd('claude-haiku-4-5', NULL, NULL, 'claudinho_analyze')::text
    || ' (o ELSE 0.02 continua de pé)'
    || E'\npreço por tokens REAIS (intocado) — 1M entrada + 100k saída:'
    || E'\n  sonnet-5: US$ ' || round(public.ai_call_cost_usd('claude-sonnet-5', 1000000, 100000, 'ludmilla_parecer')::numeric, 2)
    || ' (tem de ser 3.00)'
   AS resultado
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'ai_call_cost_usd';
