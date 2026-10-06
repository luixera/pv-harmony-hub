// worker/ludmilla/test/email-run.test.ts
// A conferência do run por e-mail. É a trava que decide se o documento entra no
// card, então cada regra da decisão tem um teste próprio.
//
// Regra (progress.md, para esta task): o ENDEREÇO confirma mas NÃO bloqueia;
// só o TITULAR bloqueia. O protocolo é chave única — se ele casa, o documento é
// daquele projeto, e endereço divergente quase sempre é cadastro nosso velho.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { conferir } from '../src/email/index.js';
import type { ProtocoloDeProjeto } from '../src/fila.js';

const PROJETO: ProtocoloDeProjeto = {
  protocolo: '045006443920',
  project_id: '11111111-1111-4111-8111-111111111111',
  company_id: '22222222-2222-4222-8222-222222222222',
  codigo: 'GD-2026-001',
  titular: 'WERLHE DE ARAUJO LIMA',
  endereco: 'RUA DAS FLORES 120',
};

const SEM_PDF = { titular: null, endereco: null };

test('titular do sistema casa com o do PDF → conferido por titular', () => {
  const c = conferir(PROJETO, 'Segue o parecer.', { titular: 'Werlhe de Araújo Lima', endereco: null });
  assert.equal(c.ok, true);
  assert.equal(c.por, 'titular');
  assert.equal(c.motivo, null);
});

test('titular do sistema casa com o nome citado no corpo do e-mail → por titular', () => {
  const c = conferir(PROJETO, 'Parecer de acesso do titular WERLHE DE ARAUJO LIMA, UC 123.', SEM_PDF);
  assert.equal(c.ok, true);
  assert.equal(c.por, 'titular');
});

test('titular do PDF é de OUTRA pessoa → único bloqueio', () => {
  const c = conferir(PROJETO, 'Segue o parecer.', { titular: 'Miguel Arcanjo Corcini', endereco: null });
  assert.equal(c.ok, false);
  assert.equal(c.por, 'titular');
  assert.match(String(c.motivo), /Miguel Arcanjo Corcini/);
  assert.match(String(c.motivo), /WERLHE DE ARAUJO LIMA/);
});

test('nome ausente no corpo do e-mail NÃO bloqueia: só o titular do PDF bloqueia', () => {
  // o corpo não cita nome nenhum — isso é falta de dado, não divergência
  const c = conferir(PROJETO, 'Prezado cliente, segue documento em anexo.', SEM_PDF);
  assert.equal(c.ok, true);
  assert.equal(c.por, 'protocolo');
});

test('titular do sistema vazio e endereço casa → conferido por endereco', () => {
  const semTitular = { ...PROJETO, titular: null };
  const c = conferir(semTitular, 'Imóvel na Rua das Flores, nº 120 - Centro.', SEM_PDF);
  assert.equal(c.ok, true);
  assert.equal(c.por, 'endereco');
  assert.equal(c.motivo, null);
});

test('endereço do PDF diverge → NÃO bloqueia, mas registra o motivo (C1)', () => {
  const c = conferir(PROJETO, 'Segue o parecer.', { titular: null, endereco: 'Avenida Brasil, 4000' });
  assert.equal(c.ok, true);
  assert.equal(c.por, 'protocolo');
  assert.match(String(c.motivo), /Avenida Brasil, 4000/);
  assert.match(String(c.motivo), /RUA DAS FLORES 120/);
});

test('titular casa e endereço diverge → titular manda, sem motivo de alarme', () => {
  const c = conferir(PROJETO, '', { titular: 'Werlhe de Araujo Lima', endereco: 'Avenida Brasil, 4000' });
  assert.equal(c.ok, true);
  assert.equal(c.por, 'titular');
  assert.equal(c.motivo, null);
});

test('nada mais casa → segue pelo protocolo, que é chave única', () => {
  const c = conferir(PROJETO, 'ENVIO DE PARECER - NOTA 45006443920', SEM_PDF);
  assert.equal(c.ok, true);
  assert.equal(c.por, 'protocolo');
  assert.equal(c.motivo, null);
});

test('projeto sem titular e sem endereço no cadastro → protocolo, sem bloqueio', () => {
  const cru = { ...PROJETO, titular: null, endereco: null };
  const c = conferir(cru, 'Segue o parecer.', { titular: 'Qualquer Nome Aqui', endereco: 'Rua Qualquer 1' });
  assert.equal(c.ok, true);
  assert.equal(c.por, 'protocolo');
  assert.equal(c.motivo, null);
});
