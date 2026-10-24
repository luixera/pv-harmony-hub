// worker/ludmilla/test/enel-caixa.test.ts
//
// Task 5 do acompanhamento da ENEL por e-mail: a busca por remetente e a porta do
// robô para as RPCs novas. Este arquivo é NOVO de propósito: os testes da EDP
// (email-caixa.test.ts, email-run.test.ts…) ficam sem uma vírgula alterada.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buscarPorRemetente, criterioPorRemetente, uidsDaBuscaPorRemetente } from '../src/email/caixa.js';
import { avisarEquipe, contaDoEmail, projetosDoEmail, registrarEmailLido, type EmailLido } from '../src/fila.js';

// ── a busca por remetente ───────────────────────────────────────────────────

test('busca por remetente: lista vira lista; falha do servidor LANÇA, nunca vira "não achei"', () => {
  assert.deepEqual(uidsDaBuscaPorRemetente([3, 7], 'nao.responda@enel.com'), [3, 7]);
  assert.deepEqual(uidsDaBuscaPorRemetente([], 'nao.responda@enel.com'), []);
  assert.throws(() => uidsDaBuscaPorRemetente(false, 'nao.responda@enel.com'), /busca na caixa de e-mail falhou/);
  assert.throws(() => uidsDaBuscaPorRemetente(undefined, 'nao.responda@enel.com'), /busca na caixa de e-mail falhou/);
});

test('busca por remetente: a mensagem de erro cita o remetente (que é nosso, não dado de cliente)', () => {
  assert.throws(() => uidsDaBuscaPorRemetente(false, 'tecnico.abc@enel.com'), /tecnico\.abc@enel\.com/);
});

// O critério da busca. `since` é o que segura o teto de 120 dias: sem ele a caixa
// INTEIRA seria lida (e cada mensagem nova da ENEL custaria IA).
test('critério da busca por remetente: remetente E data, nada além', () => {
  const desde = new Date('2026-09-18T00:00:00Z');
  const c = criterioPorRemetente('nao.responda@enel.com', desde);
  assert.deepEqual(c, { from: 'nao.responda@enel.com', since: desde });
  assert.equal(c.since, desde, 'a data é a que foi pedida, não uma cópia truncada nem undefined');
  assert.ok('since' in c && c.since instanceof Date);
});

/** Um servidor IMAP de mentira: guarda o que recebeu e responde o que mandarem. */
function imapFalso(responde: () => Promise<number[] | false | undefined>) {
  const recebidos: { query: unknown; opcoes: unknown }[] = [];
  return {
    recebidos,
    search: async (query: unknown, opcoes: unknown) => { recebidos.push({ query, opcoes }); return responde(); },
  };
}

test('buscarPorRemetente: manda o critério com uid:true e devolve a lista do servidor', async () => {
  const desde = new Date('2026-09-18T00:00:00Z');
  const imap = imapFalso(async () => [4, 9]);
  assert.deepEqual(await buscarPorRemetente(imap as never, 'tecnico.abc@enel.com', desde), [4, 9]);
  assert.deepEqual(imap.recebidos, [{ query: { from: 'tecnico.abc@enel.com', since: desde }, opcoes: { uid: true } }]);
  assert.deepEqual(await buscarPorRemetente(imapFalso(async () => []) as never, 'a@b', desde), [], 'lista vazia é resposta válida');
});

test('buscarPorRemetente: NO/BAD do servidor (false/undefined) e exceção da conexão LANÇAM, nunca viram []', async () => {
  const desde = new Date('2026-09-18T00:00:00Z');
  await assert.rejects(() => buscarPorRemetente(imapFalso(async () => false) as never, 'a@b', desde), /busca na caixa de e-mail falhou/);
  await assert.rejects(() => buscarPorRemetente(imapFalso(async () => undefined) as never, 'a@b', desde), /busca na caixa de e-mail falhou/);
  await assert.rejects(
    () => buscarPorRemetente(imapFalso(async () => { throw new Error('socket caiu'); }) as never, 'a@b', desde),
    /socket caiu/,
  );
});

// ── a porta do robô para o banco (fila.ts) ──────────────────────────────────
//
// O cliente do Supabase é de verdade; o que é falso é a REDE. Assim o que se
// confere é o JSON que de fato sairia pelo fio — e é no JSON que `undefined`
// some. Provar só o objeto antes do `JSON.stringify` não provaria o que a EDP
// manda.

process.env.SUPABASE_URL = 'http://supabase.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'chave-de-mentira';
delete process.env.LUDMILLA_MODO;

interface Chamada { rpc: string; corpo: Record<string, unknown> }
const chamadas: Chamada[] = [];
let resposta: { status: number; corpo: unknown } = { status: 200, corpo: null };

globalThis.fetch = (async (input: unknown, init?: { body?: unknown }) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
  chamadas.push({
    rpc: new URL(url).pathname.split('/').pop() ?? '',
    corpo: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
  });
  return new Response(JSON.stringify(resposta.corpo), {
    status: resposta.status, headers: { 'content-type': 'application/json' },
  });
}) as typeof fetch;

const ok = (corpo: unknown) => { chamadas.length = 0; resposta = { status: 200, corpo }; };
const falha = (message: string) => { chamadas.length = 0; resposta = { status: 400, corpo: { message, code: 'XX000' } }; };
const ultima = (): Chamada => {
  assert.equal(chamadas.length, 1, 'esperava exatamente uma chamada ao banco');
  return chamadas[0];
};

/** O e-mail lido como a EDP o monta hoje: nenhum campo da ENEL. */
const emailDaEdp: EmailLido = {
  runId: 'run-1', accountId: 'conta-edp', messageId: '<m1@example.invalid>', protocolo: '2024000123',
  projectId: 'proj-1', assunto: 'ASSUNTO INVENTADO', remetente: 'x@example.invalid',
  recebidoEm: '2026-10-01T10:00:00Z', tipoDocumento: 'parecer', veredito: 'favoravel',
  resumo: 'resumo inventado', anexos: 1, motivo: null, recomendacao: 'approved',
  concluida: true, arquivoLido: 'x.pdf',
};

/** Os 16 parâmetros que a EDP manda desde sempre — nem um a mais. */
const payloadDaEdp = {
  p_run_id: 'run-1', p_account_id: 'conta-edp', p_message_id: '<m1@example.invalid>', p_protocolo: '2024000123',
  p_project_id: 'proj-1', p_assunto: 'ASSUNTO INVENTADO', p_remetente: 'x@example.invalid',
  p_recebido_em: '2026-10-01T10:00:00Z', p_tipo_documento: 'parecer', p_veredito: 'favoravel',
  p_resumo: 'resumo inventado', p_anexos: 1, p_motivo: null, p_recomendacao: 'approved',
  p_concluida: true, p_arquivo_lido: 'x.pdf',
};

const CHAVES_NOVAS = ['p_referencia', 'p_casamento', 'p_abrir_cartao', 'p_atualizar_protocolo'];

test('EDP: o payload de ludmilla_email_registrar NÃO muda (nenhuma chave nova no fio)', async () => {
  ok('00000000-0000-0000-0000-000000000000');
  await registrarEmailLido(emailDaEdp);
  const c = ultima();
  assert.equal(c.rpc, 'ludmilla_email_registrar');
  for (const k of CHAVES_NOVAS) {
    assert.equal(k in c.corpo, false, `a EDP não pode mandar ${k} (o banco usa o DEFAULT)`);
  }
  assert.deepEqual(c.corpo, payloadDaEdp, 'os 16 parâmetros da EDP, com os mesmos valores');
});

test('ENEL: referência, casamento, abrirCartao e atualizarProtocolo vão no fio quando informados', async () => {
  ok('00000000-0000-0000-0000-000000000000');
  await registrarEmailLido({
    ...emailDaEdp, protocolo: '', referencia: '392812955', casamento: 'uc', abrirCartao: true, atualizarProtocolo: true,
  });
  const c = ultima();
  assert.equal(c.corpo.p_referencia, '392812955');
  assert.equal(c.corpo.p_casamento, 'uc');
  assert.equal(c.corpo.p_abrir_cartao, true);
  assert.equal(c.corpo.p_atualizar_protocolo, true);
  assert.equal(c.corpo.p_protocolo, '', 'a chave fixa da mensagem da ENEL continua sendo o p_protocolo');
});

test('ENEL: abrirCartao=false e atualizarProtocolo=false VÃO no fio (false não é "não informado")', async () => {
  ok('00000000-0000-0000-0000-000000000000');
  await registrarEmailLido({ ...emailDaEdp, abrirCartao: false, atualizarProtocolo: false });
  const c = ultima();
  assert.equal(c.corpo.p_abrir_cartao, false);
  assert.equal(c.corpo.p_atualizar_protocolo, false);
  assert.equal('p_referencia' in c.corpo, false, 'o que não foi informado continua fora do fio');
  assert.equal('p_casamento' in c.corpo, false);
});

test('ENEL: cada campo novo é independente (só o informado vai)', async () => {
  ok('00000000-0000-0000-0000-000000000000');
  await registrarEmailLido({ ...emailDaEdp, atualizarProtocolo: true });
  const so = Object.keys(ultima().corpo).filter(k => CHAVES_NOVAS.includes(k));
  assert.deepEqual(so, ['p_atualizar_protocolo']);
});

test('registrarEmailLido: erro do banco LANÇA (a mensagem tem de ser gravada ou o run falha)', async () => {
  falha('boom');
  await assert.rejects(() => registrarEmailLido(emailDaEdp), /Não consegui registrar o e-mail lido: boom/);
});

// ── contaDoEmail ────────────────────────────────────────────────────────────

test('contaDoEmail: lê o modo de identificação e a última varredura', async () => {
  ok([{ identificacao: 'remetente', ultima_varredura_em: '2026-10-01T03:00:00Z' }]);
  const r = await contaDoEmail('conta-enel');
  assert.deepEqual(ultima(), { rpc: 'ludmilla_email_conta', corpo: { p_account_id: 'conta-enel' } });
  assert.deepEqual(r, { identificacao: 'remetente', ultimaVarreduraEm: '2026-10-01T03:00:00Z' });
});

test('contaDoEmail: valor desconhecido cai no modo da EDP; primeira varredura vem null', async () => {
  ok([{ identificacao: 'qualquer-coisa', ultima_varredura_em: null }]);
  assert.deepEqual(await contaDoEmail('conta-edp'), { identificacao: 'protocolo_no_assunto', ultimaVarreduraEm: null });
});

test('contaDoEmail: conta que não existe e erro do banco LANÇAM', async () => {
  ok([]);
  await assert.rejects(() => contaDoEmail('conta-x'), /conta de e-mail não foi encontrada/);
  falha('sem acesso');
  await assert.rejects(() => contaDoEmail('conta-x'), /Não consegui ler a configuração da conta: sem acesso/);
});

// ── projetosDoEmail ─────────────────────────────────────────────────────────

test('projetosDoEmail: devolve a lista do banco; vazio é lista vazia; erro LANÇA', async () => {
  const projeto = {
    project_id: 'p1', company_id: 'c1', codigo: 'GD-1', protocolo: null, uc: '0088101266',
    titular: 'TITULAR INVENTADO', status: 'pending', ativo: true,
  };
  ok([projeto]);
  assert.deepEqual(await projetosDoEmail('conta-enel'), [projeto]);
  assert.deepEqual(ultima(), { rpc: 'ludmilla_email_projetos', corpo: { p_account_id: 'conta-enel' } });
  ok(null);
  assert.deepEqual(await projetosDoEmail('conta-enel'), []);
  falha('sem acesso');
  await assert.rejects(() => projetosDoEmail('conta-enel'), /Não consegui listar os projetos da concessionária: sem acesso/);
});

// ── avisarEquipe ────────────────────────────────────────────────────────────

test('avisarEquipe: manda os seis parâmetros e devolve quantos sinos tocaram', async () => {
  ok(3);
  const n = await avisarEquipe({
    accountId: 'conta-enel', messageId: '<m1@example.invalid>', protocolo: '', projectId: 'p1',
    titulo: 'TÍTULO INVENTADO', mensagem: 'MENSAGEM INVENTADA',
  });
  assert.equal(n, 3);
  assert.deepEqual(ultima(), {
    rpc: 'ludmilla_email_avisar',
    corpo: {
      p_account_id: 'conta-enel', p_message_id: '<m1@example.invalid>', p_protocolo: '', p_project_id: 'p1',
      p_titulo: 'TÍTULO INVENTADO', p_mensagem: 'MENSAGEM INVENTADA',
    },
  });
});

test('avisarEquipe: retentativa (o banco devolve 0/null) vira 0; sem projeto vai null; erro LANÇA', async () => {
  ok(null);
  assert.equal(await avisarEquipe({
    accountId: 'a', messageId: 'm', protocolo: '', projectId: null, titulo: 't', mensagem: 'x',
  }), 0);
  assert.equal(ultima().corpo.p_project_id, null);
  falha('permission denied');
  await assert.rejects(
    () => avisarEquipe({ accountId: 'a', messageId: 'm', protocolo: '', projectId: null, titulo: 't', mensagem: 'x' }),
    /Não consegui avisar a equipe: permission denied/,
  );
});
