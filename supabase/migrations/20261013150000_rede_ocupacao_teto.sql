-- Teto na ocupação guardada.
--
-- A ocupação é uma razão sem limite (GD / carga mínima) e rede_*.ocupacao_pct é
-- NUMERIC(8,2), que para em 999.999,99. Na 1ª carga da CPFL Paulista
-- (13/10/2026) 53 trafos passavam de 1 milhão de % — o pior, 0,44 kW de carga
-- contra 73.000 kW de GD — e "numeric field overflow" derrubou a promoção
-- inteira (atomicamente: nada ficou meio-carregado).
--
-- Por que teto e não coluna maior: alargar a coluna exige recriar as views que
-- a leem. E acima de ~1000x o número exato não informa nada a mais. O ESTADO
-- não é afetado: rede_classificar calcula a razão por conta própria, sem teto,
-- e o pior caso continua "risco".
--
-- (Parte dos casos extremos vinha de POT_INST em watts na BDGD — corrigido na
-- ingestão, ver POT_INST_KW em worker/ludmilla/src/bdgd/extrair.ts. O teto fica
-- mesmo assim: é a coluna que não pode quebrar a carga, qualquer que seja o dado.)
CREATE OR REPLACE FUNCTION public.rede_ocupacao(p_carga NUMERIC, p_gd NUMERIC, p_fator NUMERIC)
RETURNS NUMERIC LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $fn$
  SELECT CASE WHEN p_carga > 0 AND p_gd IS NOT NULL
              THEN least(round(p_gd / (p_carga * p_fator) * 100, 2), 99999.99) END;
$fn$;
