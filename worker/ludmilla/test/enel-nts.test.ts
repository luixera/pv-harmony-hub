// worker/ludmilla/test/enel-nts.test.ts
//
// A NT que a Ludmilla já aprendeu (02/11/2026): `ludmilla_email_nts_conhecidas` devolve as NTs
// que ela já viu em cada projeto (Carta pendente e assunto de e-mail ligado), `projetosDaEnel`
// (fila.ts) as junta aos projetos, e o run da ENEL passa a achar o e-mail pela NT mesmo com o
// projeto sem protocolo. Duas camadas: a porta do banco (fila.ts) e o run inteiro, com a REDE
// falsa (o cliente do Supabase é o de verdade; o que se confere é o JSON que sairia pelo fio).
// Titular, UC, NT e Message-IDs inventados; os remetentes são os públicos das regras.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executarVarreduraEnel } from '../src/email/enel/run.js';
import type { Caixa, MensagemLida } from '../src/email/caixa.js';
import type { RegraEmail } from '../src/email/util.js';
import { ntsConhecidas, projetosDaEnel, type Run } from '../src/fila.js';

process.env.SUPABASE_URL = 'http://supabase.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'chave-de-mentira';
delete process.env.LUDMILLA_MODO;

interface Chamada { rpc: string; corpo: Record<string, unknown> }
interface Resposta { status: number; corpo: unknown }
const chamadas: Chamada[] = [];
let responder: (c: Chamada) => Resposta = () => ({ status: 200, corpo: null });

globalThis.fetch = (async (input: unknown, init?: { body?: unknown }) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
  const c: Chamada = {
    rpc: new URL(url).pathname.split('/').pop() ?? '',
    corpo: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
  };
  chamadas.push(c);
  const r = responder(c);
  return new Response(JSON.stringify(r.corpo), { status: r.status, headers: { 'content-type': 'application/json' } });
}) as typeof fetch;

const PROJETO_DO_BANCO = {
  project_id: 'id-nt-1', company_id: 'empresa-nt', codigo: 'GD-NT-001', protocolo: null, uc: '0055070070',
  titular: 'ODETE PRATES VENTURIM', status: 'vistoria_solicitada', ativo: true,
};
const OUTRO_DO_BANCO = {
  project_id: 'id-nt-2', company_id: 'empresa-nt', codigo: 'GD-NT-002', protocolo: '391000020', uc: '0055002002',
  titular: 'GILVANETE SOARES QUINTILHO', status: 'approved', ativo: true,
};

// ── a porta do banco ────────────────────────────────────────────────────────

test('ntsConhecidas: chama a RPC com a conta e devolve as linhas; vazio é lista vazia; erro LANÇA', async () => {
  const linhas = [{ project_id: 'id-nt-1', nt: '391000777', fonte: 'carta' }];
  chamadas.length = 0;
  responder = () => ({ status: 200, corpo: linhas });
  assert.deepEqual(await ntsConhecidas('conta-enel'), linhas);
  assert.deepEqual(chamadas, [{ rpc: 'ludmilla_email_nts_conhecidas', corpo: { p_account_id: 'conta-enel' } }]);
  responder = () => ({ status: 200, corpo: null });
  assert.deepEqual(await ntsConhecidas('conta-enel'), []);
  responder = () => ({ status: 400, corpo: { message: 'sem acesso', code: '42501' } });
  await assert.rejects(() => ntsConhecidas('conta-enel'), /Não consegui listar as NTs já conhecidas: sem acesso/);
});

test('projetosDaEnel: junta as NTs a cada projeto, sem repetir; projeto sem NT fica com []; NT de projeto fora da lista some', async () => {
  chamadas.length = 0;
  responder = c => c.rpc === 'ludmilla_email_projetos'
    ? { status: 200, corpo: [PROJETO_DO_BANCO, OUTRO_DO_BANCO] }
    : c.rpc === 'ludmilla_email_nts_conhecidas'
      ? { status: 200, corpo: [
        { project_id: 'id-nt-1', nt: '391000888', fonte: 'email' },
        { project_id: 'id-nt-1', nt: '391000777', fonte: 'carta' },
        { project_id: 'id-nt-1', nt: '391000777', fonte: 'email' },
        { project_id: 'id-de-fora', nt: '391000999', fonte: 'carta' },
      ] }
      : { status: 200, corpo: null };
  const projetos = await projetosDaEnel('conta-enel');
  assert.deepEqual(projetos, [
    { ...PROJETO_DO_BANCO, nts: ['391000777', '391000888'] },
    { ...OUTRO_DO_BANCO, nts: [] },
  ]);
  assert.deepEqual(chamadas.map(c => c.rpc).sort(), ['ludmilla_email_nts_conhecidas', 'ludmilla_email_projetos']);
  assert.ok(chamadas.every(c => c.corpo.p_account_id === 'conta-enel'));
});

test('projetosDaEnel: a falha de qualquer das duas RPCs LANÇA (nunca roda achando que não conhece NT nenhuma)', async () => {
  responder = c => c.rpc === 'ludmilla_email_nts_conhecidas'
    ? { status: 400, corpo: { message: 'boom', code: 'XX000' } }
    : { status: 200, corpo: [PROJETO_DO_BANCO] };
  await assert.rejects(() => projetosDaEnel('conta-enel'), /Não consegui listar as NTs já conhecidas: boom/);
  responder = c => c.rpc === 'ludmilla_email_projetos'
    ? { status: 400, corpo: { message: 'boom', code: 'XX000' } }
    : { status: 200, corpo: [] };
  await assert.rejects(() => projetosDaEnel('conta-enel'), /Não consegui listar os projetos da concessionária: boom/);
});

// ── o run inteiro ───────────────────────────────────────────────────────────

const RUN: Run = { id: 'run-nt', tenant_id: 'tenant-nt', account_id: 'conta-enel', tipo: 'varredura_email', situacao: 'rodando' };
const REGRAS: RegraEmail[] = [
  { id: 'r-abc', remetente: 'tecnico.abc@enel.com', assunto: '', tipo_documento: 'resultado_vistoria', anexar: true, ler_pdf: true },
];
// a forma do assunto real do tecnico.abc (02/11/2026): a NT e o endereço, sem nome nem protocolo nosso
const VISTORIA: MensagemLida = {
  uid: 1, messageId: '<nt-vistoria-1@enel.test>',
  assunto: 'VISTORIA GD 391000777 - R INVENTADA DE TESTE 301 - CEP 01234-560 - JARDIM EXEMPLO - SAO PAU',
  remetente: 'Técnico ABC <tecnico.abc@enel.com>', recebidoEm: new Date(),
  texto: 'Prezado(a) Senhor(a), Informamos que após realização da vistoria através de relatorio fotográfico, a vistoria do sistema de microgeração fotovoltaica está APROVADA. Atenciosamente',
  anexos: [], anexosSemNome: 0,
};

function caixaCom(m: MensagemLida): Caixa {
  return {
    pasta: '[Gmail]/Todos os e-mails',
    async procurar() { return []; },
    async procurarDe(remetente: string) { return remetente === 'tecnico.abc@enel.com' ? [m.uid] : []; },
    async *envelopes() { yield { uid: m.uid, messageId: m.messageId, assunto: m.assunto, recebidoEm: m.recebidoEm }; },
    async *baixar() { yield m; },
    naoLidas: () => 0,
    async fechar() { /* nada */ },
  };
}

async function rodar(nts: unknown[]): Promise<Chamada> {
  chamadas.length = 0;
  responder = c => {
    switch (c.rpc) {
      case 'ludmilla_email_credencial': return { status: 200, corpo: [{ email: 'robo@exemplo.invalid', senha: 'senha-de-mentira' }] };
      case 'ludmilla_email_regras': return { status: 200, corpo: REGRAS };
      case 'ludmilla_email_projetos': return { status: 200, corpo: [PROJETO_DO_BANCO, OUTRO_DO_BANCO] };
      case 'ludmilla_email_nts_conhecidas': return { status: 200, corpo: nts };
      case 'ludmilla_email_mensagem_pendente': return { status: 200, corpo: true };
      case 'ludmilla_email_tentativa': return { status: 200, corpo: 1 };
      case 'ludmilla_email_avisar': return { status: 200, corpo: 0 };
      default: return { status: 200, corpo: null };
    }
  };
  const original = console.log;
  console.log = () => undefined;
  try { await executarVarreduraEnel(RUN, async () => caixaCom(VISTORIA)); } finally { console.log = original; }
  const registros = chamadas.filter(c => c.rpc === 'ludmilla_email_registrar');
  assert.equal(registros.length, 1, 'a mensagem é registrada uma vez');
  return registros[0];
}

test('RUN: a vistoria com a NT no assunto acha o projeto SEM protocolo pela NT que a Ludmilla já conhecia', async () => {
  const reg = await rodar([{ project_id: 'id-nt-1', nt: '391000777', fonte: 'carta' }]);
  assert.equal(reg.corpo.p_project_id, 'id-nt-1');
  assert.equal(reg.corpo.p_casamento, 'protocolo', 'o selo continua "protocolo" (CHECK do banco)');
  assert.match(String(reg.corpo.p_motivo), /reconheci pela NT 391000777, que já tinha visto neste projeto/);
  assert.ok(chamadas.some(c => c.rpc === 'ludmilla_email_nts_conhecidas'), 'o run da ENEL pede as NTs');
});

test('RUN: controle — sem a NT aprendida o mesmo e-mail fica sem projeto (era o defeito de 31/10)', async () => {
  const reg = await rodar([]);
  assert.equal(reg.corpo.p_project_id, null);
  assert.match(String(reg.corpo.p_motivo), /não reconheci de qual projeto é este e-mail/);
});
