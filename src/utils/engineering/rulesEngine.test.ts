import { describe, it, expect } from 'vitest';
import {
  buildRuleMap, resolveInverterPhase, tensaoTrifasicaDaRede,
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
