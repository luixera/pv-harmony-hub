-- ============================================================================
-- Eletropostos — estação de serviço (VPS + celular na nuvem VMOS), 16/10/2026
--
-- A estação passa a rodar na VPS, falando adb com um aparelho do VMOS Cloud.
-- Lá não há login de pessoa: ela grava com a service role
-- (eletropostos_gravar, que já aceita p_falhas e passo_min) e bate com o seu
-- próprio id. Uma estação de serviço não tem operador.
-- ============================================================================

ALTER TABLE public.eletroposto_estacao ALTER COLUMN operador DROP NOT NULL;

-- batimento de uma estação de serviço: só service role, pelo id da estação
CREATE OR REPLACE FUNCTION public.eletropostos_estacao_pulsa(p_estacao uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Só o service role dá o batimento de uma estação de serviço';
  END IF;
  UPDATE public.eletroposto_estacao SET vista_em = now() WHERE id = p_estacao AND ativa;
  IF NOT FOUND THEN RAISE EXCEPTION 'estação % não existe ou está desativada', p_estacao; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.eletropostos_estacao_pulsa(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.eletropostos_estacao_pulsa(uuid) TO service_role;

-- a estação da VPS (id fixo, citado no ambiente do serviço gdm-estacao)
INSERT INTO public.eletroposto_estacao (id, nome, operador, ativa)
VALUES ('5e7a0000-e1e7-4000-8000-000000000001', 'VPS + VMOS (celular na nuvem)', NULL, true)
ON CONFLICT (id) DO NOTHING;
