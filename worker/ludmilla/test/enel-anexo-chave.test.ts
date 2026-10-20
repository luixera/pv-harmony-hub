// worker/ludmilla/test/enel-anexo-chave.test.ts
// A CHAVE do anexo separada do TEXTO do comentário (Task 6, rodada 2, M-7).
// O cliente do Supabase é de verdade; o que é falso é a REDE: confere-se o JSON que
// de fato sairia pelo fio (é no JSON que `undefined` some). Dados inventados.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { anexoDeEmail } from '../src/fila.js';

process.env.SUPABASE_URL = 'http://supabase.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'chave-de-mentira';
delete process.env.LUDMILLA_MODO;

const chamadas: { rpc: string; corpo: Record<string, unknown> }[] = [];
globalThis.fetch = (async (input: unknown, init?: { body?: unknown }) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
  const corpo = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
  chamadas.push({ rpc: new URL(url).pathname.split('/').pop() ?? '', corpo });
  // o banco devolve a linha aberta do projeto pedido
  const linha = { abertura: 'aberto', anexo_id: 'anexo-1', projeto_id: corpo.p_project_id, company_id: 'empresa-1', codigo: 'GD-X-001' };
  return new Response(JSON.stringify([linha]), { status: 200, headers: { 'content-type': 'application/json' } });
}) as typeof fetch;

const ultima = () => { assert.equal(chamadas.length, 1); const c = chamadas[0]; chamadas.length = 0; return c; };

/** Os 7 parâmetros que a EDP manda desde sempre — nem um a mais. */
const PAYLOAD_DA_EDP = {
  p_account_id: 'conta-edp', p_protocolo: '2024000123', p_project_id: 'proj-1',
  p_message_id: '<m1@example.invalid>', p_nome_arquivo: 'parecer.pdf', p_conferido_por: 'protocolo', p_ocorrencia: 1,
};

test('EDP: o payload de ludmilla_email_anexo_novo NÃO ganha p_chave; a chave é a de sempre', async () => {
  const r = await anexoDeEmail('conta-edp', '2024000123', 'proj-1', '<m1@example.invalid>', 'parecer.pdf', 'protocolo');
  const c = ultima();
  assert.equal(c.rpc, 'ludmilla_email_anexo_novo');
  assert.deepEqual(c.corpo, PAYLOAD_DA_EDP);
  assert.equal('p_chave' in c.corpo, false);
  assert.equal(r.situacao, 'aberto');
  assert.equal(r.situacao === 'aberto' && r.anexo.id_arquivo, '<m1@example.invalid>#2024000123#parecer.pdf');
});

test('ENEL: p_chave vai no fio e só na CHAVE; o protocolo (texto do comentário) segue o informado', async () => {
  const r = await anexoDeEmail('conta-enel', '391000001', 'proj-9', '<m2@example.invalid>', 'CARTA.pdf', 'uc', 1, 'proj-9');
  const c = ultima();
  assert.equal(c.corpo.p_chave, 'proj-9');
  assert.equal(c.corpo.p_protocolo, '391000001');
  assert.ok(r.situacao === 'aberto');
  assert.equal(r.anexo.id_arquivo, '<m2@example.invalid>#proj-9#CARTA.pdf', 'a mesma expressão do banco');
  assert.equal(r.anexo.protocolo, '391000001');
});

test('chave vazia: vai no fio (o banco a ignora por nullif) e a chave cai no protocolo, como no banco', async () => {
  const r = await anexoDeEmail('conta-enel', '391000001', 'proj-9', '<m3@example.invalid>', 'CARTA.pdf', 'uc', 2, '');
  const c = ultima();
  assert.equal(c.corpo.p_chave, '');
  assert.ok(r.situacao === 'aberto');
  assert.equal(r.anexo.id_arquivo, '<m3@example.invalid>#391000001#CARTA.pdf#2');
});
