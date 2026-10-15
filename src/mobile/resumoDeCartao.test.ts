import { describe, it, expect } from 'vitest';
import { resumoDeCartao } from './resumoDeCartao';

const campos = [
  { rotulo: 'Código', valor: 'PRJ-81492' },
  { rotulo: 'Concessionária', valor: 'CPFL' },
  { rotulo: 'Potência', valor: '4,96 kWp' },
  { rotulo: 'Cidade', valor: 'São José do Rio Preto' },
];

describe('resumoDeCartao', () => {
  it('fica com os três primeiros, na ordem recebida', () => {
    expect(resumoDeCartao(campos).map(c => c.rotulo)).toEqual(['Código', 'Concessionária', 'Potência']);
  });

  it('pula campo vazio em vez de mostrar rótulo solto', () => {
    const r = resumoDeCartao([
      { rotulo: 'Código', valor: 'PRJ-1' },
      { rotulo: 'UC', valor: '' },
      { rotulo: 'Concessionária', valor: null },
      { rotulo: 'Potência', valor: '  ' },
      { rotulo: 'Cidade', valor: 'Campinas' },
    ]);
    expect(r).toEqual([
      { rotulo: 'Código', valor: 'PRJ-1' },
      { rotulo: 'Cidade', valor: 'Campinas' },
    ]);
  });

  it('normaliza espaços do valor', () => {
    expect(resumoDeCartao([{ rotulo: 'X', valor: '  a   b  ' }])[0].valor).toBe('a b');
  });

  it('aceita outro teto', () => {
    expect(resumoDeCartao(campos, 2)).toHaveLength(2);
    expect(resumoDeCartao(campos, 0)).toHaveLength(0);
  });

  it('teto inválido (NaN) não vira "mostra tudo": devolve vazio', () => {
    expect(resumoDeCartao(campos, NaN)).toEqual([]);
  });

  it('lista vazia não quebra', () => {
    expect(resumoDeCartao([])).toEqual([]);
  });
});
