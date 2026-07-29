/**
 * Engineering Rules Engine (Fase 1) — o cérebro de dimensionamento
 * SIMPLIFICADO do GD Manager.
 *
 * Princípios (combinados com o usuário):
 * - NUNCA desenha: só aplica regras e devolve sugestões + alertas.
 * - NUNCA bloqueia: todo problema vira alerta âmbar com sugestão de correção.
 * - Nenhum valor fixo no código: os valores vêm das regras do banco
 *   (`engineering_rules`) — o código só conhece as CHAVES.
 * - Toda sugestão sai EXPLICADA em português simples, com a fonte da regra,
 *   pra quem tem pouco conhecimento de engenharia conseguir decidir.
 * - Não substitui PVsyst/Helioscope/AutoCAD — automatiza o projeto
 *   convencional de baixa/média complexidade.
 */

// ── Tipos ────────────────────────────────────────────────────────────────────

/** Uma regra vinda do banco (tela "Regras de Engenharia"). */
export interface EngineeringRule {
  id?: string;
  groupKey: string;
  ruleKey: string;
  label: string;
  enabled: boolean;
  valueDefault: number | null;
  valueMin: number | null;
  valueMax: number | null;
  unit: string | null;
  priority: number;
  source: string;
  notes: string | null;
}

/** Mapa `grupo.chave` → regra — como o motor consome as regras. */
export type RuleMap = Map<string, EngineeringRule>;

export function buildRuleMap(rules: EngineeringRule[]): RuleMap {
  return new Map(rules.map(r => [`${r.groupKey}.${r.ruleKey}`, r]));
}

/** Valor de uma regra habilitada (ou o fallback se ausente/desabilitada). */
export function ruleValue(rules: RuleMap, key: string, fallback: number): number {
  const r = rules.get(key);
  if (!r || !r.enabled || r.valueDefault === null || !Number.isFinite(Number(r.valueDefault))) return fallback;
  return Number(r.valueDefault);
}

function ruleSource(rules: RuleMap, key: string): string {
  return rules.get(key)?.source ?? 'Regra interna';
}

/**
 * A FUNÇÃO do motor deste grupo está ligada? (interruptor `group_enabled`
 * no cabeçalho de cada card da tela Regras de Engenharia — pedido do
 * usuário: habilitar/desabilitar cada regra E cada função). Sem a regra,
 * a função fica ligada por padrão.
 */
export function isGroupEnabled(rules: RuleMap, group: string): boolean {
  return ruleValue(rules, `${group}.group_enabled`, 1) === 1;
}

/** Datasheet estruturado do inversor (equipment_catalog.tech_specs). */
export interface InverterSpecs {
  mpptCount?: number;
  stringsPerMppt?: number;
  mpptVminV?: number;
  mpptVmaxV?: number;
  maxDcVoltageV?: number;
  maxMpptCurrentA?: number;
  powerKw?: number;
  /** Corrente CA máxima de saída (datasheet) — base exata do disjuntor do arranjo. */
  maxAcCurrentA?: number;
}

/** Datasheet estruturado do módulo. */
export interface ModuleSpecs {
  vocV?: number;
  vmpV?: number;
  iscA?: number;
  impA?: number;
  powerW?: number;
}

export interface EngineAlert {
  severity: 'warning' | 'info';
  code: string;
  message: string;
  /** O que fazer a respeito — sempre que possível. */
  suggestion?: string;
  source?: string;
}

/** Um arranjo de strings sugerido pra UM inversor. */
export interface StringArrangement {
  /** Ex.: "6 strings × 20 módulos". */
  label: string;
  /** Módulos em cada string (uniforme ou quase — ex.: [20,20,20,20,20,20]). */
  stringSizes: number[];
  totalModules: number;
  /** Strings por MPPT (distribuição round-robin equilibrada). */
  stringsPerMppt: number[];
  /** Tensão de operação estimada da string (n × Vmp), se houver datasheet. */
  operatingVoltageV: number | null;
  /** Tensão máxima a frio estimada (n × Voc × fator), se houver datasheet. */
  coldVoltageV: number | null;
  /** Explicação em português simples do porquê este arranjo é válido. */
  explanation: string;
  /** Quanto menor, melhor (usado só pra ordenar internamente). */
  score: number;
}

/** Divisão de módulos entre inversores. */
export interface InverterSplit {
  label: string;
  /** Módulos por inversor, na ordem recebida. */
  modulesPerInverter: number[];
  explanation: string;
}

export interface ProjectArrangementOption {
  id: string;
  title: string;
  /** Divisão entre inversores (1 entrada quando há um só). */
  split: InverterSplit;
  /** Arranjo de strings por inversor (mesma ordem do split). */
  perInverter: StringArrangement[];
  summary: string;
}

export interface EngineResult {
  options: ProjectArrangementOption[];
  alerts: EngineAlert[];
}

// ── Grupo 1: Strings ─────────────────────────────────────────────────────────

interface StringWindow {
  minN: number;
  maxN: number;
  mppts: number;
  perMppt: number;
  approximate: boolean; // true = calculado por fallback (sem datasheet)
  /** Motivo do teto de módulos por string, quando um limite das regras mandou. */
  capReason: string | null;
}

/** Janela válida de módulos por string + capacidade de strings do inversor. */
function stringWindow(inv: InverterSpecs, mod: ModuleSpecs, rules: RuleMap): StringWindow {
  const mppts = inv.mpptCount ?? ruleValue(rules, 'strings.default_mppt_count', 2);
  const perMppt = inv.stringsPerMppt ?? ruleValue(rules, 'strings.default_strings_per_mppt', 2);
  const vmin = inv.mpptVminV ?? ruleValue(rules, 'strings.default_mppt_vmin', 200);
  const vmax = inv.mpptVmaxV ?? ruleValue(rules, 'strings.default_mppt_vmax', 800);
  const maxDc = inv.maxDcVoltageV ?? ruleValue(rules, 'strings.default_max_dc_voltage', 1000);
  const vocFactor = ruleValue(rules, 'strings.voc_temp_factor', 1.13);

  const hasVoltageData = !!(mod.vmpV && mod.vocV);
  let minN: number;
  let maxN: number;
  if (hasVoltageData) {
    minN = Math.ceil(vmin / mod.vmpV!);
    maxN = Math.min(
      Math.floor(vmax / mod.vmpV!),
      Math.floor(maxDc / (mod.vocV! * vocFactor)),
    );
  } else {
    minN = ruleValue(rules, 'strings.min_modules_per_string', 6);
    maxN = ruleValue(rules, 'strings.max_modules_per_string', 24);
  }

  // TETO de módulos por string — vale SEMPRE, com ou sem datasheet. (Antes só
  // era aplicado no fallback: quem tinha tensões no catálogo via a regra ser
  // ignorada e recebia strings longas demais.) Inversores pequenos têm um
  // teto próprio, mais apertado, porque a janela de tensão do MPPT deles não
  // comporta strings longas.
  let capReason: string | null = null;
  const hardMax = ruleValue(rules, 'strings.max_modules_per_string', 24);
  if (maxN > hardMax) {
    maxN = hardMax;
    capReason = `limite de ${hardMax} módulos por string das Regras de Engenharia`;
  }
  const smallKw = ruleValue(rules, 'strings.small_inverter_kw_limit', 10);
  const smallMax = ruleValue(rules, 'strings.max_modules_small_inverter', 11);
  if (inv.powerKw && inv.powerKw <= smallKw && maxN > smallMax) {
    maxN = smallMax;
    capReason = `limite de ${smallMax} módulos por string para inversores de até ${smallKw} kW`;
  }

  const approximate = !hasVoltageData
    || inv.mpptCount === undefined || inv.stringsPerMppt === undefined
    || inv.mpptVminV === undefined || inv.mpptVmaxV === undefined || inv.maxDcVoltageV === undefined;
  return { minN: Math.max(1, minN), maxN: Math.max(1, maxN), mppts, perMppt, approximate, capReason };
}

/** Distribui `count` strings entre `mppts` MPPTs, o mais equilibrado possível. */
function distributeStringsAcrossMppts(count: number, mppts: number): number[] {
  const base = Math.floor(count / mppts);
  const extra = count % mppts;
  return Array.from({ length: mppts }, (_, i) => base + (i < extra ? 1 : 0));
}

/**
 * Sugestões de arranjo de strings pra UM inversor (Grupo 1) — sempre tenta
 * devolver pelo menos `suggestions.num_suggestions` opções válidas,
 * ordenadas da melhor pra pior.
 */
export function suggestStringArrangements(
  totalModules: number,
  inv: InverterSpecs,
  mod: ModuleSpecs,
  rules: RuleMap,
): { arrangements: StringArrangement[]; alerts: EngineAlert[] } {
  const alerts: EngineAlert[] = [];
  if (!isGroupEnabled(rules, 'strings')) {
    return { arrangements: [], alerts: [{ severity: 'info', code: 'group_disabled', message: 'Sugestões de strings desligadas nas Regras de Engenharia (grupo Strings).' }] };
  }
  if (totalModules <= 0) return { arrangements: [], alerts };
  const w = stringWindow(inv, mod, rules);
  const tolerance = ruleValue(rules, 'strings.balance_tolerance_modules', 1);
  const maxStrings = w.mppts * w.perMppt;
  const wanted = Math.max(2, ruleValue(rules, 'suggestions.num_suggestions', 2));

  if (w.approximate && ruleValue(rules, 'alerts.warn_on_incomplete_datasheet', 1) === 1) {
    alerts.push({
      severity: 'info',
      code: 'incomplete_datasheet',
      message: 'Equipamento sem datasheet completo no catálogo — as sugestões usam os valores-padrão das Regras de Engenharia.',
      suggestion: 'Preencha os dados técnicos do inversor e do módulo no Catálogo de Equipamentos pra sugestões exatas.',
      source: ruleSource(rules, 'alerts.warn_on_incomplete_datasheet'),
    });
  }

  const candidates: StringArrangement[] = [];
  const midN = (w.minN + w.maxN) / 2;
  for (let s = 1; s <= maxStrings; s++) {
    const base = Math.floor(totalModules / s);
    const rest = totalModules % s;
    // uniforme (rest=0) ou quase-uniforme (strings de base+1 e base)
    const sizes = Array.from({ length: s }, (_, i) => base + (i < rest ? 1 : 0));
    const nMin = Math.min(...sizes);
    const nMax = Math.max(...sizes);
    if (nMin < w.minN || nMax > w.maxN) continue;
    if (nMax - nMin > tolerance) continue;
    const uniform = rest === 0;
    const perMppt = distributeStringsAcrossMppts(s, w.mppts);
    const mpptSpread = Math.max(...perMppt) - Math.min(...perMppt);
    const operatingV = mod.vmpV ? Math.round(nMax * mod.vmpV) : null;
    const coldV = mod.vocV ? Math.round(nMax * mod.vocV * ruleValue(rules, 'strings.voc_temp_factor', 1.13)) : null;
    // score: uniforme > misto; tensão no meio da janela; MPPTs equilibrados; menos strings
    const score =
      (uniform ? 0 : 4)
      + Math.abs(nMax - midN)
      + mpptSpread * 2
      + s * 0.1;
    const sizesLabel = uniform
      ? `${s} string(s) × ${base} módulos`
      : `${rest} string(s) × ${base + 1} + ${s - rest} string(s) × ${base}`;
    const voltagePart = operatingV
      ? ` Tensão de operação ~${operatingV}V${coldV ? ` (a frio ~${coldV}V)` : ''}, dentro da faixa do MPPT.`
      : '';
    candidates.push({
      label: sizesLabel,
      stringSizes: sizes,
      totalModules,
      stringsPerMppt: perMppt,
      operatingVoltageV: operatingV,
      coldVoltageV: coldV,
      explanation: `${sizesLabel} — ${perMppt.join(' + ')} string(s) por MPPT (${w.mppts} MPPT${w.mppts > 1 ? 's' : ''}).${voltagePart}`,
      score,
    });
  }
  candidates.sort((a, b) => a.score - b.score);
  const top = candidates.slice(0, Math.max(wanted, 2));

  if (candidates.length === 0) {
    alerts.push({
      severity: 'warning',
      code: 'no_valid_arrangement',
      message: `Não achei um arranjo válido pra ${totalModules} módulos neste inversor (janela de ${w.minN} a ${w.maxN} módulos por string${w.capReason ? `, pelo ${w.capReason}` : ''}, até ${maxStrings} strings).`,
      suggestion: 'Ajuste a quantidade de módulos, use outro inversor ou revise as regras do Grupo Strings.',
      source: ruleSource(rules, 'strings.min_modules_per_string'),
    });
  } else if (w.capReason) {
    alerts.push({
      severity: 'info',
      code: 'string_cap_applied',
      message: `Strings limitadas a ${w.maxN} módulos pelo ${w.capReason}.`,
      suggestion: 'Pra mudar, ajuste o Grupo Strings nas Regras de Engenharia.',
      source: ruleSource(rules, 'strings.max_modules_per_string'),
    });
  }
  if (candidates.length === 1) {
    alerts.push({
      severity: 'info',
      code: 'single_arrangement',
      message: 'Só existe um arranjo válido pra esta combinação de módulos e inversor.',
    });
  }
  return { arrangements: top, alerts };
}

// ── Grupo 2: Distribuição entre inversores ───────────────────────────────────

/**
 * Divide os módulos entre os inversores (Grupo 2): proporcional à potência de
 * cada um, priorizando equilíbrio. Devolve até 2 divisões diferentes.
 */
export function distributeAcrossInverters(
  totalModules: number,
  inverterPowersKw: number[],
  rules: RuleMap,
): { splits: InverterSplit[]; alerts: EngineAlert[] } {
  const alerts: EngineAlert[] = [];
  const n = inverterPowersKw.length;
  if (n === 0 || totalModules <= 0) return { splits: [], alerts };
  if (n === 1) {
    return {
      splits: [{ label: `${totalModules} módulos no inversor único`, modulesPerInverter: [totalModules], explanation: 'Projeto com um inversor — todos os módulos nele.' }],
      alerts,
    };
  }
  const groupOn = isGroupEnabled(rules, 'inverter_distribution');
  const totalPower = inverterPowersKw.reduce((a, b) => a + b, 0) || n;
  // A: proporcional à potência, arredondando e ajustando o resto no maior
  const ideal = inverterPowersKw.map(p => (totalModules * (p || totalPower / n)) / totalPower);
  const floorSplit = ideal.map(Math.floor);
  let remaining = totalModules - floorSplit.reduce((a, b) => a + b, 0);
  const byFraction = ideal
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);
  const splitA = [...floorSplit];
  for (let k = 0; k < remaining; k++) splitA[byFraction[k % n].i] += 1;

  // B: alternativa — desloca 2 módulos entre os dois inversores (do mais
  // carregado pro menos; se estiverem iguais, entre os dois primeiros) —
  // mostra que dá pra acomodar tamanhos de string diferentes
  const splitB = [...splitA];
  let maxI = splitB.indexOf(Math.max(...splitB));
  let minI = splitB.indexOf(Math.min(...splitB));
  if (maxI === minI) { maxI = 0; minI = 1; } // tudo igual: variação simétrica
  if (splitB[maxI] - 2 > 0) { splitB[maxI] -= 2; splitB[minI] += 2; }

  const maxImbalance = ruleValue(rules, 'inverter_distribution.max_power_imbalance_pct', 10);
  const label = (s: number[]) => s.join(' + ');
  const splits: InverterSplit[] = [
    { label: label(splitA), modulesPerInverter: splitA, explanation: `Divisão proporcional à potência de cada inversor (${inverterPowersKw.map(p => `${p}kW`).join(' / ')}) — a mais equilibrada.` },
  ];
  // função desligada: só a divisão proporcional, sem alternativa nem alertas
  if (groupOn && label(splitB) !== label(splitA)) {
    splits.push({ label: label(splitB), modulesPerInverter: splitB, explanation: 'Alternativa com pequeno deslocamento — útil quando o arranjo de strings fecha melhor assim.' });
  }
  // alerta de desequilíbrio (em % da média)
  const avg = totalModules / n;
  const worst = Math.max(...splitA.map(v => Math.abs(v - avg)));
  const samePower = inverterPowersKw.every(p => p === inverterPowersKw[0]);
  if (groupOn && samePower && avg > 0 && (worst / avg) * 100 > maxImbalance) {
    alerts.push({
      severity: 'warning',
      code: 'inverter_imbalance',
      message: `A divisão ficou com desequilíbrio acima de ${maxImbalance}% entre inversores iguais.`,
      suggestion: 'Ajuste a quantidade de módulos pra fechar strings iguais nos dois inversores.',
      source: ruleSource(rules, 'inverter_distribution.max_power_imbalance_pct'),
    });
  }
  return { splits, alerts };
}

// ── Grupo 5: Relação DC/AC ───────────────────────────────────────────────────

export function checkDcAcRatio(
  totalModuleW: number,
  totalInverterKw: number,
  rules: RuleMap,
): { ratio: number | null; alerts: EngineAlert[] } {
  const alerts: EngineAlert[] = [];
  if (!totalModuleW || !totalInverterKw) return { ratio: null, alerts };
  const ratio = totalModuleW / (totalInverterKw * 1000);
  if (!isGroupEnabled(rules, 'dcac')) return { ratio: Math.round(ratio * 100) / 100, alerts };
  const min = ruleValue(rules, 'dcac.dcac_min', 1.0);
  const ideal = ruleValue(rules, 'dcac.dcac_ideal', 1.25);
  const max = ruleValue(rules, 'dcac.dcac_max', 1.6);
  const r2 = Math.round(ratio * 100) / 100;
  if (ratio > max) {
    alerts.push({
      severity: 'warning',
      code: 'dcac_high',
      message: `Relação DC/AC de ${r2} acima do máximo configurado (${max}) — haverá corte de geração (clipping) nos horários de pico.`,
      suggestion: 'Considere um inversor maior ou menos módulos. O projeto NÃO está bloqueado.',
      source: ruleSource(rules, 'dcac.dcac_max'),
    });
  } else if (ratio < min) {
    alerts.push({
      severity: 'warning',
      code: 'dcac_low',
      message: `Relação DC/AC de ${r2} abaixo do mínimo configurado (${min}) — inversor subaproveitado.`,
      suggestion: 'Considere mais módulos ou um inversor menor.',
      source: ruleSource(rules, 'dcac.dcac_min'),
    });
  } else if (Math.abs(ratio - ideal) > 0.15) {
    alerts.push({
      severity: 'info',
      code: 'dcac_off_ideal',
      message: `Relação DC/AC de ${r2} (ideal configurado: ${ideal}). Dentro dos limites.`,
    });
  }
  return { ratio: r2, alerts };
}

// ── Grupos 6–9: queda de tensão, cabos, proteções e aterramento (Fase 2) ────

/** Seções comerciais de cabo (mm²) — tamanhos de mercado, não regra técnica. */
const STANDARD_SECTIONS = [1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120];
/** Correntes nominais comerciais de disjuntor (A). */
const STANDARD_BREAKERS = [10, 16, 20, 25, 32, 40, 50, 63, 80, 100, 125, 160, 200, 250];

/**
 * Queda de tensão percentual (fórmula simplificada da NBR 5410):
 * ΔV% = (2 × ρ × L × I) / (S × V) × 100 (mono/CC); trifásico usa √3 no
 * lugar do 2.
 */
export function computeVoltageDropPct(params: {
  lengthM: number; currentA: number; sectionMm2: number; systemV: number;
  threePhase?: boolean; resistivity?: number;
}): number {
  const { lengthM, currentA, sectionMm2, systemV, threePhase, resistivity = 0.0172 } = params;
  if (sectionMm2 <= 0 || systemV <= 0) return 0;
  const k = threePhase ? Math.sqrt(3) : 2;
  return (k * resistivity * lengthM * currentA) / (sectionMm2 * systemV) * 100;
}

export interface CircuitSizing {
  currentA: number;
  sectionMm2: number;
  voltageDropPct: number;
  systemV: number;
  lengthM: number;
  explanation: string;
}

export interface ElectricalSizing {
  dc: CircuitSizing | null;
  ac: CircuitSizing | null;
  /** Corrente nominal do disjuntor CA sugerido. */
  breakerA: number | null;
  breakerExplanation: string | null;
  groundSectionMm2: number | null;
  groundNotes: string | null;
  alerts: EngineAlert[];
}

/** Menor seção comercial que atende à queda máxima e à seção mínima da regra. */
function pickSection(params: {
  minSection: number; lengthM: number; currentA: number; systemV: number;
  threePhase?: boolean; resistivity: number; maxDropPct: number;
}): { sectionMm2: number; dropPct: number; capped: boolean } {
  const candidates = STANDARD_SECTIONS.filter(s => s >= params.minSection);
  for (const s of candidates) {
    const drop = computeVoltageDropPct({ ...params, sectionMm2: s });
    if (drop <= params.maxDropPct) return { sectionMm2: s, dropPct: drop, capped: false };
  }
  const last = candidates[candidates.length - 1] ?? params.minSection;
  return { sectionMm2: last, dropPct: computeVoltageDropPct({ ...params, sectionMm2: last }), capped: true };
}

/**
 * Dimensionamento elétrico simplificado (Grupos 6–9): correntes, bitolas
 * CC/CA pela queda de tensão, disjuntor CA e aterramento — tudo dirigido
 * pelas regras, com explicação e fonte. Alimenta o painel do projeto e,
 * na sequência, os memoriais.
 */
export function suggestElectricalSizing(input: {
  stringCurrentA?: number;          // Imp do módulo (ou fallback da regra)
  stringsInParallelPerMppt?: number;// pra corrente CC por circuito (padrão 1)
  inverterPowerKw?: number;         // por inversor (disjuntor de saída)
  /** Corrente CA máxima de saída do inversor (datasheet) — tem prioridade
   *  sobre o cálculo por potência, que é só uma aproximação. */
  inverterAcCurrentA?: number;
  phaseType?: 'monofasico' | 'bifasico' | 'trifasico';
  dcLengthM?: number;
  acLengthM?: number;
  dcVoltageV?: number;              // tensão de operação da string (do arranjo escolhido)
}, rules: RuleMap): ElectricalSizing {
  const alerts: EngineAlert[] = [];
  const rho = ruleValue(rules, 'cables.copper_resistivity', 0.0172);
  const threePhase = input.phaseType === 'trifasico';
  const acV = threePhase
    ? ruleValue(rules, 'voltage_drop.ac_voltage_tri_v', 380)
    : ruleValue(rules, 'voltage_drop.ac_voltage_mono_v', 220);

  const cablesOn = isGroupEnabled(rules, 'cables');
  const vdOn = isGroupEnabled(rules, 'voltage_drop');

  // ── CC (string → inversor) ────────────────────────────────────────────────
  let dc: CircuitSizing | null = null;
  if (cablesOn) {
    const iString = input.stringCurrentA ?? ruleValue(rules, 'strings.default_string_current_a', 13);
    const parallel = Math.max(1, input.stringsInParallelPerMppt ?? 1);
    const iDc = iString * parallel;
    const lDc = input.dcLengthM ?? ruleValue(rules, 'cables.default_dc_length_m', 20);
    const vDc = input.dcVoltageV ?? 600; // aproximação neutra quando o arranjo não foi escolhido
    const maxDropDc = ruleValue(rules, 'voltage_drop.vd_dc_max_pct', 2);
    const pick = pickSection({
      minSection: ruleValue(rules, 'cables.min_dc_section_mm2', 6),
      lengthM: lDc, currentA: iDc, systemV: vDc, resistivity: rho, maxDropPct: maxDropDc,
    });
    dc = {
      currentA: Math.round(iDc * 10) / 10, sectionMm2: pick.sectionMm2,
      voltageDropPct: Math.round(pick.dropPct * 100) / 100, systemV: vDc, lengthM: lDc,
      explanation: `Cabo CC ${pick.sectionMm2}mm² pra ${Math.round(iDc * 10) / 10}A e ${lDc}m — queda ~${Math.round(pick.dropPct * 100) / 100}% (limite ${maxDropDc}%). ${ruleSource(rules, 'cables.min_dc_section_mm2')}.`,
    };
    if (vdOn && pick.capped) {
      alerts.push({
        severity: 'warning', code: 'vd_dc_exceeded',
        message: `Mesmo com a maior bitola da tabela, a queda CC estimada (${dc.voltageDropPct}%) passa do limite de ${maxDropDc}%.`,
        suggestion: 'Reduza a distância do arranjo ao inversor ou revise o circuito.',
        source: ruleSource(rules, 'voltage_drop.vd_dc_max_pct'),
      });
    }
  }

  // ── CA (inversor → conexão) + disjuntor ──────────────────────────────────
  let ac: CircuitSizing | null = null;
  let breakerA: number | null = null;
  let breakerExplanation: string | null = null;
  if (cablesOn && ((input.inverterPowerKw && input.inverterPowerKw > 0) || input.inverterAcCurrentA)) {
    // corrente REAL do datasheet quando existir; senão, calculada pela potência
    const iAc = input.inverterAcCurrentA
      ?? (input.inverterPowerKw! * 1000) / (acV * (threePhase ? Math.sqrt(3) : 1));
    const lAc = input.acLengthM ?? ruleValue(rules, 'cables.default_ac_length_m', 30);
    const maxDropAc = ruleValue(rules, 'voltage_drop.vd_ac_max_pct', 3);
    const pick = pickSection({
      minSection: ruleValue(rules, 'cables.min_ac_section_mm2', 2.5),
      lengthM: lAc, currentA: iAc, systemV: acV, threePhase, resistivity: rho, maxDropPct: maxDropAc,
    });
    ac = {
      currentA: Math.round(iAc * 10) / 10, sectionMm2: pick.sectionMm2,
      voltageDropPct: Math.round(pick.dropPct * 100) / 100, systemV: acV, lengthM: lAc,
      explanation: `Cabo CA ${pick.sectionMm2}mm² pra ${Math.round(iAc * 10) / 10}A (${input.inverterPowerKw}kW em ${acV}V${threePhase ? ' trifásico' : ''}) e ${lAc}m — queda ~${Math.round(pick.dropPct * 100) / 100}% (limite ${maxDropAc}%).`,
    };
    if (vdOn && pick.capped) {
      alerts.push({
        severity: 'warning', code: 'vd_ac_exceeded',
        message: `Queda CA estimada (${ac.voltageDropPct}%) acima do limite de ${maxDropAc}% mesmo na maior bitola.`,
        suggestion: 'Aumente a bitola além da tabela, reduza a distância ou divida o circuito.',
        source: ruleSource(rules, 'voltage_drop.vd_ac_max_pct'),
      });
    }
    if (isGroupEnabled(rules, 'protections')) {
      const factor = ruleValue(rules, 'protections.breaker_sizing_factor', 1.25);
      const target = iAc * factor;
      breakerA = STANDARD_BREAKERS.find(b => b >= target) ?? STANDARD_BREAKERS[STANDARD_BREAKERS.length - 1];
      breakerExplanation = `Disjuntor CA de ${breakerA}A — ${factor}× a corrente de ${Math.round(iAc * 10) / 10}A, próximo valor comercial. ${ruleSource(rules, 'protections.breaker_sizing_factor')}.`;
      const dpsNotes = rules.get('protections.dps_class_notes');
      if (dpsNotes?.enabled && dpsNotes.notes) {
        alerts.push({ severity: 'info', code: 'dps_hint', message: `DPS: ${dpsNotes.notes}.`, source: dpsNotes.source });
      }
    }
  }

  // ── Aterramento ───────────────────────────────────────────────────────────
  let groundSectionMm2: number | null = null;
  let groundNotes: string | null = null;
  if (isGroupEnabled(rules, 'grounding')) {
    const g = rules.get('grounding.min_ground_section_mm2');
    if (g?.enabled && g.valueDefault !== null) {
      groundSectionMm2 = Number(g.valueDefault);
      groundNotes = g.notes;
    }
  }

  return { dc, ac, breakerA, breakerExplanation, groundSectionMm2, groundNotes, alerts };
}

// ── Plano de proteções do projeto (disjuntor de cada arranjo + geral) ───────

export interface BranchBreaker {
  /** Corrente CA do inversor usada no dimensionamento. */
  currentA: number;
  /** Corrente nominal do disjuntor comercial escolhido. */
  breakerA: number;
  /** true = a corrente veio do datasheet; false = estimada pela potência. */
  fromDatasheet: boolean;
  explanation: string;
}

export interface BreakerPlan {
  /** Um disjuntor por arranjo/inversor, na ordem recebida. */
  branches: BranchBreaker[];
  /** Soma das correntes dos inversores (o que o geral precisa comportar). */
  totalCurrentA: number;
  /** Disjuntor geral proporcional à soma — null quando não há geral. */
  generalBreakerA: number | null;
  generalExplanation: string | null;
  /** Bitola CA sugerida por arranjo e do tronco (pra rotular os trechos). */
  branchSectionMm2: number | null;
  trunkSectionMm2: number | null;
  alerts: EngineAlert[];
}

/**
 * Dimensiona a PROTEÇÃO do projeto inteiro (pedido do usuário): o disjuntor
 * de CADA arranjo sai da corrente CA de saída do respectivo inversor
 * (datasheet quando houver, senão estimada pela potência) e o disjuntor
 * geral é proporcional à SOMA dessas correntes — nunca a soma dos
 * disjuntores individuais, que superdimensionaria o geral.
 */
export function suggestBreakerPlan(input: {
  inverters: { powerKw?: number; acCurrentA?: number }[];
  phaseType?: 'monofasico' | 'bifasico' | 'trifasico';
  includeGeneral?: boolean;
}, rules: RuleMap): BreakerPlan {
  const alerts: EngineAlert[] = [];
  const threePhase = input.phaseType === 'trifasico';
  const acV = threePhase
    ? ruleValue(rules, 'voltage_drop.ac_voltage_tri_v', 380)
    : ruleValue(rules, 'voltage_drop.ac_voltage_mono_v', 220);
  const factor = ruleValue(rules, 'protections.breaker_sizing_factor', 1.25);
  const protectionsOn = isGroupEnabled(rules, 'protections');
  const pickBreaker = (i: number) =>
    STANDARD_BREAKERS.find(b => b >= i * factor) ?? STANDARD_BREAKERS[STANDARD_BREAKERS.length - 1];
  const round1 = (v: number) => Math.round(v * 10) / 10;

  const branches: BranchBreaker[] = input.inverters.map((inv, i) => {
    const fromDatasheet = !!inv.acCurrentA;
    const currentA = round1(inv.acCurrentA ?? ((inv.powerKw ?? 0) * 1000) / (acV * (threePhase ? Math.sqrt(3) : 1)));
    const breakerA = pickBreaker(currentA);
    return {
      currentA, breakerA, fromDatasheet,
      explanation: `Arranjo ${i + 1}: disjuntor ${breakerA}A — ${factor}× a corrente de saída de ${currentA}A `
        + `(${fromDatasheet ? 'datasheet do inversor' : `estimada de ${inv.powerKw ?? 0}kW em ${acV}V${threePhase ? ' trifásico' : ''}`}).`,
    };
  });

  const totalCurrentA = round1(branches.reduce((a, b) => a + b.currentA, 0));
  let generalBreakerA: number | null = null;
  let generalExplanation: string | null = null;
  if (input.includeGeneral && branches.length > 0) {
    generalBreakerA = pickBreaker(totalCurrentA);
    const sumBranches = branches.reduce((a, b) => a + b.breakerA, 0);
    generalExplanation = `Disjuntor geral ${generalBreakerA}A — ${factor}× a SOMA das correntes dos ${branches.length} arranjo(s) (${totalCurrentA}A).`
      + (generalBreakerA < sumBranches
        ? ` Fica abaixo da soma dos disjuntores de arranjo (${sumBranches}A) porque os inversores não somam corrente de curto — o geral acompanha a corrente real do conjunto.`
        : '');
  }

  if (!protectionsOn) {
    alerts.push({ severity: 'info', code: 'group_disabled', message: 'Grupo Proteções desligado nas Regras de Engenharia — os disjuntores são só indicativos.' });
  }
  if (branches.some(b => !b.fromDatasheet)) {
    alerts.push({
      severity: 'info', code: 'ac_current_estimated',
      message: 'A corrente de saída de algum inversor foi estimada pela potência.',
      suggestion: 'Preencha "Corrente CA máxima de saída" no Catálogo de Equipamentos pra o disjuntor sair exato.',
      source: ruleSource(rules, 'protections.breaker_sizing_factor'),
    });
  }

  // bitolas pra rotular os trechos (mesma conta do dimensionamento elétrico)
  const branchSizing = branches.length > 0
    ? suggestElectricalSizing({ inverterAcCurrentA: branches[0].currentA, phaseType: input.phaseType }, rules)
    : null;
  const trunkSizing = branches.length > 0
    ? suggestElectricalSizing({ inverterAcCurrentA: totalCurrentA, phaseType: input.phaseType }, rules)
    : null;

  return {
    branches, totalCurrentA, generalBreakerA, generalExplanation,
    branchSectionMm2: branchSizing?.ac?.sectionMm2 ?? null,
    trunkSectionMm2: trunkSizing?.ac?.sectionMm2 ?? null,
    alerts,
  };
}

// ── Grupo Microinversores ────────────────────────────────────────────────────

/**
 * Datasheet do MICROINVERSOR. É outro bicho: não tem janela de string (cada
 * módulo entra direto numa entrada CC do micro) e o que limita o projeto é
 * (a) quantas entradas o micro tem e (b) quantos micros cabem no mesmo RAMAL
 * CA — eles são encadeados no cabo tronco até o disjuntor do ramal.
 */
export interface MicroSpecs {
  /** Entradas CC = módulos por micro (HMS-2000 4T → 4). */
  dcInputs?: number;
  /** Corrente CA de saída de UM micro (datasheet). */
  maxAcCurrentA?: number;
  /** Potência de saída de UM micro, em kW. */
  powerKw?: number;
  /** Máx. de unidades no mesmo ramal, quando o fabricante declara. */
  maxPerBranch?: number;
}

/** Um RAMAL CA: os micros encadeados no mesmo tronco + o disjuntor do ramal. */
export interface MicroBranch {
  /** Micros neste ramal. */
  units: number;
  /** Módulos de cada micro do ramal (ex.: [4,4,3]). */
  modulesPerUnit: number[];
  modules: number;
  /** Soma das correntes CA dos micros do ramal. */
  currentA: number;
  breakerA: number;
  explanation: string;
}

export interface MicroPlan {
  /** Micros do projeto. */
  unitCount: number;
  /** Teto de módulos por micro efetivamente usado. */
  modulesPerUnitCap: number;
  /** Teto de micros por ramal efetivamente usado, e de onde ele veio. */
  maxPerBranch: number;
  maxPerBranchReason: string;
  branches: MicroBranch[];
  totalCurrentA: number;
  generalBreakerA: number | null;
  generalExplanation: string | null;
  branchSectionMm2: number | null;
  trunkSectionMm2: number | null;
  /** Resumo de uma linha, no mesmo espírito das sugestões de string. */
  summary: string;
  alerts: EngineAlert[];
}

/**
 * Famílias de microinversor conhecidas — a maioria não traz "micro" no
 * modelo (HYX-M2000, HMS-2000, IQ8, DS3…). Só valem junto do teto de
 * potência abaixo, pra nenhum inversor de string cair aqui por engano.
 */
const MICRO_MODEL_PATTERNS = [
  /\bhm[st]?-?\s?\d{3,4}/i,     // Hoymiles HM-, HMS-, HMT-
  /\bhyx-?\s?m\d/i,             // HYXipower HYX-M2000
  /\biq\s?[5-9]\b/i,            // Enphase IQ7/IQ8
  /\b(ds3|qs1|yc600|yc1000)\b/i, // APsystems
];
/** Acima disso não é microinversor (o maior do mercado hoje é ~2,5 kW). */
const MICRO_MAX_KW = 3.5;

/**
 * É microinversor? Ordem: (1) o datasheet manda — `is_microinverter` marcado
 * no catálogo; (2) o nome diz "microinversor"; (3) família conhecida no
 * modelo E potência de micro. A potência SOZINHA nunca decide: existe
 * inversor de string de 2kW e classificar pelo porte erraria.
 */
export function isMicroinverter(
  ts: Record<string, unknown> | null | undefined,
  name?: string | null,
  powerKw?: number | null,
): boolean {
  if (ts && Number(ts['is_microinverter']) === 1) return true;
  const nome = String(name ?? '');
  if (/micro\s*-?\s*inversor|microinverter/i.test(nome)) return true;
  const kw = Number(powerKw ?? 0);
  if (kw > 0 && kw <= MICRO_MAX_KW && MICRO_MODEL_PATTERNS.some(re => re.test(nome))) return true;
  return false;
}

/** Lê o `tech_specs` do catálogo na visão de microinversor. */
export function microSpecsFromTechSpecs(
  ts: Record<string, unknown> | null | undefined,
  powerKw?: number,
): MicroSpecs {
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined);
  const t = ts ?? {};
  return {
    dcInputs: num(t['dc_inputs']),
    maxAcCurrentA: num(t['max_ac_current_a']),
    powerKw: powerKw ?? num(t['power_kw']),
    maxPerBranch: num(t['micro_max_per_branch']),
  };
}

/** Reparte `total` em `parts` inteiros o mais equilibrados possível (7,3 → 3,2,2). */
function splitEvenly(total: number, parts: number): number[] {
  const base = Math.floor(total / parts);
  const rest = total - base * parts;
  return Array.from({ length: parts }, (_, i) => base + (i < rest ? 1 : 0));
}

/**
 * Plano de um projeto com MICROINVERSORES: quantos micros, quantos módulos em
 * cada um, como eles se dividem em ramais e o disjuntor de cada ramal.
 *
 * O teto de micros por ramal é o MENOR entre a regra do banco / datasheet do
 * fabricante e o que a corrente do ramal aguenta — o segundo protege contra
 * uma regra folgada demais num micro potente.
 */
export function suggestMicroinverterPlan(input: {
  totalModules: number;
  micro: MicroSpecs;
  /** Micros do projeto; sem isso o motor calcula pelo nº de módulos. */
  unitCount?: number;
  phaseType?: 'monofasico' | 'bifasico' | 'trifasico';
  includeGeneral?: boolean;
}, rules: RuleMap): MicroPlan {
  const alerts: EngineAlert[] = [];
  const round1 = (v: number) => Math.round(v * 10) / 10;
  const threePhase = input.phaseType === 'trifasico';
  const acV = threePhase
    ? ruleValue(rules, 'voltage_drop.ac_voltage_tri_v', 380)
    : ruleValue(rules, 'voltage_drop.ac_voltage_mono_v', 220);
  const factor = ruleValue(rules, 'protections.breaker_sizing_factor', 1.25);
  const pickBreaker = (i: number) =>
    STANDARD_BREAKERS.find(b => b >= i * factor) ?? STANDARD_BREAKERS[STANDARD_BREAKERS.length - 1];

  if (!isGroupEnabled(rules, 'microinverters')) {
    alerts.push({
      severity: 'info', code: 'group_disabled',
      message: 'Grupo Microinversores desligado nas Regras de Engenharia — o plano de ramais é só indicativo.',
    });
  }

  // ── módulos por micro: o datasheet manda; sem ele, a regra-fallback ──
  const capRule = ruleValue(rules, 'microinverters.default_modules_per_unit', 4);
  const modulesPerUnitCap = Math.max(1, Math.floor(input.micro.dcInputs ?? capRule));
  if (!input.micro.dcInputs) {
    alerts.push({
      severity: 'info', code: 'micro_inputs_default',
      message: `Nº de entradas CC do microinversor não cadastrado — usando ${modulesPerUnitCap} módulos por micro.`,
      suggestion: 'Preencha "Entradas CC (módulos por micro)" no Catálogo de Equipamentos.',
      source: ruleSource(rules, 'microinverters.default_modules_per_unit'),
    });
  }

  // ── quantidade de micros ──
  const needed = Math.ceil(Math.max(0, input.totalModules) / modulesPerUnitCap);
  const unitCount = Math.max(1, Math.floor(input.unitCount ?? needed));
  const capacity = unitCount * modulesPerUnitCap;
  if (input.totalModules > capacity) {
    const faltam = Math.ceil((input.totalModules - capacity) / modulesPerUnitCap);
    alerts.push({
      severity: 'warning', code: 'micro_units_insufficient',
      message: `${input.totalModules} módulos não cabem em ${unitCount} microinversor(es) de ${modulesPerUnitCap} entradas (capacidade ${capacity}).`,
      suggestion: `Acrescente ${faltam} microinversor(es) ou reduza a quantidade de módulos.`,
    });
  }
  // módulos equilibrados entre os micros, respeitando o teto de entradas
  const modulesPerUnit = splitEvenly(Math.min(input.totalModules, capacity), unitCount)
    .map(m => Math.min(m, modulesPerUnitCap));
  if (input.totalModules > 0 && modulesPerUnit.some(m => m < modulesPerUnitCap)) {
    alerts.push({
      severity: 'info', code: 'micro_units_partial',
      message: `Nem todo microinversor fica cheio (${modulesPerUnit.join(' + ')} módulos) — é permitido, só reduz o aproveitamento do equipamento.`,
      suggestion: `Com ${unitCount * modulesPerUnitCap} módulos os ${unitCount} micros ficariam completos.`,
    });
  }

  // ── teto de micros por ramal: regra/datasheet × corrente do ramal ──
  const unitCurrentA = round1(
    input.micro.maxAcCurrentA ?? ((input.micro.powerKw ?? 0) * 1000) / (acV * (threePhase ? Math.sqrt(3) : 1)),
  );
  // QUEM MANDA é o limite declarado (datasheet do micro > regra do tenant) —
  // decisão do usuário. A corrente do ramal não reduz o número por conta
  // própria: se estourar, o motor AVISA e explica o que fazer (princípio do
  // motor: sugere e explica, nunca decide no lugar do projetista).
  const maxPerBranch = Math.max(1, Math.floor(input.micro.maxPerBranch ?? ruleValue(rules, 'microinverters.default_max_per_branch', 3)));
  const branchMaxA = ruleValue(rules, 'microinverters.branch_max_current', 25);
  const maxPerBranchReason = `${maxPerBranch} micro(s) por ramal — `
    + `${input.micro.maxPerBranch ? 'limite do datasheet do microinversor' : 'regra "máx. de microinversores por ramal"'}.`;
  const fullBranchA = round1(maxPerBranch * unitCurrentA);
  if (unitCurrentA > 0 && fullBranchA > branchMaxA) {
    const cabem = Math.max(1, Math.floor(branchMaxA / unitCurrentA));
    alerts.push({
      severity: 'warning', code: 'micro_branch_over_current',
      message: `${maxPerBranch} micros no mesmo ramal dão ${fullBranchA}A, acima da corrente prevista pro ramal (${branchMaxA}A).`,
      suggestion: `Confira o cabo tronco e o disjuntor do ramal: ou aumente "corrente máxima do ramal" (e a bitola) nas Regras de Engenharia, ou baixe pra ${cabem} micro(s) por ramal.`,
      source: ruleSource(rules, 'microinverters.branch_max_current'),
    });
  }
  if (!input.micro.maxAcCurrentA) {
    alerts.push({
      severity: 'info', code: 'micro_current_estimated',
      message: `Corrente de saída do microinversor estimada em ${unitCurrentA}A pela potência.`,
      suggestion: 'Preencha "Corrente CA máx. de saída" no Catálogo de Equipamentos pra o ramal sair exato.',
    });
  }

  // ── ramais equilibrados (7 micros, teto 3 → 3+2+2) ──
  const branchCount = Math.max(1, Math.ceil(unitCount / maxPerBranch));
  const unitsPerBranch = splitEvenly(unitCount, branchCount);
  let cursor = 0;
  const branches: MicroBranch[] = unitsPerBranch.map((units, i) => {
    const mods = modulesPerUnit.slice(cursor, cursor + units);
    cursor += units;
    const currentA = round1(units * unitCurrentA);
    const breakerA = pickBreaker(currentA);
    return {
      units, modulesPerUnit: mods, modules: mods.reduce((a, b) => a + b, 0), currentA, breakerA,
      explanation: `Ramal ${i + 1}: ${units} micro(s) no mesmo tronco CA = ${currentA}A → disjuntor ${breakerA}A (${factor}× a corrente do ramal).`,
    };
  });

  const totalCurrentA = round1(branches.reduce((a, b) => a + b.currentA, 0));
  let generalBreakerA: number | null = null;
  let generalExplanation: string | null = null;
  if (input.includeGeneral && branches.length > 0) {
    generalBreakerA = pickBreaker(totalCurrentA);
    generalExplanation = `Disjuntor geral ${generalBreakerA}A — ${factor}× a SOMA das correntes dos ${branches.length} ramal(is) (${totalCurrentA}A).`;
  }

  const branchSizing = branches.length > 0
    ? suggestElectricalSizing({ inverterAcCurrentA: branches[0].currentA, phaseType: input.phaseType }, rules)
    : null;
  const trunkSizing = branches.length > 0
    ? suggestElectricalSizing({ inverterAcCurrentA: totalCurrentA, phaseType: input.phaseType }, rules)
    : null;

  const summary = `${unitCount} microinversor(es) · ${modulesPerUnitCap} módulos cada · `
    + `${branchCount} ramal(is) de até ${maxPerBranch}`;

  return {
    unitCount, modulesPerUnitCap, maxPerBranch, maxPerBranchReason, branches,
    totalCurrentA, generalBreakerA, generalExplanation,
    branchSectionMm2: branchSizing?.ac?.sectionMm2 ?? null,
    trunkSectionMm2: trunkSizing?.ac?.sectionMm2 ?? null,
    summary,
    alerts: isGroupEnabled(rules, 'alerts') ? alerts : [],
  };
}

// ── Orquestrador (Grupos 1+2+3+5+11+12) ─────────────────────────────────────

export interface ProjectEngineInput {
  totalModules: number;
  moduleSpecs: ModuleSpecs;
  /** Um item por inversor físico (repetir specs quando forem iguais). */
  inverters: InverterSpecs[];
}

/**
 * Roda o motor completo da Fase 1: divide entre inversores, sugere strings
 * pra cada um e monta pelo menos 2 OPÇÕES completas de arranjo do projeto,
 * cada uma com explicação — mais os alertas (que nunca bloqueiam).
 */
export function suggestProjectArrangement(input: ProjectEngineInput, rules: RuleMap): EngineResult {
  const alerts: EngineAlert[] = [];
  const options: ProjectArrangementOption[] = [];
  const { totalModules, moduleSpecs, inverters } = input;
  if (totalModules <= 0 || inverters.length === 0) {
    return { options, alerts: [{ severity: 'info', code: 'missing_data', message: 'Preencha a quantidade de módulos e o(s) inversor(es) do projeto pra receber sugestões.' }] };
  }

  // DC/AC do projeto inteiro (Grupo 5)
  const totalInverterKw = inverters.reduce((a, i) => a + (i.powerKw ?? 0), 0);
  const totalModuleW = (moduleSpecs.powerW ?? 0) * totalModules;
  if (totalInverterKw > 0 && totalModuleW > 0) {
    alerts.push(...checkDcAcRatio(totalModuleW, totalInverterKw, rules).alerts);
  }

  // Grupo 2: divisões entre inversores
  const powers = inverters.map(i => i.powerKw ?? 1);
  const dist = distributeAcrossInverters(totalModules, powers, rules);
  alerts.push(...dist.alerts);

  // Grupos 1+3: pra cada divisão, o melhor arranjo de strings de cada inversor
  let optionIdx = 0;
  for (const split of dist.splits.slice(0, 2)) {
    const perInverter: StringArrangement[] = [];
    let feasible = true;
    for (let i = 0; i < inverters.length; i++) {
      const res = suggestStringArrangements(split.modulesPerInverter[i], inverters[i], moduleSpecs, rules);
      // alertas de datasheet só uma vez
      for (const a of res.alerts) {
        if (!alerts.some(x => x.code === a.code)) alerts.push(a);
      }
      if (res.arrangements.length === 0) { feasible = false; break; }
      perInverter.push(res.arrangements[0]);
    }
    if (!feasible) continue;
    optionIdx += 1;
    const summary = inverters.length === 1
      ? perInverter[0].label
      : perInverter.map((a, i) => `INV ${String(i + 1).padStart(2, '0')}: ${a.label}`).join(' · ');
    options.push({
      id: `opt-${optionIdx}`,
      title: `Sugestão ${optionIdx}`,
      split,
      perInverter,
      summary,
    });
  }

  // Grupo 12: se as duas divisões geraram o MESMO arranjo, tenta uma variação
  // com o 2º melhor arranjo de strings do primeiro inversor
  if (options.length === 1 || (options.length === 2 && options[0].summary === options[1].summary)) {
    const first = options[0];
    const alt = suggestStringArrangements(first.split.modulesPerInverter[0], inverters[0], moduleSpecs, rules)
      .arrangements.find(a => a.label !== first.perInverter[0].label);
    if (alt) {
      const perInverter = [alt, ...first.perInverter.slice(1)];
      const summary = inverters.length === 1
        ? alt.label
        : perInverter.map((a, i) => `INV ${String(i + 1).padStart(2, '0')}: ${a.label}`).join(' · ');
      const next: ProjectArrangementOption = {
        id: `opt-${options.length + 1}`,
        title: `Sugestão ${options.length + 1}`,
        split: first.split,
        perInverter,
        summary,
      };
      if (options.length === 2) options[1] = next; else options.push(next);
    } else if (options.length === 2) {
      options.pop(); // duas iguais e sem alternativa: mostra só uma
    }
  }

  // interruptores globais: Sugestões desligado = 1 opção só; Alertas
  // desligado = silencia tudo (a regra avisa que não é recomendado)
  const finalOptions = isGroupEnabled(rules, 'suggestions') ? options : options.slice(0, 1);
  const finalAlerts = isGroupEnabled(rules, 'alerts') ? alerts : [];
  return { options: finalOptions, alerts: finalAlerts };
}

// ── Datasheet: leitura tolerante do tech_specs do catálogo ───────────────────

/** Converte o jsonb `tech_specs` do catálogo (chaves livres) em InverterSpecs. */
export function inverterSpecsFromTechSpecs(ts: Record<string, unknown> | null | undefined, powerKw?: number): InverterSpecs {
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined);
  const t = ts ?? {};
  return {
    mpptCount: num(t['mppt_count']),
    stringsPerMppt: num(t['strings_per_mppt']),
    mpptVminV: num(t['mppt_vmin_v']),
    mpptVmaxV: num(t['mppt_vmax_v']),
    maxDcVoltageV: num(t['max_dc_voltage_v']),
    maxMpptCurrentA: num(t['max_mppt_current_a']),
    powerKw: powerKw ?? num(t['power_kw']),
    maxAcCurrentA: num(t['max_ac_current_a']),
  };
}

/** Converte o jsonb `tech_specs` do módulo em ModuleSpecs. */
export function moduleSpecsFromTechSpecs(ts: Record<string, unknown> | null | undefined, powerW?: number): ModuleSpecs {
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined);
  const t = ts ?? {};
  return {
    vocV: num(t['voc_v']),
    vmpV: num(t['vmp_v']),
    iscA: num(t['isc_a']),
    impA: num(t['imp_a']),
    powerW: powerW ?? num(t['power_w']),
  };
}
