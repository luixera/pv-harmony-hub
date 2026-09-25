-- ============================================================================
-- VÍNCULO COM O CATÁLOGO — conserta os projetos cujo equipamento foi trocado
-- (25/09/2026)
--
-- `project_equipment.inverter_catalog_id` / `module_catalog_id` apontam para o
-- item do catálogo escolhido no combobox. Trocar o equipamento no modal mudava
-- marca/modelo e NÃO mexia no vínculo — ele ficava apontando para o
-- equipamento antigo. Resultado relatado pelo usuário: o **pacote do
-- instalador** saiu com o INMETRO/datasheet do equipamento que não é mais o do
-- projeto (o mesmo defeito que o motor de engenharia teve em ago/2026,
-- PRJ-49561, e que só tinha sido corrigido na aba Unifilar).
--
-- O código já foi corrigido (o modal atualiza/limpa o vínculo; o pacote só
-- confia nele se ainda bater com o modelo escrito). Aqui fica a limpeza dos
-- dados: vínculo que não corresponde mais ao equipamento é REAPONTADO para o
-- item certo do catálogo — e, se o equipamento não estiver no catálogo, é
-- apagado (NULL), que é a verdade: não há item vinculado.
-- ============================================================================

-- mesma chave da comparação no front (`chaveEquip`): só letras e números
CREATE OR REPLACE FUNCTION public.chave_equipamento(t TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE
AS $$ SELECT lower(regexp_replace(coalesce(t, ''), '[^a-zA-Z0-9]', '', 'g')); $$;

DO $$
DECLARE _e RECORD; _novo UUID; _n INTEGER := 0;
BEGIN
  FOR _e IN
    SELECT e.project_id, e.inverter_catalog_id, e.inverter_brand, e.inverter_model,
           e.module_catalog_id, e.module_brand, e.module_model
      FROM public.project_equipment e
     WHERE e.inverter_catalog_id IS NOT NULL OR e.module_catalog_id IS NOT NULL
  LOOP
    -- inversor
    IF _e.inverter_catalog_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.equipment_catalog c
       WHERE c.id = _e.inverter_catalog_id
         AND public.chave_equipamento(c.model) = public.chave_equipamento(_e.inverter_model)
    ) THEN
      SELECT c.id INTO _novo FROM public.equipment_catalog c
       WHERE c.type = 'inverter'
         AND public.chave_equipamento(c.model) = public.chave_equipamento(_e.inverter_model)
       ORDER BY (public.chave_equipamento(c.brand) = public.chave_equipamento(_e.inverter_brand)) DESC
       LIMIT 1;
      UPDATE public.project_equipment SET inverter_catalog_id = _novo WHERE project_id = _e.project_id;
      _n := _n + 1;
    END IF;

    -- módulo
    IF _e.module_catalog_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.equipment_catalog c
       WHERE c.id = _e.module_catalog_id
         AND public.chave_equipamento(c.model) = public.chave_equipamento(_e.module_model)
    ) THEN
      SELECT c.id INTO _novo FROM public.equipment_catalog c
       WHERE c.type = 'module'
         AND public.chave_equipamento(c.model) = public.chave_equipamento(_e.module_model)
       ORDER BY (public.chave_equipamento(c.brand) = public.chave_equipamento(_e.module_brand)) DESC
       LIMIT 1;
      UPDATE public.project_equipment SET module_catalog_id = _novo WHERE project_id = _e.project_id;
      _n := _n + 1;
    END IF;
  END LOOP;
  RAISE NOTICE 'vínculos corrigidos: %', _n;
END $$;
