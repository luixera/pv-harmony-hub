import { describe, expect, it } from 'vitest';
import { LinhaDePrazo, prazoMedioGlobal } from './prazoMedio';

/**
 * O prazo médio global tem de ser ponderado pela quantidade de pagamentos,
 * senão uma empresa com 1 pagamento pesa igual a uma com 60 e o KPI do topo
 * mente. É a única conta que a tela do financeiro faz no navegador.
 */

const emp = (pagamentos: number, prazo: number | null): LinhaDePrazo =>
  ({ pagamentos, prazo_medio_dias: prazo });

describe('prazoMedioGlobal', () => {
  it('pondera pela quantidade de pagamentos', () => {
    // a média simples daria (10 + 50) / 2 = 30; a ponderada é a verdadeira
    expect(prazoMedioGlobal([emp(90, 10), emp(10, 50)])).toBe(14);
  });

  it('coincide com a média simples quando o peso é igual', () => {
    expect(prazoMedioGlobal([emp(5, 10), emp(5, 20)])).toBe(15);
  });

  // quem nunca pagou não tem prazo — e prazo nulo não é prazo zero
  it('ignora empresa que nunca pagou', () => {
    expect(prazoMedioGlobal([emp(4, 20), emp(0, null)])).toBe(20);
  });

  it('ignora linha incoerente (prazo sem pagamento)', () => {
    expect(prazoMedioGlobal([emp(3, 30), emp(0, 999)])).toBe(30);
  });

  it('devolve null quando ninguém pagou — a tela mostra "—", não "0 dias"', () => {
    expect(prazoMedioGlobal([])).toBeNull();
    expect(prazoMedioGlobal([emp(0, null)])).toBeNull();
  });

  it('arredonda para dia inteiro', () => {
    expect(prazoMedioGlobal([emp(3, 10), emp(1, 1)])).toBe(8); // 31/4 = 7,75
  });

  it('aceita prazo negativo (pagamento adiantado)', () => {
    expect(prazoMedioGlobal([emp(2, -3)])).toBe(-3);
  });
});
