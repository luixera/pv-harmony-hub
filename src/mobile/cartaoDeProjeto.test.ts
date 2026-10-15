import { describe, it, expect, vi } from 'vitest';
import { cartaoDeProjeto, corDaEtapa, statusVariants } from './cartaoDeProjeto';
import { resumoDeCartao } from './resumoDeCartao';
import { VALID_PROJECT_STATUSES } from '@/lib/statusMapping';

const projeto = {
  id: 'p1',
  code: 'PRJ-81492',
  title: 'Projeto do João',
  status: 'analysis',
  concessionaireName: 'CPFL Paulista',
  generalData: { holder_name: 'João da Silva' },
  equipment: { total_installed_power: 4.96 },
};

const rotulo = (s: string) => `Etapa ${s}`;

/** Razão de contraste WCAG entre uma cor hex de 6 dígitos e o branco. */
function contrasteComBranco(hex: string): number {
  const canal = (i: number) => {
    const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const lum = 0.2126 * canal(0) + 0.7152 * canal(1) + 0.0722 * canal(2);
  return 1.05 / (lum + 0.05);
}

describe('cartaoDeProjeto', () => {
  it('usa o titular como título, a etapa como selo e abre pelo id', () => {
    const abrir = vi.fn();
    const item = cartaoDeProjeto(projeto, rotulo, abrir);
    expect(item.id).toBe('p1');
    expect(item.titulo).toBe('João da Silva');
    expect(item.selo).toEqual({ texto: 'Etapa analysis', cor: corDaEtapa('analysis') });
    item.aoAbrir?.();
    expect(abrir).toHaveBeenCalledWith('p1');
  });

  it('monta código, concessionária e potência, nessa ordem', () => {
    const { campos } = cartaoDeProjeto(projeto, rotulo, () => {});
    expect(campos).toEqual([
      { rotulo: 'Código', valor: 'PRJ-81492' },
      { rotulo: 'Concessionária', valor: 'CPFL Paulista' },
      { rotulo: 'Potência', valor: '4.96 kWp' },
    ]);
  });

  it('cai no título do projeto e depois no código quando falta o titular', () => {
    const semTitular = { ...projeto, generalData: { holder_name: '' } };
    expect(cartaoDeProjeto(semTitular, rotulo, () => {}).titulo).toBe('Projeto do João');
    const semNada = { ...semTitular, title: '' };
    expect(cartaoDeProjeto(semNada, rotulo, () => {}).titulo).toBe('PRJ-81492');
  });

  it('o cartão pula a potência quando é zero ou ausente', () => {
    const zero = { ...projeto, equipment: { total_installed_power: 0 } };
    const ausente = { ...projeto, equipment: undefined };
    for (const p of [zero, ausente]) {
      const rotulos = resumoDeCartao(cartaoDeProjeto(p, rotulo, () => {}).campos).map(c => c.rotulo);
      expect(rotulos).toEqual(['Código', 'Concessionária']);
    }
  });

  it('não quebra sem dados gerais nem concessionária', () => {
    const cru = { id: 'p2', code: 'PRJ-2', status: 'pending' };
    const item = cartaoDeProjeto(cru, rotulo, () => {});
    expect(item.titulo).toBe('PRJ-2');
    expect(resumoDeCartao(item.campos)).toEqual([{ rotulo: 'Código', valor: 'PRJ-2' }]);
  });
});

describe('corDaEtapa', () => {
  it('devolve hex de 6 dígitos para toda etapa que o banco aceita', () => {
    for (const status of VALID_PROJECT_STATUSES) {
      expect(corDaEtapa(status)).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it('todas passam do mínimo AA (4,5:1) sobre o branco do cartão', () => {
    for (const status of [...VALID_PROJECT_STATUSES, 'etapa-inventada-pelo-cliente']) {
      expect(contrasteComBranco(corDaEtapa(status))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('etapa desconhecida cai no tom neutro de "pendente"', () => {
    expect(corDaEtapa('etapa-inventada-pelo-cliente')).toBe(corDaEtapa('pending'));
  });

  // Os dois primeiros testes NÃO pegam etapa faltando: a ausente cai no neutro,
  // que é hex de 6 dígitos e passa em AA. Sem esta verificação, acrescentar uma
  // etapa ao banco e esquecer do mapa passaria verde — e o selo sairia cinza.
  it('toda etapa que o banco aceita tem variante declarada', () => {
    const semVariante = VALID_PROJECT_STATUSES.filter(s => !(s in statusVariants));
    expect(semVariante).toEqual([]);
  });
});
