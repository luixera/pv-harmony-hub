import { describe, it, expect } from 'vitest';
import { partirMensagem, paraWhatsapp, listaNumerada, diasEmPalavras } from './ze-texto.ts';

describe('partirMensagem', () => {
  it('texto curto sai inteiro', () => {
    expect(partirMensagem('oi', 100)).toEqual(['oi']);
  });

  it('corta em parágrafo quando dá', () => {
    const p1 = 'a'.repeat(40);
    const p2 = 'b'.repeat(40);
    expect(partirMensagem(`${p1}\n\n${p2}`, 50)).toEqual([p1, p2]);
  });

  it('cai para a quebra de linha quando o parágrafo não cabe', () => {
    const l1 = 'a'.repeat(40);
    const l2 = 'b'.repeat(40);
    expect(partirMensagem(`${l1}\n${l2}`, 50)).toEqual([l1, l2]);
  });

  it('cai para o espaço quando a linha não cabe', () => {
    const partes = partirMensagem(`${'a'.repeat(30)} ${'b'.repeat(30)}`, 40);
    expect(partes).toHaveLength(2);
    expect(partes[0]).toBe('a'.repeat(30));
  });

  it('palavra maior que o limite é cortada na força', () => {
    const partes = partirMensagem('x'.repeat(25), 10);
    expect(partes).toEqual(['x'.repeat(10), 'x'.repeat(10), 'x'.repeat(5)]);
  });

  it('nenhum pedaço passa do limite e nada se perde', () => {
    const texto = Array.from({ length: 30 }, (_, i) => `linha ${i} com um tanto de texto`).join('\n');
    const partes = partirMensagem(texto, 120);
    expect(partes.every(p => p.length <= 120)).toBe(true);
    expect(partes.join('\n')).toBe(texto);
  });

  it('texto vazio devolve lista vazia', () => {
    expect(partirMensagem('   ', 100)).toEqual([]);
  });
});

describe('paraWhatsapp', () => {
  it('negrito de markdown vira negrito de WhatsApp', () => {
    expect(paraWhatsapp('olha o **projeto** aí')).toBe('olha o *projeto* aí');
  });

  it('título de markdown vira negrito', () => {
    expect(paraWhatsapp('## Tarefas de hoje\ntexto')).toBe('*Tarefas de hoje*\ntexto');
  });

  it('itálico sublinhado duplo vira um só', () => {
    expect(paraWhatsapp('__assim__')).toBe('_assim_');
  });

  it('não estraga um asterisco solto nem uma lista', () => {
    expect(paraWhatsapp('- item um\n- item dois')).toBe('- item um\n- item dois');
  });

  it('tira espaço sobrando nas pontas', () => {
    expect(paraWhatsapp('  oi  ')).toBe('oi');
  });
});

describe('listaNumerada', () => {
  it('numera a partir de 1', () => {
    expect(listaNumerada(['ligar pro João', 'cobrar a CPFL'])).toBe('1. ligar pro João\n2. cobrar a CPFL');
  });
  it('lista vazia vira string vazia', () => {
    expect(listaNumerada([])).toBe('');
  });
});

describe('diasEmPalavras', () => {
  it('fala como gente', () => {
    expect(diasEmPalavras(0)).toBe('hoje');
    expect(diasEmPalavras(1)).toBe('ontem');
    expect(diasEmPalavras(5)).toBe('há 5 dias');
    expect(diasEmPalavras(45)).toBe('há 1 mês');
    expect(diasEmPalavras(70)).toBe('há 2 meses');
  });
});
