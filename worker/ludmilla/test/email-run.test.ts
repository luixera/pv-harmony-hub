// worker/ludmilla/test/email-run.test.ts
// A conferência e o TRATAMENTO do run por e-mail. São as decisões que botam
// documento no card de cliente real, então cada regra tem um teste próprio.
//
// Regras que mandam aqui:
//  · o ENDEREÇO confirma mas NÃO bloqueia; só o TITULAR bloqueia. O protocolo é
//    chave única — se ele casa, o documento é daquele projeto, e endereço
//    divergente quase sempre é cadastro nosso velho.
//  · titular e endereço conferem SÓ contra o que a IA extraiu do PDF: o corpo
//    do e-mail é longo e casa por acidente.
//  · nome que não dá para comparar é FALTA DE DADO, nunca divergência.
//  · nada de dado de cliente no log.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  conferir, tratarMensagem, type DepsTratamento, type ParecerLido,
} from '../src/email/index.js';
import type { MensagemLida } from '../src/email/caixa.js';
import type { RegraEmail } from '../src/email/util.js';
import type { AnexoPendente, EmailLido, Run } from '../src/fila.js';

const PROJETO = {
  protocolo: '045006443920',
  project_id: '11111111-1111-4111-8111-111111111111',
  company_id: '22222222-2222-4222-8222-222222222222',
  codigo: 'GD-2026-001',
  titular: 'WERLHE DE ARAUJO LIMA',
  endereco: 'RUA DAS FLORES 120',
};

const SEM_PDF = { titular: null, endereco: null };

// ── conferir ────────────────────────────────────────────────────────────────

test('titular do sistema casa com o do PDF → conferido por titular', () => {
  const c = conferir(PROJETO, { titular: 'Werlhe de Araújo Lima', endereco: null });
  assert.equal(c.ok, true);
  assert.equal(c.por, 'titular');
  assert.equal(c.motivo, null);
});

test('titular do PDF é de OUTRA pessoa → único bloqueio', () => {
  const c = conferir(PROJETO, { titular: 'Miguel Arcanjo Corcini', endereco: null });
  assert.equal(c.ok, false);
  assert.equal(c.por, 'titular');
  assert.match(String(c.motivo), /Miguel Arcanjo Corcini/);
  assert.match(String(c.motivo), /WERLHE DE ARAUJO LIMA/);
});

test('sem PDF lido o selo é protocolo: o corpo do e-mail NÃO confere mais nada', () => {
  // Antes isto conferia contra o corpo inteiro e saía por 'titular'/'endereco'.
  // Num corpo longo "JOSÉ … SANTOS" casava com "Av. São José" + "Santos/SP" e
  // saía o selo mais forte sem nada conferido de verdade.
  const c = conferir(PROJETO, SEM_PDF);
  assert.equal(c.ok, true);
  assert.equal(c.por, 'protocolo');
  assert.equal(c.motivo, null);
});

test('titular do sistema vazio e endereço do PDF casa → conferido por endereco', () => {
  const semTitular = { ...PROJETO, titular: null };
  const c = conferir(semTitular, { titular: null, endereco: 'Rua das Flores, nº 120 - Centro' });
  assert.equal(c.ok, true);
  assert.equal(c.por, 'endereco');
  assert.equal(c.motivo, null);
});

test('endereço do PDF diverge → NÃO bloqueia, mas registra o motivo', () => {
  const c = conferir(PROJETO, { titular: null, endereco: 'Avenida Brasil, 4000' });
  assert.equal(c.ok, true);
  assert.equal(c.por, 'protocolo');
  assert.match(String(c.motivo), /Avenida Brasil, 4000/);
  assert.match(String(c.motivo), /RUA DAS FLORES 120/);
});

test('titular casa e endereço diverge → titular manda, sem motivo de alarme', () => {
  const c = conferir(PROJETO, { titular: 'Werlhe de Araujo Lima', endereco: 'Avenida Brasil, 4000' });
  assert.equal(c.ok, true);
  assert.equal(c.por, 'titular');
  assert.equal(c.motivo, null);
});

test('projeto sem titular e sem endereço no cadastro → protocolo, sem bloqueio', () => {
  const cru = { ...PROJETO, titular: null, endereco: null };
  const c = conferir(cru, { titular: 'Qualquer Nome Aqui', endereco: 'Rua Qualquer 1' });
  assert.equal(c.ok, true);
  assert.equal(c.por, 'protocolo');
  assert.equal(c.motivo, null);
});

test('titular do SISTEMA com uma palavra só é falta de dado, não divergência', () => {
  // "Ivanildo" no cadastro + "IVANILDO PEREIRA DOS SANTOS" no PDF bloqueava o
  // anexo e logava alarme de pessoa errada. Agora cai para o protocolo.
  const curto = { ...PROJETO, titular: 'Ivanildo' };
  const c = conferir(curto, { titular: 'IVANILDO PEREIRA DOS SANTOS', endereco: null });
  assert.equal(c.ok, true);
  assert.equal(c.por, 'protocolo');
  assert.equal(c.motivo, null);
});

test('titular do SISTEMA de uma palavra NÃO bloqueia nem contra nome bem diferente', () => {
  const curto = { ...PROJETO, titular: 'Ivanildo' };
  const c = conferir(curto, { titular: 'MIGUEL ARCANJO CORCINI', endereco: null });
  assert.equal(c.ok, true, 'sem duas palavras do nosso lado não há divergência provada');
  assert.equal(c.por, 'protocolo');
});

test('titular do PDF com uma palavra só também é falta de dado', () => {
  // o outro lado da mesma regra: a IA que extraiu só o primeiro nome não pode
  // fazer o anexo ser bloqueado
  const c = conferir(PROJETO, { titular: 'WERLHE', endereco: null });
  assert.equal(c.ok, true);
  assert.equal(c.por, 'protocolo');
});

test('razão social de duas palavras continua conferindo e continua bloqueando', () => {
  const pj = { ...PROJETO, titular: 'PADARIA IRMAOS' };
  assert.equal(conferir(pj, { titular: 'Padaria Irmaos', endereco: null }).por, 'titular');
  assert.equal(conferir(pj, { titular: 'Mercado Central', endereco: null }).ok, false);
});

// ── tratarMensagem, com dublês ───────────────────────────────────────────────

const RUN: Run = {
  id: '33333333-3333-4333-8333-333333333333',
  tenant_id: '44444444-4444-4444-8444-444444444444',
  account_id: '55555555-5555-4555-8555-555555555555',
  tipo: 'varredura_email',
  situacao: 'rodando',
};

const REGRAS: RegraEmail[] = [
  { id: '1', remetente: 'relacionamento.edp', assunto: 'ENVIO DE PARECER', tipo_documento: 'parecer', anexar: true, ler_pdf: true },
  { id: '2', remetente: null, assunto: 'CARTA DE OBRAS', tipo_documento: 'carta_obras', anexar: true, ler_pdf: false },
];

const anexo = (nome: string, mime: string, tamanho = 1000) =>
  ({ nome, mime, bytes: Buffer.alloc(tamanho, 1) });

const mensagem = (over: Partial<MensagemLida> = {}): MensagemLida => ({
  uid: 7,
  messageId: '<abc-123@edp.com.br>',
  assunto: 'ENVIO DE PARECER - NOTA 45006443920',
  remetente: '"Relacionamento EDP" <relacionamento.edp@edp.com.br>',
  recebidoEm: new Date('2026-09-10T12:12:00Z'),
  texto: 'Segue o parecer em anexo.',
  anexos: [anexo('parecer.pdf', 'application/pdf')],
  ...over,
});

const PARECER_OK: ParecerLido = {
  ok: true, veredito: 'favoravel', resumo: 'Parecer favorável.',
  titular: 'WERLHE DE ARAUJO LIMA', endereco: 'RUA DAS FLORES 120', erro: null,
};

interface Diario {
  registros: EmailLido[];
  anexosPedidos: string[];
  subidos: string[];
  enviados: string[];
  marcadosComErro: string[];
  pdfsLidos: number[];
}

function dubles(o: {
  parecer?: ParecerLido;
  /** nomes de arquivo cuja linha o banco NÃO devolve (já `enviado`) */
  jaResolvidos?: string[];
  /** nomes de arquivo que o storage recusa */
  storageRecusa?: string[];
} = {}): { deps: DepsTratamento; d: Diario } {
  const d: Diario = { registros: [], anexosPedidos: [], subidos: [], enviados: [], marcadosComErro: [], pdfsLidos: [] };
  const deps: DepsTratamento = {
    async anexoDeEmail(_conta, protocolo, projectId, messageId, nomeArquivo): Promise<AnexoPendente | null> {
      d.anexosPedidos.push(nomeArquivo);
      if ((o.jaResolvidos ?? []).includes(nomeArquivo)) return null;
      return {
        id: `anexo-${nomeArquivo}`, project_id: projectId, company_id: PROJETO.company_id,
        protocolo, id_arquivo: `${messageId}#${nomeArquivo}`, nome_arquivo: nomeArquivo, codigo: PROJETO.codigo,
      };
    },
    async subirDocumento(a): Promise<string> {
      if ((o.storageRecusa ?? []).includes(a.nome_arquivo)) {
        throw new Error('Não consegui guardar o anexo no projeto: bucket indisponível');
      }
      d.subidos.push(a.nome_arquivo);
      return `caminho/${a.nome_arquivo}`;
    },
    async anexoEnviado(id): Promise<void> { d.enviados.push(id); },
    async anexoErro(id): Promise<void> { d.marcadosComErro.push(id); },
    async registrarEmailLido(p): Promise<void> { d.registros.push(p); },
    async lerParecer(pdf): Promise<ParecerLido> {
      d.pdfsLidos.push(pdf.length);
      return o.parecer ?? PARECER_OK;
    },
  };
  return { deps, d };
}

/** Roda com o console capturado — cala o teste e deixa PROVAR o que vai no log. */
async function comLogs<T>(f: () => Promise<T>): Promise<{ r: T; logs: string }> {
  const original = console.log;
  const linhas: string[] = [];
  console.log = (linha?: unknown) => { linhas.push(String(linha)); };
  try {
    const r = await f();
    return { r, logs: linhas.join('\n') };
  } finally {
    console.log = original;
  }
}

test('caminho feliz: anexa, lê o parecer, recomenda a etapa e conclui', async () => {
  const { deps, d } = dubles();
  const { r } = await comLogs(() => tratarMensagem(RUN, PROJETO, mensagem(), REGRAS, deps));
  assert.equal(r.situacao, 'tratado');
  assert.equal(r.anexados, 1);
  assert.equal(r.concluida, true);
  assert.deepEqual(d.subidos, ['parecer.pdf']);
  assert.equal(d.registros[0].recomendacao, 'approved');
  assert.equal(d.registros[0].concluida, true);
  assert.equal(d.registros[0].arquivoLido, 'parecer.pdf');
  assert.equal(d.registros[0].anexos, 1);
});

test('IA com ok:false → o anexo SOBE, a recomendação NÃO sai, e fica pendente', async () => {
  const falha: ParecerLido = { ok: false, veredito: null, resumo: '', titular: null, endereco: null, erro: 'credit balance is too low' };
  const { deps, d } = dubles({ parecer: falha });
  const { r } = await comLogs(() => tratarMensagem(RUN, PROJETO, mensagem(), REGRAS, deps));
  assert.equal(r.situacao, 'tratado');
  assert.equal(r.anexados, 1, 'o documento tem de chegar ao card mesmo sem a IA');
  assert.equal(r.concluida, false, 'é falha passageira: um run futuro tenta de novo');
  assert.equal(d.registros[0].recomendacao, null, 'recomendar sem ter lido seria chute');
  assert.equal(d.registros[0].concluida, false);
  assert.equal(d.registros[0].arquivoLido, null, 'nada foi lido');
  assert.match(String(d.registros[0].motivo), /não consegui ler o parecer/);
});

test('nenhuma regra casa → concluída (é configuração), nenhum anexo', async () => {
  const { deps, d } = dubles();
  const outro = mensagem({ assunto: 'RA HugMe - EDP São Paulo te mandou mensagem' });
  const { r } = await comLogs(() => tratarMensagem(RUN, PROJETO, outro, REGRAS, deps));
  assert.equal(r.situacao, 'ignorado');
  assert.equal(r.anexados, 0);
  assert.equal(r.concluida, true, 'insistir faria a robô rebaixar o mesmo e-mail duas vezes por dia');
  assert.deepEqual(d.anexosPedidos, []);
  assert.deepEqual(d.subidos, []);
  assert.equal(d.registros[0].projectId, null);
  assert.match(String(d.registros[0].motivo), /nenhuma regra casa/);
});

test('imagem da assinatura é ignorada; o PDF do mesmo e-mail é anexado', async () => {
  const { deps, d } = dubles();
  const comAssinatura = mensagem({
    anexos: [
      anexo('image001.png', 'image/png'),
      anexo('image002.jpg', 'image/jpeg'),
      anexo('logo.svg', 'image/svg+xml'),
      anexo('parecer.pdf', 'application/pdf'),
      anexo('planilha.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
    ],
  });
  const { r } = await comLogs(() => tratarMensagem(RUN, PROJETO, comAssinatura, REGRAS, deps));
  assert.equal(r.imagensIgnoradas, 3);
  assert.equal(r.anexados, 2, 'o PDF e o xlsx sobem — só imagem é descartada');
  assert.deepEqual(d.subidos, ['parecer.pdf', 'planilha.xlsx']);
  assert.deepEqual(d.anexosPedidos, ['parecer.pdf', 'planilha.xlsx']);
  assert.match(String(d.registros[0].motivo), /3 imagem\(ns\)/);
});

test('titular do PDF divergente → bloqueia e NADA sobe', async () => {
  const outraPessoa: ParecerLido = { ...PARECER_OK, titular: 'MIGUEL ARCANJO CORCINI' };
  const { deps, d } = dubles({ parecer: outraPessoa });
  const { r } = await comLogs(() => tratarMensagem(RUN, PROJETO, mensagem(), REGRAS, deps));
  assert.equal(r.situacao, 'bloqueado');
  assert.equal(r.anexados, 0);
  assert.deepEqual(d.anexosPedidos, [], 'nem a linha do anexo é aberta');
  assert.deepEqual(d.subidos, []);
  assert.equal(d.registros[0].anexos, 0);
  assert.equal(d.registros[0].recomendacao, null);
  assert.equal(d.registros[0].concluida, true, 'é decisão, não falha passageira');
  assert.match(String(d.registros[0].motivo), /não anexei/);
});

test('endereço divergente NÃO bloqueia: anexa pelo protocolo e registra o motivo', async () => {
  const outroEndereco: ParecerLido = { ...PARECER_OK, titular: null, endereco: 'AVENIDA BRASIL 4000' };
  const { deps, d } = dubles({ parecer: outroEndereco });
  const { r } = await comLogs(() => tratarMensagem(RUN, PROJETO, mensagem(), REGRAS, deps));
  assert.equal(r.situacao, 'tratado');
  assert.equal(r.anexados, 1);
  assert.equal(r.concluida, true);
  assert.match(String(d.registros[0].motivo), /endereço do parecer/);
  assert.equal(d.registros[0].recomendacao, 'approved', 'o parecer favorável vale mesmo com endereço velho');
});

test('anexo que falha no storage → marcado com erro e a mensagem fica pendente', async () => {
  const { deps, d } = dubles({ storageRecusa: ['parecer.pdf'] });
  const { r } = await comLogs(() => tratarMensagem(RUN, PROJETO, mensagem(), REGRAS, deps));
  assert.equal(r.anexados, 0);
  assert.equal(r.concluida, false, 'sem isso o PDF ficaria perdido em silêncio');
  assert.deepEqual(d.marcadosComErro, ['anexo-parecer.pdf']);
  assert.deepEqual(d.enviados, []);
  assert.equal(d.registros[0].concluida, false);
});

test('anexo que o banco já resolveu não sobe de novo, e não deixa a mensagem pendente', async () => {
  const { deps, d } = dubles({ jaResolvidos: ['parecer.pdf'] });
  const { r } = await comLogs(() => tratarMensagem(RUN, PROJETO, mensagem(), REGRAS, deps));
  assert.equal(r.anexados, 0);
  assert.equal(r.concluida, true);
  assert.deepEqual(d.subidos, []);
  assert.deepEqual(d.marcadosComErro, []);
});

test('o PDF lido é o MAIOR, e fica registrado qual foi', async () => {
  const { deps, d } = dubles();
  const dois = mensagem({
    anexos: [
      anexo('anexo-tecnico.pdf', 'application/pdf', 20_000),
      anexo('parecer-de-acesso.pdf', 'application/pdf', 900_000),
    ],
  });
  const { r } = await comLogs(() => tratarMensagem(RUN, PROJETO, dois, REGRAS, deps));
  assert.deepEqual(d.pdfsLidos, [900_000], 'um só PDF é lido, e é o maior');
  assert.equal(d.registros[0].arquivoLido, 'parecer-de-acesso.pdf');
  assert.equal(r.anexados, 2, 'os dois PDFs vão para o card; só a LEITURA é de um');
});

test('regra que pede PDF num e-mail sem PDF: conclui, com a ressalva', async () => {
  const { deps, d } = dubles();
  const semAnexo = mensagem({ anexos: [] });
  const { r } = await comLogs(() => tratarMensagem(RUN, PROJETO, semAnexo, REGRAS, deps));
  assert.equal(r.concluida, true, 'não há o que ler; insistir não resolve');
  assert.deepEqual(d.pdfsLidos, []);
  assert.match(String(d.registros[0].motivo), /não trouxe PDF/);
  assert.equal(d.registros[0].recomendacao, null);
});

test('regra sem ler_pdf não chama a IA e conclui', async () => {
  const { deps, d } = dubles();
  const carta = mensagem({
    assunto: 'EDP - CARTA DE OBRAS 45006443920',
    anexos: [anexo('carta.pdf', 'application/pdf')],
  });
  const { r } = await comLogs(() => tratarMensagem(RUN, PROJETO, carta, REGRAS, deps));
  assert.deepEqual(d.pdfsLidos, [], 'a regra não pede leitura');
  assert.equal(r.concluida, true);
  assert.equal(d.registros[0].arquivoLido, null);
  assert.equal(d.registros[0].recomendacao, null, 'recomendação de etapa é só para parecer');
});

test('o log NÃO leva nome, endereço, assunto nem nome de arquivo do cliente', async () => {
  const outraPessoa: ParecerLido = {
    ok: true, veredito: 'favoravel', resumo: 'ok',
    titular: 'MIGUEL ARCANJO CORCINI', endereco: 'AVENIDA BRASIL 4000', erro: null,
  };
  const { deps } = dubles({ parecer: outraPessoa });
  const nomeComTitular = 'PARECER_WERLHE_DE_ARAUJO_LIMA.pdf';
  const m = mensagem({
    assunto: 'ENVIO DE PARECER - NOTA 45006443920 - WERLHE DE ARAUJO LIMA',
    anexos: [anexo(nomeComTitular, 'application/pdf')],
  });
  const { logs } = await comLogs(() => tratarMensagem(RUN, PROJETO, m, REGRAS, deps));

  assert.ok(logs.length > 0, 'o bloqueio TEM de logar — pulo silencioso foi o defeito');
  assert.doesNotMatch(logs, /WERLHE/i, 'titular do cadastro não vai para o journald');
  assert.doesNotMatch(logs, /MIGUEL/i, 'titular do parecer também não');
  assert.doesNotMatch(logs, /FLORES|BRASIL/i, 'endereço não vai para o journald');
  assert.doesNotMatch(logs, /ENVIO DE PARECER/i, 'assunto não vai para o journald');
  assert.doesNotMatch(logs, /\.pdf/i, 'nome de arquivo da EDP às vezes traz o titular');
  // o que PODE ir: o código do projeto, o protocolo e o que foi conferido
  assert.match(logs, /GD-2026-001/);
  assert.match(logs, /045006443920/);
  assert.match(logs, /"por":"titular"/);
});

test('o log do anexo que falhou também não leva nome de arquivo', async () => {
  const { deps } = dubles({ storageRecusa: ['PARECER_WERLHE.pdf'] });
  const m = mensagem({ anexos: [anexo('PARECER_WERLHE.pdf', 'application/pdf')] });
  const { logs } = await comLogs(() => tratarMensagem(RUN, PROJETO, m, REGRAS, deps));
  assert.match(logs, /anexo falhou ao subir/);
  assert.doesNotMatch(logs, /WERLHE/i);
  assert.doesNotMatch(logs, /\.pdf/i);
  assert.match(logs, /application\/pdf/, 'o mime fica: ajuda a diagnosticar e não é dado de cliente');
});
