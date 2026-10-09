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

  // corte DEPOIS de um veredito válido: um parser que "conserta" JSON cortado
  // devolveria 'projeto' aqui — e é exatamente o que não pode acontecer
  it('resposta cortada depois do veredito válido vira dúvida', () => {
    expect(lerVeredito('{"veredito":"projeto","motiv').veredito).toBe('duvida');
  });

  // exercita o catch do JSON.parse (tem chaves, mas não é JSON)
  it('JSON malformado com chaves vira dúvida', () => {
    expect(lerVeredito('{"veredito":"projeto",}').veredito).toBe('duvida');
  });

  it('dois objetos JSON no mesmo texto viram dúvida', () => {
    const r = lerVeredito('{"veredito":"projeto","motivo":"a"} e depois {"veredito":"nao_projeto","motivo":"b"}');
    expect(r.veredito).toBe('duvida');
  });

  it('veredito nulo vira dúvida', () => {
    expect(lerVeredito('{"veredito":null}').veredito).toBe('duvida');
  });

  it('objeto sem a chave veredito vira dúvida', () => {
    expect(lerVeredito('{"motivo":"sem veredito"}').veredito).toBe('duvida');
  });

  // comportamento desejado e fixado: maiúscula e espaços são tolerados
  it('veredito com maiúsculas e espaços é normalizado', () => {
    expect(lerVeredito('{"veredito":" PROJETO "}').veredito).toBe('projeto');
  });

  it('motivo acima de 500 caracteres é cortado em 500', () => {
    const longo = 'x'.repeat(900);
    const r = lerVeredito(`{"veredito":"projeto","motivo":"${longo}"}`);
    expect(r.veredito).toBe('projeto');
    expect(r.motivo).toHaveLength(500);
  });

  it('veredito válido sem motivo devolve motivo vazio', () => {
    expect(lerVeredito('{"veredito":"duvida"}')).toEqual({ veredito: 'duvida', motivo: '' });
  });

  it('entrada null ou undefined vira dúvida', () => {
    expect(lerVeredito(null as unknown as string).veredito).toBe('duvida');
    expect(lerVeredito(undefined as unknown as string).veredito).toBe('duvida');
  });

  // o motivo do worker vai para o log e para o WhatsApp: nunca ecoa a resposta
  it('o motivo de uma resposta ilegível não ecoa o que o modelo escreveu', () => {
    const prosa = 'O documento de João da Silva, CPF 123.456.789-00, é um contrato.';
    expect(lerVeredito(prosa).motivo).not.toContain('João');
    expect(lerVeredito('{"veredito":"talvez joão"}').motivo).not.toContain('joão');
    expect(lerVeredito('{"veredito":"João",}').motivo).not.toContain('João');
  });
});
