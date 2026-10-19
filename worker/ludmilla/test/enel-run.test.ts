// worker/ludmilla/test/enel-run.test.ts
// O tratamento de UMA mensagem da ENEL, com dependências falsas que GRAVAM o que
// foi chamado. Cada caso afirma as chamadas e o retorno. Nomes, UCs, NTs e
// endereços são 100% inventados.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tratarMensagemEnel, type DepsEnel, type ParecerEnel } from '../src/email/enel/run.js';
import { referenciaDoProjeto, type ProjetoEnel } from '../src/email/enel/identificar.js';
import type { MensagemLida } from '../src/email/caixa.js';
import type { RegraEmail } from '../src/email/util.js';
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
  /** o 2º argumento de anexoDeEmail: a CHAVE do anexo */
  chavesDoAnexo: string[];
  anexosPedidos: string[];
  subidos: string[];
  errosDeAnexo: string[];
  avisos: AvisoEmail[];
  leituras: number;
}

function dubles(o: { parecer?: ParecerEnel; storageRecusa?: string; anexoRetorna?: AberturaDeAnexo['situacao'] } = {}): { deps: DepsEnel; d: Diario } {
  const d: Diario = { ordem: [], tentativas: [], registros: [], chavesDoAnexo: [], anexosPedidos: [], subidos: [], errosDeAnexo: [], avisos: [], leituras: 0 };
  const deps: DepsEnel = {
    async abrirTentativa(p) { d.ordem.push('abrirTentativa'); d.tentativas.push(p); return d.tentativas.length; },
    async anexoDeEmail(_conta, chave, projectId, _msg, nome): Promise<AberturaDeAnexo> {
      d.ordem.push('anexoDeEmail'); d.chavesDoAnexo.push(chave); d.anexosPedidos.push(nome);
      if (o.anexoRetorna === 'ja_resolvido') return { situacao: 'ja_resolvido' };
      return {
        situacao: 'aberto',
        anexo: { id: `anexo-${nome}`, project_id: projectId, company_id: 'empresa-t6', protocolo: chave, id_arquivo: `x#${chave}#${nome}`, nome_arquivo: nome, codigo: '' },
      };
    },
    async subirDocumento(a) {
      d.ordem.push('subirDocumento');
      if (o.storageRecusa) throw new Error(o.storageRecusa);
      d.subidos.push(a.nome_arquivo);
      return `caminho/${a.nome_arquivo}`;
    },
    async anexoEnviado() { d.ordem.push('anexoEnviado'); },
    async anexoErro(_id, motivo) { d.ordem.push('anexoErro'); d.errosDeAnexo.push(motivo); },
    async registrarEmailLido(p) { d.ordem.push('registrarEmailLido'); d.registros.push(p); },
    async avisar(p) { d.ordem.push('avisar'); d.avisos.push(p); return 1; },
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

const tratar = async (m: MensagemLida, deps: DepsEnel, projetos = PROJETOS) =>
  (await comLogs(() => tratarMensagemEnel(RUN, m, REGRAS, projetos, deps))).r;

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
  assert.deepEqual(d.chavesDoAnexo, [referenciaDoProjeto(PC)]);
  assert.notEqual(d.chavesDoAnexo[0], '391000001');
  const reg = unico(d);
  assert.equal(reg.referencia, '391000001');
  assert.equal(reg.atualizarProtocolo, true);
  assert.equal(reg.recomendacao, 'approved');
  assert.equal(reg.abrirCartao, true);
  assert.equal(reg.casamento, 'uc');
  assert.match(String(reg.motivo), /a Carta traz a NT 391000001; o cadastro tem nenhum — o cartão sugere gravar a NT/);
});

test('16b. a 2ª tentativa da mesma Carta usa a MESMA chave do anexo (não sobe em dobro)', async () => {
  // 1ª: a IA falhou; o projeto foi achado pela UC no assunto e o anexo subiu com a chave de sempre
  const um = dubles({ parecer: { ...carta(), ok: false, veredito: null, titular: null, nt: null, tipo: null, erro: 'a leitura do documento respondeu 503' } });
  const m = mensagem({ assunto: 'Geração Distribuída – Carta – Instalação 77001122' });
  const r1 = await tratar(m, um.deps);
  assert.equal(r1.concluida, false);
  assert.equal(um.d.registros[0].atualizarProtocolo, undefined);
  // 2ª: a IA voltou e leu a NT
  const dois = dubles({ parecer: carta({ nt: '391000001', uc: '77001122', titular: PC.titular }), anexoRetorna: 'ja_resolvido' });
  await tratar(m, dois.deps);
  assert.deepEqual(dois.d.chavesDoAnexo, um.d.chavesDoAnexo, 'a chave do anexo não pode virar a NT');
  assert.equal(dois.d.registros[0].referencia, '391000001');
  assert.equal(dois.d.registros[0].atualizarProtocolo, true);
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

test('24. projeto achado pelo texto e a IA falha: anexa, mas NÃO conclui (a Carta precisa do veredito)', async () => {
  const { deps, d } = dubles({ parecer: { ...carta(), ok: false, veredito: null, titular: null, nt: null, tipo: null, erro: 'a leitura do documento respondeu 503' } });
  const r = await tratar(mensagem({ assunto: 'Geração Distribuída – Carta – NT 391000010' }), deps);
  assert.equal(r.situacao, 'tratado');
  assert.equal(r.concluida, false);
  assert.equal(d.subidos.length, 1);
  const reg = unico(d);
  assert.equal(reg.concluida, false);
  assert.match(String(reg.motivo), /não consegui ler o documento/);
});
