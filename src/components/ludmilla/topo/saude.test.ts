import { describe, expect, it } from 'vitest';
import { saudeDaConta, type SaudeDaConta } from '@/lib/ludmillaPainel';
import { AGORA, CONTA_CPFL, CONTA_EDP, CONTA_ELEKTRO, CONTA_ENEL } from '@/lib/ludmillaCaixa.fixtures';
import { palavraDaSaude } from './saude';

const H = 3_600_000;
const antes = (horas: number) => new Date(AGORA - horas * H).toISOString();
const base = { estacao: null, caixaPronta: true, agora: AGORA };
const OFFLINE = { online: false, texto: 'estação offline há 3 h' };

describe('palavraDaSaude — a palavra curta do chip, visível também no celular (sem title)', () => {
  it('em dia: nenhuma palavra', () => {
    expect(palavraDaSaude(saudeDaConta(CONTA_CPFL, base))).toBeNull();
  });
  it('erro, sessão expirada, desligada, sem acesso', () => {
    expect(palavraDaSaude(saudeDaConta({ ...CONTA_CPFL, situacao: 'erro' }, base))).toBe('com erro');
    expect(palavraDaSaude(saudeDaConta({ ...CONTA_CPFL, situacao: 'sessao_expirada' }, base))).toBe('sessão expirada');
    expect(palavraDaSaude(saudeDaConta({ ...CONTA_CPFL, enabled: false }, base))).toBe('desligada');
    expect(palavraDaSaude(saudeDaConta({ ...CONTA_CPFL, situacao: 'nao_configurado' }, base))).toBe('sem acesso');
  });
  it('estação fora do ar vira "offline", qualquer que seja o texto do motivo', () => {
    const elektro = { ...CONTA_ELEKTRO, situacao: 'ok' as const };
    expect(palavraDaSaude(saudeDaConta(elektro, { ...base, estacao: OFFLINE }))).toBe('offline');
    expect(palavraDaSaude(saudeDaConta(elektro, { ...base, estacao: { online: false, texto: 'estação nunca ligou — instale a Ludmilla no PC do coworking' } }))).toBe('offline');
    expect(palavraDaSaude(saudeDaConta(elektro, { ...base, estacao: { online: false, texto: 'estação sem operador — escolha um usuário no acesso ao portal' } }))).toBe('offline');
  });
  it('caixa de e-mail não configurada, leitura atrasada do portal', () => {
    expect(palavraDaSaude(saudeDaConta(CONTA_ENEL, { ...base, caixaPronta: false }))).toBe('sem caixa');
    expect(palavraDaSaude(saudeDaConta({ ...CONTA_CPFL, ultima_varredura_em: antes(20) }, base))).toBe('atrasada');
  });
  it('nunca lida: sem palavra, porque o chip já diz "nunca lida"', () => {
    expect(palavraDaSaude(saudeDaConta(CONTA_EDP, base))).toBeNull();
    expect(palavraDaSaude(saudeDaConta({ ...CONTA_CPFL, ultima_varredura_em: null }, base))).toBeNull();
  });
  it('texto que não conhece: mostra o próprio texto (nunca esconde um problema)', () => {
    const novo: SaudeDaConta = { tom: 'atencao', texto: 'algo novo' };
    expect(palavraDaSaude(novo)).toBe('algo novo');
    expect(palavraDaSaude({ tom: 'ok', texto: 'em dia' })).toBeNull();
  });
  it('toda saúde que a lógica de verdade produz cabe numa palavra curta (<= 16 letras) ou é null', () => {
    const elektro = { ...CONTA_ELEKTRO, situacao: 'ok' as const };
    const todas = [
      saudeDaConta({ ...CONTA_CPFL, enabled: false }, base),
      saudeDaConta({ ...CONTA_CPFL, situacao: 'erro' }, base),
      saudeDaConta({ ...CONTA_CPFL, situacao: 'sessao_expirada' }, base),
      saudeDaConta(CONTA_ENEL, { ...base, caixaPronta: false }),
      saudeDaConta({ ...CONTA_CPFL, situacao: 'nao_configurado' }, base),
      saudeDaConta(elektro, { ...base, estacao: OFFLINE }),
      saudeDaConta(CONTA_EDP, base),
      saudeDaConta({ ...CONTA_CPFL, ultima_varredura_em: null }, base),
      saudeDaConta({ ...CONTA_CPFL, ultima_varredura_em: antes(20) }, base),
    ];
    for (const s of todas) {
      const p = palavraDaSaude(s);
      expect(s.tom).not.toBe('ok');
      if (p !== null) expect(p.length).toBeLessThanOrEqual(16);
    }
  });
});
