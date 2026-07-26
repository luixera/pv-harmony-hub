import {
  RuleMap, suggestElectricalSizing, suggestProjectArrangement,
} from './rulesEngine';

/**
 * Variáveis de ENGENHARIA para os templates .docx (memoriais descritivos) —
 * a ponte entre o Rules Engine e o gerador de documentos. Tudo vem das
 * regras do banco + dados do projeto; sem dado suficiente, a tag resolve
 * vazia (o documento continua saindo — nunca bloqueia).
 *
 * Chaves novas registradas em `TEMPLATE_VARIABLES` (projectValues.ts,
 * categoria "Engenharia (Motor)") — manter os dois em sincronia.
 */

function fmtPct(v: number): string {
  return `${v.toFixed(2).replace('.', ',')}%`;
}

export interface EngineeringTemplateInput {
  totalModules?: number | null;
  modulePowerW?: number | null;
  inverterPowerKw?: number | null;
  inverterCount?: number | null;
  phaseType?: string | null;
}

export function engineeringTemplateValues(input: EngineeringTemplateInput, rules: RuleMap): Record<string, string> {
  const values: Record<string, string> = {
    arranjo_strings: '', arranjo_strings_resumo: '',
    bitola_cc: '', bitola_ca: '', queda_tensao_cc: '', queda_tensao_ca: '',
    disjuntor_ca: '', disjuntor_geral_ca: '', bitola_aterramento: '',
  };

  const n = Math.max(1, Number(input.inverterCount ?? 1) || 1);
  const totalModules = Math.max(0, Number(input.totalModules ?? 0) || 0);
  const powerKw = Number(input.inverterPowerKw ?? 0) || undefined;
  const rawPhase = String(input.phaseType ?? '').toLowerCase();
  const phaseType = rawPhase.includes('tri') ? 'trifasico' as const
    : rawPhase.includes('bi') ? 'bifasico' as const : 'monofasico' as const;

  // ── Arranjo de strings (a MELHOR opção do motor, a mesma do "Usar esta") ──
  let dcVoltageV: number | undefined;
  if (totalModules > 0) {
    const engine = suggestProjectArrangement({
      totalModules,
      moduleSpecs: { powerW: Number(input.modulePowerW ?? 0) || undefined },
      inverters: Array.from({ length: n }, () => ({ powerKw })),
    }, rules);
    const best = engine.options[0];
    if (best) {
      const lines: string[] = [];
      for (let i = 0; i < best.perInverter.length; i++) {
        const arr = best.perInverter[i];
        lines.push(n > 1 ? `Inversor ${i + 1}:` : 'Inversor:');
        // uma linha por MPPT usado (formato dos memoriais reais)
        arr.stringsPerMppt.forEach((qtd, m) => {
          if (qtd <= 0) return;
          const size = arr.stringSizes[0] ?? 0;
          lines.push(`    ${qtd} string${qtd > 1 ? 's' : ''} de ${size} módulos ligada${qtd > 1 ? 's' : ''} ao MPPT${m + 1};`);
        });
      }
      lines.push(`Total: ${totalModules} módulos${n > 1 ? ` – ${n} inversores` : ''}.`);
      values.arranjo_strings = lines.join('\n');
      values.arranjo_strings_resumo = best.perInverter.map((a, i) => (n > 1 ? `Inversor ${i + 1}: ${a.label}` : a.label)).join(' · ');
      dcVoltageV = best.perInverter[0]?.operatingVoltageV ?? undefined;
    }
  }

  // ── Dimensionamento elétrico: por inversor (disjuntor de cada) ────────────
  const perInv = suggestElectricalSizing({ inverterPowerKw: powerKw, phaseType, dcVoltageV }, rules);
  if (perInv.dc) {
    values.bitola_cc = `${perInv.dc.sectionMm2} mm²`;
    values.queda_tensao_cc = fmtPct(perInv.dc.voltageDropPct);
  }
  if (perInv.ac) {
    values.bitola_ca = `${perInv.ac.sectionMm2} mm²`;
    values.queda_tensao_ca = fmtPct(perInv.ac.voltageDropPct);
  }
  if (perInv.breakerA != null) values.disjuntor_ca = `${perInv.breakerA}A`;
  if (perInv.groundSectionMm2 != null) values.bitola_aterramento = `${perInv.groundSectionMm2} mm²`;

  // disjuntor geral = dimensionado pra potência TOTAL (junção dos arranjos)
  if (powerKw && n > 1) {
    const total = suggestElectricalSizing({ inverterPowerKw: powerKw * n, phaseType }, rules);
    if (total.breakerA != null) values.disjuntor_geral_ca = `${total.breakerA}A`;
  } else if (perInv.breakerA != null) {
    values.disjuntor_geral_ca = `${perInv.breakerA}A`; // 1 inversor: geral = o próprio
  }

  return values;
}
