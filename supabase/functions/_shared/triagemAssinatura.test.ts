import { describe, expect, it } from 'vitest';
import { lerVeredito } from './triagemAssinatura';

describe('lerVeredito', () => {
  it('lê o JSON limpo', () => {
    const r = lerVeredito('{"veredito":"projeto","motivo":"Memorial descritivo de GD."}');
    expect(r.veredito).toBe('projeto');
    expect(r.motivo).toBe('Memorial descritivo de GD.');
  });

  it('acha o JSON no meio de texto solto', () => {
    const r = lerVeredito('Analisei o documento.\n```json\n{"veredito":"nao_projeto","motivo":"É um contrato de prestação de serviços."}\n```');
    expect(r.veredito).toBe('nao_projeto');
    expect(r.motivo).toMatch(/contrato/);
  });

  // FALHA FECHADA: o que não dá para ler NUNCA vira 'projeto'
  it('resposta cortada vira dúvida', () => {
    expect(lerVeredito('{"veredito":"proje').veredito).toBe('duvida');
  });

  it('texto sem JSON vira dúvida', () => {
    expect(lerVeredito('não consegui abrir o arquivo').veredito).toBe('duvida');
  });

  it('veredito desconhecido vira dúvida', () => {
    expect(lerVeredito('{"veredito":"talvez","motivo":"x"}').veredito).toBe('duvida');
  });

  it('string vazia vira dúvida', () => {
    expect(lerVeredito('').veredito).toBe('duvida');
  });
});
