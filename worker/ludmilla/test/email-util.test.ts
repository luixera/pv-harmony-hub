import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  casaEndereco, casaProtocolo, casaTitular, chaveProtocolo, protocoloDoAssunto,
  recomendacaoDoVeredito, regraQueCasa, type RegraEmail,
} from '../src/email/util.js';

const REGRAS: RegraEmail[] = [
  { id: '1', remetente: 'relacionamento.edp', assunto: 'ENVIO DE PARECER', tipo_documento: 'parecer', anexar: true, ler_pdf: true },
  { id: '2', remetente: null, assunto: 'CARTA DE OBRAS', tipo_documento: 'carta_obras', anexar: true, ler_pdf: false },
  { id: '3', remetente: null, assunto: 'NOTA -', tipo_documento: 'nota', anexar: true, ler_pdf: false },
];

test('chaveProtocolo tira pontuação e zeros à esquerda', () => {
  assert.equal(chaveProtocolo('045006443920'), '45006443920');
  assert.equal(chaveProtocolo('45006443920'), '45006443920');
  assert.equal(chaveProtocolo('0.400.083.127-22'), '40008312722');
  assert.equal(chaveProtocolo(''), '');
});

test('casaProtocolo ignora o zero à esquerda do sistema', () => {
  assert.ok(casaProtocolo('045006443920', '45006443920'));
  assert.ok(!casaProtocolo('045006443920', '45006439205'));
  // número curto demais não casa: evita colar e-mail pelo número da rua
  assert.ok(!casaProtocolo('123', '123'));
});

test('protocoloDoAssunto acha o protocolo do projeto dentro do assunto', () => {
  const candidatos = ['045006443920', '040008312722'];
  assert.equal(protocoloDoAssunto('ENVIO DE PARECER - NOTA 45006443920', candidatos), '045006443920');
  assert.equal(protocoloDoAssunto('NOTA - 40008312722', candidatos), '040008312722');
  assert.equal(protocoloDoAssunto('RA HugMe - EDP São Paulo te mandou mensagem', candidatos), null);
});

test('regraQueCasa usa assunto e, quando houver, remetente', () => {
  assert.equal(regraQueCasa(REGRAS, 'ENVIO DE PARECER - NOTA 45006443920', 'relacionamento.edp@edp.com.br')?.tipo_documento, 'parecer');
  // assunto de parecer vindo de outro remetente não vale como parecer
  assert.equal(regraQueCasa(REGRAS, 'ENVIO DE PARECER - NOTA 1', 'estranho@exemplo.com'), null);
  assert.equal(regraQueCasa(REGRAS, 'EDP - CARTA DE OBRAS', 'edpdocumentoporemail@edpbr.com.br')?.tipo_documento, 'carta_obras');
  assert.equal(regraQueCasa(REGRAS, 'Protocolo de Atendimento EDP 0460917635', 'protocolodoatendimentosp@edp.com.br'), null);
});

test('casaTitular compara primeiro e último nome, sem acento', () => {
  assert.ok(casaTitular('WERLHE DE ARAUJO LIMA', 'Sr. Werlhe de Araújo Lima'));
  assert.ok(!casaTitular('WERLHE DE ARAUJO LIMA', 'Miguel Arcanjo Corcini'));
  assert.ok(!casaTitular('', 'Werlhe de Araujo Lima'));
});

test('casaEndereco compara rua e número normalizados', () => {
  assert.ok(casaEndereco('RUA DAS FLORES 120', 'Rua das Flores, nº 120 - Centro'));
  assert.ok(!casaEndereco('RUA DAS FLORES 120', 'Rua das Flores, nº 999'));
  assert.ok(!casaEndereco('', 'Rua das Flores 120'));
});

test('recomendacaoDoVeredito só recomenda etapa para parecer', () => {
  assert.equal(recomendacaoDoVeredito('parecer', 'favoravel'), 'approved');
  assert.equal(recomendacaoDoVeredito('parecer', 'pendencia'), 'pendencia');
  assert.equal(recomendacaoDoVeredito('parecer', 'inconclusivo'), null);
  assert.equal(recomendacaoDoVeredito('carta_obras', 'favoravel'), null);
});

test('casaEndereco usa o ÚLTIMO número do endereço, não o primeiro', () => {
  // AV 9 DE JULHO 1500: pega 1500, não 9
  assert.ok(!casaEndereco('AV 9 DE JULHO 1500', 'Av 9 de Julho 3000'));
  assert.ok(casaEndereco('AV 9 DE JULHO 1500', 'Avenida 9 de Julho, 1500 - Centro'));
});

test('casaEndereco compara palavras da rua por palavra inteira, não substring', () => {
  // FLORES não é substring de FLORESTA (bem como não caso palavra inteira)
  assert.ok(!casaEndereco('RUA DAS FLORES 120', 'Rua da Floresta 120'));
});

test('casaTitular rejeita nome com uma palavra só', () => {
  assert.ok(!casaTitular('JOSE', 'Maria Jose Santos'));
  // confirmação que continua funcionando com dois nomes
  assert.ok(casaTitular('WERLHE DE ARAUJO LIMA', 'Sr. Werlhe de Araújo Lima'));
});

test('regraQueCasa encontra regra de nota com remetente qualquer', () => {
  assert.equal(regraQueCasa(REGRAS, 'NOTA - 40008312722', 'relacionamento@edp.com.br')?.tipo_documento, 'nota');
});

test('casaProtocolo respeita piso de 8 dígitos', () => {
  // 7 dígitos não casam
  assert.ok(!casaProtocolo('1234567', '1234567'));
  // 8 dígitos casam
  assert.ok(casaProtocolo('12345678', '12345678'));
});
