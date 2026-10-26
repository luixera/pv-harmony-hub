// worker/ludmilla/test/email-pasta.test.ts
//
// A ENEL por e-mail passa a ler "Todos os e-mails" (a pasta `\All` do Gmail), não só a
// Caixa de entrada. Medido em 24/10/2026: na INBOX os e-mails da ENEL começam em 09/10,
// e a conta tem e-mails desde maio (o Claudinho, pela API do Gmail, viu 51 em agosto e
// 67 em setembro). A EDP NÃO muda: continua na INBOX.
//
// Arquivo NOVO de propósito: os testes da EDP e da ENEL que já existem ficam sem uma
// vírgula alterada.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  abrirPasta, escolherPasta, preferenciaDaPasta,
  type Caixa, type EnvelopeLido, type OpcoesDaCaixa, type PastaDaLista,
} from '../src/email/caixa.js';
import { anotarEnvelopes, contaEnelZerada, executarVarreduraEnel, resultadoEnel } from '../src/email/enel/run.js';
import type { Run } from '../src/fila.js';

// ── escolherPasta (pura) ────────────────────────────────────────────────────

const GMAIL_PT: PastaDaLista[] = [
  { path: 'INBOX', specialUse: '\\Inbox' },
  { path: '[Gmail]/Enviados', specialUse: '\\Sent' },
  { path: '[Gmail]/Todos os e-mails', specialUse: '\\All' },
  { path: '[Gmail]/Spam', specialUse: '\\Junk' },
];
const GMAIL_EN: PastaDaLista[] = [
  { path: 'INBOX', specialUse: '\\Inbox' },
  { path: '[Gmail]/All Mail', specialUse: '\\All' },
];

test('escolherPasta "todos": acha a pasta \\All, em português ou em inglês', () => {
  assert.deepEqual(escolherPasta(GMAIL_PT, 'todos'), { caminho: '[Gmail]/Todos os e-mails', reserva: false });
  assert.deepEqual(escolherPasta(GMAIL_EN, 'todos'), { caminho: '[Gmail]/All Mail', reserva: false });
});

test('escolherPasta "todos": o que vale é o specialUse, NUNCA o nome da pasta', () => {
  // nome estranho, mas \All de verdade: é essa
  assert.deepEqual(
    escolherPasta([{ path: 'INBOX', specialUse: '\\Inbox' }, { path: 'Arquivo Geral', specialUse: '\\All' }], 'todos'),
    { caminho: 'Arquivo Geral', reserva: false },
  );
  // nome idêntico ao do Gmail, mas SEM \All (pasta comum do usuário): não é essa
  assert.deepEqual(
    escolherPasta([{ path: 'INBOX', specialUse: '\\Inbox' }, { path: '[Gmail]/All Mail' }, { path: '[Gmail]/Todos os e-mails', specialUse: '\\Archive' }], 'todos'),
    { caminho: 'INBOX', reserva: true },
  );
});

test('escolherPasta "todos": sem pasta \\All cai na INBOX e AVISA que foi reserva', () => {
  assert.deepEqual(escolherPasta([{ path: 'INBOX', specialUse: '\\Inbox' }, { path: 'Trabalho' }], 'todos'), { caminho: 'INBOX', reserva: true });
  assert.deepEqual(escolherPasta([], 'todos'), { caminho: 'INBOX', reserva: true });
});

test('escolherPasta "entrada": é SEMPRE a INBOX, mesmo que exista \\All, e nunca é reserva', () => {
  assert.deepEqual(escolherPasta(GMAIL_PT, 'entrada'), { caminho: 'INBOX', reserva: false });
  assert.deepEqual(escolherPasta(GMAIL_EN, 'entrada'), { caminho: 'INBOX', reserva: false });
  assert.deepEqual(escolherPasta([], 'entrada'), { caminho: 'INBOX', reserva: false });
});

test('preferenciaDaPasta: sem opção (o jeito que a EDP chama) é "entrada"', () => {
  assert.equal(preferenciaDaPasta(undefined), 'entrada');
  assert.equal(preferenciaDaPasta({}), 'entrada');
  assert.equal(preferenciaDaPasta({ pasta: undefined }), 'entrada');
  assert.equal(preferenciaDaPasta({ pasta: 'entrada' }), 'entrada');
  assert.equal(preferenciaDaPasta({ pasta: 'todos' }), 'todos');
});

// ── abrirPasta: o dublê do cliente IMAP ─────────────────────────────────────

function imapFalso(lista: PastaDaLista[], o: { listaFalha?: boolean } = {}) {
  const trancas: { path: string; opcoes: unknown }[] = [];
  const lock = { release: () => undefined };
  let listagens = 0;
  return {
    trancas, lock, listagens: () => listagens,
    async list() { listagens++; if (o.listaFalha) throw new Error('LIST falhou'); return lista; },
    async getMailboxLock(path: string, opcoes: { readOnly: true }) { trancas.push({ path, opcoes }); return lock; },
  };
}

test('EDP: sem opção, abre a INBOX em SÓ LEITURA e nem pergunta pela lista de pastas', async () => {
  const imap = imapFalso(GMAIL_PT);
  const r = await abrirPasta(imap, preferenciaDaPasta(undefined));
  assert.deepEqual(imap.trancas, [{ path: 'INBOX', opcoes: { readOnly: true } }]);
  assert.equal(imap.listagens(), 0, 'o caminho da EDP não ganha nenhuma chamada nova ao servidor');
  assert.equal(r.caminho, 'INBOX');
  assert.equal(r.reserva, false);
  assert.equal(r.lock, imap.lock);
});

test('ENEL: com \\All, abre ESSA pasta em só leitura (EXAMINE), nunca a INBOX', async () => {
  const imap = imapFalso(GMAIL_PT);
  const r = await abrirPasta(imap, 'todos');
  assert.deepEqual(imap.trancas, [{ path: '[Gmail]/Todos os e-mails', opcoes: { readOnly: true } }]);
  assert.equal(r.caminho, '[Gmail]/Todos os e-mails');
  assert.equal(r.reserva, false);
});

test('ENEL: sem \\All, abre a INBOX em só leitura e diz que foi reserva', async () => {
  const imap = imapFalso([{ path: 'INBOX', specialUse: '\\Inbox' }]);
  const r = await abrirPasta(imap, 'todos');
  assert.deepEqual(imap.trancas, [{ path: 'INBOX', opcoes: { readOnly: true } }]);
  assert.equal(r.caminho, 'INBOX');
  assert.equal(r.reserva, true);
});

test('abrirPasta: falha ao listar as pastas LANÇA (não vira "li a INBOX" em silêncio) e nada é aberto', async () => {
  const imap = imapFalso(GMAIL_PT, { listaFalha: true });
  await assert.rejects(() => abrirPasta(imap, 'todos'), /LIST falhou/);
  assert.equal(imap.trancas.length, 0);
});

// ── os dois chamadores (a EDP e a ENEL) ─────────────────────────────────────

const FONTE_EDP = new URL('../../src/email/index.ts', import.meta.url);

test('EDP (leitura do código-fonte): TODA chamada de abrirCaixa no run da EDP é sem opção', () => {
  // O run da EDP não tem ponto de injeção, e esta entrega não o mexe: o que se prova
  // aqui é o texto das chamadas. Se alguém passar `{ pasta: 'todos' }`, ou qualquer
  // segundo argumento, a EDP deixa de ler só a INBOX e este teste cai.
  const fonte = readFileSync(FONTE_EDP, 'utf8');
  const chamadas = [...fonte.matchAll(/\babrirCaixa\(([^)]*)\)/g)].map(m => m[1].trim());
  assert.ok(chamadas.length >= 1, 'o run da EDP chama abrirCaixa');
  for (const argumentos of chamadas) assert.equal(argumentos, 'creds', `a EDP chama abrirCaixa(creds), sem opção; achei abrirCaixa(${argumentos})`);
  assert.equal(/pasta\s*:/.test(fonte), false, 'o run da EDP não fala de pasta');
});

const RUN: Run = { id: 'run-1', tenant_id: 'tenant-1', account_id: 'conta-enel', tipo: 'varredura_email', situacao: 'em_andamento' };

const REGRAS = [
  { id: 'r1', remetente: 'nao.responda@enel.com', assunto: '', tipo_documento: 'carta_projeto', anexar: true, ler_pdf: true },
  { id: 'r2', remetente: 'tecnico.abc@enel.com', assunto: '', tipo_documento: 'resultado_vistoria', anexar: true, ler_pdf: true },
];

// A REDE é falsa (o cliente do Supabase é o de verdade): o que se confere é o JSON que sairia pelo fio.
process.env.SUPABASE_URL = 'http://supabase.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'chave-de-mentira';
delete process.env.LUDMILLA_MODO;

interface Chamada { rpc: string; corpo: Record<string, unknown> }
const chamadas: Chamada[] = [];
/** Por padrão toda mensagem está JÁ TRATADA (pendente = false): o run só lê envelopes. */
let pendentes: ReadonlySet<string> = new Set();

globalThis.fetch = (async (input: unknown, init?: { body?: unknown }) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
  const rpc = new URL(url).pathname.split('/').pop() ?? '';
  const corpo = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
  chamadas.push({ rpc, corpo });
  const dados: unknown =
    rpc === 'ludmilla_email_credencial' ? [{ email: 'robo@exemplo.invalid', senha: 'senha-de-mentira' }]
    : rpc === 'ludmilla_email_regras' ? REGRAS
    : rpc === 'ludmilla_email_projetos' ? []
    : rpc === 'ludmilla_email_mensagem_pendente' ? pendentes.has(String(corpo.p_message_id))
    : null;
  return new Response(JSON.stringify(dados), { status: 200, headers: { 'content-type': 'application/json' } });
}) as typeof fetch;

const env = (uid: number, messageId: string, recebidoEm: string | null): EnvelopeLido => ({
  uid, messageId, assunto: 'ASSUNTO INVENTADO', recebidoEm: recebidoEm ? new Date(recebidoEm) : null,
});

/** Uma caixa de mentira: só envelopes por remetente. `baixar` não é chamado quando tudo está tratado. */
function caixaFalsa(pasta: string, porRemetente: Record<string, EnvelopeLido[]>) {
  const estado = { fechada: false, baixou: false };
  const caixa: Caixa = {
    pasta,
    async procurar() { return []; },
    async procurarDe(remetente: string) { return (porRemetente[remetente] ?? []).map(e => e.uid); },
    async *envelopes(uids: number[]) {
      for (const lista of Object.values(porRemetente)) for (const e of lista) if (uids.includes(e.uid)) yield e;
    },
    async *baixar() { estado.baixou = true; },
    naoLidas: () => 0,
    async fechar() { estado.fechada = true; },
  };
  return { caixa, estado };
}

/** Roda o run da ENEL com a caixa falsa e devolve o que foi pedido à caixa e o `resultado` gravado. */
async function rodar(porRemetente: Record<string, EnvelopeLido[]>, pasta = '[Gmail]/Todos os e-mails') {
  chamadas.length = 0;
  const { caixa, estado } = caixaFalsa(pasta, porRemetente);
  const pedidos: { c: unknown; opcoes: OpcoesDaCaixa | undefined }[] = [];
  const original = console.log;
  console.log = () => undefined;
  try {
    await executarVarreduraEnel(RUN, async (c, opcoes) => { pedidos.push({ c, opcoes }); return caixa; });
  } finally { console.log = original; }
  const fim = chamadas.filter(c => c.rpc === 'ludmilla_finalizar_run');
  assert.equal(fim.length, 1, 'o run é fechado exatamente uma vez');
  return { pedidos, estado, fim: fim[0].corpo, resultado: fim[0].corpo.p_resultado as Record<string, unknown> };
}

test('ENEL: o run abre a caixa pedindo "todos" (Todos os e-mails), e fecha a conexão', async () => {
  const { pedidos, estado, fim } = await rodar({});
  assert.equal(pedidos.length, 1);
  assert.deepEqual(pedidos[0].c, { email: 'robo@exemplo.invalid', senha: 'senha-de-mentira' });
  assert.equal(preferenciaDaPasta(pedidos[0].opcoes), 'todos', 'a ENEL lê Todos os e-mails');
  assert.equal(estado.fechada, true);
  assert.equal(fim.p_situacao, 'ok');
});

test('ENEL: o resultado traz pasta_lida e email_mais_antigo (o mais antigo entre TODOS os remetentes)', async () => {
  const { resultado } = await rodar({
    'nao.responda@enel.com': [env(1, '<a@x>', '2026-09-05T10:00:00Z'), env(2, '<b@x>', '2026-10-12T10:00:00Z')],
    'tecnico.abc@enel.com': [env(3, '<c@x>', '2026-05-20T08:30:00Z'), env(4, '<d@x>', null)],
  });
  assert.equal(resultado.pasta_lida, '[Gmail]/Todos os e-mails');
  assert.equal(resultado.email_mais_antigo, '2026-05-20T08:30:00.000Z');
});

test('ENEL: email_mais_antigo conta os e-mails JÁ TRATADOS (pulados): é isso que mostra até onde a pasta alcança', async () => {
  // pendentes vazio = nenhuma mensagem precisa de tratamento: todas viram "pulados"
  const { resultado, estado } = await rodar({
    'nao.responda@enel.com': [env(1, '<a@x>', '2026-06-01T10:00:00Z'), env(2, '<b@x>', '2026-10-12T10:00:00Z')],
  });
  assert.equal(resultado.pulados, 2);
  assert.equal(resultado.lidos, 0);
  assert.equal(estado.baixou, false, 'tudo pulado: nada é baixado');
  assert.equal(resultado.email_mais_antigo, '2026-06-01T10:00:00.000Z');
});

test('ENEL: sem nenhum e-mail na busca, email_mais_antigo é null e pasta_lida continua dita', async () => {
  const { resultado } = await rodar({}, 'INBOX');
  assert.equal(resultado.email_mais_antigo, null);
  assert.equal(resultado.pasta_lida, 'INBOX', 'se a conta não tiver \\All, o resultado mostra que foi a reserva');
});

// ── anotarEnvelopes e as chaves do resultado ────────────────────────────────

test('anotarEnvelopes: guarda o mais antigo, ignora data ausente, e não "esquece" um mais antigo já visto', () => {
  const n = contaEnelZerada();
  // função de propósito: o `assert.equal` estreita `n.maisAntigoEm` para `null` e o TS não
  // "desestreitaria" depois das chamadas de `anotarEnvelopes`
  const maisAntigo = () => n.maisAntigoEm?.toISOString() ?? null;
  assert.equal(maisAntigo(), null);
  anotarEnvelopes(n, [env(1, '<a>', '2026-10-01T00:00:00Z'), env(2, '<b>', null), env(3, '<c>', '2026-09-01T00:00:00Z')]);
  assert.equal(maisAntigo(), '2026-09-01T00:00:00.000Z');
  anotarEnvelopes(n, [env(4, '<d>', '2026-10-20T00:00:00Z')]); // outro remetente, mais novo: não troca
  assert.equal(maisAntigo(), '2026-09-01T00:00:00.000Z');
  anotarEnvelopes(n, [env(5, '<e>', '2026-05-02T12:00:00Z')]); // outro remetente, mais velho: troca
  assert.equal(maisAntigo(), '2026-05-02T12:00:00.000Z');
  anotarEnvelopes(n, []);
  assert.equal(maisAntigo(), '2026-05-02T12:00:00.000Z');
});

test('resultadoEnel: as chaves que já existiam continuam (a tela lê), e as duas novas entram', () => {
  const ANTIGAS = [
    'remetentes', 'projetos_ativos', 'lidos', 'tratados', 'por_protocolo', 'por_uc', 'por_titular',
    'nao_identificados', 'conflitos', 'inativos', 'bloqueados', 'ignorados', 'anexados',
    'anexos_de_outro_projeto', 'anexos_recusados', 'anexos_sem_nome', 'imagens_ignoradas', 'avisos',
    'avisos_mensagens', 'pulados', 'a_tentar_de_novo', 'nao_lidas', 'falhas', 'falhas_busca', 'falhas_tratamento',
  ];
  const n = contaEnelZerada();
  n.pastaLida = '[Gmail]/All Mail';
  n.maisAntigoEm = new Date('2026-05-02T12:00:00Z');
  const r = resultadoEnel(n, 4, 30, 0);
  for (const k of ANTIGAS) assert.equal(typeof r[k], 'number', `a chave ${k} continua, numérica`);
  assert.deepEqual(Object.keys(r).filter(k => !ANTIGAS.includes(k)).sort(), ['email_mais_antigo', 'pasta_lida']);
  assert.equal(r.pasta_lida, '[Gmail]/All Mail');
  assert.equal(r.email_mais_antigo, '2026-05-02T12:00:00.000Z');
});

test('resultadoEnel: sem diagnóstico, as duas chaves novas existem e valem null', () => {
  const r = resultadoEnel(contaEnelZerada(), 1, 1, 0);
  assert.equal(r.pasta_lida, null);
  assert.equal(r.email_mais_antigo, null);
});
