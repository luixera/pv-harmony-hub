import { describe, expect, it } from 'vitest';
import type { PortalAccount } from '@/hooks/useLudmilla';
import { AGORA, CONTAS_DE_EXEMPLO, CONTA_CPFL, CONTA_ENEL, nomeDaContaDeExemplo } from './ludmillaCaixa.fixtures';
import {
  fraseDaProximaLeitura, leiturasDasContas, linhasDeLeitura, proximaLeitura, somarLeituras, textoDaListaVazia,
} from './ludmillaLeituras';

// AGORA (fixtures) = quinta, 22/10/2026, 09:00 de Brasília
const estacaoDe = (c: PortalAccount) => (c.modo === 'local' ? { online: true, texto: 'estação online' } : null);
const opcoes = { nomeDaConta: nomeDaContaDeExemplo, estacaoDe, caixaPronta: true, captchas: [], agora: AGORA };

describe('linhasDeLeitura (coluna da esquerda)', () => {
  it('a hora quando leu hoje; a palavra da saúde quando pede alguém; pelo nome', () => {
    expect(linhasDeLeitura(CONTAS_DE_EXEMPLO, opcoes)).toEqual([
      { id: 'conta-cpfl', nome: 'CPFL Paulista', texto: '08:00', alerta: false },
      { id: 'conta-edp', nome: 'EDP São Paulo', texto: 'nunca lida', alerta: true },
      { id: 'conta-elektro', nome: 'Elektro', texto: 'sessão expirada', alerta: true },
      { id: 'conta-enel', nome: 'ENEL SP', texto: '07:30', alerta: false },
    ]);
  });

  it('CAPTCHA aguardando: "espera o código"', () => {
    const l = linhasDeLeitura(CONTAS_DE_EXEMPLO, { ...opcoes, captchas: [{ account_id: 'conta-elektro' }] });
    expect(l.find(x => x.id === 'conta-elektro')).toEqual({ id: 'conta-elektro', nome: 'Elektro', texto: 'espera o código', alerta: true });
  });

  it('lida em outro dia: a data', () => {
    const ontem = { ...CONTA_CPFL, ultima_varredura_em: '2026-10-21T20:00:00Z' };
    expect(linhasDeLeitura([ontem], opcoes)[0]).toMatchObject({ texto: '21/10', alerta: false });
  });
});

describe('a próxima leitura (decisão 18)', () => {
  it('ENEL de hora em hora no expediente; portal às 8h e 17h; EDP só a pedido', () => {
    const p = proximaLeitura(CONTAS_DE_EXEMPLO, nomeDaContaDeExemplo, AGORA);
    expect(p).toEqual({ nome: 'ENEL SP', quando: Date.parse('2026-10-22T13:00:00Z') });
    expect(fraseDaProximaLeitura(p, AGORA)).toBe('A próxima leitura da ENEL SP é às 10:00.');
  });

  it('depois das 18h: amanhã; empate pelo nome', () => {
    const noite = Date.parse('2026-10-22T21:30:00Z');
    const p = proximaLeitura(CONTAS_DE_EXEMPLO, nomeDaContaDeExemplo, noite);
    expect(p).toEqual({ nome: 'CPFL Paulista', quando: Date.parse('2026-10-23T11:00:00Z') });
    expect(fraseDaProximaLeitura(p, noite)).toBe('A próxima leitura da CPFL Paulista é amanhã às 08:00.');
  });

  it('e-mail não lê no fim de semana', () => {
    const sextaNoite = Date.parse('2026-10-23T21:30:00Z');
    const p = proximaLeitura([CONTA_ENEL], nomeDaContaDeExemplo, sextaNoite);
    expect(fraseDaProximaLeitura(p, sextaNoite)).toBe('A próxima leitura da ENEL SP é segunda às 08:00.');
  });

  it('conta desligada não conta; sem nenhuma, sem frase', () => {
    expect(proximaLeitura([{ ...CONTA_ENEL, enabled: false }], nomeDaContaDeExemplo, AGORA)).toBeNull();
    expect(fraseDaProximaLeitura(null, AGORA)).toBeNull();
  });

  it('o texto da lista vazia (spec §4.6)', () => {
    expect(textoDaListaVazia('A próxima leitura da ENEL SP é às 10:00.'))
      .toBe('A próxima leitura da ENEL SP é às 10:00. Se chegar algo, eu coloco aqui e aviso no sino.');
    expect(textoDaListaVazia(null)).toBe('Se chegar algo, eu coloco aqui e aviso no sino.');
  });
});

describe('somarLeituras e leiturasDasContas (decisão 7)', () => {
  it('portal: o maior número de protocolos; e-mail: o que veio contado', () => {
    const soma = somarLeituras([
      { account_id: 'conta-cpfl', protocolos_lidos: 199 },
      { account_id: 'conta-cpfl', protocolos_lidos: 198 },
      { account_id: 'conta-elektro', protocolos_lidos: null },
    ], { 'conta-enel': 38, 'conta-edp': 0 });
    expect(soma).toEqual({ protocolos: { 'conta-cpfl': 199 }, emails: { 'conta-enel': 38, 'conta-edp': 0 } });
    expect(leiturasDasContas(CONTAS_DE_EXEMPLO, nomeDaContaDeExemplo, soma)).toEqual([
      { nome: 'CPFL Paulista', meio: 'portal', emails: null, protocolos: 199 },
      { nome: 'EDP São Paulo', meio: 'email', emails: 0, protocolos: null },
      { nome: 'Elektro', meio: 'portal', emails: null, protocolos: 0 },
      { nome: 'ENEL SP', meio: 'email', emails: 38, protocolos: null },
    ]);
  });
});
