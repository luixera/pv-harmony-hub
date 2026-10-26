// worker/ludmilla/test/enel-cobranca-run.test.ts
// O run da ENEL agenda a cobrança da nota e a encerra quando a ENEL avisa que trocou.
// Duas camadas: (1) o tratamento de UMA mensagem, com dublês que GRAVAM o que foi chamado;
// (2) as RPCs de verdade (`fila.ts`) e o run inteiro, com a REDE falsa (o JSON que sairia
// pelo fio). Titular, UC, NT, notas e Message-IDs inventados; o canalgd.sp@br.enel.com é o
// remetente público da regra.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simpleParser } from 'mailparser';
import { DEPS_ENEL, executarVarreduraEnel, tratarMensagemEnel, type DepsEnel } from '../src/email/enel/run.js';
import type { ProjetoEnel } from '../src/email/enel/identificar.js';
import { extrairMensagem, type Caixa, type MensagemLida } from '../src/email/caixa.js';
import type { RegraEmail } from '../src/email/util.js';
import {
  agendarCobranca, encerrarCobrancasPorTroca, type CobrancaParaAgendar, type EmailLido, type Run,
} from '../src/fila.js';

// A REDE é falsa (o cliente do Supabase é o de verdade). Tem de vir antes do 1º uso do cliente.
process.env.SUPABASE_URL = 'http://supabase.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'chave-de-mentira';
delete process.env.LUDMILLA_MODO;

const RUN: Run = { id: 'run-cob', tenant_id: 'tenant-cob', account_id: 'conta-enel', tipo: 'varredura_email', situacao: 'rodando' };
const REGRAS: RegraEmail[] = [
  { id: 'r-canal', remetente: 'canalgd.sp@br.enel.com', assunto: '', tipo_documento: 'troca_relogio', anexar: true, ler_pdf: true },
  { id: 'r-carta', remetente: 'nao.responda@enel.com', assunto: '', tipo_documento: 'carta_projeto', anexar: true, ler_pdf: true },
];
const PA: ProjetoEnel = {
  project_id: 'id-cob-1', company_id: 'empresa-cob', codigo: 'GD-COB-001', protocolo: '391000010',
  uc: '0055001001', titular: 'TEODORICO VALADARES QUINTINO', status: 'approved', ativo: true,
};
const PB: ProjetoEnel = {
  project_id: 'id-cob-2', company_id: 'empresa-cob', codigo: 'GD-COB-002', protocolo: '391000020',
  uc: '0055002002', titular: 'GILVANETE SOARES QUINTILHO', status: 'approved', ativo: true,
};
const PINATIVO: ProjetoEnel = {
  project_id: 'id-cob-3', company_id: 'empresa-cob', codigo: 'GD-COB-003', protocolo: '391000030',
  uc: '0055003003', titular: 'ARLINDA CORDEIRO VIEGAS', status: 'completed', ativo: false,
};

const AGORA = new Date('2026-10-24T12:00:00Z');
// A nota como a ENEL escreve: 11 dígitos (a forma comum) ou 12 com um zero na frente; a canônica é a de 12.
const NOTA11 = '70712345678';
const NOTA12 = '070712345678';
const AGENDADA = `Prezado(a), boa tarde! Nota de serviço criada ${NOTA11} , na data de 01/10/2026 , referente a instalação 2222222222 , para a troca do medidor bidirecional, com o prazo de execução de até 7 dias úteis. Protocolo: 9876543210 . Atenciosamente`;
const REENVIO = `Prezado(a), bom dia! Reenviamos a nota de serviço ${NOTA11} , referente a instalação 2222222222 , para a troca do medidor bidirecional, com o prazo de execução de até 5 dias úteis. Motivo da rejeição: Fechado Sem Acesso ao Centro de Medição. 06.10.2026 Protocolo: 9876543210 . Atenciosamente`;
const FALHA_SEM_NOTA = 'Identificamos que a tentativa de troca do medidor no dia 15/09 não foi executada pelo seguinte motivo: Cliente Não Permitiu Execução.';
const SEM_NUMERO = 'Nota de serviço criada , para a troca do medidor bidirecional, com o prazo de execução de até 7 dias úteis.';
const REALIZADA = `Prezado(a), a troca do medidor referente à nota GD 391000010, já foi realizada através da nota de serviço ${NOTA11} .`;

const mensagem = (o: Partial<MensagemLida> = {}): MensagemLida => ({
  uid: 1, messageId: '<cob-nota-1@enel.test>', assunto: 'RE: TROCA DE RELÓGIO - NT 391000010',
  remetente: 'Canal GD <canalgd.sp@br.enel.com>', recebidoEm: new Date('2026-10-01T15:00:00Z'),
  texto: AGENDADA, anexos: [], anexosSemNome: 0, referencias: ['<cob-pedido@exemplo.test>'], ...o,
});

interface Diario {
  ordem: string[]; registros: EmailLido[]; agendadas: CobrancaParaAgendar[]; encerradas: [string, string, string][];
}

/**
 * Se uma frente anterior tiver posto um campo OBRIGATÓRIO a mais em `DepsEnel`, o tsc aponta
 * aqui: acrescente um dublê que não faz nada, no mesmo formato dos de baixo.
 */
function dubles(o: {
  agendarFalha?: Error; encerrarFalha?: Error; resposta?: string; encerradas?: number; semCobranca?: boolean;
} = {}): { deps: DepsEnel; d: Diario } {
  const d: Diario = { ordem: [], registros: [], agendadas: [], encerradas: [] };
  const deps: DepsEnel = {
    async abrirTentativa() { d.ordem.push('abrirTentativa'); return 1; },
    async anexoDeEmail() { return { situacao: 'ja_resolvido' }; },
    async subirDocumento() { return 'caminho'; },
    async anexoEnviado() { /* nada */ },
    async anexoErro() { /* nada */ },
    async registrarEmailLido(p) { d.ordem.push('registrarEmailLido'); d.registros.push(p); },
    async avisar() { d.ordem.push('avisar'); return 1; },
    async lerParecer() { throw new Error('a IA não deveria ser chamada nestes casos'); },
  };
  if (!o.semCobranca) {
    deps.agendarCobranca = async p => {
      d.ordem.push('agendarCobranca');
      if (o.agendarFalha) throw o.agendarFalha;
      d.agendadas.push(p);
      return o.resposta ?? 'criada';
    };
    deps.encerrarCobrancas = async (conta, projeto, quando) => {
      d.ordem.push('encerrarCobrancas');
      if (o.encerrarFalha) throw o.encerrarFalha;
      d.encerradas.push([conta, projeto, quando]);
      return o.encerradas ?? 1;
    };
  }
  return { deps, d };
}

const FALHA_DE_BANCO = new Error('Não consegui agendar a cobrança da troca (código 23514)');
const FALHA_AO_ENCERRAR = new Error('Não consegui encerrar as cobranças da troca (código 42501)');

async function comLogs<T>(f: () => Promise<T>): Promise<{ r: T; logs: string }> {
  const original = console.log;
  const linhas: string[] = [];
  console.log = (linha?: unknown) => { linhas.push(String(linha)); };
  try { return { r: await f(), logs: linhas.join('\n') }; } finally { console.log = original; }
}
const tratar = (m: MensagemLida, deps: DepsEnel, projetos: ProjetoEnel[] = [PA]) =>
  comLogs(() => tratarMensagemEnel(RUN, m, REGRAS, projetos, deps, AGORA));
const ultimoRegistro = (d: Diario): EmailLido => {
  const r = d.registros.at(-1);
  if (!r) throw new Error('nenhum registro');
  return r;
};
/** O que NÃO é da cobrança: o registro sem a anotação e sem o "terminei". */
const semACobranca = (r: EmailLido) => ({ ...r, motivo: null, concluida: null });

// ── 1. O tratamento de uma mensagem (dublês) ─────────────────────────────────

test('troca agendada: agenda a cobrança da nota (12 dígitos) com tudo o que a resposta precisa', async () => {
  const { deps, d } = dubles();
  const { r } = await tratar(mensagem(), deps);
  assert.equal(r.situacao, 'tratado');
  assert.deepEqual(d.agendadas, [{
    accountId: 'conta-enel', messageId: '<cob-nota-1@enel.test>', projectId: 'id-cob-1',
    nota: NOTA12, dataNota: '2026-10-01T15:00:00.000Z', prazoDias: 7,
    para: 'canalgd.sp@br.enel.com', assunto: 'RE: TROCA DE RELÓGIO - NT 391000010',
    inReplyTo: '<cob-nota-1@enel.test>', referencias: ['<cob-pedido@exemplo.test>', '<cob-nota-1@enel.test>'],
  }]);
});

test('a nota escrita com 11 dígitos ou com 12 (zero na frente) é a MESMA nota', async () => {
  const a = dubles();
  await tratar(mensagem({ texto: AGENDADA }), a.deps);
  const b = dubles();
  await tratar(mensagem({ texto: AGENDADA.replace(NOTA11, NOTA12) }), b.deps);
  assert.equal(a.d.agendadas[0].nota, NOTA12);
  assert.equal(b.d.agendadas[0].nota, NOTA12);
});

test('a NT de 9 dígitos NUNCA vira o número da nota', async () => {
  const { deps, d } = dubles();
  await tratar(mensagem({ texto: 'Nota de serviço criada para a troca do medidor da nota 391000010, com o prazo de execução de até 7 dias úteis.' }), deps);
  assert.equal(d.agendadas[0].nota, null);
});

test('a cobrança é agendada ANTES do registro concluído (a resposta do banco decide o "terminei")', async () => {
  const { deps, d } = dubles();
  await tratar(mensagem(), deps);
  assert.ok(d.ordem.indexOf('agendarCobranca') < d.ordem.lastIndexOf('registrarEmailLido'), d.ordem.join(' > '));
});

test('o histórico da mensagem diz para quando a cobrança ficou, com a nota como a ENEL escreve (sem o zero)', async () => {
  const { deps, d } = dubles();
  await tratar(mensagem(), deps);
  assert.match(String(ultimoRegistro(d).motivo), new RegExp(`cobrança da nota ${NOTA11} à ENEL agendada para 08/10/2026`));
  assert.ok(!String(ultimoRegistro(d).motivo).includes(NOTA12), 'o zero à esquerda é do banco, não da tela');
});

test('a data do histórico é a do e-mail da nota + 7 dias, no horário de Brasília', async () => {
  const { deps, d } = dubles();
  // 31/10 às 23h30 em Brasília = 01/11 02:30 UTC: + 7 dias = 07/11 (e não 08/11)
  await tratar(mensagem({ recebidoEm: new Date('2026-11-01T02:30:00Z') }), deps);
  assert.match(String(ultimoRegistro(d).motivo), /agendada para 07\/11\/2026/);
});

test('o reenvio da nota (troca que falhou com o número) reabre a mesma nota', async () => {
  const { deps, d } = dubles();
  await tratar(mensagem({ texto: REENVIO }), deps);
  assert.equal(d.agendadas.length, 1);
  assert.equal(d.agendadas[0].nota, NOTA12);
  assert.equal(d.agendadas[0].prazoDias, null);
});

test('falha sem número, e Carta, não agendam nada', async () => {
  const a = dubles();
  await tratar(mensagem({ texto: FALHA_SEM_NOTA }), a.deps);
  assert.equal(a.d.agendadas.length, 0);
  const b = dubles();
  await tratar(mensagem({ remetente: 'ENEL <nao.responda@enel.com>', assunto: 'Carta - NT 391000010', texto: '' }), b.deps);
  assert.equal(b.d.agendadas.length, 0);
});

test('remetente que só PARECE da ENEL casa a regra, mas não vira cobrança', async () => {
  const { deps, d } = dubles();
  const { logs } = await tratar(mensagem({ remetente: 'Canal <canalgd.sp@br.enel.com.exemplo.test>' }), deps);
  assert.equal(d.agendadas.length, 0);
  assert.match(logs, /fora da ENEL/);
});

test('remetente com "%" disfarçado de @enel.com não vira cobrança', async () => {
  const { deps, d } = dubles();
  await tratar(mensagem({ remetente: 'Canal <canalgd.sp@br.enel.com>, <x%evil.com@enel.com>' }), deps);
  assert.equal(d.agendadas.length, 0);
});

test('sem o projeto casado (não reconhecido, em conflito ou já concluído): nada é agendado', async () => {
  // não reconhecido: o assunto e o corpo não trazem protocolo, UC nem titular de projeto nosso
  const a = dubles();
  const { r: ra } = await tratar(mensagem({ assunto: 'RE: TROCA DE RELÓGIO' }), a.deps);
  assert.equal(ra.situacao, 'nao_identificado');
  // em conflito: a NT do assunto e a UC do corpo apontam para projetos diferentes
  const b = dubles();
  const { r: rb } = await tratar(mensagem({ texto: `${AGENDADA} UC 0055002002` }), b.deps, [PA, PB]);
  assert.equal(rb.situacao, 'conflito');
  // já concluído
  const c = dubles();
  const { r: rc } = await tratar(mensagem({ assunto: 'RE: TROCA DE RELÓGIO - NT 391000030' }), c.deps, [PA, PINATIVO]);
  assert.equal(rc.situacao, 'inativo');
  for (const x of [a, b, c]) {
    assert.equal(x.d.agendadas.length, 0);
    assert.ok(!x.d.ordem.includes('agendarCobranca'));
  }
});

test('nota sem número: agenda assim mesmo, e o histórico avisa para conferir', async () => {
  const { deps, d } = dubles();
  await tratar(mensagem({ texto: SEM_NUMERO }), deps);
  assert.equal(d.agendadas[0].nota, null);
  assert.match(String(ultimoRegistro(d).motivo), /SEM o número da nota/);
});

test('a resposta do banco que NÃO é "criada" nem "atualizada": nada de ressalva de agendamento', async () => {
  for (const resposta of ['mantida', 'mais_antiga', 'projeto_inativo', 'para_recusado', 'conta_recusada', 'mensagem_inexistente']) {
    const { deps, d } = dubles({ resposta });
    const { logs } = await tratar(mensagem(), deps);
    // "troca do relógio agendada" (a anotação de sempre) continua; só a ressalva da cobrança some
    assert.doesNotMatch(String(ultimoRegistro(d).motivo ?? ''), /à ENEL agendada|SEM o número/, resposta);
    assert.match(logs, new RegExp(`"resultado":"${resposta}"`), 'o log diz o que o banco respondeu');
    assert.equal(ultimoRegistro(d).concluida, true, `${resposta} não é falha: a mensagem termina`);
  }
  const { deps, d } = dubles({ resposta: 'atualizada' });
  await tratar(mensagem(), deps);
  assert.match(String(ultimoRegistro(d).motivo), /à ENEL agendada/, '"atualizada" ganha a ressalva, como "criada"');
});

// ── 2. Falha ao agendar: o e-mail é tratado como sempre; a cobrança fica para a próxima leitura ──

test('o agendamento falhou: o tratamento NÃO rejeita, o e-mail é tratado como sempre e fica para a releitura', async () => {
  const bom = dubles();
  const { r: rb } = await tratar(mensagem(), bom.deps);
  const ruim = dubles({ agendarFalha: FALHA_DE_BANCO });
  const { r } = await tratar(mensagem(), ruim.deps);
  assert.equal(r.situacao, 'tratado');
  assert.equal(r.concluida, false, 'a cobrança não foi agendada: um run futuro tenta de novo');
  assert.equal(ruim.d.registros.length, 1, 'o registro (cartão, histórico) sai como sempre');
  assert.equal(ultimoRegistro(ruim.d).concluida, false);
  assert.match(String(ultimoRegistro(ruim.d).motivo), /cobrança à ENEL NÃO agendada \(código 23514\)/);
  // o resto do tratamento é IGUAL ao da leitura sem falha: só mudam o "terminei" e a anotação da cobrança
  assert.deepEqual(semACobranca(ultimoRegistro(ruim.d)), semACobranca(ultimoRegistro(bom.d)));
  assert.deepEqual({ ...r, concluida: null }, { ...rb, concluida: null });
  assert.deepEqual(ruim.d.ordem.filter(x => x !== 'agendarCobranca'), bom.d.ordem.filter(x => x !== 'agendarCobranca'),
    'as mesmas chamadas de antes (tentativa, sino, registro), na mesma ordem');
});

test('o agendamento falhou e o log/histórico NUNCA levam a mensagem crua do erro (ela pode citar o cliente)', async () => {
  const cru = new Error('duplicate key value violates unique constraint — Failing row contains (TEODORICO VALADARES QUINTINO, 70712345678)');
  const { deps, d } = dubles({ agendarFalha: cru });
  const { logs } = await tratar(mensagem(), deps);
  const historico = String(ultimoRegistro(d).motivo);
  for (const proibido of ['TEODORICO', 'QUINTINO', NOTA11 + ')', 'duplicate key']) {
    assert.ok(!logs.includes(proibido), `o log tem "${proibido}"`);
    assert.ok(!historico.includes(proibido), `o histórico tem "${proibido}"`);
  }
  assert.match(logs, /"nivel":"falha"/);
  assert.match(historico, /NÃO agendada \(erro sem código\)/);
});

test('o encerramento falhou: o cartão de Concluído sai como sempre e a mensagem fica para a releitura', async () => {
  const bom = dubles();
  await tratar(mensagem({ texto: REALIZADA, recebidoEm: new Date('2026-10-20T15:00:00Z') }), bom.deps);
  const ruim = dubles({ encerrarFalha: FALHA_AO_ENCERRAR });
  const { r } = await tratar(mensagem({ texto: REALIZADA, recebidoEm: new Date('2026-10-20T15:00:00Z') }), ruim.deps);
  assert.equal(r.situacao, 'tratado');
  assert.equal(r.concluida, false);
  const reg = ultimoRegistro(ruim.d);
  assert.equal(reg.abrirCartao, true, 'o cartão que sugere Concluído não depende da cobrança');
  assert.equal(reg.recomendacao, 'completed');
  assert.equal(reg.concluida, false);
  assert.match(String(reg.motivo), /não consegui encerrar a cobrança à ENEL \(código 42501\)/);
  assert.deepEqual(semACobranca(reg), semACobranca(ultimoRegistro(bom.d)));
});

test('o encerramento falhou: o log não leva a mensagem crua do erro', async () => {
  const { deps } = dubles({ encerrarFalha: new Error('permission denied para TEODORICO VALADARES QUINTINO') });
  const { logs } = await tratar(mensagem({ texto: REALIZADA }), deps);
  assert.ok(!logs.includes('TEODORICO') && !logs.includes('permission denied'), logs);
  assert.match(logs, /"nivel":"falha"/);
});

// ── 3. Troca realizada: encerra ──────────────────────────────────────────────

test('troca realizada: encerra as cobranças do projeto, com a data do e-mail, e não agenda nada', async () => {
  const { deps, d } = dubles();
  await tratar(mensagem({ texto: REALIZADA, recebidoEm: new Date('2026-10-20T15:00:00Z') }), deps);
  assert.deepEqual(d.encerradas, [['conta-enel', 'id-cob-1', '2026-10-20T15:00:00.000Z']]);
  assert.equal(d.agendadas.length, 0);
  assert.ok(!d.ordem.includes('agendarCobranca'));
  assert.match(String(ultimoRegistro(d).motivo), /1 cobrança\(s\) à ENEL encerrada\(s\)/);
  assert.equal(ultimoRegistro(d).concluida, true);
});

test('troca realizada: a reprogramação executada também encerra', async () => {
  const { deps, d } = dubles();
  await tratar(mensagem({
    texto: `Prezado(a), nota de serviço ${NOTA11} para a reprogramação do medidor bidirecional, que se encontra executada em 20/10/2026.`,
    recebidoEm: new Date('2026-10-20T15:00:00Z'),
  }), deps);
  assert.equal(d.encerradas.length, 1);
  assert.equal(d.agendadas.length, 0);
});

test('troca realizada sem cobrança aberta (o banco devolve 0): encerra sem ressalva', async () => {
  const { deps, d } = dubles({ encerradas: 0 });
  await tratar(mensagem({ texto: REALIZADA }), deps);
  assert.equal(d.encerradas.length, 1);
  assert.doesNotMatch(String(ultimoRegistro(d).motivo), /encerrada/);
});

test('troca realizada, e-mail sem data: encerra até a hora da leitura (nunca derruba o tratamento)', async () => {
  const { deps, d } = dubles();
  const { r } = await tratar(mensagem({ texto: REALIZADA, recebidoEm: null }), deps);
  assert.equal(r.situacao, 'tratado');
  assert.deepEqual(d.encerradas, [['conta-enel', 'id-cob-1', '2026-10-24T12:00:00.000Z']]);
});

test('troca agendada, e a que falhou, não encerram nada; a realizada só encerra se o projeto foi achado', async () => {
  const a = dubles();
  await tratar(mensagem(), a.deps);
  await tratar(mensagem({ texto: REENVIO }), a.deps);
  await tratar(mensagem({ texto: FALHA_SEM_NOTA }), a.deps);
  assert.equal(a.d.encerradas.length, 0);
  const b = dubles();
  // a NT do corpo (391000010) também acharia o projeto: tira-a, e o assunto também não a traz
  const { r: rb } = await tratar(mensagem({ texto: REALIZADA.replace(' referente à nota GD 391000010,', ''), assunto: 'RE: TROCA DE RELÓGIO' }), b.deps);
  assert.equal(rb.situacao, 'nao_identificado');
  assert.equal(b.d.encerradas.length, 0, 'sem projeto casado não há de quem encerrar');
});

// ── 4. Log, dublês antigos, produção ─────────────────────────────────────────

test('o log não leva titular, assunto, número da nota nem texto', async () => {
  for (const texto of [AGENDADA, REALIZADA]) {
    const { deps } = dubles();
    const { logs } = await tratar(mensagem({ texto }), deps);
    assert.match(logs, /cobrança da troca|cobranças encerradas pela troca/);
    for (const proibido of ['TEODORICO', 'QUINTINO', 'TROCA DE RELÓGIO', NOTA11, NOTA12, 'Prezado', 'Atenciosamente', 'cob-nota-1']) {
      assert.ok(!logs.includes(proibido), `o log tem "${proibido}"`);
    }
  }
});

test('o log diz só o código do projeto, o resultado e se havia número', async () => {
  const { deps } = dubles();
  const { logs } = await tratar(mensagem(), deps);
  const linha = logs.split('\n').map(l => JSON.parse(l) as Record<string, unknown>).find(l => l.msg === 'cobrança da troca');
  assert.ok(linha);
  assert.deepEqual(Object.keys(linha).sort(), ['com_numero', 'msg', 'projeto', 'resultado', 't']);
  assert.equal(linha.projeto, 'GD-COB-001');
  assert.equal(linha.resultado, 'criada');
  assert.equal(linha.com_numero, true);
});

test('dublês antigos, sem as funções de cobrança: o tratamento segue igual, nas duas pontas', async () => {
  for (const texto of [AGENDADA, REALIZADA]) {
    const { deps, d } = dubles({ semCobranca: true });
    const { r } = await tratar(mensagem({ texto }), deps);
    assert.equal(r.situacao, 'tratado');
    assert.equal(r.concluida, true);
    assert.equal(d.registros.length, 1);
    assert.doesNotMatch(String(ultimoRegistro(d).motivo), /cobrança/);
  }
});

test('DEPS_ENEL de produção tem as duas funções de cobrança, e são as de fila.ts', () => {
  assert.equal(DEPS_ENEL.agendarCobranca, agendarCobranca);
  assert.equal(DEPS_ENEL.encerrarCobrancas, encerrarCobrancasPorTroca);
});

// ── 5. extrairMensagem: o cabeçalho References ───────────────────────────────

const EML = (referencias: string | null) => [
  'From: Canal GD <canalgd.sp@br.enel.com>',
  'To: equipe@exemplo.test',
  'Subject: RE: TROCA DE RELOGIO - NT 391000010',
  'Message-ID: <cob-nota-1@enel.test>',
  'In-Reply-To: <cob-pedido@exemplo.test>',
  ...(referencias === null ? [] : [`References: ${referencias}`]),
  'Date: Thu, 01 Oct 2026 12:00:00 -0300',
  'Content-Type: text/plain; charset=utf-8',
  '',
  `Nota de servico criada ${NOTA11} para a troca do medidor.`,
].join('\r\n');

test('extrairMensagem lê o cabeçalho References, em lista de ids', async () => {
  const m = extrairMensagem(await simpleParser(EML('<cob-primeiro@exemplo.test> <cob-pedido@exemplo.test>')), 9);
  assert.deepEqual(m.referencias, ['<cob-primeiro@exemplo.test>', '<cob-pedido@exemplo.test>']);
});

test('extrairMensagem: um id só, ids em linhas dobradas, e sem cabeçalho', async () => {
  assert.deepEqual(extrairMensagem(await simpleParser(EML('<so-um@exemplo.test>')), 9).referencias, ['<so-um@exemplo.test>']);
  const dobrado = extrairMensagem(await simpleParser(EML('<a@exemplo.test>\r\n <b@exemplo.test>\r\n\t<c@exemplo.test>')), 9);
  assert.deepEqual(dobrado.referencias, ['<a@exemplo.test>', '<b@exemplo.test>', '<c@exemplo.test>']);
  assert.deepEqual(extrairMensagem(await simpleParser(EML(null)), 9).referencias, []);
});

// ── 6. As RPCs de fila.ts: nomes e tipos de parâmetro do banco ───────────────

interface Chamada { rpc: string; corpo: Record<string, unknown> }
const chamadas: Chamada[] = [];
type Resposta = { status: number; corpo: unknown };
let responder: (c: Chamada) => Resposta = () => ({ status: 200, corpo: null });

globalThis.fetch = (async (input: unknown, init?: { body?: unknown }) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
  const rpc = new URL(url).pathname.split('/').pop() ?? '';
  const corpo = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
  const chamada = { rpc, corpo };
  chamadas.push(chamada);
  const { status, corpo: dados } = responder(chamada);
  return new Response(JSON.stringify(dados), { status, headers: { 'content-type': 'application/json' } });
}) as typeof fetch;

const CHAMADAS_DA_COBRANCA = ['ludmilla_cobranca_agendar', 'ludmilla_cobranca_encerrar_por_troca'];
const paraAgendar = (o: Partial<CobrancaParaAgendar> = {}): CobrancaParaAgendar => ({
  accountId: 'conta-enel', messageId: '<cob-nota-1@enel.test>', projectId: 'id-cob-1', nota: NOTA12,
  dataNota: '2026-10-01T15:00:00.000Z', prazoDias: 7, para: 'canalgd.sp@br.enel.com',
  assunto: 'RE: TROCA DE RELÓGIO - NT 391000010', inReplyTo: '<cob-nota-1@enel.test>',
  referencias: ['<cob-pedido@exemplo.test>', '<cob-nota-1@enel.test>'], ...o,
});

test('agendarCobranca chama ludmilla_cobranca_agendar com os parâmetros que o banco tem (nome e tipo)', async () => {
  chamadas.length = 0;
  responder = () => ({ status: 200, corpo: 'criada' });
  const r = await agendarCobranca(paraAgendar());
  assert.equal(r, 'criada');
  assert.equal(chamadas.length, 1);
  assert.equal(chamadas[0].rpc, 'ludmilla_cobranca_agendar');
  // os 10 parâmetros do banco vivo (conferidos em pg_proc em 26/10/2026), nem mais nem menos
  assert.deepEqual(chamadas[0].corpo, {
    p_account_id: 'conta-enel', p_message_id: '<cob-nota-1@enel.test>', p_project_id: 'id-cob-1', p_nota: NOTA12,
    p_data_nota: '2026-10-01T15:00:00.000Z', p_prazo_dias: 7, p_para: 'canalgd.sp@br.enel.com',
    p_assunto: 'RE: TROCA DE RELÓGIO - NT 391000010', p_in_reply_to: '<cob-nota-1@enel.test>',
    p_referencias: '<cob-pedido@exemplo.test> <cob-nota-1@enel.test>',
  });
});

test('agendarCobranca: sem nota, sem prazo, sem cabeçalhos = null no fio (nunca string vazia)', async () => {
  chamadas.length = 0;
  responder = () => ({ status: 200, corpo: 'criada' });
  await agendarCobranca(paraAgendar({ nota: null, prazoDias: null, inReplyTo: null, referencias: [] }));
  const c = chamadas[0].corpo;
  assert.equal(c.p_nota, null);
  assert.equal(c.p_prazo_dias, null);
  assert.equal(c.p_in_reply_to, null);
  assert.equal(c.p_referencias, null);
});

test('agendarCobranca: o erro leva só o CÓDIGO (a mensagem do PostgREST pode citar a linha recusada)', async () => {
  responder = () => ({ status: 400, corpo: {
    code: '23514', message: 'new row violates check constraint — Failing row contains (TEODORICO VALADARES QUINTINO)',
    details: 'Failing row contains (TEODORICO VALADARES QUINTINO, RE: TROCA DE RELÓGIO)', hint: null,
  } });
  await assert.rejects(agendarCobranca(paraAgendar()), (e: Error) => {
    assert.match(e.message, /agendar a cobrança/);
    assert.match(e.message, /23514/);
    assert.ok(!e.message.includes('TEODORICO') && !e.message.includes('RELÓGIO'), e.message);
    return true;
  });
});

test('agendarCobranca: falha de rede (sem código) também não vaza nem sai com "código " vazio', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => { throw new TypeError('fetch failed: ECONNREFUSED 10.0.0.1'); }) as typeof fetch;
  try {
    await assert.rejects(agendarCobranca(paraAgendar()), (e: Error) => {
      assert.match(e.message, /agendar a cobrança/);
      assert.doesNotMatch(e.message, /código \)/);
      return true;
    });
  } finally { globalThis.fetch = original; }
});

test('encerrarCobrancasPorTroca chama ludmilla_cobranca_encerrar_por_troca (conta, projeto, quando) e devolve o número', async () => {
  chamadas.length = 0;
  responder = () => ({ status: 200, corpo: 2 });
  const n = await encerrarCobrancasPorTroca('conta-enel', 'id-cob-1', '2026-10-20T15:00:00.000Z');
  assert.equal(n, 2);
  assert.equal(chamadas[0].rpc, 'ludmilla_cobranca_encerrar_por_troca');
  assert.deepEqual(chamadas[0].corpo, { p_account_id: 'conta-enel', p_project_id: 'id-cob-1', p_quando: '2026-10-20T15:00:00.000Z' });
  responder = () => ({ status: 200, corpo: null });
  assert.equal(await encerrarCobrancasPorTroca('conta-enel', 'id-cob-1', '2026-10-20T15:00:00.000Z'), 0);
});

test('encerrarCobrancasPorTroca: o erro leva só o CÓDIGO', async () => {
  responder = () => ({ status: 403, corpo: { code: '42501', message: 'permission denied — TEODORICO VALADARES QUINTINO', details: null, hint: null } });
  await assert.rejects(encerrarCobrancasPorTroca('conta-enel', 'id-cob-1', '2026-10-20T15:00:00.000Z'), (e: Error) => {
    assert.match(e.message, /encerrar as cobranças/);
    assert.match(e.message, /42501/);
    assert.ok(!e.message.includes('TEODORICO'), e.message);
    return true;
  });
});

// ── 7. O run inteiro (rede falsa): a cobrança falhar NÃO derruba o run ────────

function caixaDe(mensagens: MensagemLida[]): Caixa {
  return {
    pasta: '[Gmail]/Todos os e-mails',
    async procurar() { return []; },
    async procurarDe(remetente: string) { return remetente === 'canalgd.sp@br.enel.com' ? mensagens.map(m => m.uid) : []; },
    async *envelopes(uids: number[]) {
      for (const m of mensagens) if (uids.includes(m.uid)) yield { uid: m.uid, messageId: m.messageId, assunto: m.assunto, recebidoEm: m.recebidoEm };
    },
    async *baixar(uids: number[]) { for (const m of mensagens) if (uids.includes(m.uid)) yield m; },
    naoLidas: () => 0,
    async fechar() { /* nada */ },
  };
}

/** A rede de um run da ENEL: o que o robô lê do banco e o que cada RPC responde. */
function redeDoRun(o: { pendente: (id: string) => boolean; agendar: (n: number) => Resposta }) {
  let agendamentos = 0;
  responder = c => {
    switch (c.rpc) {
      case 'ludmilla_email_credencial': return { status: 200, corpo: [{ email: 'robo@exemplo.invalid', senha: 'senha-de-mentira' }] };
      case 'ludmilla_email_regras': return { status: 200, corpo: REGRAS };
      case 'ludmilla_email_projetos': return { status: 200, corpo: [PA, PB] };
      case 'ludmilla_email_mensagem_pendente': return { status: 200, corpo: o.pendente(String(c.corpo.p_message_id)) };
      case 'ludmilla_email_tentativa': return { status: 200, corpo: 1 };
      case 'ludmilla_email_avisar': return { status: 200, corpo: 0 };
      case 'ludmilla_cobranca_agendar': return o.agendar(++agendamentos);
      default: return { status: 200, corpo: null };
    }
  };
}

async function rodarRun(mensagens: MensagemLida[]) {
  chamadas.length = 0;
  const { logs } = await comLogs(() => executarVarreduraEnel(RUN, async () => caixaDe(mensagens)));
  const fim = chamadas.filter(c => c.rpc === 'ludmilla_finalizar_run');
  assert.equal(fim.length, 1, 'o run é fechado exatamente uma vez');
  return { logs, fim: fim[0].corpo, resultado: fim[0].corpo.p_resultado as Record<string, unknown> };
}

const NOTA_DE_PB = mensagem({
  uid: 2, messageId: '<cob-nota-2@enel.test>', assunto: 'RE: TROCA DE RELÓGIO - NT 391000020',
  texto: AGENDADA.replace(NOTA11, '70787654321'),
});

test('RUN: a cobrança que NÃO agenda não derruba o run: ele fecha ok, a mensagem fica para a releitura e as outras seguem', async () => {
  redeDoRun({
    pendente: () => true,
    agendar: n => n === 1
      ? { status: 400, corpo: { code: '23514', message: 'falhou — TEODORICO VALADARES QUINTINO', details: null, hint: null } }
      : { status: 200, corpo: 'criada' },
  });
  const { logs, fim, resultado } = await rodarRun([mensagem(), NOTA_DE_PB]);
  assert.equal(fim.p_situacao, 'ok', 'run "ok", não "erro"');
  assert.equal(resultado.lidos, 2);
  assert.equal(resultado.tratados, 2, 'a 2ª mensagem foi tratada depois da falha da 1ª');
  assert.equal(resultado.a_tentar_de_novo, 1, 'a falha entra no resultado: uma mensagem volta no próximo run');
  const registros = chamadas.filter(c => c.rpc === 'ludmilla_email_registrar');
  assert.equal(registros.length, 2, 'as duas mensagens foram registradas (cartão e histórico não esperam a cobrança)');
  assert.deepEqual(registros.map(r => r.corpo.p_concluida), [false, true]);
  assert.match(String(registros[0].corpo.p_motivo), /cobrança à ENEL NÃO agendada \(código 23514\)/);
  assert.equal(chamadas.filter(c => c.rpc === 'ludmilla_cobranca_agendar').length, 2);
  assert.ok(!logs.includes('TEODORICO'), 'a mensagem crua do PostgREST não chega ao log');
});

test('RUN: nota nova agenda; o corpo da chamada é o da cobrança da PRÓPRIA mensagem', async () => {
  redeDoRun({ pendente: () => true, agendar: () => ({ status: 200, corpo: 'criada' }) });
  const { fim, resultado } = await rodarRun([mensagem()]);
  assert.equal(fim.p_situacao, 'ok');
  assert.equal(resultado.a_tentar_de_novo, 0);
  const agendamentos = chamadas.filter(c => c.rpc === 'ludmilla_cobranca_agendar');
  assert.equal(agendamentos.length, 1);
  assert.equal(agendamentos[0].corpo.p_message_id, '<cob-nota-1@enel.test>');
  assert.equal(agendamentos[0].corpo.p_project_id, 'id-cob-1');
  assert.equal(agendamentos[0].corpo.p_nota, NOTA12);
  assert.equal(agendamentos[0].corpo.p_para, 'canalgd.sp@br.enel.com');
});

test('RUN: só notas NOVAS — mensagem já concluída é pulada e nunca vira cobrança', async () => {
  // o banco diz "não está pendente" (concluída) para os e-mails de nota que já foram lidos
  redeDoRun({ pendente: () => false, agendar: () => ({ status: 200, corpo: 'criada' }) });
  const { fim, resultado } = await rodarRun([mensagem(), NOTA_DE_PB]);
  assert.equal(fim.p_situacao, 'ok');
  assert.equal(resultado.pulados, 2);
  assert.equal(resultado.lidos, 0);
  for (const c of chamadas) {
    assert.ok(!CHAMADAS_DA_COBRANCA.includes(c.rpc), `${c.rpc} não devia ser chamada`);
    assert.notEqual(c.rpc, 'ludmilla_email_tentativa', 'nem a tentativa é contada de novo');
  }
});

test('RUN: só a nota nova, no meio das já lidas, agenda', async () => {
  redeDoRun({ pendente: id => id === '<cob-nota-2@enel.test>', agendar: () => ({ status: 200, corpo: 'criada' }) });
  const { resultado } = await rodarRun([mensagem(), NOTA_DE_PB]);
  assert.equal(resultado.pulados, 1);
  assert.equal(resultado.lidos, 1);
  const agendamentos = chamadas.filter(c => c.rpc === 'ludmilla_cobranca_agendar');
  assert.equal(agendamentos.length, 1);
  assert.equal(agendamentos[0].corpo.p_message_id, '<cob-nota-2@enel.test>');
});
