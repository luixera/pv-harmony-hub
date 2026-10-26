// worker/ludmilla/test/enel-run.test.ts
// O tratamento de UMA mensagem da ENEL, com dependências falsas que GRAVAM o que
// foi chamado. Cada caso afirma as chamadas e o retorno. Nomes, UCs, NTs e
// endereços são 100% inventados.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  contaEnelZerada, resultadoEnel, somarEnel, tratarMensagemEnel, type DepsEnel, type ParecerEnel, type TratamentoEnel,
} from '../src/email/enel/run.js';
import { referenciaDoProjeto, type ProjetoEnel } from '../src/email/enel/identificar.js';
import type { MensagemLida } from '../src/email/caixa.js';
import { idArquivoDeEmail, type RegraEmail } from '../src/email/util.js';
import type { AberturaDeAnexo, AvisoEmail, EmailLido, Run, TentativaEmail } from '../src/fila.js';

const RUN: Run = { id: 'run-t6', tenant_id: 'tenant-t6', account_id: 'conta-enel', tipo: 'varredura_email', situacao: 'rodando' };

const regra = (remetente: string, tipo: string, anexar: boolean, ler: boolean): RegraEmail =>
  ({ id: `r-${remetente}`, remetente, assunto: '', tipo_documento: tipo, anexar, ler_pdf: ler });
const REGRAS: RegraEmail[] = [
  regra('nao.responda@enel.com', 'carta_projeto', true, true),
  regra('tecnico.abc@enel.com', 'resultado_vistoria', true, true),
  regra('canalgd.sp@br.enel.com', 'troca_relogio', true, true),
  regra('no-reply@enel.com', 'resposta_automatica', false, false),
  regra('postmaster@enel.com', 'devolucao', false, false),
  regra('atendimento.edsp@enel.com', 'resultado_vistoria', true, false),
  regra('avisos.gerais@enel.test', 'comunicado', false, false),
];

const projeto = (o: Partial<ProjetoEnel> & { codigo: string }): ProjetoEnel => ({
  project_id: `id-${o.codigo}`, company_id: 'empresa-t6', protocolo: null, uc: null, titular: null,
  status: 'analysis', ativo: true, ...o,
});
const PA = projeto({ codigo: 'GD-T6-001', protocolo: '391000010', uc: '0055001001', titular: 'ODALIRIO PRATES VENTURIM' });
const PB = projeto({ codigo: 'GD-T6-002', protocolo: '391000020', uc: '0055002002', titular: 'GILVANETE SOARES QUINTILHO' });
const PC = projeto({ codigo: 'GD-T6-003', protocolo: 'Sem protocolo', uc: '0077001122', titular: 'ELIZEU MANTOVANI BRASILINO' });
const PI = projeto({ codigo: 'GD-T6-005', protocolo: '391000050', uc: '0055005005', titular: 'ARLINDA CORDEIRO VIEGAS', status: 'completed', ativo: false });
const PROJETOS = [PA, PB, PC, PI];

const pdf = (nome = 'CARTA.pdf', tamanho = 100) => ({ nome, mime: 'application/pdf', bytes: Buffer.alloc(tamanho, 1) });

const mensagem = (o: Partial<MensagemLida> = {}): MensagemLida => ({
  uid: 1, messageId: '<t6-1@enel.test>', assunto: 'Geração Distribuída – Carta',
  remetente: 'ENEL <nao.responda@enel.com>', recebidoEm: new Date('2026-10-10T12:00:00Z'),
  texto: '', anexos: [pdf()], anexosSemNome: 0, ...o,
});

const carta = (o: Partial<ParecerEnel> = {}): ParecerEnel => ({
  ok: true, veredito: 'favoravel', resumo: 'Projeto aprovado.', pendencias: [], titular: PA.titular,
  endereco: null, tipo: 'carta_projeto', nt: PA.protocolo, uc: null, erro: null, ...o,
});

interface Diario {
  ordem: string[];
  tentativas: TentativaEmail[];
  registros: EmailLido[];
  /** o 8º argumento de anexoDeEmail: a CHAVE do anexo (só a chave; nunca aparece na tela) */
  chavesDoAnexo: (string | undefined)[];
  /** o 2º argumento de anexoDeEmail: o protocolo, que é o TEXTO do comentário do card */
  protocolosDoAnexo: string[];
  anexosPedidos: string[];
  subidos: string[];
  errosDeAnexo: string[];
  avisos: AvisoEmail[];
  leituras: number;
}

/**
 * `banco`: as linhas de anexo por `id_arquivo`, com a MESMA regra da RPC
 * (`coalesce(nullif(p_chave, ''), p_protocolo)` na chave; linha `enviado` responde
 * `ja_resolvido`). Passe o mesmo Map em dois tratamentos para simular a 2ª leitura.
 */
function dubles(o: {
  parecer?: ParecerEnel; storageRecusa?: string; anexoRetorna?: AberturaDeAnexo['situacao']; avisoFalha?: boolean;
  banco?: Map<string, 'pendente' | 'enviado'>;
} = {}): { deps: DepsEnel; d: Diario } {
  const d: Diario = { ordem: [], tentativas: [], registros: [], chavesDoAnexo: [], protocolosDoAnexo: [], anexosPedidos: [], subidos: [], errosDeAnexo: [], avisos: [], leituras: 0 };
  const banco = o.banco ?? new Map<string, 'pendente' | 'enviado'>();
  const deps: DepsEnel = {
    async abrirTentativa(p) { d.ordem.push('abrirTentativa'); d.tentativas.push(p); return d.tentativas.length; },
    async anexoDeEmail(_conta, protocolo, projectId, msg, nome, _conferido, ocorrencia = 1, chave): Promise<AberturaDeAnexo> {
      d.ordem.push('anexoDeEmail'); d.chavesDoAnexo.push(chave); d.protocolosDoAnexo.push(protocolo); d.anexosPedidos.push(nome);
      if (o.anexoRetorna === 'ja_resolvido') return { situacao: 'ja_resolvido' };
      const idArquivo = idArquivoDeEmail(msg, chave || protocolo, nome, ocorrencia);
      if (banco.get(idArquivo) === 'enviado') return { situacao: 'ja_resolvido' };
      banco.set(idArquivo, 'pendente');
      return {
        situacao: 'aberto',
        anexo: { id: idArquivo, project_id: projectId, company_id: 'empresa-t6', protocolo, id_arquivo: idArquivo, nome_arquivo: nome, codigo: '' },
      };
    },
    async subirDocumento(a) {
      d.ordem.push('subirDocumento');
      if (o.storageRecusa) throw new Error(o.storageRecusa);
      d.subidos.push(a.nome_arquivo);
      return `caminho/${a.nome_arquivo}`;
    },
    async anexoEnviado(id) { d.ordem.push('anexoEnviado'); banco.set(id, 'enviado'); },
    async anexoErro(_id, motivo) { d.ordem.push('anexoErro'); d.errosDeAnexo.push(motivo); },
    async registrarEmailLido(p) { d.ordem.push('registrarEmailLido'); d.registros.push(p); },
    async avisar(p) {
      d.ordem.push('avisar');
      if (o.avisoFalha) throw new Error('Não consegui avisar a equipe: tempo esgotado');
      d.avisos.push(p);
      return 1;
    },
    async lerParecer() { d.ordem.push('lerParecer'); d.leituras++; return o.parecer ?? carta(); },
  };
  return { deps, d };
}

/** Roda com o console capturado: cala o teste e deixa PROVAR o que vai para o log. */
async function comLogs<T>(f: () => Promise<T>): Promise<{ r: T; logs: string }> {
  const original = console.log;
  const linhas: string[] = [];
  console.log = (linha?: unknown) => { linhas.push(String(linha)); };
  try { return { r: await f(), logs: linhas.join('\n') }; } finally { console.log = original; }
}

/**
 * O "agora" dos testes é FIXO: o sino só toca para e-mail de até 30 dias, e com o
 * relógio real os e-mails de 10/10 envelheceriam e os testes quebrariam sozinhos.
 */
const AGORA = new Date('2026-10-24T12:00:00Z');
const haDias = (dias: number): Date => new Date(AGORA.getTime() - dias * 86_400_000);

const tratar = async (m: MensagemLida, deps: DepsEnel, projetos = PROJETOS) =>
  (await comLogs(() => tratarMensagemEnel(RUN, m, REGRAS, projetos, deps, AGORA))).r;

const unico = (d: Diario): EmailLido => { assert.equal(d.registros.length, 1); return d.registros[0]; };

// ── 1. Carta ─────────────────────────────────────────────────────────────────

test('1. Carta (corpo vazio, PDF): conta a tentativa ANTES da IA, anexa, sugere Aprovado e abre o cartão', async () => {
  const { deps, d } = dubles();
  const r = await tratar(mensagem(), deps);
  assert.equal(r.situacao, 'tratado');
  assert.equal(r.por, 'protocolo');
  assert.ok(d.ordem.indexOf('abrirTentativa') < d.ordem.indexOf('lerParecer'), 'a tentativa é contada antes de pagar a IA');
  assert.equal(d.tentativas[0].protocolo, '');
  assert.equal(d.subidos.length, 1);
  const reg = unico(d);
  assert.equal(reg.protocolo, '');
  assert.equal(reg.referencia, '391000010');
  assert.equal(reg.casamento, 'protocolo');
  assert.equal(reg.recomendacao, 'approved');
  assert.equal(reg.abrirCartao, true);
  assert.equal(reg.concluida, true);
  assert.equal(reg.projectId, PA.project_id);
  assert.equal(reg.arquivoLido, 'CARTA.pdf');
});

test('2. Carta de projeto já em vistoria (com a NT no cadastro): anexa, NÃO sugere voltar, sem cartão', async () => {
  const pv = { ...PA, status: 'vistoria_solicitada' };
  const { deps, d } = dubles();
  const r = await tratar(mensagem(), deps, [pv, PB]);
  assert.equal(r.situacao, 'tratado');
  assert.equal(d.subidos.length, 1);
  const reg = unico(d);
  assert.equal(reg.recomendacao, null);
  assert.equal(reg.abrirCartao, false);
  assert.match(String(reg.motivo), /já está à frente/);
  assert.equal('atualizarProtocolo' in reg, false);
});

// ── 3–5. o corpo resolve, sem IA ─────────────────────────────────────────────

test('3. vistoria aprovada no corpo: sem IA, 1 aviso, sem etapa, anotação no motivo', async () => {
  const { deps, d } = dubles();
  const r = await tratar(mensagem({
    remetente: 'Técnico ABC <tecnico.abc@enel.com>', assunto: 'RE: VISTORIA GD - NT 391000010',
    texto: 'Prezado(a) Senhor(a), Informamos que após realização da vistoria através de relatorio fotográfico, a vistoria do sistema de microgeração fotovoltaica está APROVADA. Atenciosamente',
    anexos: [pdf('RELATORIO.pdf')],
  }), deps);
  assert.equal(r.situacao, 'tratado');
  assert.equal(d.leituras, 0, 'o corpo resolveu: não paga IA');
  assert.equal(d.avisos.length, 1);
  assert.match(d.avisos[0].titulo, /Vistoria virtual aprovada/);
  const reg = unico(d);
  assert.equal(reg.recomendacao, null);
  assert.equal(reg.abrirCartao, false);
  assert.match(String(reg.motivo), /vistoria virtual aprovada — falta a troca do relógio/);
  assert.equal(reg.arquivoLido, null, 'a IA não leu o PDF: não há arquivo lido');
});

test('4. troca que não foi executada: sem IA, 1 aviso com o motivo', async () => {
  const { deps, d } = dubles();
  await tratar(mensagem({
    remetente: 'Canal GD <canalgd.sp@br.enel.com>', assunto: 'RE: TROCA DE RELÓGIO - NT 391000010',
    texto: 'Prezado(a), bom dia! Identificamos que a tentativa de troca do medidor no dia 15/09 , não foi executada pelo seguinte motivo: Cliente Não Permitiu Execução. Atenciosamente',
    anexos: [],
  }), deps);
  assert.equal(d.leituras, 0);
  assert.equal(d.avisos.length, 1);
  assert.match(d.avisos[0].mensagem, /Cliente Não Permitiu Execução/);
  assert.equal(d.avisos[0].projectId, PA.project_id);
});

test('5. troca agendada: sem IA, sem aviso, sem cartão; o prazo vai no motivo', async () => {
  const { deps, d } = dubles();
  await tratar(mensagem({
    remetente: 'Canal GD <canalgd.sp@br.enel.com>', assunto: 'RE: TROCA DE RELÓGIO - NT 391000010',
    texto: 'Prezado, boa tarde! Nota de serviço criada 400012345678 , na data de 01/10/2026 , referente a instalação 2222222222 , para a troca do medidor bidirecional, com o prazo de execução de até 7 dias úteis. Atenciosamente',
    anexos: [],
  }), deps);
  assert.equal(d.leituras, 0);
  assert.equal(d.avisos.length, 0);
  const reg = unico(d);
  assert.equal(reg.abrirCartao, false);
  assert.match(String(reg.motivo), /prazo de até 7 dias úteis/);
});

// ── 6–8. sem projeto certo ───────────────────────────────────────────────────

test('6. sem identificação e sem PDF: nao_identificado, concluída, nada anexado, sem IA', async () => {
  const { deps, d } = dubles();
  const r = await tratar(mensagem({ anexos: [] }), deps);
  assert.equal(r.situacao, 'nao_identificado');
  assert.equal(r.concluida, true);
  assert.equal(d.leituras, 0);
  assert.equal(d.anexosPedidos.length, 0);
  const reg = unico(d);
  assert.equal(reg.projectId, null);
  assert.equal(reg.concluida, true);
});

test('7. sem identificação no texto e a IA falha: nao_identificado e NÃO concluída (tenta de novo)', async () => {
  const { deps, d } = dubles({ parecer: { ...carta(), ok: false, veredito: null, titular: null, nt: null, tipo: null, erro: 'a leitura do documento respondeu 503' } });
  const r = await tratar(mensagem(), deps);
  assert.equal(r.situacao, 'nao_identificado');
  assert.equal(r.concluida, false);
  assert.equal(unico(d).concluida, false);
  assert.equal(d.anexosPedidos.length, 0);
});

test('8. o texto aponta A e o documento aponta B: conflito, nada anexado', async () => {
  const { deps, d } = dubles({ parecer: carta({ nt: PB.protocolo, titular: PB.titular }) });
  const r = await tratar(mensagem({ assunto: 'Geração Distribuída – Carta – NT 391000010' }), deps);
  assert.equal(r.situacao, 'conflito');
  assert.equal(d.anexosPedidos.length, 0);
  assert.equal(unico(d).projectId, null);
});

// ── 9–10. o documento é de outra pessoa / de outro projeto ───────────────────

test('9. titular do documento é OUTRA pessoa: bloqueado, nada anexado, cartão aberto', async () => {
  const { deps, d } = dubles({ parecer: carta({ titular: 'HERMINIO TAVARES BRANDALISE' }) });
  const r = await tratar(mensagem(), deps);
  assert.equal(r.situacao, 'bloqueado');
  assert.equal(d.anexosPedidos.length, 0);
  const reg = unico(d);
  assert.equal(reg.abrirCartao, true);
  assert.equal(reg.recomendacao, null);
  assert.equal('atualizarProtocolo' in reg, false);
  assert.equal(reg.concluida, true, 'bloqueio é definitivo: não paga a IA de novo a cada run');
});

// Fechamento A · I-1: o veredito e o resumo são do documento de OUTRA pessoa. O banco
// escreve o veredito no cartão e no sino ("CARTA_PROJETO · FAVORAVEL"); o projeto nem é dele.
test('I-1. bloqueio: o veredito e o resumo do documento de outra pessoa não vão para o cartão', async () => {
  const { deps, d } = dubles({ parecer: carta({ titular: 'HERMINIO TAVARES BRANDALISE', veredito: 'favoravel', resumo: 'Projeto aprovado.' }) });
  const r = await tratar(mensagem(), deps);
  assert.equal(r.situacao, 'bloqueado');
  const reg = unico(d);
  assert.equal(reg.veredito, null);
  assert.equal(reg.resumo, null);
  // o resto do bloqueio segue: o motivo com os dois nomes, o arquivo lido, o cartão aberto
  assert.match(String(reg.motivo), /não anexei · o documento é de "HERMINIO TAVARES BRANDALISE"/);
  assert.equal(reg.arquivoLido, 'CARTA.pdf');
  assert.equal(reg.abrirCartao, true);
  assert.equal(reg.tipoDocumento, 'carta_projeto');
});

test('10. arquivo com a NT de B ao tratar A: não vai para o card de A', async () => {
  const { deps, d } = dubles();
  const r = await tratar(mensagem({ anexos: [pdf('CARTA.pdf', 200), pdf('NT_391000020.pdf', 50)] }), deps);
  assert.equal(r.situacao, 'tratado');
  assert.deepEqual(d.anexosPedidos, ['CARTA.pdf']);
  assert.equal(r.deOutroProjeto, 1);
  assert.match(String(unico(d).motivo), /número de outro projeto/);
});

// ── 11–14. resposta automática, devolução, comunicado, projeto concluído ─────

test('11. resposta automática (no-reply) com a NT no assunto: tratado, sem IA, sem anexo, sem cartão', async () => {
  const { deps, d } = dubles();
  const r = await tratar(mensagem({
    remetente: 'ENEL <no-reply@enel.com>', assunto: 'Recebemos sua mensagem - NT 391000010',
    texto: 'Olá, Informamos que seu e-mail foi recebido com sucesso, gerando o número de atendimento SF0123456789',
  }), deps);
  assert.equal(r.situacao, 'tratado');
  assert.equal(d.leituras, 0);
  assert.equal(d.anexosPedidos.length, 0);
  assert.equal(unico(d).abrirCartao, false);
});

test('12. devolução (postmaster) sem projeto: 1 aviso, sem projeto', async () => {
  const { deps, d } = dubles();
  const r = await tratar(mensagem({ remetente: 'postmaster@enel.com', assunto: 'Undeliverable: pedido de vistoria', anexos: [] }), deps);
  assert.equal(r.situacao, 'nao_identificado');
  assert.equal(d.avisos.length, 1);
  assert.equal(d.avisos[0].projectId, null);
});

test('13. comunicado a todos: ignorado e concluído', async () => {
  const { deps, d } = dubles();
  const r = await tratar(mensagem({ remetente: 'avisos.gerais@enel.test', assunto: 'Comunicado geral' }), deps);
  assert.equal(r.situacao, 'ignorado');
  assert.equal(r.concluida, true);
  assert.equal(d.leituras, 0);
  assert.equal(unico(d).concluida, true);
});

test('14. a NT é de projeto concluído: inativo, nada anexado', async () => {
  const { deps, d } = dubles();
  const r = await tratar(mensagem({
    remetente: 'Canal GD <canalgd.sp@br.enel.com>', assunto: 'RE: TROCA DE RELÓGIO - NT 391000050', texto: 'Prezados, segue.',
  }), deps);
  assert.equal(r.situacao, 'inativo');
  assert.equal(d.anexosPedidos.length, 0);
  assert.equal(unico(d).projectId, null);
});

// ── 15. privacidade ──────────────────────────────────────────────────────────

test('15. privacidade: titular, nome de arquivo e assunto vão para o BANCO, nunca para o log', async () => {
  const assunto = 'TROCA DE RELÓGIO - ODALIRIO PRATES VENTURIM - NT 391000010';
  // bloqueio por titular
  const b = dubles({ parecer: carta({ titular: 'HERMINIO TAVARES BRANDALISE' }) });
  const bloqueio = await comLogs(() => tratarMensagemEnel(RUN, mensagem({ assunto }), REGRAS, PROJETOS, b.deps));
  assert.equal(bloqueio.r.situacao, 'bloqueado');
  for (const proibido of ['HERMINIO', 'BRANDALISE', 'ODALIRIO', 'VENTURIM', '.pdf', 'TROCA DE REL']) {
    assert.ok(!bloqueio.logs.includes(proibido), `"${proibido}" não pode ir para o log`);
  }
  assert.match(String(b.d.registros[0].motivo), /HERMINIO TAVARES BRANDALISE/);
  assert.match(String(b.d.registros[0].motivo), /ODALIRIO PRATES VENTURIM/);

  // anexo que falha com a mensagem crua do storage (traz o caminho e o nome)
  const nome = 'PARECER_ODALIRIO_PRATES_VENTURIM.pdf';
  const crua = `Não consegui guardar o anexo no projeto: Invalid key: empresa-t6/id-GD-T6-001/other_photos/1760000000000_${nome}`;
  const f = dubles({ storageRecusa: crua });
  const falha = await comLogs(() => tratarMensagemEnel(RUN, mensagem({ assunto, anexos: [pdf(nome)] }), REGRAS, PROJETOS, f.deps));
  assert.equal(falha.r.situacao, 'tratado');
  assert.equal(falha.r.concluida, false, 'anexo que falhou deixa a mensagem para outra tentativa');
  for (const proibido of ['ODALIRIO', 'PRATES', 'VENTURIM', '.pdf', 'TROCA DE REL', 'Invalid key']) {
    assert.ok(!falha.logs.includes(proibido), `"${proibido}" não pode ir para o log`);
  }
  assert.match(falha.logs, /o storage recusou o nome do arquivo/);
  assert.equal(f.d.errosDeAnexo[0], crua, 'o texto completo vai para a linha do anexo, no banco');
  assert.equal(f.d.registros[0].assunto, assunto);
});

// ── 16–18. R3: a NT da Carta vira protocolo ──────────────────────────────────

test('16. Carta sem nada no texto, projeto achado pela UC e sem protocolo: sugere gravar a NT; a chave do anexo NÃO muda', async () => {
  const { deps, d } = dubles({ parecer: carta({ nt: '391000001', uc: '77001122', titular: PC.titular }) });
  const r = await tratar(mensagem({ assunto: 'Geração Distribuída – Carta', texto: '' }), deps);
  assert.equal(r.situacao, 'tratado');
  assert.equal(r.por, 'uc');
  assert.equal(d.subidos.length, 1);
  // M-7: a CHAVE é o project_id (nunca muda, nunca aparece); o TEXTO do comentário é a NT da Carta
  assert.deepEqual(d.chavesDoAnexo, [PC.project_id]);
  assert.deepEqual(d.protocolosDoAnexo, ['391000001'], 'o comentário diz "para o protocolo 391000001", não o código');
  const reg = unico(d);
  assert.equal(reg.referencia, '391000001');
  assert.equal(reg.atualizarProtocolo, true);
  assert.equal(reg.recomendacao, 'approved');
  assert.equal(reg.abrirCartao, true);
  assert.equal(reg.casamento, 'uc');
  assert.match(String(reg.motivo), /a Carta traz a NT 391000001; o cadastro tem nenhum — o cartão sugere gravar a NT/);
});

// Fechamento A · I-2: com a IA fora, a trava do titular não roda — o anexo ESPERA a leitura.
// Antes, a 1ª tentativa subia o documento só pelo texto e a 2ª o achava `enviado`: a trava
// nunca rodava para ele. Agora a 1ª não anexa; a 2ª (a IA voltou) confere e anexa uma vez.
test('16b. a 2ª tentativa da mesma Carta (a IA voltou e leu a NT): só ela anexa, uma vez; a 3ª não sobe de novo', async () => {
  const banco = new Map<string, 'pendente' | 'enviado'>();
  // 1ª: a IA falhou; o projeto foi achado pela UC no assunto — o anexo espera a leitura
  const um = dubles({ banco, parecer: { ...carta(), ok: false, veredito: null, titular: null, nt: null, tipo: null, erro: 'a leitura do documento respondeu 503' } });
  const m = mensagem({ assunto: 'Geração Distribuída – Carta – Instalação 77001122' });
  const r1 = await tratar(m, um.deps);
  assert.equal(r1.concluida, false);
  assert.equal(um.d.registros[0].atualizarProtocolo, undefined);
  assert.equal(um.d.anexosPedidos.length, 0, 'sem a leitura, a trava do titular não rodou: nada vai para o card');
  assert.match(String(um.d.registros[0].motivo), /não anexei ainda: preciso ler o documento para conferir o titular/);
  // 2ª: a IA voltou e leu a NT — anexa agora, com a chave de sempre e o texto da NT
  const leitura = carta({ nt: '391000001', uc: '77001122', titular: PC.titular });
  const dois = dubles({ banco, parecer: leitura });
  const r2 = await tratar(m, dois.deps);
  assert.equal(r2.concluida, true);
  assert.deepEqual(dois.d.chavesDoAnexo, [PC.project_id], 'a chave do anexo é o project_id, nunca a NT');
  assert.deepEqual(dois.d.protocolosDoAnexo, ['391000001'], 'o texto do comentário é a NT');
  assert.equal(dois.d.subidos.length, 1);
  assert.equal(dois.d.registros[0].referencia, '391000001');
  assert.equal(dois.d.registros[0].atualizarProtocolo, true);
  // 3ª ("Ler de novo"): mesma chave, já resolvido — não sobe em dobro
  const tres = dubles({ banco, parecer: leitura });
  await tratar(m, tres.deps);
  assert.deepEqual(tres.d.chavesDoAnexo, [PC.project_id]);
  assert.equal(tres.d.subidos.length, 0, 'não subiu de novo');
});

test('16c. M-7: "Ler de novo" DEPOIS de aplicar a troca (o projeto já com a NT) não sobe o documento de novo', async () => {
  const banco = new Map<string, 'pendente' | 'enviado'>();
  const m = mensagem();
  const leitura = carta({ nt: '391000001', uc: '77001122', titular: PC.titular });
  const antes = dubles({ banco, parecer: leitura });
  await tratar(m, antes.deps);
  assert.equal(antes.d.subidos.length, 1);
  assert.equal(antes.d.registros[0].atualizarProtocolo, true);
  // a equipe aplicou: o protocolo do cadastro agora é a NT, e referenciaDoProjeto muda junto
  const aplicado = { ...PC, protocolo: '391000001' };
  assert.notEqual(referenciaDoProjeto(aplicado), referenciaDoProjeto(PC));
  const depois = dubles({ banco, parecer: leitura });
  await tratar(m, depois.deps, [PA, PB, aplicado, PI]);
  assert.equal(depois.d.subidos.length, 0, 'mesma chave (project_id): já resolvido');
  assert.deepEqual(depois.d.chavesDoAnexo, [PC.project_id]);
  const reg = unico(depois.d);
  assert.equal('atualizarProtocolo' in reg, false, 'a NT já é o protocolo');
  assert.equal(reg.referencia, '391000001');
});

test('17. Carta com a NT igual ao protocolo (zeros à esquerda à parte): sem pedido de troca, a chave nem vai', async () => {
  const p = { ...PA, protocolo: '0391000010' };
  const { deps, d } = dubles({ parecer: carta({ nt: '391000010' }) });
  await tratar(mensagem(), deps, [p, PB]);
  const reg = unico(d);
  assert.equal('atualizarProtocolo' in reg, false, 'ausente: o payload fica igual ao de antes');
  assert.equal(reg.referencia, '391000010');
  assert.equal(reg.recomendacao, 'approved');
  assert.doesNotMatch(String(reg.motivo), /gravar a NT/);
});

test('18. Carta de projeto já em vistoria e SEM protocolo: cartão só de troca (sem etapa)', async () => {
  const pv = projeto({ codigo: 'GD-T6-004', protocolo: 'Sem protocolo', uc: '0066003003', titular: 'NEUZIRA CAMPELO DORNELES', status: 'vistoria_solicitada' });
  const { deps, d } = dubles({ parecer: carta({ nt: '391000004', uc: '66003003', titular: pv.titular }) });
  await tratar(mensagem(), deps, [PA, pv]);
  const reg = unico(d);
  assert.equal(reg.recomendacao, null);
  assert.equal(reg.atualizarProtocolo, true);
  assert.equal(reg.abrirCartao, true);
  assert.equal(reg.referencia, '391000004');
  assert.match(String(reg.motivo), /já está à frente/);
});

test('18b. só a NT lida na Carta vira protocolo: número do assunto ou do corpo não', async () => {
  // um número de 9 dígitos (com cara de NT) no assunto e no corpo, e a IA não achou a NT
  const semNt = dubles({ parecer: carta({ nt: null, uc: '77001122', titular: PC.titular }) });
  await tratar(mensagem({ assunto: 'Geração Distribuída – Carta – Protocolo 998877665', texto: 'Atendimento 887766554.' }), semNt.deps);
  const reg = unico(semNt.d);
  assert.equal('atualizarProtocolo' in reg, false);
  assert.equal(reg.referencia, referenciaDoProjeto(PC));
  // com a NT lida, vale ela — não o número do assunto
  const comNt = dubles({ parecer: carta({ nt: '391000001', uc: '77001122', titular: PC.titular }) });
  await tratar(mensagem({ assunto: 'Geração Distribuída – Carta – Protocolo 998877665' }), comNt.deps);
  assert.equal(unico(comNt.d).referencia, '391000001');
});

// ── 19. R2: a trava do titular nos dois sentidos ─────────────────────────────

test('19a. NT no assunto + Carta de OUTRA pessoa com o mesmo primeiro e último nome: bloqueado, sem troca', async () => {
  const p = projeto({ codigo: 'GD-T6-006', protocolo: '391000030', uc: '0055006006', titular: 'OTAVIO BRENO QUARESMA' });
  const { deps, d } = dubles({ parecer: carta({ nt: '391000099', titular: 'OTAVIO LEANDRO QUARESMA' }) });
  const r = await tratar(mensagem({ assunto: 'Geração Distribuída – Carta – NT 391000030' }), deps, [p, PA]);
  assert.equal(r.situacao, 'bloqueado');
  assert.equal(d.anexosPedidos.length, 0);
  const reg = unico(d);
  assert.equal('atualizarProtocolo' in reg, false);
  assert.equal(reg.referencia, '391000030');
});

test('19b. cadastro com o nome curto, documento com os nomes do meio: mesma pessoa, anexa', async () => {
  const p = projeto({ codigo: 'GD-T6-007', protocolo: '391000040', titular: 'CELINA MOURAO' });
  const { deps, d } = dubles({ parecer: carta({ nt: '391000040', titular: 'CELINA DE FARIAS PRUDENTE MOURAO' }) });
  const r = await tratar(mensagem(), deps, [p, PA]);
  assert.equal(r.situacao, 'tratado');
  assert.equal(d.subidos.length, 1);
});

test('19c. cadastro com os nomes do meio, documento com o nome curto: mesma pessoa, anexa', async () => {
  const p = projeto({ codigo: 'GD-T6-008', protocolo: '391000040', titular: 'CELINA DE FARIAS PRUDENTE MOURAO' });
  const { deps, d } = dubles({ parecer: carta({ nt: '391000040', titular: 'CELINA MOURAO' }) });
  const r = await tratar(mensagem(), deps, [p, PA]);
  assert.equal(r.situacao, 'tratado');
  assert.equal(d.subidos.length, 1);
});

// ── 20. R1: o atendimento.edsp manda o resultado no ASSUNTO ───────────────────

const CORPO_GENERICO = 'Prezado(a) cliente, segue o comunicado técnico referente à nota informada no assunto. Atenciosamente, Equipe de Atendimento';

test('20a. atendimento.edsp "… - Vistoria aprovada" no assunto: sem IA, 1 aviso, sem etapa', async () => {
  const pv = { ...PA, status: 'vistoria_solicitada' };
  const { deps, d } = dubles();
  const r = await tratar(mensagem({
    remetente: 'atendimento.edsp@enel.com', assunto: 'Comunicado técnico sobre a nota: 391000010 - Vistoria aprovada',
    texto: CORPO_GENERICO, anexos: [pdf('COMUNICADO.pdf')],
  }), deps, [pv, PB]);
  assert.equal(r.situacao, 'tratado');
  assert.equal(d.leituras, 0);
  assert.equal(d.avisos.length, 1);
  assert.match(d.avisos[0].titulo, /Vistoria virtual aprovada/);
  const reg = unico(d);
  assert.equal(reg.recomendacao, null);
  assert.equal(d.subidos.length, 1, 'a regra do atendimento.edsp anexa');
});

test('20b. atendimento.edsp "… - Vistoria reprovada": sugere vistoria_reprovada (cabe na etapa)', async () => {
  const pv = { ...PA, status: 'vistoria_solicitada' };
  const { deps, d } = dubles();
  await tratar(mensagem({
    remetente: 'atendimento.edsp@enel.com', assunto: 'Comunicado técnico sobre a nota: 391000010 - Vistoria reprovada',
    texto: CORPO_GENERICO, anexos: [],
  }), deps, [pv, PB]);
  assert.equal(d.leituras, 0);
  assert.equal(d.avisos.length, 0);
  const reg = unico(d);
  assert.equal(reg.recomendacao, 'vistoria_reprovada');
  assert.equal(reg.abrirCartao, true);
});

// ── 21–23 ────────────────────────────────────────────────────────────────────

test('21. troca que falhou com "Motivo da rejeição:": 1 aviso com o motivo', async () => {
  const { deps, d } = dubles();
  await tratar(mensagem({
    remetente: 'Canal GD <canalgd.sp@br.enel.com>', assunto: 'RE: TROCA DE RELÓGIO - NT 391000010',
    texto: 'Prezado(a), bom dia! Reenviamos a nota de serviço 400012345678 , referente a instalação 2222222222 , para a troca do medidor bidirecional, com o prazo de execução de até 5 dias úteis. Motivo da rejeição: Fechado Sem Acesso ao Centro de Medição. 06.10.2026 Protocolo: 9876543210 . Atenciosamente',
    anexos: [],
  }), deps);
  assert.equal(d.leituras, 0);
  assert.equal(d.avisos.length, 1);
  assert.match(d.avisos[0].titulo, /não trocou o relógio/);
  assert.match(d.avisos[0].mensagem, /Fechado Sem Acesso ao Centro de Medição/);
});

test('22. devolução de e-mail de um projeto: o aviso diz "Um dos destinatários", nunca "a ENEL não recebeu"', async () => {
  const { deps, d } = dubles();
  await tratar(mensagem({ remetente: 'postmaster@enel.com', assunto: 'Undeliverable: TROCA DE RELÓGIO - NT 391000010', anexos: [] }), deps);
  assert.equal(d.avisos.length, 1);
  assert.equal(d.avisos[0].projectId, PA.project_id);
  assert.match(d.avisos[0].mensagem, /Um dos destinatários/);
  assert.doesNotMatch(d.avisos[0].mensagem, /ENEL não recebeu|não foi entregue/);
  assert.equal(d.leituras, 0);
});

test('23. R4: aprovado com observações — sugere Aprovado e lista até 3 itens', async () => {
  const { deps, d } = dubles({ parecer: carta({ pendencias: ['Instalar placa de advertência', 'Ajustar o DPS', 'Corrigir a ART', 'Enviar fotos do quadro'] }) });
  await tratar(mensagem(), deps);
  const reg = unico(d);
  assert.equal(reg.recomendacao, 'approved');
  assert.match(String(reg.motivo), /aprovado com observações: Instalar placa de advertência, Ajustar o DPS, Corrigir a ART e mais 1/);
});

test('23b. R4: pendências vazias ou em branco não viram ressalva', async () => {
  const { deps, d } = dubles({ parecer: carta({ pendencias: ['  ', ''] }) });
  await tratar(mensagem(), deps);
  assert.doesNotMatch(String(unico(d).motivo), /observações/);
});

// Fechamento A · I-2: antes este teste fixava "anexa, mas não conclui". Sem a leitura a
// trava do titular não roda, e o documento subia para o projeto achado só pelo texto.
test('24. projeto achado pelo texto e a IA falha: NÃO anexa ainda (falta conferir o titular) e NÃO conclui', async () => {
  const { deps, d } = dubles({ parecer: { ...carta(), ok: false, veredito: null, titular: null, nt: null, tipo: null, erro: 'a leitura do documento respondeu 503' } });
  const r = await tratar(mensagem({ assunto: 'Geração Distribuída – Carta – NT 391000010' }), deps);
  assert.equal(r.situacao, 'tratado');
  assert.equal(r.concluida, false);
  assert.equal(r.anexados, 0);
  assert.equal(r.deOutroProjeto, 0, 'o arquivo que espera não é "de outro projeto"');
  assert.equal(d.anexosPedidos.length, 0, 'nem a linha do anexo é aberta');
  assert.equal(d.subidos.length, 0);
  const reg = unico(d);
  assert.equal(reg.concluida, false, 'a mensagem fica para a próxima tentativa');
  assert.equal(reg.anexos, 0);
  assert.match(String(reg.motivo), /não consegui ler o documento/);
  assert.match(String(reg.motivo), /não anexei ainda: preciso ler o documento para conferir o titular/);
  assert.doesNotMatch(String(reg.motivo), /número de outro projeto/);
});

test('I-2. a IA fora e, na tentativa seguinte, a Carta é de OUTRA pessoa: o documento nunca chega ao card', async () => {
  const banco = new Map<string, 'pendente' | 'enviado'>();
  const m = mensagem({ assunto: 'Geração Distribuída – Carta – NT 391000010' });
  const um = dubles({ banco, parecer: { ...carta(), ok: false, veredito: null, titular: null, nt: null, tipo: null, erro: 'a leitura do documento respondeu 503' } });
  const r1 = await tratar(m, um.deps);
  assert.equal(r1.concluida, false);
  const dois = dubles({ banco, parecer: carta({ titular: 'HERMINIO TAVARES BRANDALISE' }) });
  const r2 = await tratar(m, dois.deps);
  assert.equal(r2.situacao, 'bloqueado');
  assert.equal(um.d.anexosPedidos.length + dois.d.anexosPedidos.length, 0);
  assert.equal(um.d.subidos.length + dois.d.subidos.length, 0);
});

test('I-2. regra com ler_pdf: false (atendimento.edsp) segue anexando como antes: não há leitura a esperar', async () => {
  const pv = { ...PA, status: 'vistoria_solicitada' };
  // a IA "fora" não muda nada: esta regra nunca chama a leitura
  const { deps, d } = dubles({ parecer: { ...carta(), ok: false, veredito: null, titular: null, nt: null, tipo: null, erro: 'a leitura do documento respondeu 503' } });
  const r = await tratar(mensagem({
    remetente: 'atendimento.edsp@enel.com', assunto: 'Comunicado técnico sobre a nota: 391000010 - Vistoria aprovada',
    texto: CORPO_GENERICO, anexos: [pdf('COMUNICADO.pdf')],
  }), deps, [pv, PB]);
  assert.equal(d.leituras, 0);
  assert.equal(r.concluida, true);
  assert.equal(d.subidos.length, 1);
  assert.doesNotMatch(String(unico(d).motivo), /não anexei ainda/);
});

// ── Rodada de correção 1 ─────────────────────────────────────────────────────

const CORPO_VISTORIA_OK = 'Prezado(a) Senhor(a), Informamos que após realização da vistoria através de relatorio fotográfico, a vistoria do sistema de microgeração fotovoltaica está APROVADA. Atenciosamente';
const VISTORIA_OK = (o: Partial<MensagemLida> = {}) => mensagem({
  remetente: 'Técnico ABC <tecnico.abc@enel.com>', assunto: 'RE: VISTORIA GD - NT 391000010', texto: CORPO_VISTORIA_OK, anexos: [], ...o,
});

test('I-1. o aviso falha: a exceção sobe e NADA fica gravado como concluído (o sino toca na retentativa)', async () => {
  const { deps, d } = dubles({ avisoFalha: true });
  await assert.rejects(tratar(VISTORIA_OK(), deps), /avisar a equipe/);
  assert.ok(d.ordem.includes('avisar'));
  assert.equal(d.registros.some(r => r.concluida), false);
});

test('I-1. devolução sem projeto: o aviso que falha também não deixa a mensagem concluída', async () => {
  const { deps, d } = dubles({ avisoFalha: true });
  await assert.rejects(tratar(mensagem({ remetente: 'postmaster@enel.com', assunto: 'Undeliverable: pedido de vistoria', anexos: [] }), deps));
  assert.equal(d.registros.some(r => r.concluida), false);
});

test('I-1. o aviso vem ANTES do registro nos dois caminhos', async () => {
  const achado = dubles();
  await tratar(VISTORIA_OK(), achado.deps);
  assert.ok(achado.d.ordem.indexOf('avisar') < achado.d.ordem.indexOf('registrarEmailLido'));
  const semProjeto = dubles();
  await tratar(mensagem({ remetente: 'postmaster@enel.com', assunto: 'Undeliverable: pedido de vistoria', anexos: [] }), semProjeto.deps);
  assert.ok(semProjeto.d.ordem.indexOf('avisar') < semProjeto.d.ordem.indexOf('registrarEmailLido'));
});

// ── 24/10/2026 · janela de 120 dias, sino só para e-mail de até 30 ───────────────
// O e-mail antigo continua sendo tratado, anexado e registrado; só não toca o sino.
// A ressalva no motivo deixa a equipe ver no histórico que houve aviso e por que calou.

const RESSALVA_ANTIGO = /aviso não tocado: e-mail de mais de 30 dias/;
const DEVOLUCAO = (o: Partial<MensagemLida> = {}) =>
  mensagem({ remetente: 'postmaster@enel.com', assunto: 'Undeliverable: pedido de vistoria', anexos: [], ...o });

test('janela 120. vistoria aprovada de 40 dias: 0 chamadas a avisar e a ressalva no motivo; o resto segue igual', async () => {
  const { deps, d } = dubles();
  const r = await tratar(VISTORIA_OK({ recebidoEm: haDias(40) }), deps);
  assert.equal(d.avisos.length, 0);
  assert.equal(d.ordem.includes('avisar'), false);
  assert.equal(r.situacao, 'tratado');
  assert.equal(r.avisos, 0);
  assert.equal(r.concluida, true);
  const reg = unico(d);
  assert.equal(reg.concluida, true);
  assert.equal(reg.projectId, PA.project_id);
  assert.match(String(reg.motivo), /vistoria virtual aprovada — falta a troca do relógio/, 'a anotação de sempre continua');
  assert.match(String(reg.motivo), RESSALVA_ANTIGO);
});

test('janela 120. a MESMA vistoria aprovada de 5 dias atrás: 1 chamada a avisar e nenhuma ressalva', async () => {
  const { deps, d } = dubles();
  const r = await tratar(VISTORIA_OK({ recebidoEm: haDias(5) }), deps);
  assert.equal(d.avisos.length, 1);
  assert.equal(r.avisos, 1);
  assert.doesNotMatch(String(unico(d).motivo), /aviso não tocado/);
});

test('janela 120. e-mail sem data (recebidoEm null): na dúvida, avisa', async () => {
  const { deps, d } = dubles();
  await tratar(VISTORIA_OK({ recebidoEm: null }), deps);
  assert.equal(d.avisos.length, 1);
  assert.doesNotMatch(String(unico(d).motivo), /aviso não tocado/);
});

test('janela 120. troca não executada de 40 dias: não toca o sino, anota a ressalva', async () => {
  const { deps, d } = dubles();
  await tratar(mensagem({
    remetente: 'Canal GD <canalgd.sp@br.enel.com>', assunto: 'RE: TROCA DE RELÓGIO - NT 391000010',
    texto: 'Prezado(a), bom dia! Identificamos que a tentativa de troca do medidor no dia 15/09 , não foi executada pelo seguinte motivo: Cliente Não Permitiu Execução. Atenciosamente',
    anexos: [], recebidoEm: haDias(40),
  }), deps);
  assert.equal(d.avisos.length, 0);
  const motivo = String(unico(d).motivo);
  assert.match(motivo, /Cliente Não Permitiu Execução/, 'a anotação da troca continua no histórico');
  assert.match(motivo, RESSALVA_ANTIGO);
});

test('janela 120. devolução sem projeto: de 40 dias não toca o sino (e anota a ressalva); de 5 dias toca', async () => {
  const antigo = dubles();
  const r = await tratar(DEVOLUCAO({ recebidoEm: haDias(40) }), antigo.deps);
  assert.equal(r.situacao, 'nao_identificado');
  assert.equal(r.avisos, 0);
  assert.equal(antigo.d.avisos.length, 0);
  assert.equal(antigo.d.ordem.includes('avisar'), false);
  const reg = unico(antigo.d);
  assert.equal(reg.concluida, true);
  assert.match(String(reg.motivo), /não reconheci de qual projeto é este e-mail/, 'o motivo de sempre continua');
  assert.match(String(reg.motivo), RESSALVA_ANTIGO);

  const recente = dubles();
  await tratar(DEVOLUCAO({ recebidoEm: haDias(5) }), recente.deps);
  assert.equal(recente.d.avisos.length, 1);
  assert.doesNotMatch(String(unico(recente.d).motivo), /aviso não tocado/);
});

test('janela 120. Carta de 40 dias: segue tratada, anexada e abre o cartão; sem aviso a tocar, sem ressalva', async () => {
  const { deps, d } = dubles();
  const r = await tratar(mensagem({ recebidoEm: haDias(40) }), deps);
  assert.equal(r.situacao, 'tratado');
  assert.equal(d.subidos.length, 1);
  const reg = unico(d);
  assert.equal(reg.recomendacao, 'approved');
  assert.equal(reg.abrirCartao, true);
  assert.doesNotMatch(String(reg.motivo ?? ''), /aviso não tocado/, 'a ressalva é só para o aviso que existiria');
});

test('I-3a. a IA põe a UC do próprio projeto no campo nt: sem troca e sem cartão vazio', async () => {
  const p = projeto({ codigo: 'GD-T6-009', protocolo: 'Sem protocolo', uc: '0391000005', titular: 'CELINA MOURAO', status: 'vistoria_solicitada' });
  const { deps, d } = dubles({ parecer: carta({ nt: '391000005', uc: null, titular: 'CELINA MOURAO' }) });
  const r = await tratar(mensagem(), deps, [p, PA]);
  assert.equal(r.situacao, 'tratado');
  const reg = unico(d);
  assert.equal('atualizarProtocolo' in reg, false);
  assert.equal(reg.abrirCartao, false);
});

test('I-3b. NT colada pela leitura (14 dígitos, "NT … (SF …)"): não vira sugestão de protocolo', async () => {
  const { deps, d } = dubles({ parecer: carta({ nt: '39100000101234', uc: '77001122', titular: PC.titular }) });
  await tratar(mensagem(), deps);
  const reg = unico(d);
  assert.equal('atualizarProtocolo' in reg, false);
  assert.equal(reg.referencia, referenciaDoProjeto(PC));
  assert.equal(reg.recomendacao, 'approved');
});

test('I-3c. Carta antiga (NT velha) de projeto com a NT nova e à frente: não sugere voltar, só pede conferência', async () => {
  const p = projeto({ codigo: 'GD-T6-010', protocolo: '391000222', uc: '0066001001', titular: 'CELINA MOURAO', status: 'vistoria_solicitada' });
  const { deps, d } = dubles({ parecer: carta({ nt: '391000111', uc: '66001001', titular: 'CELINA MOURAO' }) });
  await tratar(mensagem(), deps, [p, PA]);
  const reg = unico(d);
  assert.equal('atualizarProtocolo' in reg, false);
  assert.equal(reg.abrirCartao, false);
  assert.equal(reg.referencia, '391000222');
  assert.match(String(reg.motivo), /a Carta traz a NT 391000111, diferente da do cadastro \(391000222\); como o projeto já está à frente, não sugeri trocar — confira/);
});

test('M-1. vistoria aprovada no corpo, mas projeto NÃO identificado: sem sino (sem projeto, só a devolução avisa)', async () => {
  const { deps, d } = dubles();
  const r = await tratar(VISTORIA_OK({ assunto: 'RE: VISTORIA GD' }), deps);
  assert.equal(r.situacao, 'nao_identificado');
  assert.equal(d.avisos.length, 0);
});

test('M-1. R1: o ASSUNTO vale antes do corpo (corpo diz aprovada, assunto diz reprovada)', async () => {
  const pv = { ...PA, status: 'vistoria_solicitada' };
  const { deps, d } = dubles();
  await tratar(mensagem({
    remetente: 'atendimento.edsp@enel.com', assunto: 'Comunicado técnico sobre a nota: 391000010 - Vistoria reprovada',
    texto: 'Informamos que a vistoria do sistema de microgeração está APROVADA.', anexos: [],
  }), deps, [pv, PB]);
  assert.equal(unico(d).recomendacao, 'vistoria_reprovada');
  assert.equal(d.avisos.length, 0);
});

test('M-1. vistoria aprovada lida no PDF (corpo genérico): 1 aviso e o arquivo lido registrado', async () => {
  const { deps, d } = dubles({ parecer: carta({ tipo: 'resultado_vistoria', veredito: 'favoravel' }) });
  await tratar(mensagem({
    remetente: 'Técnico ABC <tecnico.abc@enel.com>', assunto: 'RE: VISTORIA GD - NT 391000010',
    texto: 'Prezado(a), segue o relatório em anexo. Atenciosamente', anexos: [pdf('RELATORIO.pdf')],
  }), deps);
  assert.equal(d.leituras, 1);
  assert.equal(d.avisos.length, 1);
  assert.match(d.avisos[0].titulo, /Vistoria virtual aprovada/);
  assert.equal(unico(d).arquivoLido, 'RELATORIO.pdf');
});

test('M-1. vistoria reprovada com o projeto em Aprovado: sugere vistoria_reprovada (é o que recomendacaoCabe diz)', async () => {
  const pa = { ...PA, status: 'approved' };
  const { deps, d } = dubles();
  await tratar(mensagem({
    remetente: 'atendimento.edsp@enel.com', assunto: 'Comunicado técnico sobre a nota: 391000010 - Vistoria reprovada',
    texto: CORPO_GENERICO, anexos: [],
  }), deps, [pa, PB]);
  assert.equal(unico(d).recomendacao, 'vistoria_reprovada');
});

test('M-1. a ressalva da troca diz o protocolo que o cadastro tem (não "nenhum")', async () => {
  const { deps, d } = dubles({ parecer: carta({ nt: '391000777' }) });
  await tratar(mensagem({ assunto: 'Geração Distribuída – Carta – NT 391000010' }), deps);
  const reg = unico(d);
  assert.equal(reg.atualizarProtocolo, true);
  assert.equal(reg.referencia, '391000777');
  assert.match(String(reg.motivo), /a Carta traz a NT 391000777; o cadastro tem 391000010 — o cartão sugere gravar a NT/);
});

test('M-5. Carta com pendência: os itens vão como "pendências da Carta", nunca como observações de aprovado', async () => {
  const { deps, d } = dubles({ parecer: carta({ veredito: 'pendencia', pendencias: ['Corrigir o diagrama unifilar', 'Enviar a ART', 'Ajustar o DPS', 'Trocar a placa'] }) });
  await tratar(mensagem(), deps);
  const reg = unico(d);
  assert.equal(reg.recomendacao, 'pendencia');
  assert.match(String(reg.motivo), /pendências da Carta: Corrigir o diagrama unifilar, Enviar a ART, Ajustar o DPS e mais 1/);
  assert.doesNotMatch(String(reg.motivo), /aprovado com observações/);
});

test('M-2. titular de nome curto, igual no cadastro e no documento: não se bloqueia', async () => {
  const p = projeto({ codigo: 'GD-T6-011', protocolo: '391000060', titular: 'LU SANTOS NETO' });
  const { deps, d } = dubles({ parecer: carta({ nt: '391000060', titular: 'LU SANTOS NETO' }) });
  const r = await tratar(mensagem(), deps, [p, PA]);
  assert.equal(r.situacao, 'tratado');
  assert.equal(d.subidos.length, 1);
});

test('M-3. o PDF que a IA leu traz o número de OUTRO projeto: o que ele diz não vale para etapa, troca nem observações', async () => {
  const { deps, d } = dubles({ parecer: carta({ nt: '391000777', titular: null, pendencias: ['Item qualquer'] }) });
  const r = await tratar(mensagem({
    assunto: 'Geração Distribuída – Carta – NT 391000010', anexos: [pdf('NT_391000020.pdf', 500), pdf('CARTA.pdf', 100)],
  }), deps);
  assert.equal(r.situacao, 'tratado');
  assert.deepEqual(d.subidos, ['CARTA.pdf']);
  const reg = unico(d);
  assert.equal(reg.recomendacao, null);
  assert.equal(reg.abrirCartao, false);
  assert.equal('atualizarProtocolo' in reg, false);
  assert.equal(reg.arquivoLido, 'NT_391000020.pdf');
  assert.match(String(reg.motivo), /o documento que li \(NT_391000020\.pdf\) traz o número de outro projeto/);
  assert.doesNotMatch(String(reg.motivo), /observações/);
});

// ── Rodada de correção 2 ─────────────────────────────────────────────────────

test('N1. Carta antiga SEM veredito (inconclusiva) com a NT velha, projeto já em vistoria com NT: não pede a troca', async () => {
  const p = projeto({ codigo: 'GD-T6-012', protocolo: '391000222', uc: '0066004004', titular: 'CELINA MOURAO', status: 'vistoria_solicitada' });
  const { deps, d } = dubles({ parecer: carta({ veredito: 'inconclusivo', nt: '391000111', uc: '66004004', titular: 'CELINA MOURAO' }) });
  await tratar(mensagem(), deps, [p, PA]);
  const reg = unico(d);
  assert.equal(reg.recomendacao, null);
  assert.equal('atualizarProtocolo' in reg, false);
  assert.equal(reg.abrirCartao, false, 'sem etapa e sem troca: nada de cartão vazio');
  assert.equal(reg.referencia, '391000222');
  assert.match(String(reg.motivo), /a Carta traz a NT 391000111, diferente da do cadastro \(391000222\); como o projeto já está à frente, não sugeri trocar — confira/);
});

test('N1. Carta de pendência com o projeto JÁ em pendência e com NT: etapa barrada (a mesma) → não pede a troca', async () => {
  // `pendencia` está antes da fase da Carta: aqui quem segura a troca é a etapa barrada, não o status
  const p = projeto({ codigo: 'GD-T6-013', protocolo: '391000222', uc: '0066005005', titular: 'CELINA MOURAO', status: 'pendencia' });
  const { deps, d } = dubles({ parecer: carta({ veredito: 'pendencia', nt: '391000111', uc: '66005005', titular: 'CELINA MOURAO' }) });
  await tratar(mensagem(), deps, [p, PA]);
  const reg = unico(d);
  assert.equal(reg.recomendacao, null);
  assert.equal('atualizarProtocolo' in reg, false);
  assert.match(String(reg.motivo), /a Carta traz a NT 391000111, diferente da do cadastro \(391000222\)/);
});

test('N3. o PDF lido é de OUTRO projeto e é um laudo de vistoria aprovada: o sino NÃO toca', async () => {
  const { deps, d } = dubles({ parecer: carta({ tipo: 'resultado_vistoria', veredito: 'favoravel', nt: null, titular: null }) });
  const r = await tratar(mensagem({
    remetente: 'Técnico ABC <tecnico.abc@enel.com>', assunto: 'RE: VISTORIA GD - NT 391000010',
    texto: 'Prezado(a), segue o relatório em anexo. Atenciosamente',
    anexos: [pdf('LAUDO_NT_391000020.pdf', 500), pdf('RELATORIO.pdf', 100)],
  }), deps);
  assert.equal(r.situacao, 'tratado');
  assert.equal(d.leituras, 1);
  assert.equal(d.avisos.length, 0, 'a vistoria aprovada é do outro projeto');
  assert.deepEqual(d.subidos, ['RELATORIO.pdf']);
});

test('M-5 (Task 3). resposta automática que repete "troca … não executada/NÃO CONCLUÍDA": não classifica, não toca o sino', async () => {
  const { deps, d } = dubles();
  const r = await tratar(mensagem({
    remetente: 'ENEL <no-reply@enel.com>', assunto: 'RE: TROCA DE RELÓGIO - NT 391000010 - NÃO CONCLUÍDA',
    texto: 'Recebemos o seu e-mail: "a tentativa de troca do medidor não foi executada pelo seguinte motivo: Cliente Ausente". Atendimento SF0123456789.',
    anexos: [],
  }), deps);
  assert.equal(r.situacao, 'tratado');
  assert.equal(d.avisos.length, 0);
  const reg = unico(d);
  assert.equal(reg.recomendacao, null);
  assert.doesNotMatch(String(reg.motivo), /troca do relógio/);
});

test('M-5 (Task 3). devolução que cita "a vistoria … está REPROVADA": só o aviso da devolução, sem etapa', async () => {
  const pv = { ...PA, status: 'vistoria_solicitada' };
  const { deps, d } = dubles();
  await tratar(mensagem({
    remetente: 'postmaster@enel.com', assunto: 'Undeliverable: RE: VISTORIA - NT 391000010',
    texto: 'Delivery has failed. Original message: Informamos que a vistoria do sistema de microgeração está REPROVADA pelos motivos abaixo.',
    anexos: [],
  }), deps, [pv, PB]);
  assert.equal(d.avisos.length, 1);
  assert.equal(d.avisos[0].titulo, '📡 Um e-mail nosso voltou');
  const reg = unico(d);
  assert.equal(reg.recomendacao, null, 'a devolução não sugere vistoria_reprovada');
  assert.doesNotMatch(String(reg.motivo), /vistoria/);
});

// ── "A troca do relógio já foi realizada" → cartão sugerindo Concluído (decisão do usuário, 24/10/2026) ──

const TROCA_REALIZADA = 'Prezado, bom dia! De acordo com os registros em sistema, a troca do medidor referente à nota GD 391000010 , já foi realizada através da nota de serviço 400012345678 no dia 02/10/2026. Protocolo: 9876543210 . Atenciosamente';
const deTroca = (texto: string): MensagemLida => mensagem({
  remetente: 'Canal GD <canalgd.sp@br.enel.com>', assunto: 'RE: VISTORIA - NT 391000010', texto, anexos: [],
});

test('B1. troca já realizada, NT no assunto: abre o cartão sugerindo Concluído, sem IA e sem sino', async () => {
  const { deps, d } = dubles();
  const r = await tratar(deTroca(TROCA_REALIZADA), deps);
  assert.equal(r.situacao, 'tratado');
  assert.equal(d.leituras, 0);
  assert.equal(d.avisos.length, 0, 'não toca o sino: o cartão basta');
  const reg = unico(d);
  assert.equal(reg.recomendacao, 'completed');
  assert.equal(reg.abrirCartao, true);
  assert.equal(reg.concluida, true);
  assert.equal(reg.projectId, PA.project_id);
  assert.equal('atualizarProtocolo' in reg, false);
  assert.match(String(reg.motivo), /a ENEL informa que a troca do relógio foi realizada/);
});

test('B2. o projeto já está em vistoria ou em aprovado: Concluído continua cabendo', async () => {
  for (const status of ['approved', 'vistoria_solicitada']) {
    const { deps, d } = dubles();
    await tratar(deTroca(TROCA_REALIZADA), deps, [{ ...PA, status }, PB]);
    assert.equal(unico(d).recomendacao, 'completed', status);
    assert.equal(unico(d).abrirCartao, true, status);
  }
});

test('B3. "não foi realizada": é a falha (1 aviso), nunca Concluído', async () => {
  const { deps, d } = dubles();
  await tratar(deTroca('Prezado, bom dia! A troca do medidor referente à nota GD 391000010 não foi realizada pelo seguinte motivo: Cliente Ausente. Protocolo: 9876543210 .'), deps);
  assert.equal(d.avisos.length, 1);
  assert.match(d.avisos[0].mensagem, /Cliente Ausente/);
  const reg = unico(d);
  assert.equal(reg.recomendacao, null);
  assert.equal(reg.abrirCartao, false);
});

test('B4. resposta automática que repete "a troca … foi realizada": não classifica, sem cartão', async () => {
  const { deps, d } = dubles();
  await tratar(mensagem({
    remetente: 'ENEL <no-reply@enel.com>', assunto: 'RE: TROCA DE RELÓGIO - NT 391000010',
    texto: `Recebemos o seu e-mail: "${TROCA_REALIZADA}". Atendimento SF0123456789.`, anexos: [],
  }), deps);
  assert.equal(d.avisos.length, 0);
  assert.equal(unico(d).recomendacao, null);
  assert.equal(unico(d).abrirCartao, false);
});

// ── Razão social cortada no documento: a trava do titular só relaxa para projeto achado por NÚMERO ──

const PJ = projeto({
  codigo: 'GD-T6-PJ', protocolo: '391000070', uc: '0055007007',
  titular: 'ALFA BETA COMÉRCIO DE PEÇAS , ACESSÓRIOS PARA VEÍCULOS E AUTOMOTORES LTDA',
});
const PJ_CORTADO = 'Alfa Beta Comercio De Pecas';

test('PJ1. razão social cortada no PDF, projeto achado pela UC: mesma empresa, anexa e trata', async () => {
  const { deps, d } = dubles({ parecer: carta({ nt: null, uc: '55007007', titular: PJ_CORTADO }) });
  const r = await tratar(mensagem(), deps, [PJ, PA]);
  assert.equal(r.situacao, 'tratado');
  assert.equal(r.por, 'uc');
  assert.equal(d.subidos.length, 1);
  assert.equal(unico(d).projectId, PJ.project_id);
});

test('PJ2. razão social cortada no PDF, projeto achado pelo protocolo: mesma empresa, anexa e trata', async () => {
  const { deps, d } = dubles({ parecer: carta({ nt: '391000070', titular: PJ_CORTADO }) });
  const r = await tratar(mensagem(), deps, [PJ, PA]);
  assert.equal(r.situacao, 'tratado');
  assert.equal(r.por, 'protocolo');
  assert.equal(d.subidos.length, 1);
});

test('PJ3. o mesmo par com o projeto achado pelo NOME no assunto: bloqueado, nada anexado', async () => {
  const { deps, d } = dubles({ parecer: carta({ nt: null, uc: null, titular: PJ_CORTADO }) });
  const r = await tratar(mensagem({ assunto: `Geração Distribuída – Carta - ${PJ.titular} - GD` }), deps, [PJ, PA]);
  assert.equal(r.situacao, 'bloqueado');
  assert.equal(r.por, 'titular');
  assert.equal(d.anexosPedidos.length, 0);
});

test('PJ4. pessoa física pai × filho, projeto achado pela UC: bloqueado', async () => {
  const p = projeto({ codigo: 'GD-T6-PF', protocolo: '391000071', uc: '0055007171', titular: 'JOSE CARLOS SANTOS' });
  const { deps, d } = dubles({ parecer: carta({ nt: null, uc: '55007171', titular: 'JOSE CARLOS SANTOS FILHO' }) });
  const r = await tratar(mensagem(), deps, [p, PA]);
  assert.equal(r.situacao, 'bloqueado');
  assert.equal(d.anexosPedidos.length, 0);
});

// ── Fechamento A · rótulo dos avisos ─────────────────────────────────────────
// A RPC de aviso devolve o ROW_COUNT (um sino por pessoa da equipe: ~6 por aviso). `avisos`
// soma SINOS e fica como está (a tela antiga lê essa chave); `avisos_mensagens` conta
// as MENSAGENS que tocaram pelo menos um sino.

const tratamento = (o: Partial<TratamentoEnel> = {}): TratamentoEnel => ({
  situacao: 'tratado', por: 'protocolo', anexados: 0, imagensIgnoradas: 0, recusados: 0, semNome: 0,
  deOutroProjeto: 0, avisos: 0, concluida: true, ...o,
});

test('avisos_mensagens conta MENSAGENS com aviso; avisos segue somando os sinos', () => {
  const n = contaEnelZerada();
  somarEnel(n, tratamento({ avisos: 6 }));
  somarEnel(n, tratamento({ avisos: 0 }));
  somarEnel(n, tratamento({ avisos: 5 }));
  somarEnel(n, tratamento({ situacao: 'nao_identificado', por: null, avisos: 6 })); // devolução sem projeto
  const r = resultadoEnel(n, 4, 30, 0);
  assert.equal(r.avisos, 17);
  assert.equal(r.avisos_mensagens, 3);
});

test('avisos_mensagens: run sem aviso dá 0 (a chave existe)', () => {
  const r = resultadoEnel(contaEnelZerada(), 1, 1, 0);
  assert.equal(r.avisos_mensagens, 0);
  assert.equal(r.avisos, 0);
});

test('avisos_mensagens: do tratamento ao resultado, uma vistoria aprovada com 6 sinos é 1 mensagem', async () => {
  const { deps } = dubles();
  const seis: DepsEnel = { ...deps, avisar: async () => 6 };
  const t = await tratar(VISTORIA_OK(), seis);
  const n = contaEnelZerada();
  somarEnel(n, t);
  const r = resultadoEnel(n, 1, 1, 0);
  assert.equal(r.avisos, 6);
  assert.equal(r.avisos_mensagens, 1);
});
