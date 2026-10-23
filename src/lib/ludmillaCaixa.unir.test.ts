import { describe, expect, it } from 'vitest';
import type { PortalUpdate } from '@/hooks/useLudmilla';
import { contarPendentes, itensDaCaixa, unirDecididoPrimeiro, type Afazer } from './ludmillaCaixa';
import {
  CONTAS_DE_EXEMPLO, F_DEVOLUCAO, F_VISTORIA, U_CPFL, U_EDP, nomeDaContaDeExemplo, rotuloDeExemplo,
} from './ludmillaCaixa.fixtures';

/**
 * I-1 da revisão da Task 5: `useCaixaDaLudmilla` junta a consulta de PENDENTES (que a
 * barra lateral e a página compartilham, e que pode estar velha) com a consulta da
 * SITUAÇÃO escolhida. Uma decisão só anda para frente (pendente → aplicada/ignorada/
 * feito), então, no mesmo id, a versão da situação é a que vale. Antes, o repetido que
 * vencia era o primeiro, ou seja, o pendente velho.
 */
describe('unirDecididoPrimeiro', () => {
  const aplicada = { ...U_CPFL, situacao: 'aplicada' as const, aplicada_por: 'pessoa-1', aplicada_em: '2026-10-22T12:00:00Z' };
  const feito = { ...F_VISTORIA, feito_por: 'pessoa-2', feito_em: '2026-10-22T12:05:00Z' };

  it('o mesmo id pendente numa lista e aplicado na outra resulta em aplicado', () => {
    const r = unirDecididoPrimeiro([U_CPFL], [aplicada]);
    expect(r).toHaveLength(1);
    expect(r[0].situacao).toBe('aplicada');
  });

  it('vale para o A fazer: aberto nas pendentes e feito na lista da situação resulta em feito', () => {
    const r = unirDecididoPrimeiro([F_VISTORIA], [feito]);
    expect(r).toHaveLength(1);
    expect(r[0].feito_em).toBe('2026-10-22T12:05:00Z');
  });

  it('quem só existe numa das listas entra uma vez cada', () => {
    const r = unirDecididoPrimeiro([U_CPFL, U_EDP], [aplicada]);
    expect(r.map(x => x.id).sort()).toEqual([U_CPFL.id, U_EDP.id].sort());
    expect(r.find(x => x.id === U_CPFL.id)?.situacao).toBe('aplicada');
    expect(r.find(x => x.id === U_EDP.id)?.situacao).toBe('pendente');
  });

  it('sem repetido, devolve as duas listas inteiras', () => {
    expect(unirDecididoPrimeiro([U_CPFL], [U_EDP]).map(x => x.id).sort()).toEqual([U_CPFL.id, U_EDP.id].sort());
    expect(unirDecididoPrimeiro([], [])).toEqual([]);
  });

  it('o item decidido deixa de contar como pendente na caixa (o efeito que a revisão apontou)', () => {
    const entrada = (updates: PortalUpdate[], afazeres: Afazer[]) => itensDaCaixa({
      updates, afazeres, contas: CONTAS_DE_EXEMPLO, nomeDaConta: nomeDaContaDeExemplo, rotuloEtapa: rotuloDeExemplo,
    });
    const antes = contarPendentes(entrada([U_CPFL], [F_VISTORIA, F_DEVOLUCAO])).total;
    const depois = contarPendentes(entrada(
      unirDecididoPrimeiro([U_CPFL], [aplicada]),
      unirDecididoPrimeiro([F_VISTORIA, F_DEVOLUCAO], [feito]),
    )).total;
    expect(antes).toBe(3);
    expect(depois).toBe(1);
  });
});
