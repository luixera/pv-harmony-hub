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
  conferir, contaZerada, resultadoDoRun, somarTratamento, tratarMensagem, triar,
  type DepsTratamento, type ParecerLido, type Tratamento,
} from '../src/email/index.js';
import type { EnvelopeLido, MensagemLida } from '../src/email/caixa.js';
import { idArquivoDeEmail, type RegraEmail } from '../src/email/util.js';
import type { AberturaDeAnexo, EmailLido, Run, TentativaEmail } from '../src/fila.js';

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
  // regra que só avisa: não anexa nem lê (E1 não pode bloquear o que não depende de arquivo)
  { id: '3', remetente: null, assunto: 'AVISO DA EDP', tipo_documento: 'aviso', anexar: false, ler_pdf: false },
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
  anexosSemNome: 0,
  ...over,
});

const PARECER_OK: ParecerLido = {
  ok: true, veredito: 'favoravel', resumo: 'Parecer favorável.',
  titular: 'WERLHE DE ARAUJO LIMA', endereco: 'RUA DAS FLORES 120', erro: null,
};

interface Diario {
  registros: EmailLido[];
  anexosPedidos: string[];
  chavesPedidas: string[];
  /** a ocorrência (1, 2, …) que o worker mandou para cada anexo pedido */
  ocorrenciasPedidas: number[];
  subidos: string[];
  /** o mime com que cada arquivo foi para o storage */
  mimesSubidos: string[];
  enviados: string[];
  marcadosComErro: string[];
  motivosGravados: string[];
  pdfsLidos: number[];
  tentativas: TentativaEmail[];
  /** a ORDEM em que as dependências foram chamadas (o D4 é sobre ordem) */
  ordem: string[];
}

function dubles(o: {
  parecer?: ParecerLido;
  /** o parecer depende de QUAL PDF foi lido (identificado pelo tamanho): E1 */
  parecerDoPdf?: (tamanho: number) => ParecerLido;
  /** nomes de arquivo cuja linha o banco NÃO devolve (já `enviado`) */
  jaResolvidos?: string[];
  /** o banco diz que o projeto não existe (apagado entre a listagem e o registro) */
  projetoInexistente?: boolean;
  /** nomes de arquivo que o storage recusa */
  storageRecusa?: string[];
  /** a mensagem com que o storage recusa (crua, como vem de terceiro) */
  erroDoStorage?: string;
  /** o banco recusa abrir a linha do anexo (falha permanente) */
  anexoEstoura?: boolean;
  /** a leitura do parecer estoura (não é `ok:false`, é exceção) */
  parecerEstoura?: boolean;
} = {}): { deps: DepsTratamento; d: Diario } {
  const d: Diario = {
    registros: [], anexosPedidos: [], chavesPedidas: [], ocorrenciasPedidas: [], subidos: [], mimesSubidos: [],
    enviados: [], marcadosComErro: [], motivosGravados: [], pdfsLidos: [], tentativas: [], ordem: [],
  };
  const deps: DepsTratamento = {
    async abrirTentativa(p): Promise<number> {
      d.ordem.push('abrirTentativa');
      d.tentativas.push(p);
      return d.tentativas.length;
    },
    async anexoDeEmail(_conta, protocolo, projectId, messageId, nomeArquivo, _conferidoPor, ocorrencia = 1): Promise<AberturaDeAnexo> {
      d.ordem.push('anexoDeEmail');
      d.anexosPedidos.push(nomeArquivo);
      d.ocorrenciasPedidas.push(ocorrencia);
      d.chavesPedidas.push(idArquivoDeEmail(messageId, protocolo, nomeArquivo, ocorrencia));
      if (o.anexoEstoura) throw new Error('Não consegui abrir o anexo: permission denied');
      if (o.projetoInexistente) return { situacao: 'projeto_inexistente' };
      if ((o.jaResolvidos ?? []).includes(nomeArquivo)) return { situacao: 'ja_resolvido' };
      return {
        situacao: 'aberto',
        anexo: {
          id: `anexo-${nomeArquivo}${ocorrencia > 1 ? `-${ocorrencia}` : ''}`, project_id: projectId, company_id: PROJETO.company_id,
          protocolo, id_arquivo: idArquivoDeEmail(messageId, protocolo, nomeArquivo, ocorrencia),
          nome_arquivo: nomeArquivo, codigo: PROJETO.codigo,
        },
      };
    },
    async subirDocumento(a, _bytes, mime): Promise<string> {
      d.ordem.push('subirDocumento');
      if ((o.storageRecusa ?? []).includes(a.nome_arquivo)) {
        throw new Error(o.erroDoStorage ?? 'Não consegui guardar o anexo no projeto: bucket indisponível');
      }
      d.subidos.push(a.nome_arquivo);
      d.mimesSubidos.push(mime);
      return `caminho/${a.nome_arquivo}`;
    },
    async anexoEnviado(id): Promise<void> { d.ordem.push('anexoEnviado'); d.enviados.push(id); },
    async anexoErro(id, motivo): Promise<void> {
      d.ordem.push('anexoErro');
      d.marcadosComErro.push(id);
      d.motivosGravados.push(motivo);
    },
    async registrarEmailLido(p): Promise<void> { d.ordem.push('registrarEmailLido'); d.registros.push(p); },
    async lerParecer(pdf): Promise<ParecerLido> {
      d.ordem.push('lerParecer');
      if (o.parecerEstoura) throw new Error('a leitura do parecer caiu');
      d.pdfsLidos.push(pdf.length);
      return o.parecerDoPdf?.(pdf.length) ?? o.parecer ?? PARECER_OK;
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

// ── D1: a chave do anexo carrega o protocolo ────────────────────────────────

test('a chave do anexo pedida ao banco inclui o protocolo do projeto', async () => {
  // Sem o protocolo na chave, o mesmo anexo servindo dois projetos colidia na
  // UNIQUE: num ramo o documento não chegava ao card, no outro ia para o card
  // de OUTRO cliente.
  const { deps, d } = dubles();
  await comLogs(() => tratarMensagem(RUN, PROJETO, mensagem(), REGRAS, deps));
  assert.deepEqual(d.chavesPedidas, ['<abc-123@edp.com.br>#045006443920#parecer.pdf']);
});

test('o mesmo e-mail em outro protocolo pede OUTRA chave', async () => {
  const outroProjeto = { ...PROJETO, protocolo: '045006443921', project_id: 'aaaa1111-1111-4111-8111-111111111111', codigo: 'GD-2026-002' };
  const { deps, d } = dubles();
  const m = mensagem({ assunto: 'ENVIO DE PARECER - NOTAS 45006443920 e 45006443921' });
  await comLogs(() => tratarMensagem(RUN, PROJETO, m, REGRAS, deps));
  await comLogs(() => tratarMensagem(RUN, outroProjeto, m, REGRAS, deps));
  assert.equal(d.chavesPedidas.length, 2);
  assert.notEqual(d.chavesPedidas[0], d.chavesPedidas[1], 'duas chaves, uma por projeto');
  assert.match(d.chavesPedidas[1], /#045006443921#/);
});

// ── D2: a mensagem crua do storage não vai para o log ──────────────────────

test('erro do storage COM nome de arquivo do titular não aparece no log', async () => {
  // O dublê lança o que o storage lança de verdade — com o caminho, e o caminho
  // com o nome do titular dentro. O teste antigo passava por construção, porque
  // a mensagem escolhida por ele não tinha nome de arquivo nenhum.
  const nome = 'PARECER_WERLHE_DE_ARAUJO_LIMA.pdf';
  const cru = `Não consegui guardar o anexo no projeto: Invalid key: 22222222-2222-4222-8222-222222222222/11111111-1111-4111-8111-111111111111/other_photos/1760000000000_${nome}`;
  const { deps, d } = dubles({ storageRecusa: [nome], erroDoStorage: cru });
  const { logs } = await comLogs(() =>
    tratarMensagem(RUN, PROJETO, mensagem({ anexos: [anexo(nome, 'application/pdf')] }), REGRAS, deps));

  assert.match(logs, /anexo falhou ao subir/, 'a falha TEM de aparecer no log');
  assert.doesNotMatch(logs, /WERLHE/i, 'o nome do titular não vai para o journald');
  assert.doesNotMatch(logs, /\.pdf/i, 'nem o nome do arquivo');
  assert.doesNotMatch(logs, /Invalid key/i, 'nem a mensagem crua de terceiro');
  assert.doesNotMatch(logs, /other_photos/, 'nem o caminho no bucket');
  assert.match(logs, /recusou o nome do arquivo/, 'a razão curta diz o bastante para diagnosticar');
  // …e o texto COMPLETO continua indo para o banco, que é de onde a tela lê
  assert.equal(d.motivosGravados.length, 1);
  assert.ok(d.motivosGravados[0].includes(nome), 'o detalhe fica no banco, não no log');
});

// ── D4: a tentativa é contada antes de gastar a IA ─────────────────────────

test('a tentativa é aberta ANTES da leitura do parecer', async () => {
  const { deps, d } = dubles();
  await comLogs(() => tratarMensagem(RUN, PROJETO, mensagem(), REGRAS, deps));
  assert.equal(d.ordem[0], 'abrirTentativa', 'nada é gasto antes de a tentativa contar');
  assert.ok(d.ordem.indexOf('abrirTentativa') < d.ordem.indexOf('lerParecer'));
  assert.equal(d.tentativas.length, 1);
  assert.equal(d.tentativas[0].messageId, '<abc-123@edp.com.br>');
  assert.equal(d.tentativas[0].protocolo, PROJETO.protocolo);
  assert.equal(d.tentativas[0].projectId, PROJETO.project_id);
});

test('tratamento que MORRE no meio já deixou a tentativa contada', async () => {
  // Era o vazamento de dinheiro: estourando antes de `registrarEmailLido`, não
  // havia linha, `tentativas` nunca incrementava, e todo run futuro baixava o
  // corpo e chamava a IA de novo — para sempre, sem nada avisar.
  const { deps, d } = dubles({ anexoEstoura: true });
  await assert.rejects(
    () => comLogs(() => tratarMensagem(RUN, PROJETO, mensagem(), REGRAS, deps)),
    /Não consegui abrir o anexo/,
  );
  assert.equal(d.tentativas.length, 1, 'a tentativa foi contada mesmo sem registro no fim');
  assert.deepEqual(d.registros, [], 'o tratamento morreu antes do registro');
});

test('IA que ESTOURA (não só responde ok:false) também já contou a tentativa', async () => {
  const { deps, d } = dubles({ parecerEstoura: true });
  await assert.rejects(
    () => comLogs(() => tratarMensagem(RUN, PROJETO, mensagem(), REGRAS, deps)),
    /a leitura do parecer caiu/,
  );
  assert.equal(d.tentativas.length, 1);
});

test('mensagem sem regra também conta a tentativa (e conclui)', async () => {
  const { deps, d } = dubles();
  const outro = mensagem({ assunto: 'RA HugMe - EDP São Paulo te mandou mensagem' });
  const { r } = await comLogs(() => tratarMensagem(RUN, PROJETO, outro, REGRAS, deps));
  assert.equal(r.concluida, true);
  assert.equal(d.tentativas.length, 1);
  assert.deepEqual(d.pdfsLidos, [], 'nada de IA numa mensagem que nenhuma regra quer');
});

// ── E1: e-mail que cita DOIS protocolos ─────────────────────────────────────
// O defeito: o laço trata um protocolo por vez, e para CADA um anexava todos os
// arquivos da mensagem e lia o MAIOR PDF. O documento de um cliente ia para o
// card do outro (de outra integradora, até), com o comentário "titular
// conferido"; e o outro projeto era bloqueado por divergir do PDF errado.

const PROJETO_B = {
  ...PROJETO, protocolo: '045006443921', project_id: 'aaaa1111-1111-4111-8111-111111111111',
  codigo: 'GD-2026-002', titular: 'MIGUEL ARCANJO CORCINI', endereco: 'AVENIDA BRASIL 4000',
};
const DOIS = [PROJETO.protocolo, PROJETO_B.protocolo];
const ASSUNTO_DOIS = 'ENVIO DE PARECER - NOTAS 45006443920 e 45006443921';
const PDF_A = 'PARECER_45006443920.pdf';
const PDF_B = 'PARECER_45006443921.pdf';
const TAM_A = 900_000; // o MAIOR: é o que o código antigo lia, para os dois projetos
const TAM_B = 400_000;
const PARECER_DE_B: ParecerLido = { ...PARECER_OK, titular: 'MIGUEL ARCANJO CORCINI', endereco: 'AVENIDA BRASIL 4000' };
/** O parecer de cada PDF diz o titular do seu próprio projeto. */
const parecerDoPdf = (tamanho: number): ParecerLido => (tamanho === TAM_A ? PARECER_OK : PARECER_DE_B);

const doisProtocolos = (over: Partial<MensagemLida> = {}): MensagemLida => mensagem({
  assunto: ASSUNTO_DOIS,
  anexos: [anexo(PDF_A, 'application/pdf', TAM_A), anexo(PDF_B, 'application/pdf', TAM_B)],
  ...over,
});

test('E1: dois protocolos — cada projeto recebe SÓ o arquivo do seu protocolo', async () => {
  const a = dubles({ parecerDoPdf });
  const ra = await comLogs(() => tratarMensagem(RUN, PROJETO, doisProtocolos(), REGRAS, a.deps, DOIS));
  const b = dubles({ parecerDoPdf });
  const rb = await comLogs(() => tratarMensagem(RUN, PROJETO_B, doisProtocolos(), REGRAS, b.deps, DOIS));

  assert.deepEqual(a.d.subidos, [PDF_A], 'o card de A não recebe o parecer de B');
  assert.deepEqual(b.d.subidos, [PDF_B], 'o card de B não recebe o parecer de A');
  assert.deepEqual(a.d.anexosPedidos, [PDF_A]);
  assert.deepEqual(b.d.anexosPedidos, [PDF_B]);
  assert.equal(ra.r.anexados, 1);
  assert.equal(rb.r.anexados, 1);
  assert.equal(ra.r.situacao, 'tratado');
  assert.equal(rb.r.situacao, 'tratado');
});

test('E1: a IA lê o PDF DO PROTOCOLO, não o maior — e o titular confere contra ele', async () => {
  // Antes: B lia o PDF de A (o maior), o titular divergia, bloqueava e gravava
  // concluida = true. B ficava sem documento, e "Ler de novo" dava o mesmo.
  const b = dubles({ parecerDoPdf });
  const { r } = await comLogs(() => tratarMensagem(RUN, PROJETO_B, doisProtocolos(), REGRAS, b.deps, DOIS));
  assert.deepEqual(b.d.pdfsLidos, [TAM_B], 'lê o de B (o menor), não o maior');
  assert.equal(r.situacao, 'tratado', 'o titular do PDF de B é o de B: nada a bloquear');
  assert.equal(b.d.registros[0].arquivoLido, PDF_B);
  assert.equal(b.d.registros[0].anexos, 1);
  assert.equal(b.d.registros[0].recomendacao, 'approved');

  const a = dubles({ parecerDoPdf });
  await comLogs(() => tratarMensagem(RUN, PROJETO, doisProtocolos(), REGRAS, a.deps, DOIS));
  assert.deepEqual(a.d.pdfsLidos, [TAM_A]);
  assert.equal(a.d.registros[0].arquivoLido, PDF_A);
});

test('E1: dois protocolos e o nome do arquivo casa com B enquanto se trata A — A não leva o de B', async () => {
  const soDeB = doisProtocolos({ anexos: [anexo(PDF_B, 'application/pdf', TAM_B)] });
  const a = dubles({ parecerDoPdf });
  const { r } = await comLogs(() => tratarMensagem(RUN, PROJETO, soDeB, REGRAS, a.deps, DOIS));
  assert.equal(r.situacao, 'sem_dono', 'nada neste e-mail é de A');
  assert.deepEqual(a.d.subidos, []);
  assert.deepEqual(a.d.anexosPedidos, [], 'nem a linha do anexo é aberta no banco');
  assert.deepEqual(a.d.pdfsLidos, [], 'e a IA não é paga para ler o PDF de outro cliente');

  const b = dubles({ parecerDoPdf });
  const rb = await comLogs(() => tratarMensagem(RUN, PROJETO_B, soDeB, REGRAS, b.deps, DOIS));
  assert.equal(rb.r.situacao, 'tratado');
  assert.deepEqual(b.d.subidos, [PDF_B]);
});

test('E1: nenhum arquivo casa pelo nome → não anexa nada, conclui e grava o motivo', async () => {
  const semNumero = doisProtocolos({
    anexos: [anexo('parecer_a.pdf', 'application/pdf', TAM_A), anexo('parecer_b.pdf', 'application/pdf', TAM_B)],
  });
  const { deps, d } = dubles({ parecerDoPdf });
  const { r } = await comLogs(() => tratarMensagem(RUN, PROJETO, semNumero, REGRAS, deps, DOIS));

  assert.equal(r.situacao, 'sem_dono');
  assert.equal(r.anexados, 0);
  assert.equal(r.concluida, true, 'não é falha passageira: insistir não resolve');
  assert.deepEqual(d.anexosPedidos, []);
  assert.deepEqual(d.subidos, []);
  assert.deepEqual(d.pdfsLidos, [], 'sem dono, a IA não lê: seria pagar para ler o PDF talvez errado');
  assert.equal(d.ordem.includes('lerParecer'), false);
  assert.equal(d.registros.length, 1);
  const reg = d.registros[0];
  assert.equal(reg.concluida, true);
  assert.equal(reg.anexos, 0);
  assert.equal(reg.recomendacao, null, 'recomendar etapa lendo o PDF errado seria pior que não recomendar');
  assert.equal(reg.arquivoLido, null);
  assert.equal(reg.projectId, PROJETO.project_id, 'a linha tem projeto, senão não aparece no grupo de atenção');
  assert.match(String(reg.motivo), /não anexei/);
  assert.match(String(reg.motivo), /cita 2 protocolos/);
  assert.match(String(reg.motivo), /qual documento é de qual/);
  assert.match(String(reg.motivo), /confira à mão/);
});

test('E1: arquivo que traz os DOIS números no nome é ambíguo — não vai para nenhum card', async () => {
  const junto = doisProtocolos({ anexos: [anexo('PARECER_45006443920_45006443921.pdf', 'application/pdf', TAM_A)] });
  const a = dubles({ parecerDoPdf });
  const b = dubles({ parecerDoPdf });
  const ra = await comLogs(() => tratarMensagem(RUN, PROJETO, junto, REGRAS, a.deps, DOIS));
  const rb = await comLogs(() => tratarMensagem(RUN, PROJETO_B, junto, REGRAS, b.deps, DOIS));
  assert.equal(ra.r.situacao, 'sem_dono');
  assert.equal(rb.r.situacao, 'sem_dono');
  assert.deepEqual([...a.d.subidos, ...b.d.subidos], []);
});

test('E1: dois protocolos, um arquivo sem número no nome — fica de fora, e o motivo diz', async () => {
  const comCarta = doisProtocolos({
    anexos: [anexo(PDF_A, 'application/pdf', TAM_A), anexo('carta.pdf', 'application/pdf', 5_000)],
  });
  const { deps, d } = dubles({ parecerDoPdf });
  const { r } = await comLogs(() => tratarMensagem(RUN, PROJETO, comCarta, REGRAS, deps, DOIS));
  assert.equal(r.situacao, 'tratado');
  assert.deepEqual(d.subidos, [PDF_A]);
  assert.match(String(d.registros[0].motivo), /cita 2 protocolos/);
  assert.match(String(d.registros[0].motivo), /1 de 2 arquivo/, 'quem lê sabe que sobrou arquivo sem dono');
});

test('E1: um arquivo xlsx com o número no nome também é do projeto; o PDF lido é só do projeto', async () => {
  const mista = doisProtocolos({
    anexos: [
      anexo(PDF_B, 'application/pdf', TAM_B),
      anexo('MEMORIAL_45006443920.xlsx', 'application/vnd.ms-excel', 50_000),
      anexo(PDF_A, 'application/pdf', 100_000),
    ],
  });
  const { deps, d } = dubles({ parecerDoPdf: () => PARECER_OK });
  await comLogs(() => tratarMensagem(RUN, PROJETO, mista, REGRAS, deps, DOIS));
  assert.deepEqual(d.subidos, ['MEMORIAL_45006443920.xlsx', PDF_A]);
  assert.deepEqual(d.pdfsLidos, [100_000], 'o PDF de A, ainda que o de B seja maior');
});

test('E1: com UM protocolo no assunto nada muda — anexa tudo e lê o maior, mesmo com outros na lista da conta', async () => {
  // O caso normal. A lista da conta tem 2 protocolos, mas o assunto cita 1.
  const um = mensagem({
    anexos: [anexo('anexo-tecnico.pdf', 'application/pdf', 20_000), anexo('parecer-de-acesso.pdf', 'application/pdf', 900_000),
      anexo('planilha.xls', 'application/vnd.ms-excel', 3_000)],
  });
  const { deps, d } = dubles();
  const { r } = await comLogs(() => tratarMensagem(RUN, PROJETO, um, REGRAS, deps, DOIS));
  assert.equal(r.situacao, 'tratado');
  assert.deepEqual(d.subidos, ['anexo-tecnico.pdf', 'parecer-de-acesso.pdf', 'planilha.xls']);
  assert.deepEqual(d.pdfsLidos, [900_000]);
  assert.equal(d.registros[0].arquivoLido, 'parecer-de-acesso.pdf');
  assert.equal(d.registros[0].motivo, null, 'nada a ressalvar no caso normal');
});

test('E1: sem a lista da conta (chamada antiga) vale o caso de UM protocolo — e o nome ainda barra o de outro', async () => {
  // Este teste fixava `[PDF_A, PDF_B]` ("sem saber de outros protocolos, não há como
  // separar"): era a lacuna 1 do E1 escrita como se fosse comportamento desejado.
  // O nome do arquivo não depende de lista nenhuma (E1b): o número de B no nome
  // nunca é o de A, conheça-se B ou não.
  const { deps, d } = dubles();
  const { r } = await comLogs(() => tratarMensagem(RUN, PROJETO, doisProtocolos(), REGRAS, deps));
  assert.equal(r.situacao, 'tratado');
  assert.deepEqual(d.subidos, [PDF_A], 'o arquivo de B não vai para o card de A');
  assert.equal(r.deOutroProtocolo, 1);
});

test('E1: regra que não anexa nem lê não depende de arquivo — não bloqueia', async () => {
  const aviso = doisProtocolos({ assunto: 'AVISO DA EDP - NOTAS 45006443920 e 45006443921' });
  const { deps, d } = dubles();
  const { r } = await comLogs(() => tratarMensagem(RUN, PROJETO, aviso, REGRAS, deps, DOIS));
  assert.equal(r.situacao, 'tratado');
  assert.equal(r.concluida, true);
  assert.deepEqual(d.subidos, []);
});

test('E1: dois protocolos e e-mail SEM anexo → o caminho de sempre ("não trouxe PDF"), não "sem dono"', async () => {
  const { deps, d } = dubles();
  const { r } = await comLogs(() => tratarMensagem(RUN, PROJETO, doisProtocolos({ anexos: [] }), REGRAS, deps, DOIS));
  assert.equal(r.situacao, 'tratado');
  assert.equal(r.concluida, true);
  assert.match(String(d.registros[0].motivo), /não trouxe PDF/);
});

test('E1: dois protocolos e IA fora do ar — ainda assim cada card só leva o seu arquivo', async () => {
  const falha: ParecerLido = { ok: false, veredito: null, resumo: '', titular: null, endereco: null, erro: 'sem crédito' };
  const a = dubles({ parecer: falha });
  const b = dubles({ parecer: falha });
  const ra = await comLogs(() => tratarMensagem(RUN, PROJETO, doisProtocolos(), REGRAS, a.deps, DOIS));
  await comLogs(() => tratarMensagem(RUN, PROJETO_B, doisProtocolos(), REGRAS, b.deps, DOIS));
  // sem IA não há conferência de titular: o nome do arquivo é a ÚNICA barreira
  assert.deepEqual(a.d.subidos, [PDF_A]);
  assert.deepEqual(b.d.subidos, [PDF_B]);
  assert.equal(ra.r.concluida, false, 'IA fora do ar continua sendo falha passageira');
});

test('E1: o log do caso "sem dono" não leva nome de pessoa, de arquivo nem assunto', async () => {
  const m = doisProtocolos({
    assunto: 'ENVIO DE PARECER - NOTAS 45006443920 e 45006443921 - WERLHE DE ARAUJO LIMA',
    anexos: [anexo('PARECER_WERLHE_DE_ARAUJO_LIMA.pdf', 'application/pdf', TAM_A),
      anexo('PARECER_MIGUEL_ARCANJO_CORCINI.pdf', 'application/pdf', TAM_B)],
  });
  const { deps } = dubles();
  const { logs } = await comLogs(() => tratarMensagem(RUN, PROJETO, m, REGRAS, deps, DOIS));
  assert.ok(logs.length > 0, 'o descarte TEM de deixar rastro');
  assert.doesNotMatch(logs, /WERLHE|ARAUJO|MIGUEL|CORCINI/i);
  assert.doesNotMatch(logs, /\.pdf|PARECER_/i);
  assert.doesNotMatch(logs, /ENVIO DE PARECER/i);
  assert.match(logs, /GD-2026-001/);
  assert.match(logs, /045006443920/);
});

// ── E1b: arquivo cujo NOME traz o número de OUTRO protocolo ──────────────────
// As duas lacunas que sobraram do E1, que só olhava o nome quando o assunto
// citava VÁRIOS protocolos NOSSOS:
//  1. o assunto cita dois protocolos e só um é nosso (o outro é de projeto
//     concluído, de outra conta ou fora do teto de 80): a contagem dá 1;
//  2. com um protocolo só, um arquivo com o número de OUTRO projeto nosso no nome.
// Nos dois casos o documento de um cliente ia para o card de outro. A regra agora
// vale sempre: nome com número de protocolo DIFERENTE do que se trata não anexa.

const DE_NINGUEM = 'PARECER_99999999999.pdf'; // protocolo que não é de nenhum projeto nosso

test('E1b: um protocolo e nomes genéricos — anexa tudo como sempre (sem regressão)', async () => {
  const m = mensagem({
    anexos: [anexo('parecer.pdf', 'application/pdf', 20_000), anexo('documento.pdf', 'application/pdf', 900_000),
      anexo('image001.png', 'image/png', 4_000)],
  });
  const { deps, d } = dubles();
  const { r } = await comLogs(() => tratarMensagem(RUN, PROJETO, m, REGRAS, deps, DOIS));
  assert.equal(r.situacao, 'tratado');
  assert.deepEqual(d.subidos, ['parecer.pdf', 'documento.pdf']);
  assert.deepEqual(d.pdfsLidos, [900_000], 'lê o maior, como sempre');
  assert.equal(r.deOutroProtocolo, 0);
  assert.doesNotMatch(String(d.registros[0].motivo), /outro protocolo/);
  assert.equal(r.imagensIgnoradas, 1, 'a imagem continua sendo ignorada pelo motivo de sempre');
});

test('E1b: um protocolo e o nome traz o número DESTE protocolo — anexa', async () => {
  const m = mensagem({ anexos: [anexo(PDF_A, 'application/pdf', TAM_A)] });
  const { deps, d } = dubles();
  const { r } = await comLogs(() => tratarMensagem(RUN, PROJETO, m, REGRAS, deps, DOIS));
  assert.deepEqual(d.subidos, [PDF_A]);
  assert.equal(r.anexados, 1);
  assert.equal(r.deOutroProtocolo, 0);
  assert.equal(d.registros[0].motivo, null);
});

test('E1b: um protocolo e o nome traz o de OUTRO — não anexa, o genérico segue, e a IA não lê o de outro', async () => {
  // O de outro é o MAIOR: era ele que a IA lia (titular do outro cliente → bloqueio
  // do nosso, ou "titular conferido" no card errado).
  const m = mensagem({
    anexos: [anexo(DE_NINGUEM, 'application/pdf', 900_000), anexo('parecer.pdf', 'application/pdf', 50_000)],
  });
  const { deps, d } = dubles();
  const { r } = await comLogs(() => tratarMensagem(RUN, PROJETO, m, REGRAS, deps, [PROJETO.protocolo]));
  assert.equal(r.situacao, 'tratado');
  assert.deepEqual(d.subidos, ['parecer.pdf']);
  assert.deepEqual(d.anexosPedidos, ['parecer.pdf'], 'nem a linha do arquivo de outro é aberta no banco');
  assert.deepEqual(d.pdfsLidos, [50_000], 'a IA lê o genérico, não o PDF de outro protocolo');
  assert.equal(r.anexados, 1);
  assert.equal(r.deOutroProtocolo, 1);
  assert.equal(r.concluida, true);
  const motivo = String(d.registros[0].motivo);
  assert.match(motivo, /1 arquivo\(s\) não anexado\(s\)/);
  assert.match(motivo, /outro protocolo/);
  assert.match(motivo, /PARECER_99999999999\.pdf/, 'o nome fica no banco, que é de onde a tela lê');
});

test('E1b: um protocolo e TODOS os arquivos são de outro — sem_dono, concluída, nada anexado, IA fora', async () => {
  const m = mensagem({ anexos: [anexo(DE_NINGUEM, 'application/pdf', 900_000)] });
  const { deps, d } = dubles();
  const { r } = await comLogs(() => tratarMensagem(RUN, PROJETO, m, REGRAS, deps, [PROJETO.protocolo]));
  assert.equal(r.situacao, 'sem_dono');
  assert.equal(r.anexados, 0);
  assert.equal(r.deOutroProtocolo, 1);
  assert.equal(r.concluida, true, 'insistir daria o mesmo resultado');
  assert.deepEqual(d.anexosPedidos, []);
  assert.deepEqual(d.subidos, []);
  assert.deepEqual(d.pdfsLidos, [], 'não se paga IA para ler o PDF de outro cliente');
  const reg = d.registros[0];
  assert.equal(reg.concluida, true);
  assert.equal(reg.recomendacao, null);
  assert.equal(reg.arquivoLido, null);
  assert.equal(reg.projectId, PROJETO.project_id, 'a linha tem projeto, senão não aparece no grupo de atenção');
  assert.match(String(reg.motivo), /não anexei/);
  assert.match(String(reg.motivo), /outro protocolo/);
  assert.match(String(reg.motivo), /confira à mão/);
  assert.doesNotMatch(String(reg.motivo), /não trouxe PDF/, 'o e-mail trouxe PDF: dizer o contrário seria mentira');
});

test('E1b lacuna 1: o assunto cita dois protocolos mas só um é NOSSO — o arquivo do outro não entra no nosso card', async () => {
  // B é de projeto concluído, de outra conta ou ficou fora do teto de 80: não está
  // na lista, a contagem dá 1 e o E1 antigo anexava tudo. O arquivo de B é o MAIOR.
  const m = doisProtocolos({
    anexos: [anexo(PDF_A, 'application/pdf', TAM_B), anexo(PDF_B, 'application/pdf', TAM_A)],
  });
  const { deps, d } = dubles({ parecerDoPdf: tam => (tam === TAM_B ? PARECER_OK : PARECER_DE_B) });
  const { r } = await comLogs(() => tratarMensagem(RUN, PROJETO, m, REGRAS, deps, [PROJETO.protocolo]));
  assert.deepEqual(d.subidos, [PDF_A], 'o card de A só leva o arquivo de A');
  assert.deepEqual(d.pdfsLidos, [TAM_B], 'e a IA lê o PDF de A, não o maior (que é o de B)');
  assert.equal(r.situacao, 'tratado', 'ler o PDF de B bloquearia A por titular divergente');
  assert.equal(r.deOutroProtocolo, 1);
  assert.equal(d.registros[0].arquivoLido, PDF_A);
  assert.match(String(d.registros[0].motivo), /outro protocolo/);
  assert.match(String(d.registros[0].motivo), /PARECER_45006443921\.pdf/);
});

test('E1b lacuna 1: o mesmo e-mail, lista da conta com outros projetos — nada muda', async () => {
  const m = doisProtocolos();
  const { deps, d } = dubles({ parecerDoPdf });
  const { r } = await comLogs(() => tratarMensagem(RUN, PROJETO, m, REGRAS, deps, [PROJETO.protocolo, '045000000001', '045000000002']));
  assert.deepEqual(d.subidos, [PDF_A]);
  assert.equal(r.deOutroProtocolo, 1);
});

test('E1b lacuna 2: um protocolo e o arquivo traz o número de OUTRO projeto NOSSO — não anexa', async () => {
  // O assunto cita só A, mas um dos arquivos é o parecer de B (também nosso).
  const m = mensagem({
    anexos: [anexo(PDF_B, 'application/pdf', TAM_A), anexo(PDF_A, 'application/pdf', TAM_B)],
  });
  const { deps, d } = dubles({ parecerDoPdf: tam => (tam === TAM_B ? PARECER_OK : PARECER_DE_B) });
  const { r } = await comLogs(() => tratarMensagem(RUN, PROJETO, m, REGRAS, deps, DOIS));
  assert.deepEqual(d.subidos, [PDF_A]);
  assert.deepEqual(d.pdfsLidos, [TAM_B]);
  assert.equal(r.situacao, 'tratado');
  assert.equal(r.deOutroProtocolo, 1);
});

test('E1b lacuna 2: só o arquivo de B num e-mail que cita A — sem_dono para A', async () => {
  const m = mensagem({ anexos: [anexo(PDF_B, 'application/pdf', TAM_B)] });
  const { deps, d } = dubles({ parecerDoPdf });
  const { r } = await comLogs(() => tratarMensagem(RUN, PROJETO, m, REGRAS, deps, DOIS));
  assert.equal(r.situacao, 'sem_dono');
  assert.deepEqual(d.subidos, []);
  assert.deepEqual(d.pdfsLidos, []);
  assert.equal(r.deOutroProtocolo, 1);
});

test('E1b: o caso normal de DOIS protocolos nossos NÃO dispara o contador (cada um vê o arquivo do outro)', async () => {
  // Contar aqui faria o contador subir justamente no fluxo que o E1 protege.
  const a = dubles({ parecerDoPdf });
  const ra = await comLogs(() => tratarMensagem(RUN, PROJETO, doisProtocolos(), REGRAS, a.deps, DOIS));
  const b = dubles({ parecerDoPdf });
  const rb = await comLogs(() => tratarMensagem(RUN, PROJETO_B, doisProtocolos(), REGRAS, b.deps, DOIS));
  assert.equal(ra.r.deOutroProtocolo, 0);
  assert.equal(rb.r.deOutroProtocolo, 0);
  assert.deepEqual(a.d.subidos, [PDF_A]);
  assert.deepEqual(b.d.subidos, [PDF_B]);
  assert.doesNotMatch(String(a.d.registros[0].motivo), /de outro protocolo/);
});

test('E1b: dois protocolos nossos e um arquivo com o de A MAIS um número estranho — ambíguo, não vai para A', async () => {
  const m = doisProtocolos({
    anexos: [anexo('PARECER_45006443920_45006449999.pdf', 'application/pdf', TAM_A), anexo(PDF_B, 'application/pdf', TAM_B)],
  });
  const { deps, d } = dubles({ parecerDoPdf });
  const { r } = await comLogs(() => tratarMensagem(RUN, PROJETO, m, REGRAS, deps, DOIS));
  assert.equal(r.situacao, 'sem_dono', 'nada neste e-mail é seguramente de A');
  assert.deepEqual(d.subidos, []);
  assert.equal(r.deOutroProtocolo, 1, 'só o que traz o número ESTRANHO conta; o de B é a divisão normal');
});

test('E1b: um protocolo, nome com o número deste MAIS o de outro — ambíguo, não anexa; o genérico segue', async () => {
  const m = mensagem({
    anexos: [anexo('PARECER_45006443920_45006449999.pdf', 'application/pdf', 900_000), anexo('parecer.pdf', 'application/pdf', 50_000)],
  });
  const { deps, d } = dubles();
  const { r } = await comLogs(() => tratarMensagem(RUN, PROJETO, m, REGRAS, deps, [PROJETO.protocolo]));
  assert.deepEqual(d.subidos, ['parecer.pdf']);
  assert.equal(r.deOutroProtocolo, 1);
});

test('E1b: conservador — data, carimbo de hora e CPF pontuado no nome NÃO são protocolo e não barram', async () => {
  // Falso positivo aqui deixaria um documento legítimo sem chegar ao card.
  const nomes = ['parecer_20261012.pdf', 'Scan_20261012153045.pdf', 'CPF 123.456.789-01.pdf', 'UC_4001234567.pdf', 'NF_12345678.pdf'];
  const m = mensagem({ anexos: nomes.map((n, i) => anexo(n, 'application/pdf', 1_000 + i)) });
  const { deps, d } = dubles();
  const { r } = await comLogs(() => tratarMensagem(RUN, PROJETO, m, REGRAS, deps, DOIS));
  assert.deepEqual(d.subidos, nomes);
  assert.equal(r.deOutroProtocolo, 0);
});

test('E1b: regra que não anexa nem lê não olha o nome — não bloqueia o que não depende de arquivo', async () => {
  const aviso = mensagem({
    assunto: 'AVISO DA EDP - NOTA 45006443920',
    anexos: [anexo(DE_NINGUEM, 'application/pdf', 1_000)],
  });
  const { deps, d } = dubles();
  const { r } = await comLogs(() => tratarMensagem(RUN, PROJETO, aviso, REGRAS, deps, DOIS));
  assert.equal(r.situacao, 'tratado');
  assert.equal(r.concluida, true);
  assert.equal(r.deOutroProtocolo, 0);
  assert.deepEqual(d.subidos, []);
});

test('E1b: regra que só LÊ (não anexa) também não lê o PDF de outro protocolo', async () => {
  const soLe: RegraEmail[] = [{ ...REGRAS[0], anexar: false, ler_pdf: true }];
  const m = mensagem({
    anexos: [anexo(DE_NINGUEM, 'application/pdf', 900_000), anexo('parecer.pdf', 'application/pdf', 50_000)],
  });
  const { deps, d } = dubles();
  await comLogs(() => tratarMensagem(RUN, PROJETO, m, soLe, deps, [PROJETO.protocolo]));
  assert.deepEqual(d.pdfsLidos, [50_000]);
  assert.deepEqual(d.subidos, []);
});

test('E1b: o descarte também aparece quando o titular bloqueia o resto', async () => {
  const outroTitular: ParecerLido = { ...PARECER_OK, titular: 'MIGUEL ARCANJO CORCINI' };
  const m = mensagem({
    anexos: [anexo(DE_NINGUEM, 'application/pdf', 900_000), anexo('parecer.pdf', 'application/pdf', 50_000)],
  });
  const { deps } = dubles({ parecer: outroTitular });
  const { r } = await comLogs(() => tratarMensagem(RUN, PROJETO, m, REGRAS, deps, [PROJETO.protocolo]));
  assert.equal(r.situacao, 'bloqueado');
  assert.equal(r.deOutroProtocolo, 1, 'a contagem não some só porque o resultado foi outro');
});

test('E1b: o log do descarte não leva nome de arquivo nem o número do outro protocolo', async () => {
  const m = mensagem({
    anexos: [anexo('PARECER_WERLHE_45006449999.pdf', 'application/pdf', 900_000), anexo('parecer.pdf', 'application/pdf', 50_000)],
  });
  const { deps } = dubles();
  const { logs } = await comLogs(() => tratarMensagem(RUN, PROJETO, m, REGRAS, deps, [PROJETO.protocolo]));
  assert.match(logs, /outro protocolo/, 'o descarte TEM de deixar rastro');
  assert.match(logs, /"de_outro_protocolo":1/);
  assert.doesNotMatch(logs, /WERLHE|45006449999|PARECER_/i, 'o número é de outro cliente');
});

test('E1b: sobra só xlsx e o único PDF é de outro protocolo — a ressalva não diz "não trouxe PDF"', async () => {
  const m = mensagem({
    anexos: [anexo(DE_NINGUEM, 'application/pdf', 900_000),
      anexo('planilha.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 30_000)],
  });
  const { deps, d } = dubles();
  const { r } = await comLogs(() => tratarMensagem(RUN, PROJETO, m, REGRAS, deps, [PROJETO.protocolo]));
  assert.equal(r.situacao, 'tratado');
  assert.deepEqual(d.subidos, ['planilha.xlsx']);
  assert.deepEqual(d.pdfsLidos, [], 'o único PDF é de outro protocolo: não se lê');
  assert.match(String(d.registros[0].motivo), /nenhum PDF do e-mail é deste protocolo/);
  assert.doesNotMatch(String(d.registros[0].motivo), /não trouxe PDF/, 'trouxe, só que de outro protocolo');
});

// A conta do run: o contador que o tratamento calcula só existe para a pessoa se
// for somado e chegar ao `resultado` — e o laço que faz isso precisa de IMAP.

const tratamentoDe = (over: Partial<Tratamento> = {}): Tratamento => ({
  situacao: 'tratado', anexados: 0, imagensIgnoradas: 0, recusados: 0, semNome: 0, deOutroProtocolo: 0, concluida: true, ...over,
});

test('E1b: o contador de arquivos de outro protocolo é somado e chega ao resultado, à parte do sem_dono', () => {
  const n = contaZerada();
  somarTratamento(n, tratamentoDe({ situacao: 'tratado', anexados: 1, deOutroProtocolo: 2 }));
  somarTratamento(n, tratamentoDe({ situacao: 'sem_dono', deOutroProtocolo: 1 }));
  somarTratamento(n, tratamentoDe({ situacao: 'bloqueado', deOutroProtocolo: 1 }));
  somarTratamento(n, tratamentoDe({ situacao: 'tratado' }));
  const res = resultadoDoRun(n, 80, 0);
  assert.equal(res.anexos_de_outro_protocolo, 4, 'arquivos, somados de todas as situações');
  assert.equal(res.sem_dono, 1, 'mensagens: só a que ficou sem dono');
  assert.equal(res.tratados, 2);
  assert.equal(res.bloqueados, 1);
  assert.equal(res.anexados, 1);
});

test('o resultado do run mantém TODAS as chaves de antes (a extração não perdeu nenhuma) e soma cada contador', () => {
  const n = contaZerada();
  n.lidos = 9; n.pulados = 3; n.descartados = 2; n.naoLidas = 1; n.falhasBusca = 1; n.falhasTratamento = 2;
  somarTratamento(n, tratamentoDe({ situacao: 'ignorado', imagensIgnoradas: 4, recusados: 2, semNome: 1, concluida: false }));
  const res = resultadoDoRun(n, 80, 3);
  assert.deepEqual(Object.keys(res).sort(), [
    'a_tentar_de_novo', 'anexados', 'anexos_de_outro_protocolo', 'anexos_recusados', 'anexos_sem_nome',
    'bloqueados', 'descartados', 'falhas', 'falhas_busca', 'falhas_tratamento', 'ignorados',
    'imagens_ignoradas', 'lidos', 'nao_lidas', 'protocolos', 'pulados', 'sem_dono', 'tratados',
  ]);
  assert.deepEqual(res, {
    a_tentar_de_novo: 1, anexados: 0, anexos_de_outro_protocolo: 0, anexos_recusados: 2, anexos_sem_nome: 1,
    bloqueados: 0, descartados: 2, falhas: 3, falhas_busca: 1, falhas_tratamento: 2, ignorados: 1,
    imagens_ignoradas: 4, lidos: 9, nao_lidas: 1, protocolos: 80, pulados: 3, sem_dono: 0, tratados: 0,
  });
});

// ── E2: o que o bucket aceita ────────────────────────────────────────────────
// Antes, TODO anexo não-imagem era enviado, e o storage recusava o que o bucket
// não aceita: o .p7s (assinatura digital, comum em parecer) virava `anexoFalhou`,
// a mensagem ficava pendente, e a cada run a IA relia o MESMO PDF já lido — até
// 5 leituras pagas — e depois a mensagem era abandonada no teto.

test('E2: parecer.pdf + parecer.p7s — o p7s é IGNORADO, não falhado, e a mensagem conclui', async () => {
  const comAssinatura = mensagem({
    anexos: [anexo('parecer.pdf', 'application/pdf'), anexo('parecer.p7s', 'application/pkcs7-signature', 3_000)],
  });
  const { deps, d } = dubles({ storageRecusa: ['parecer.p7s'] });
  const { r } = await comLogs(() => tratarMensagem(RUN, PROJETO, comAssinatura, REGRAS, deps));
  assert.equal(r.concluida, true, 'sem isto a IA relia o PDF a cada run');
  assert.equal(r.anexados, 1);
  assert.equal(r.recusados, 1);
  assert.deepEqual(d.anexosPedidos, ['parecer.pdf'], 'a linha do p7s nem é aberta');
  assert.deepEqual(d.marcadosComErro, [], 'ignorado não é falha');
  assert.equal(d.registros[0].concluida, true);
  assert.deepEqual(d.pdfsLidos, [1000], 'uma leitura só');
  assert.match(String(d.registros[0].motivo), /1 arquivo\(s\)/);
  assert.match(String(d.registros[0].motivo), /parecer\.p7s/, 'o nome fica no banco, que é de onde a tela lê');
  assert.match(String(d.registros[0].motivo), /tipo/);
});

test('E2: PDF acima de 10 MB é recusado por tamanho, e a mensagem conclui', async () => {
  const grande = mensagem({ anexos: [anexo('parecer.pdf', 'application/pdf', 10 * 1024 * 1024 + 1)] });
  const { deps, d } = dubles();
  const { r } = await comLogs(() => tratarMensagem(RUN, PROJETO, grande, REGRAS, deps));
  assert.equal(r.anexados, 0);
  assert.equal(r.recusados, 1);
  assert.equal(r.concluida, true);
  assert.deepEqual(d.anexosPedidos, []);
  assert.match(String(d.registros[0].motivo), /10 MB/);
});

test('E2: PDF de mime genérico sobe com o mime que o bucket conhece', async () => {
  // octet-stream no storage é recusado: sem isto o PDF ficava em retentativa.
  const m = mensagem({ anexos: [anexo('parecer.pdf', 'application/octet-stream')] });
  const { deps, d } = dubles();
  const { r } = await comLogs(() => tratarMensagem(RUN, PROJETO, m, REGRAS, deps));
  assert.equal(r.anexados, 1);
  assert.deepEqual(d.mimesSubidos, ['application/pdf']);
});

test('E2: regra que não anexa não conta recusado — não foi o bucket que impediu', async () => {
  const m = mensagem({
    assunto: 'AVISO DA EDP - NOTA 45006443920',
    anexos: [anexo('parecer.p7s', 'application/pkcs7-signature')],
  });
  const { deps } = dubles();
  const { r } = await comLogs(() => tratarMensagem(RUN, PROJETO, m, REGRAS, deps));
  assert.equal(r.recusados, 0);
});

test('E2: o log do arquivo recusado não leva o nome (que às vezes traz o titular)', async () => {
  const m = mensagem({
    anexos: [anexo('parecer.pdf', 'application/pdf'), anexo('ASSINATURA_WERLHE_DE_ARAUJO_LIMA.p7s', 'application/pkcs7-signature')],
  });
  const { deps } = dubles();
  const { logs } = await comLogs(() => tratarMensagem(RUN, PROJETO, m, REGRAS, deps));
  assert.match(logs, /não aceita/);
  assert.match(logs, /"recusados":1/);
  assert.doesNotMatch(logs, /WERLHE|ARAUJO/i);
  assert.doesNotMatch(logs, /\.p7s/i);
});

// ── E5: dois anexos de MESMO nome, e o log que dizia mentira ────────────────

test('E5: dois anexos de mesmo nome na mesma mensagem viram DOIS anexos, com chaves diferentes', async () => {
  const dupla = mensagem({
    anexos: [anexo('parecer.pdf', 'application/pdf', 1_000), anexo('parecer.pdf', 'application/pdf', 2_000)],
  });
  const { deps, d } = dubles();
  const { r } = await comLogs(() => tratarMensagem(RUN, PROJETO, dupla, REGRAS, deps));
  assert.deepEqual(d.ocorrenciasPedidas, [1, 2]);
  assert.equal(new Set(d.chavesPedidas).size, 2, 'o segundo não pode colidir com o primeiro e sumir');
  assert.deepEqual(d.chavesPedidas, ['<abc-123@edp.com.br>#045006443920#parecer.pdf', '<abc-123@edp.com.br>#045006443920#parecer.pdf#2']);
  assert.equal(r.anexados, 2);
  assert.equal(d.subidos.length, 2);
});

test('E5: a ocorrência é contada na mensagem inteira — a imagem de mesmo nome não desloca o índice', async () => {
  // O índice tem de ser o mesmo em todo run para a retentativa retomar a MESMA
  // linha: contar só os anexos que sobraram dos filtros o faria depender deles.
  const m = mensagem({
    anexos: [anexo('parecer.pdf', 'image/png', 10), anexo('parecer.pdf', 'application/pdf', 1_000)],
  });
  const { deps, d } = dubles();
  await comLogs(() => tratarMensagem(RUN, PROJETO, m, REGRAS, deps));
  assert.deepEqual(d.ocorrenciasPedidas, [2]);
});

test('E5: "já resolvido" e "projeto não existe" têm logs diferentes, e cada um diz a verdade', async () => {
  const resolvido = dubles({ jaResolvidos: ['parecer.pdf'] });
  const lr = await comLogs(() => tratarMensagem(RUN, PROJETO, mensagem(), REGRAS, resolvido.deps));
  assert.match(lr.logs, /já estava resolvido/);
  assert.doesNotMatch(lr.logs, /não existe/);

  const sumiu = dubles({ projetoInexistente: true });
  const ls = await comLogs(() => tratarMensagem(RUN, PROJETO, mensagem(), REGRAS, sumiu.deps));
  assert.match(ls.logs, /projeto.*não existe/);
  assert.doesNotMatch(ls.logs, /já estava resolvido/, 'não dizer "resolvido no card" de projeto que nem existe');
  assert.deepEqual(sumiu.d.subidos, []);
});

// ── E6: anexo sem nome ──────────────────────────────────────────────────────

test('E6: anexo sem nome vira ressalva e contador, mesmo em regra que não lê PDF', async () => {
  const carta = mensagem({
    assunto: 'EDP - CARTA DE OBRAS 45006443920',
    anexos: [anexo('carta.pdf', 'application/pdf')],
    anexosSemNome: 2,
  });
  const { deps, d } = dubles();
  const { r } = await comLogs(() => tratarMensagem(RUN, PROJETO, carta, REGRAS, deps));
  assert.equal(r.semNome, 2);
  assert.match(String(d.registros[0].motivo), /2 anexo\(s\) sem nome de arquivo/);
  assert.equal(r.concluida, true, 'é descarte conhecido, não falha passageira');
});

test('E6: sem anexo sem nome, o contador é zero e não há ressalva', async () => {
  const { deps, d } = dubles();
  const { r } = await comLogs(() => tratarMensagem(RUN, PROJETO, mensagem(), REGRAS, deps));
  assert.equal(r.semNome, 0);
  assert.equal(d.registros[0].motivo, null);
});

// ── D7: a triagem, sem IMAP e sem banco ───────────────────────────────────

const envelope = (over: Partial<EnvelopeLido> = {}): EnvelopeLido => ({
  uid: 1,
  messageId: '<um@edp.com.br>',
  assunto: 'ENVIO DE PARECER - NOTA 45006443920',
  recebidoEm: new Date('2026-09-10T12:12:00Z'),
  ...over,
});

const ALVO = { codigo: PROJETO.codigo, protocolo: PROJETO.protocolo };

test('triagem: aprova o que tem o protocolo no assunto e está pendente', async () => {
  const { r } = await comLogs(() => triar([envelope()], ALVO, async () => true));
  assert.deepEqual([...r.aprovados.keys()], [1]);
  assert.equal(r.descartados, 0);
  assert.equal(r.pulados, 0);
  assert.equal(r.falhasTratamento, 0);
});

test('triagem: protocolo só no CORPO é descartado (a busca do IMAP acha no corpo)', async () => {
  const { r, logs } = await comLogs(() => triar(
    [envelope({ uid: 2, assunto: 'Comunicado geral da EDP' })], ALVO, async () => true));
  assert.equal(r.aprovados.size, 0);
  assert.equal(r.descartados, 1);
  assert.match(logs, /não está no assunto/);
  assert.doesNotMatch(logs, /Comunicado geral/, 'o assunto é dado do cliente');
});

test('triagem: mensagem já concluída é pulada, com aviso no log', async () => {
  const { r, logs } = await comLogs(() => triar([envelope({ uid: 3 })], ALVO, async () => false));
  assert.equal(r.aprovados.size, 0);
  assert.equal(r.pulados, 1);
  assert.match(logs, /pulei sem baixar/);
});

test('triagem: consulta de pendência que falha é FALHA DE TRATAMENTO, e não derruba os outros', async () => {
  const envelopes = [envelope({ uid: 4, messageId: '<a@edp>' }), envelope({ uid: 5, messageId: '<b@edp>' })];
  const { r, logs } = await comLogs(() => triar(envelopes, ALVO, async id => {
    if (id === '<a@edp>') throw new Error('canceling statement due to statement timeout');
    return true;
  }));
  assert.equal(r.falhasTratamento, 1);
  assert.deepEqual([...r.aprovados.keys()], [5], 'o outro envelope segue o caminho normal');
  assert.match(logs, /não consegui conferir se esta mensagem já foi tratada/);
});
