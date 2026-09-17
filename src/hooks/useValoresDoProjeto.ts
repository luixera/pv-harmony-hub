import { useCallback } from 'react';
import { ProjectWithDetails } from '@/hooks/useProjects';
import { RevisionGeneralData, RevisionEquipment } from '@/hooks/useProjectRevisions';
import { useEquipmentCatalog } from '@/hooks/useEquipmentCatalog';
import { useEntryRules, resolveEntryRule, entryRuleValues } from '@/hooks/useEntryRules';
import { useEngineeringRuleMap } from '@/hooks/useEngineeringRules';
import { engineeringTemplateValues } from '@/utils/engineering/templateValues';
import { buildProjectValues } from '@/utils/projectValues';

/**
 * FONTE ÚNICA das variáveis de um projeto para documentos (memorial,
 * formulários da ENEL e da CEMIG) — o que antes vivia dentro do diálogo de
 * geração e agora o Engenheiro Bidu também precisa, porque ele preenche o
 * formulário da CEMIG por conta própria.
 *
 * Junta: variáveis gerais do projeto, colunas do padrão de entrada da
 * concessionária (regra escolhida vence a automática — `resolveEntryRule` é o
 * ponto único), variáveis de engenharia (arranjo, bitolas, disjuntores) e o
 * nº do INMETRO de módulo e inversor, que mora no Catálogo.
 */

export interface DadosDaRevisao {
  general_data?: RevisionGeneralData;
  equipment?: RevisionEquipment;
}

export function useValoresDoProjeto(project: ProjectWithDetails | null | undefined) {
  const { data: entryRules = [] } = useEntryRules(project?.concessionaire_id ?? undefined);
  const { ruleMap } = useEngineeringRuleMap();
  const { data: catalogo = [] } = useEquipmentCatalog();

  /**
   * Nº do INMETRO do módulo e do inversor, buscados no Catálogo.
   *
   * Casa pelo vínculo quando ele ainda bate com o modelo escrito no projeto, e
   * cai para marca+modelo quando não bate — mesma precaução da aba Unifilar:
   * editar o equipamento à mão troca o texto e deixa o vínculo velho para trás.
   */
  const inmetroValues = useCallback((e: {
    inverter_brand?: string | null; inverter_model?: string | null;
    module_brand?: string | null; module_model?: string | null;
  } | null | undefined) => {
    const norm = (s?: string | null) => (s ?? '').trim().toUpperCase();
    const acha = (tipo: 'inverter' | 'module', marca?: string | null, modelo?: string | null) => {
      const mo = norm(modelo);
      if (!mo) return null;
      const doTipo = catalogo.filter(i => i.type === tipo);
      return doTipo.find(i => norm(i.model) === mo && norm(i.brand) === norm(marca))
          ?? doTipo.find(i => norm(i.model) === mo)
          ?? null;
    };
    return {
      inmetro_modulo: acha('module', e?.module_brand, e?.module_model)?.inmetro_number ?? '',
      inmetro_inversor: acha('inverter', e?.inverter_brand, e?.inverter_model)?.inmetro_number ?? '',
    };
  }, [catalogo]);

  /** Monta as variáveis; `revisao` troca dados gerais/equipamentos pelos de uma revisão; `extras` entra por cima. */
  const construir = useCallback((revisao?: DadosDaRevisao, extras: Record<string, string> = {}): Record<string, string> => {
    if (!project) return { ...extras };
    const g = revisao?.general_data ?? project.generalData;
    const e = revisao?.equipment ?? project.equipment;
    const entryRule = resolveEntryRule(entryRules, g);
    return {
      ...entryRuleValues(entryRule),
      ...engineeringTemplateValues({
        totalModules: e?.module_quantity,
        modulePowerW: e?.module_power,
        inverterPowerKw: e?.inverter_power,
        inverterCount: e?.inverter_quantity,
        phaseType: g?.phase_type,
      }, ruleMap),
      ...buildProjectValues(project, { generalData: revisao?.general_data, equipment: revisao?.equipment }),
      ...inmetroValues(e),
      ...extras,
    };
  }, [project, entryRules, ruleMap, inmetroValues]);

  return { construir, entryRules };
}
