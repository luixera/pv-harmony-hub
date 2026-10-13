-- ============================================================================
-- TENSÃO DA REDE DA UC (05/10/2026)
--
-- O Motor de Engenharia só conhecia UMA tensão trifásica — a regra
-- `voltage_drop.ac_voltage_tri_v`, 380 V. Em rede 127/220 (CEMIG e boa parte
-- de MG/SP) o inversor trifásico entrega em 220 V: calculando em 380 V a
-- corrente sai 1,73× menor que a real e o disjuntor e a bitola do diagrama
-- saem subdimensionados — a mesma família de erro do PRJ-66266, pelo outro
-- lado. O formulário da CEMIG já escrevia "127/220" fixo; o motor não sabia.
--
-- A tensão passa a ser um dado do PROJETO (a UC é que define), com padrão
-- sugerido pela concessionária. Guardada como o par fase-neutro/fase-fase que
-- o eletricista usa ("127/220"), e não em volts soltos: é assim que aparece na
-- conta de luz e no formulário da concessionária. A tensão trifásica é o
-- ÚLTIMO número do par; mono e bifásico seguem na regra `ac_voltage_mono_v`
-- (220 V nos dois pares usados no Brasil).
--
-- Sem valor preenchido, nada muda: o motor continua caindo na regra de 380 V.
-- ============================================================================

ALTER TABLE public.project_general_data   ADD COLUMN IF NOT EXISTS grid_voltage TEXT;
ALTER TABLE public.revision_general_data  ADD COLUMN IF NOT EXISTS grid_voltage TEXT;
ALTER TABLE public.energy_concessionaires ADD COLUMN IF NOT EXISTS grid_voltage TEXT;

COMMENT ON COLUMN public.project_general_data.grid_voltage IS
  'Tensão da rede da UC, par fase-neutro/fase-fase ("127/220", "220/380"). '
  'O Motor de Engenharia usa o último número como tensão trifásica. '
  'NULL = não informado, cai na regra voltage_drop.ac_voltage_tri_v.';
COMMENT ON COLUMN public.revision_general_data.grid_voltage IS
  'Tensão da rede da UC nesta revisão — ver project_general_data.grid_voltage.';
COMMENT ON COLUMN public.energy_concessionaires.grid_voltage IS
  'Tensão de rede PADRÃO desta concessionária, sugerida ao projeto quando o '
  'cadastro da UC não traz a dela. A UC pode fugir do padrão (rural, indústria).';

-- Semeado só o que é fato conhecido: a CEMIG opera em 127/220 — é o que o
-- formulário MicroGD aceito já declara. As demais ficam NULL de propósito:
-- preencher no chute mudaria disjuntor e bitola de projeto que hoje está certo.
UPDATE public.energy_concessionaires
   SET grid_voltage = '127/220'
 WHERE grid_voltage IS NULL AND name ILIKE '%cemig%';
