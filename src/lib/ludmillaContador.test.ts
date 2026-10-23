import { describe, expect, it } from 'vitest';
import { contagemDaLudmilla } from './ludmillaContador';
import {
  AFAZERES_DE_EXEMPLO, F_DEVOLUCAO, F_FEITO, U_APLICADA, U_CPFL, U_IGNORADA, UPDATES_DE_EXEMPLO,
} from './ludmillaCaixa.fixtures';

/**
 * O CONTADOR DA BARRA LATERAL (decisão do usuário, 22/10/2026): conta TUDO que pede
 * uma pessoa — recomendações pendentes + A fazer abertos. Nas fixtures: 5
 * recomendações pendentes (CPFL, ENEL ×2, EDP, CPFL sem projeto) + 2 A fazer abertos
 * (vistoria e devolução); a aplicada, a ignorada e o A fazer feito não contam.
 */
describe('contagemDaLudmilla', () => {
  it('soma as recomendações pendentes com os A fazer abertos', () => {
    expect(contagemDaLudmilla(UPDATES_DE_EXEMPLO, AFAZERES_DE_EXEMPLO)).toEqual({
      total: 7,
      porConta: { 'conta-cpfl': 2, 'conta-edp': 1, 'conta-enel': 4 },
    });
  });

  it('o A fazer aberto entra no total (antes o contador só via as recomendações)', () => {
    const soRecomendacoes = contagemDaLudmilla(UPDATES_DE_EXEMPLO, []);
    const comAfazer = contagemDaLudmilla(UPDATES_DE_EXEMPLO, AFAZERES_DE_EXEMPLO);
    expect(soRecomendacoes.total).toBe(5);
    expect(comAfazer.total - soRecomendacoes.total).toBe(2);
  });

  it('sem recomendação pendente, só o A fazer aberto conta', () => {
    expect(contagemDaLudmilla([U_APLICADA, U_IGNORADA], AFAZERES_DE_EXEMPLO).total).toBe(2);
  });

  it('o que já foi decidido não conta: aplicada, ignorada e A fazer feito', () => {
    expect(contagemDaLudmilla([U_APLICADA, U_IGNORADA], [F_FEITO])).toEqual({ total: 0, porConta: {} });
  });

  it('o que está esperando o Desfazer (oculto) sai da conta, nas duas origens', () => {
    const c = contagemDaLudmilla(UPDATES_DE_EXEMPLO, AFAZERES_DE_EXEMPLO, new Set([`u:${U_CPFL.id}`, `f:${F_DEVOLUCAO.id}`]));
    expect(c.total).toBe(5);
    expect(c.porConta['conta-cpfl']).toBe(1);
    expect(c.porConta['conta-enel']).toBe(3);
  });

  it('sem nada, zero', () => {
    expect(contagemDaLudmilla([], [])).toEqual({ total: 0, porConta: {} });
  });
});
