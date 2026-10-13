// worker/ludmilla/test/enel-identificar.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  combinar, identificarPorDocumento, identificarPorTexto, nomeTrazOutroProjeto, numerosDoTexto,
  referenciaDoProjeto, titularNoAssunto, type ProjetoEnel,
} from '../src/email/enel/identificar.js';

const P = (o: Partial<ProjetoEnel>): ProjetoEnel => ({
  project_id: 'x', company_id: 'c', codigo: 'PRJ-X', protocolo: null, uc: null, titular: null,
  status: 'analysis', ativo: true, ...o,
});
const A = P({ project_id: 'a', codigo: 'PRJ-A', protocolo: '123456789', uc: '1111111111', titular: 'MARIA APARECIDA SILVA' });
const B = P({ project_id: 'b', codigo: 'PRJ-B', protocolo: '987654321', uc: '2222222222', titular: 'JOSE CARLOS SANTOS' });
const C = P({ project_id: 'c', codigo: 'PRJ-C', protocolo: 'aguardando protocolo', uc: '3333333333',
              titular: 'OSSEL LOCACAO DE SALAS PARA VELORIOS LTDA' });
const VELHO = P({ project_id: 'v', codigo: 'PRJ-V', protocolo: '555555555', uc: '4444444444',
                  titular: 'MARIA APARECIDA SILVA', status: 'completed', ativo: false });
const TODOS = [A, B, C, VELHO];
const txt = (assunto: string, corpo = '') => ({ assunto, corpo });

test('numerosDoTexto: só sequências de 9+ dígitos, sem zero à esquerda', () => {
  assert.deepEqual([...numerosDoTexto('NT 0123456789 em 13/10/2026, CEP 01310100')], ['123456789']);
  assert.deepEqual([...numerosDoTexto('data 20261013')], []); // 8 dígitos não identificam
  assert.deepEqual([...numerosDoTexto(null)], []);
});

test('NT no assunto identifica pelo protocolo', () => {
  const id = identificarPorTexto(txt('VISTORIA GD 123456789 - resultado'), TODOS);
  assert.equal(id.tipo, 'achado');
  assert.equal(id.tipo === 'achado' && id.projeto.codigo, 'PRJ-A');
  assert.equal(id.tipo === 'achado' && id.por, 'protocolo');
});

test('instalação no corpo identifica pela UC', () => {
  const id = identificarPorTexto(txt('RE: TROCA DE RELÓGIO', 'referente a instalação 2222222222 , para a troca'), TODOS);
  assert.equal(id.tipo === 'achado' && id.projeto.codigo, 'PRJ-B');
  assert.equal(id.tipo === 'achado' && id.por, 'uc');
});

test('protocolo de contato da ENEL (10 dígitos, de ninguém) NÃO identifica', () => {
  const id = identificarPorTexto(txt('RE: atendimento', 'Protocolo: 9876543210. Atenciosamente'), TODOS);
  assert.equal(id.tipo, 'nenhum');
});

test('números de dois projetos é conflito', () => {
  const id = identificarPorTexto(txt('NT 123456789 e NT 987654321'), TODOS);
  assert.equal(id.tipo, 'conflito');
});

test('número de um projeto e nome do titular de outro é conflito', () => {
  const id = identificarPorTexto(txt('TROCA DE RELÓGIO - JOSE CARLOS SANTOS - NT 123456789'), TODOS);
  assert.equal(id.tipo, 'conflito');
});

test('número e nome do MESMO projeto identificam pelo protocolo', () => {
  const id = identificarPorTexto(txt('TROCA DE RELÓGIO - JOSE CARLOS SANTOS - NT 987654321'), TODOS);
  assert.equal(id.tipo === 'achado' && id.projeto.codigo, 'PRJ-B');
  assert.equal(id.tipo === 'achado' && id.por, 'protocolo');
});

test('só o nome no assunto, único entre os ATIVOS, identifica pelo titular', () => {
  // MARIA APARECIDA SILVA também é titular do VELHO, que está concluído: não conta
  const id = identificarPorTexto(txt('PROJETO GD - MARIA A. SILVA'), TODOS);
  assert.equal(id.tipo === 'achado' && id.projeto.codigo, 'PRJ-A');
  assert.equal(id.tipo === 'achado' && id.por, 'titular');
});

test('nome que casa com dois projetos ativos é conflito', () => {
  const GEMEO = P({ project_id: 'g', codigo: 'PRJ-G', titular: 'MARIA APARECIDA SILVA' });
  const id = identificarPorTexto(txt('PROJETO GD - MARIA APARECIDA SILVA'), [...TODOS, GEMEO]);
  assert.equal(id.tipo, 'conflito');
});

test('nome no CORPO não identifica (assinatura de funcionário da ENEL)', () => {
  const id = identificarPorTexto(txt('RE: sua solicitação', 'Atenciosamente, Jose Carlos Santos — Serviço da Enel'), TODOS);
  assert.equal(id.tipo, 'nenhum');
});

test('empresa com palavras curtas no meio casa pelo nome completo', () => {
  assert.equal(titularNoAssunto('PROJETO GD - OSSEL LOCACAO DE SALAS PARA VELORIOS LTDA', C.titular!), true);
  assert.equal(titularNoAssunto('PROJETO GD - OSSEL', C.titular!), false);
});

test('titular de uma palavra só nunca identifica', () => {
  assert.equal(titularNoAssunto('PROJETO GD - IVANILDO', 'IVANILDO'), false);
});

test('número de projeto concluído dá "inativo", não achado', () => {
  const id = identificarPorTexto(txt('VISTORIA GD 555555555'), TODOS);
  assert.equal(id.tipo, 'inativo');
});

test('protocolo só com texto não identifica por número', () => {
  const id = identificarPorTexto(txt('aguardando protocolo'), TODOS);
  assert.equal(id.tipo, 'nenhum');
});

test('documento: NT e UC trocados de campo pela IA ainda identificam', () => {
  const id = identificarPorDocumento({ nt: '2222222222', uc: '987654321', titular: null }, TODOS);
  assert.equal(id.tipo === 'achado' && id.projeto.codigo, 'PRJ-B');
});

test('documento: titular extraído identifica quando é único', () => {
  const id = identificarPorDocumento({ nt: null, uc: null, titular: 'José Carlos dos Santos' }, TODOS);
  assert.equal(id.tipo === 'achado' && id.projeto.codigo, 'PRJ-B');
  assert.equal(id.tipo === 'achado' && id.por, 'titular');
});

test('combinar: texto e documento apontando projetos diferentes é conflito', () => {
  const t = identificarPorTexto(txt('NT 123456789'), TODOS);
  const d = identificarPorDocumento({ nt: '987654321', uc: null, titular: null }, TODOS);
  assert.equal(combinar(t, d).tipo, 'conflito');
});

test('combinar: texto vazio fica com o documento; mesmo projeto fica com o sinal mais forte', () => {
  const nada = identificarPorTexto(txt('Carta'), TODOS);
  const d = identificarPorDocumento({ nt: '123456789', uc: null, titular: null }, TODOS);
  assert.equal(combinar(nada, d).tipo === 'achado' && (combinar(nada, d) as { projeto: ProjetoEnel }).projeto.codigo, 'PRJ-A');
  const t = identificarPorTexto(txt('', 'instalação 1111111111'), TODOS);
  const r = combinar(t, d);
  assert.equal(r.tipo === 'achado' && r.por, 'protocolo');
});

test('arquivo com o número de OUTRO projeto (ativo ou não) não vai para este card', () => {
  assert.equal(nomeTrazOutroProjeto('CARTA_987654321.pdf', A, TODOS), true);
  assert.equal(nomeTrazOutroProjeto('CARTA_555555555.pdf', A, TODOS), true); // concluído também barra
  assert.equal(nomeTrazOutroProjeto('CARTA_123456789.pdf', A, TODOS), false);
  assert.equal(nomeTrazOutroProjeto('parecer.pdf', A, TODOS), false);
  assert.equal(nomeTrazOutroProjeto('nota_de_servico_400012345678.pdf', A, TODOS), false); // número de ninguém
});

test('referência do projeto: protocolo numérico, senão UC, senão o código', () => {
  assert.equal(referenciaDoProjeto(A), '123456789');
  assert.equal(referenciaDoProjeto(C), 'UC 3333333333');
  assert.equal(referenciaDoProjeto(P({ codigo: 'PRJ-Z' })), 'PRJ-Z');
});

// ── Correção pré-revisão: nome do meio de OUTRA pessoa não casa (janela) ─────

test('janela: nome do meio de OUTRA pessoa não casa (JOSE MARIA não é JOSE CARLOS)', () => {
  assert.equal(titularNoAssunto('TROCA DE RELÓGIO - JOSE MARIA SANTOS', 'JOSE CARLOS SANTOS'), false);
});

test('janela: inicial que não é de nenhum nome do meio não casa (JOSE M. não é JOSE CARLOS)', () => {
  assert.equal(titularNoAssunto('PROJETO GD - JOSE M. SANTOS', 'JOSE CARLOS SANTOS'), false);
});

test('janela: inicial de um nome do meio do titular casa (MARIA A. SILVA)', () => {
  assert.equal(titularNoAssunto('PROJETO GD - MARIA A. SILVA', 'MARIA APARECIDA SILVA'), true);
});

test('janela: nome do meio omitido, com ou sem conector, casa', () => {
  assert.equal(titularNoAssunto('PROJETO GD - MARIA SILVA', 'MARIA APARECIDA SILVA'), true);
  assert.equal(titularNoAssunto('PROJETO GD - MARIA DA SILVA', 'MARIA APARECIDA SILVA'), true);
});

test('janela: mais de 24 caracteres entre o primeiro e o último nome não casa', () => {
  assert.equal(titularNoAssunto('PROJETO GD - MARIA APARECIDA DE DA DOS DAS DO SILVA', 'MARIA APARECIDA SILVA'), false);
});

test('janela: o defeito inteiro — JOSE MARIA inativo não puxa o JOSE CARLOS ativo', () => {
  const CARLOS = P({ project_id: 'jc', codigo: 'PRJ-JC', titular: 'JOSE CARLOS SANTOS' });
  const MARIA = P({ project_id: 'jm', codigo: 'PRJ-JM', titular: 'JOSE MARIA SANTOS', status: 'completed', ativo: false });
  const id = identificarPorTexto(txt('PROJETO GD - JOSE MARIA SANTOS'), [CARLOS, MARIA]);
  assert.equal(id.tipo, 'nenhum');
});

test('janela: o mesmo nome identifica o titular que TEM esse nome do meio', () => {
  const CARLOS = P({ project_id: 'jc', codigo: 'PRJ-JC', titular: 'JOSE CARLOS SANTOS' });
  const MARIA = P({ project_id: 'jm', codigo: 'PRJ-JM', titular: 'JOSE MARIA SANTOS' });
  const id = identificarPorTexto(txt('PROJETO GD - JOSE MARIA SANTOS'), [CARLOS, MARIA]);
  assert.equal(id.tipo === 'achado' && id.projeto.codigo, 'PRJ-JM');
  assert.equal(id.tipo === 'achado' && id.por, 'titular');
});

test('janela: vale a ocorrência compatível mesmo que a primeira traga outro nome do meio', () => {
  assert.equal(titularNoAssunto('PROJETO GD - JOSE MARIA SANTOS E JOSE C. SANTOS', 'JOSE CARLOS SANTOS'), true);
});
