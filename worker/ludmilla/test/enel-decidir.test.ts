// worker/ludmilla/test/enel-decidir.test.ts
// As decisões puras do run da ENEL: ler o PDF (pagar IA)?, que etapa sugerir, a
// sugestão cabe?, que aviso tocar, que janela de busca, quais remetentes, a NT que
// vira protocolo e a trava do titular. Dados 100% inventados.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  avisosEnel, janelaDeBusca, ntParaGravar, precisaLerPdf, recomendacaoCabe, recomendacaoEnel,
  remetentesParaBuscar, titularDeOutraPessoa,
} from '../src/email/enel/decidir.js';
import type { RegraEmail } from '../src/email/util.js';

const R = (o: Partial<RegraEmail>): RegraEmail => ({ id: 'r', remetente: 'x@enel.com', assunto: '', tipo_documento: 'outro', anexar: true, ler_pdf: true, ...o });
const ACHADO = { tipo: 'achado' as const, projeto: { codigo: 'PRJ-A' } as never, por: 'protocolo' as const };
const NENHUM = { tipo: 'nenhum' as const };

test('Carta: lê o PDF mesmo com o projeto achado no texto (precisa do veredito)', () => {
  assert.equal(precisaLerPdf(R({ tipo_documento: 'carta_projeto' }), ACHADO, null, true), true);
});
test('vistoria resolvida pelo corpo: NÃO paga IA', () => {
  assert.equal(precisaLerPdf(R({ tipo_documento: 'resultado_vistoria' }), ACHADO, { tipo: 'resultado_vistoria', aprovada: true }, true), false);
});
test('texto não identificou: lê o PDF para descobrir o projeto', () => {
  assert.equal(precisaLerPdf(R({ tipo_documento: 'troca_relogio' }), NENHUM, null, true), true);
});
test('conflito ou projeto inativo no texto: não paga IA (ler não resolve)', () => {
  assert.equal(precisaLerPdf(R({}), { tipo: 'conflito', motivo: '', codigos: [] }, null, true), false);
  assert.equal(precisaLerPdf(R({}), { tipo: 'inativo', projeto: {} as never, por: 'uc' }, null, true), false);
});
test('regra que não lê PDF, ou e-mail sem PDF: nunca lê', () => {
  assert.equal(precisaLerPdf(R({ ler_pdf: false }), NENHUM, null, true), false);
  assert.equal(precisaLerPdf(R({}), NENHUM, null, false), false);
});

test('mapa de etapas (spec §8)', () => {
  const ok = { ok: true, tipo: null, veredito: null };
  assert.equal(recomendacaoEnel(null, { ok: true, tipo: 'carta_projeto', veredito: 'favoravel' }), 'approved');
  assert.equal(recomendacaoEnel(null, { ok: true, tipo: 'carta_projeto', veredito: 'pendencia' }), 'pendencia');
  assert.equal(recomendacaoEnel({ tipo: 'resultado_vistoria', aprovada: false }, ok), 'vistoria_reprovada');
  assert.equal(recomendacaoEnel({ tipo: 'resultado_vistoria', aprovada: true }, ok), null);
  assert.equal(recomendacaoEnel({ tipo: 'troca_relogio', estado: 'agendada', prazoDias: 7 }, ok), null);
  assert.equal(recomendacaoEnel(null, { ok: false, tipo: 'carta_projeto', veredito: 'favoravel' }), null);
  assert.equal(recomendacaoEnel(null, { ok: true, tipo: 'resultado_vistoria', veredito: 'pendencia' }), 'vistoria_reprovada');
});

test('não sugere etapa para trás nem a mesma', () => {
  assert.equal(recomendacaoCabe('approved', 'analysis'), true);
  assert.equal(recomendacaoCabe('approved', 'vistoria_solicitada'), false);
  assert.equal(recomendacaoCabe('approved', 'approved'), false);
  assert.equal(recomendacaoCabe('pendencia', 'approved'), false);
  assert.equal(recomendacaoCabe('vistoria_reprovada', 'vistoria_solicitada'), true);
  assert.equal(recomendacaoCabe('vistoria_reprovada', 'analysis'), false);
});

test('avisos: vídeo aprovado, troca que falhou, e-mail devolvido', () => {
  const p = { codigo: 'PRJ-A' };
  assert.equal(avisosEnel('resultado_vistoria', { tipo: 'resultado_vistoria', aprovada: true }, null, p).length, 1);
  assert.match(avisosEnel('troca_relogio', { tipo: 'troca_relogio', estado: 'nao_executada', motivo: 'cliente nao permitiu execucao' }, null, p)[0].mensagem, /cliente nao permitiu/);
  assert.equal(avisosEnel('devolucao', null, null, null).length, 1);
  assert.equal(avisosEnel('troca_relogio', { tipo: 'troca_relogio', estado: 'agendada', prazoDias: 7 }, null, p).length, 0);
  assert.equal(avisosEnel('carta_projeto', null, { ok: true, tipo: 'resultado_vistoria', veredito: 'favoravel' }, p).length, 1);
});

test('R5: a devolução diz que UM DOS DESTINATÁRIOS não recebeu — nunca que a ENEL não recebeu', () => {
  const [a] = avisosEnel('devolucao', null, null, { codigo: 'PRJ-A' });
  assert.equal(a.titulo, '📡 Um e-mail nosso voltou');
  assert.equal(a.mensagem,
    'Um dos destinatários de um e-mail do projeto PRJ-A não recebeu a mensagem (devolução do servidor). '
    + 'Confira se a ENEL recebeu — a resposta automática dela costuma chegar no mesmo minuto.');
  assert.doesNotMatch(a.mensagem, /ENEL não recebeu|não foi entregue/);
  const [semProjeto] = avisosEnel('devolucao', null, null, null);
  assert.match(semProjeto.mensagem, /^Um dos destinatários de um e-mail não recebeu/);
});

test('janela: 30 dias na primeira leitura; depois desde a última menos 2 dias, nunca mais que 30', () => {
  const agora = new Date('2026-10-13T12:00:00Z');
  assert.equal(janelaDeBusca(null, agora).toISOString(), '2026-09-13T12:00:00.000Z');
  assert.equal(janelaDeBusca('2026-10-12T12:00:00Z', agora).toISOString(), '2026-10-10T12:00:00.000Z');
  assert.equal(janelaDeBusca('2026-07-01T00:00:00Z', agora).toISOString(), '2026-09-13T12:00:00.000Z');
});

test('remetentes: os das regras, sem repetir e sem o comunicado (o atendimento.edsp agora É buscado)', () => {
  // R6: a regra do atendimento.edsp virou resultado_vistoria; o comunicado é um remetente inventado.
  const regras = [
    R({ remetente: 'nao.responda@enel.com' }), R({ remetente: 'NAO.RESPONDA@enel.com' }),
    R({ remetente: 'atendimento.edsp@enel.com', tipo_documento: 'resultado_vistoria', ler_pdf: false }),
    R({ remetente: 'avisos.gerais@enel.test', tipo_documento: 'comunicado' }), R({ remetente: null }),
  ];
  assert.deepEqual(remetentesParaBuscar(regras), ['nao.responda@enel.com', 'atendimento.edsp@enel.com']);
});

// ── R3: a NT da Carta que o cartão sugere gravar ────────────────────────────────

const CARTA = { ok: true, tipo: 'carta_projeto', nt: '391000001' };

test('R3: Carta com NT e cadastro sem protocolo (texto, vazio ou null) → sugere gravar a NT', () => {
  assert.equal(ntParaGravar(CARTA, 'Sem protocolo'), '391000001');
  assert.equal(ntParaGravar(CARTA, ''), '391000001');
  assert.equal(ntParaGravar(CARTA, null), '391000001');
});
test('R3: Carta com NT diferente do protocolo do cadastro → sugere a NT', () => {
  assert.equal(ntParaGravar(CARTA, '391000777'), '391000001');
});
test('R3: NT igual ao protocolo, comparando sem zeros à esquerda → não sugere', () => {
  assert.equal(ntParaGravar(CARTA, '0391000001'), null);
  assert.equal(ntParaGravar({ ...CARTA, nt: '0391000001' }, '391000001'), null);
  assert.equal(ntParaGravar(CARTA, 'NT 391.000.001'), null);
});
test('R3: só a Carta, lida pela IA, com NT de 9+ dígitos', () => {
  assert.equal(ntParaGravar({ ...CARTA, ok: false }, null), null, 'leitura que falhou');
  assert.equal(ntParaGravar({ ...CARTA, tipo: 'resultado_vistoria' }, null), null, 'não é Carta');
  assert.equal(ntParaGravar({ ...CARTA, tipo: null }, null), null, 'não houve leitura');
  assert.equal(ntParaGravar({ ...CARTA, nt: null }, null), null, 'a IA não achou a NT');
  assert.equal(ntParaGravar({ ...CARTA, nt: '39100001' }, null), null, '8 dígitos não é NT');
  assert.equal(ntParaGravar({ ...CARTA, nt: '000039100001' }, null), null, '8 dígitos depois dos zeros');
});

// ── R2: a trava do titular, nos dois sentidos ──────────────────────────────────

test('R2: o cadastro omite nomes do meio do documento → mesma pessoa, não bloqueia', () => {
  assert.equal(titularDeOutraPessoa('CELINA MOURAO', 'CELINA DE FARIAS PRUDENTE MOURAO'), false);
});
test('R2: o documento omite nomes do meio do cadastro → mesma pessoa, não bloqueia', () => {
  assert.equal(titularDeOutraPessoa('CELINA DE FARIAS PRUDENTE MOURAO', 'CELINA MOURAO'), false);
});
test('R2: mesmo primeiro e último nome, nome do meio diferente → OUTRA pessoa, bloqueia', () => {
  // casaTitular (só primeiro e último) deixava passar: é a direção perigosa
  assert.equal(titularDeOutraPessoa('OTAVIO BRENO QUARESMA', 'OTAVIO LEANDRO QUARESMA'), true);
  assert.equal(titularDeOutraPessoa('OTAVIO LEANDRO QUARESMA', 'OTAVIO BRENO QUARESMA'), true);
});
test('R2: nome que não dá para comparar é falta de dado, nunca bloqueio', () => {
  assert.equal(titularDeOutraPessoa('Odalirio', 'ZULMIRA PEDROSO CAVALHEIRO'), false);
  assert.equal(titularDeOutraPessoa('ZULMIRA PEDROSO CAVALHEIRO', 'Zu'), false);
  assert.equal(titularDeOutraPessoa(null, 'ZULMIRA PEDROSO CAVALHEIRO'), false);
  assert.equal(titularDeOutraPessoa('ZULMIRA PEDROSO CAVALHEIRO', null), false);
});
test('R2: pessoa claramente diferente bloqueia; o mesmo nome com acento e caixa não', () => {
  assert.equal(titularDeOutraPessoa('ZULMIRA PEDROSO CAVALHEIRO', 'HERMINIO TAVARES BRANDALISE'), true);
  assert.equal(titularDeOutraPessoa('ZULMIRA PEDROSO CAVALHEIRO', 'Zulmira Pedroso Cavalheiro'), false);
});
