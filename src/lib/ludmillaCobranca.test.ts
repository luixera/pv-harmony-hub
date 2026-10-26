import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ASSINATURA_DA_COBRANCA, LACUNAS, TAMANHO_MAXIMO_DO_TEXTO, dadosDoEmail, dataBr, montarEmailDeCobranca,
  notaNaTela, rascunhoDaCobranca, resumoDaCobranca, saudacao, textoComNotaNaTela, textoPronto,
} from '@/lib/ludmillaCobranca';
import { COBRANCA_BASE } from '@/lib/ludmillaCobranca.fixtures';

/** 10:00 e 13:00 em Brasília */
const MANHA = new Date('2026-10-24T13:00:00Z');
const TARDE = new Date('2026-10-24T16:00:00Z');

describe('montarEmailDeCobranca — o modelo aprovado pelo usuário (spec §5)', () => {
  it('1ª cobrança de manhã: o texto inteiro, como aprovado (a nota sem o zero da forma guardada)', () => {
    expect(COBRANCA_BASE.nota_servico).toBe('070700000123');
    expect(montarEmailDeCobranca(COBRANCA_BASE, MANHA)).toBe([
      'Prezados, bom dia.',
      '',
      'Referente à nota de serviço nº 70700000123, aberta em 01/10/2026 para a troca do medidor da instalação 0055009001 — titular MARTA EXEMPLO PRADO, NT 391000099:',
      '',
      'poderiam, por gentileza, confirmar se a troca já foi executada? Caso tenha sido reprogramada, pedimos a gentileza de nos informar a nova data.',
      '',
      'Atenciosamente,',
      'Equipe GD Manager',
    ].join('\n'));
  });

  it('depois do meio-dia: "boa tarde"', () => {
    expect(montarEmailDeCobranca(COBRANCA_BASE, TARDE).split('\n')[0]).toBe('Prezados, boa tarde.');
  });

  it('2ª cobrança: "retomando o e-mail abaixo", e a anterior citada embaixo', () => {
    const t = montarEmailDeCobranca({
      ...COBRANCA_BASE, enviadas: 1, ultima_enviada_em: '2026-10-15T14:00:00Z',
      ultimo_texto_enviado: 'Prezados, bom dia.\n\nPrimeira cobrança.',
    }, TARDE);
    expect(t.split('\n')[0]).toBe('Prezados, retomando o e-mail abaixo:');
    expect(t).toContain('Referente à nota de serviço nº 70700000123, aberta em 01/10/2026');
    expect(t).toContain('Atenciosamente,\nEquipe GD Manager\n\nEm 15/10/2026, Equipe GD Manager escreveu:\n> Prezados, bom dia.\n>\n> Primeira cobrança.');
  });

  it('a 2ª cobrança não é a 1ª repetida: abre de outro jeito e cita a anterior', () => {
    const primeira = montarEmailDeCobranca(COBRANCA_BASE, MANHA);
    const segunda = montarEmailDeCobranca({
      ...COBRANCA_BASE, enviadas: 1, ultima_enviada_em: '2026-10-15T14:00:00Z',
      ultimo_texto_enviado: primeira,
    }, MANHA);
    expect(segunda).not.toBe(primeira);
    expect(segunda.split('\n')[0]).not.toBe(primeira.split('\n')[0]);
    expect(segunda).toContain('> Prezados, bom dia.');
  });

  it('o que falta no cadastro vira lacuna no texto (e trava o Enviar)', () => {
    const t = montarEmailDeCobranca({ ...COBRANCA_BASE, nota_servico: null, projeto: { protocol_number: 'Sem protocolo' } }, MANHA);
    for (const l of LACUNAS) expect(t).toContain(l);
  });

  it('o embed 1:1 que chega como lista também serve', () => {
    const d = dadosDoEmail({ ...COBRANCA_BASE, projeto: { protocol_number: '391.000.099', project_general_data: [{ holder_name: 'MARTA EXEMPLO PRADO', uc_number: '0055009001' }] } });
    expect(d).toEqual({ nota: '70700000123', dataDaNota: '01/10/2026', uc: '0055009001', titular: 'MARTA EXEMPLO PRADO', nt: '391000099' });
  });

  it('a assinatura mora num lugar só', () => {
    expect(ASSINATURA_DA_COBRANCA).toBe('Equipe GD Manager');
  });
});

describe('notaNaTela — guardada com 12 dígitos e zero; a ENEL escreve sem o zero', () => {
  it('tira o zero da forma canônica', () => {
    expect(notaNaTela('070700000123')).toBe('70700000123');
  });
  it('não mexe no que não é a forma canônica, nem inventa nota', () => {
    expect(notaNaTela('400000000123')).toBe('400000000123');
    expect(notaNaTela('70700000123')).toBe('70700000123');
    expect(notaNaTela(null)).toBeNull();
    expect(notaNaTela('  ')).toBeNull();
  });
});

describe('textoComNotaNaTela — o título que o banco grava com o zero', () => {
  it('só a nota (12 dígitos com zero na frente) perde o zero', () => {
    expect(textoComNotaNaTela('📡 Cobrar a ENEL — troca do relógio do PRJ-20001 (nota 070700000123)'))
      .toBe('📡 Cobrar a ENEL — troca do relógio do PRJ-20001 (nota 70700000123)');
    expect(textoComNotaNaTela('📡 A cobrança da nota 070700000123 não saiu')).toBe('📡 A cobrança da nota 70700000123 não saiu');
  });
  it('a UC de 10 dígitos, o número maior e a data ficam como estão', () => {
    const t = 'UC 0055009001, 0070700000123 e 01/10/2026 (nota 400000000123)';
    expect(textoComNotaNaTela(t)).toBe(t);
  });
});

describe('rascunhoDaCobranca', () => {
  it('o texto já aprovado que não saiu volta como rascunho; sem ele, o modelo', () => {
    expect(rascunhoDaCobranca({ ...COBRANCA_BASE, texto_aprovado: 'Prezados, bom dia.\n\nO que a pessoa escreveu.' }, MANHA))
      .toBe('Prezados, bom dia.\n\nO que a pessoa escreveu.');
    expect(rascunhoDaCobranca(COBRANCA_BASE, MANHA)).toBe(montarEmailDeCobranca(COBRANCA_BASE, MANHA));
  });
});

describe('textoPronto — a trava do Enviar na tela (o banco tem a mesma)', () => {
  it('modelo completo: pronto', () => {
    expect(textoPronto(montarEmailDeCobranca(COBRANCA_BASE, MANHA))).toEqual({ ok: true, porque: null });
  });
  it('lacuna, vazio ou longo demais: não', () => {
    expect(textoPronto('Prezados, bom dia. Instalação [UC], nota [NÚMERO DA NOTA].'))
      .toEqual({ ok: false, porque: 'Complete no texto: [NÚMERO DA NOTA], [UC].' });
    expect(textoPronto('   ').ok).toBe(false);
    expect(textoPronto('curto').ok).toBe(false);
    expect(textoPronto('x'.repeat(TAMANHO_MAXIMO_DO_TEXTO + 1)).ok).toBe(false);
  });
  it('as lacunas e o tamanho são os mesmos do banco (ludmilla_cobranca_aprovar, na migração que a redefiniu)', () => {
    const sql = readFileSync('supabase/migrations/20261025120000_ludmilla_cobranca_ajustes.sql', 'utf8');
    expect(sql).toContain(`ARRAY[${LACUNAS.map(l => `'${l}'`).join(', ')}]`);
    expect(sql).toContain(`length(_texto) > ${TAMANHO_MAXIMO_DO_TEXTO}`);
  });
});

describe('saudacao e dataBr — horário de Brasília', () => {
  it('bom dia até 11:59, boa tarde a partir do meio-dia', () => {
    expect(saudacao(new Date('2026-10-24T14:59:00Z'))).toBe('bom dia');
    expect(saudacao(new Date('2026-10-24T15:00:00Z'))).toBe('boa tarde');
  });
  it('dd/mm/aaaa em Brasília', () => {
    expect(dataBr('2026-10-01T02:00:00Z')).toBe('30/09/2026');
  });
});

describe('resumoDaCobranca — o que a linha decidida diz', () => {
  it('cada situação', () => {
    expect(resumoDaCobranca({ ...COBRANCA_BASE, erro: 'o Gmail recusou a senha de app da caixa (EAUTH 535)' }))
      .toBe('O último envio não saiu: o Gmail recusou a senha de app da caixa (EAUTH 535)');
    expect(resumoDaCobranca(COBRANCA_BASE)).toBe('Esperando alguém da equipe revisar e enviar.');
    expect(resumoDaCobranca({ ...COBRANCA_BASE, situacao: 'enviando' })).toBe('Saindo agora pela caixa da Ludmilla.');
    expect(resumoDaCobranca({ ...COBRANCA_BASE, situacao: 'agendada', enviadas: 0 })).toBe('Agendada para 08/10/2026.');
    expect(resumoDaCobranca({ ...COBRANCA_BASE, situacao: 'agendada', enviadas: 2, ultima_enviada_em: '2026-10-22T14:00:00Z', vence_em: '2026-10-29T14:00:00Z' }))
      .toBe('Enviada 2× (a última em 22/10/2026). Próxima cobrança em 29/10/2026, se a ENEL não responder.');
    expect(resumoDaCobranca({ ...COBRANCA_BASE, situacao: 'encerrada', motivo_encerramento: 'a ENEL avisou que a troca do relógio foi feita' }))
      .toBe('Encerrada: a ENEL avisou que a troca do relógio foi feita');
    expect(resumoDaCobranca({ ...COBRANCA_BASE, situacao: 'dispensada' })).toBe('Dispensada pela equipe: não sai mais cobrança desta nota.');
  });
});
