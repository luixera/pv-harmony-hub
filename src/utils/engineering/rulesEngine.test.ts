import { describe, it, expect } from 'vitest';
import {
  buildRuleMap, capacidadeDeStringsConhecida, resolveInverterPhase,
  suggestStringArrangements, tensaoTrifasicaDaRede,
  type EngineeringRule,
} from './rulesEngine';

/**
 * TENSÃO DA REDE — o motor conhecia uma única tensão trifásica (380 V) e
 * calculava 1,73× menos corrente do que a real em rede 127/220 (CEMIG e boa
 * parte de MG/SP), subdimensionando disjuntor e bitola. Estes testes travam o
 * comportamento: a rede do projeto manda na tensão trifásica, o datasheet
 * continua acima dela, e sem rede informada nada muda.
 */

const regra = (groupKey: string, ruleKey: string, valueDefault: number): EngineeringRule => ({
  groupKey, ruleKey, label: ruleKey, enabled: true, valueDefault,
  valueMin: null, valueMax: null, unit: null, priority: 0,
  source: 'Regra interna', notes: null,
});

const REGRAS = buildRuleMap([
  regra('voltage_drop', 'ac_voltage_mono_v', 220),
  regra('voltage_drop', 'ac_voltage_tri_v', 380),
  regra('protections', 'single_phase_max_kw', 6),
]);

describe('tensaoTrifasicaDaRede', () => {
  it('usa o último número do par — 127/220 é trifásico 220 V', () => {
    expect(tensaoTrifasicaDaRede('127/220')).toBe(220);
  });

  it('220/380 é trifásico 380 V', () => {
    expect(tensaoTrifasicaDaRede('220/380')).toBe(380);
  });

  it('aceita o par escrito com espaços ou com V', () => {
    expect(tensaoTrifasicaDaRede(' 127 / 220 V ')).toBe(220);
  });

  it('devolve null no que não dá para ler, em vez de chutar', () => {
    expect(tensaoTrifasicaDaRede(null)).toBeNull();
    expect(tensaoTrifasicaDaRede('')).toBeNull();
    expect(tensaoTrifasicaDaRede('baixa tensão')).toBeNull();
  });
});

describe('resolveInverterPhase — tensão trifásica vem da rede do projeto', () => {
  it('trifásico em rede 127/220 sai 220 V, não 380 V', () => {
    const r = resolveInverterPhase(
      { specs: { acPhases: 3 }, powerKw: 20, gridVoltage: '127/220' }, REGRAS);
    expect(r.phaseType).toBe('trifasico');
    expect(r.voltageV).toBe(220);
  });

  it('trifásico em rede 220/380 segue 380 V', () => {
    const r = resolveInverterPhase(
      { specs: { acPhases: 3 }, powerKw: 20, gridVoltage: '220/380' }, REGRAS);
    expect(r.voltageV).toBe(380);
  });

  it('sem rede informada, nada muda: cai na regra de 380 V', () => {
    const r = resolveInverterPhase({ specs: { acPhases: 3 }, powerKw: 20 }, REGRAS);
    expect(r.voltageV).toBe(380);
  });

  it('monofásico é 220 V nos dois pares de rede', () => {
    for (const rede of ['127/220', '220/380']) {
      const r = resolveInverterPhase(
        { specs: { acPhases: 1 }, powerKw: 5, gridVoltage: rede }, REGRAS);
      expect(r.voltageV).toBe(220);
    }
  });

  it('a tensão do datasheet continua mandando na da rede', () => {
    const r = resolveInverterPhase(
      { specs: { acPhases: 3, acVoltageV: 380 }, gridVoltage: '127/220' }, REGRAS);
    expect(r.voltageV).toBe(380);
  });

  it('datasheet 380 V numa rede 127/220 avisa a incompatibilidade', () => {
    const r = resolveInverterPhase(
      { specs: { acPhases: 3, acVoltageV: 380 }, gridVoltage: '127/220' }, REGRAS);
    expect(r.alerts.some(a => a.code === 'inverter_voltage_vs_grid')).toBe(true);
  });

  it('datasheet 220 V na rede 127/220 não reclama de nada', () => {
    const r = resolveInverterPhase(
      { specs: { acPhases: 3, acVoltageV: 220 }, gridVoltage: '127/220' }, REGRAS);
    expect(r.alerts.some(a => a.code === 'inverter_voltage_vs_grid')).toBe(false);
  });

  it('a fase deduzida pela potência também usa a tensão da rede', () => {
    const r = resolveInverterPhase({ powerKw: 20, gridVoltage: '127/220' }, REGRAS);
    expect(r.phaseType).toBe('trifasico');
    expect(r.voltageV).toBe(220);
    expect(r.source).toBe('potencia');
    expect(r.alerts.some(a => a.code === 'inverter_phase_estimated')).toBe(true);
  });
});

/**
 * ENTRADAS DE STRING — o catálogo do SOFAR 10KTLM-G3 só tinha fase e tensão, e
 * o motor completou com as regras (2 MPPTs × 2 strings = 4 entradas),
 * sugerindo "4 string(s) × 8 módulos" num inversor que não tem 4 entradas
 * (relato do usuário com print, 05/10/2026 — PRJ-84285). Um palpite sobre o
 * HARDWARE não pode sair como opção pronta para virar desenho.
 */
const REGRAS_STRING = buildRuleMap([
  regra('strings', 'group_enabled', 1),
  regra('strings', 'default_mppt_count', 2),
  regra('strings', 'default_strings_per_mppt', 2),
  regra('strings', 'min_modules_per_string', 6),
  regra('strings', 'max_modules_per_string', 24),
  regra('strings', 'balance_tolerance_modules', 1),
  regra('alerts', 'warn_on_incomplete_datasheet', 1),
  regra('suggestions', 'num_suggestions', 2),
]);

const MODULO = { powerW: 620, vmpV: 41.6, vocV: 49.6, impA: 14.9, iscA: 15.8 };

describe('capacidadeDeStringsConhecida', () => {
  it('é falsa quando o catálogo não traz MPPTs nem strings por MPPT', () => {
    expect(capacidadeDeStringsConhecida({ powerKw: 10 })).toBe(false);
  });

  it('é falsa quando traz só um dos dois', () => {
    expect(capacidadeDeStringsConhecida({ mpptCount: 2 })).toBe(false);
    expect(capacidadeDeStringsConhecida({ stringsPerMppt: 1 })).toBe(false);
  });

  it('é verdadeira com os dois preenchidos', () => {
    expect(capacidadeDeStringsConhecida({ mpptCount: 2, stringsPerMppt: 1 })).toBe(true);
  });
});

describe('suggestStringArrangements — nº de entradas chutado', () => {
  it('avisa em WARNING que as entradas de string são suposição', () => {
    const r = suggestStringArrangements(24, { powerKw: 10 }, MODULO, REGRAS_STRING);
    const a = r.alerts.find(x => x.code === 'string_capacity_estimated');
    expect(a).toBeDefined();
    expect(a!.severity).toBe('warning');
    expect(a!.message).toContain('2 MPPT');
  });

  it('com MPPTs e strings do datasheet, não levanta esse alerta', () => {
    const r = suggestStringArrangements(
      24, { powerKw: 10, mpptCount: 2, stringsPerMppt: 1, mpptVminV: 180, mpptVmaxV: 850, maxDcVoltageV: 1100 },
      MODULO, REGRAS_STRING);
    expect(r.alerts.some(x => x.code === 'string_capacity_estimated')).toBe(false);
  });

  it('nenhuma sugestão passa das entradas que o inversor tem', () => {
    const r = suggestStringArrangements(
      24, { powerKw: 10, mpptCount: 2, stringsPerMppt: 1, mpptVminV: 180, mpptVmaxV: 850, maxDcVoltageV: 1100 },
      MODULO, REGRAS_STRING);
    for (const arr of r.arrangements) expect(arr.stringSizes.length).toBeLessThanOrEqual(2);
  });
});
