import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CONTA_CPFL, CONTA_EDP } from '@/lib/ludmillaCaixa.fixtures';

// O cartão puxa dados do banco pelos blocos de e-mail; aqui só importa a ORDEM do que aparece.
vi.mock('@/hooks/useLudmilla', () => ({
  estadoDaEstacao: () => null,
  useUltimoRunEmail: () => ({ data: null }),
}));
vi.mock('@/components/ludmilla/RegrasEmail', () => ({ RegrasEmail: () => null }));
vi.mock('@/components/ludmilla/MensagensEmail', () => ({
  ContadoresEmail: () => null,
  // a lista do que ela leu pode ter dezenas de telas (ENEL: ~30 mil px em 13/11/2026)
  MensagensEmail: () => createElement('div', { 'data-teste': 'lista-de-emails' }),
}));

const { CartaoDaConta } = await import('./CartaoDaConta');

const cartao = (conta: typeof CONTA_EDP) => renderToStaticMarkup(createElement(CartaoDaConta, {
  conta, nome: 'EDP São Paulo', caixa: { gmail_email: 'caixa@exemplo.test' } as never, caixaPronta: true,
  caixaFalhou: false, agora: Date.parse('2026-11-13T12:00:00Z'), verificando: false,
  onVerificar: () => {}, onAcessoAoPortal: () => {},
}));

describe('CartaoDaConta: o "Ler agora" fica à vista (13/11/2026)', () => {
  it('no e-mail, o botão vem ANTES da lista do que ela leu — antes ficava ~3 telas abaixo na EDP', () => {
    const html = cartao({ ...CONTA_EDP, ultima_varredura_em: '2026-11-11T01:28:32Z' });
    const botao = html.indexOf('Ler agora');
    expect(botao).toBeGreaterThan(-1);
    expect(botao).toBeLessThan(html.indexOf('O que eu li na caixa'));
    expect(botao).toBeLessThan(html.indexOf('data-teste="lista-de-emails"'));
    expect(botao).toBeLessThan(html.indexOf('Regras de leitura dos e-mails'));
  });

  it('no portal, o botão e o "Acesso ao portal" continuam lá', () => {
    const html = cartao(CONTA_CPFL);
    expect(html).toContain('Ler agora');
    expect(html).toContain('Acesso ao portal');
  });
});
