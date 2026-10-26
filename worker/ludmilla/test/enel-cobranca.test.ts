// worker/ludmilla/test/enel-cobranca.test.ts
// A cobrança da troca do relógio — as funções puras. Notas, UCs, NTs, Message-IDs e
// endereços são inventados; o único endereço real é o remetente público da regra da
// ENEL (canalgd.sp@br.enel.com), que já está nos testes de hoje.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DIAS_ENTRE_COBRANCAS, MAX_CARACTERES_REFERENCIAS, MAX_REFERENCIAS, REGEX_DESTINATARIO_ENEL, ajustarSaudacao,
  assuntoDaResposta, cabecalhosDaResposta, cobrancaDaMensagem, dataBr, destinatarioDaEnel, enderecoDoRemetente,
  horaEmBrasilia, notaDeServico, podeEnviar, saudacaoNaHora, trocaFoiRealizada, vencimento, type EstadoDoEnvio,
} from '../src/email/enel/cobranca.js';
import { classificarCorpo, textoNovo } from '../src/email/enel/classificar.js';

// A nota de serviço aparece de dois jeitos nos e-mails reais: 11 dígitos (707…) ou 12 com um
// zero na frente (0707…). A forma canônica (a do banco) é a de 12.
const NOTA11 = '70712345678';
const NOTA12 = '070712345678';
const OUTRA11 = '70787654321';

const AGENDADA = `Prezado(a), boa tarde! Nota de serviço criada ${NOTA11} , na data de 01/10/2026 , referente a instalação 2222222222 , para a troca do medidor bidirecional, com o prazo de execução de até 7 dias úteis. Protocolo: 9876543210 . Atenciosamente`;
const REENVIO = `Prezado(a), bom dia! Reenviamos a nota de serviço ${NOTA11} , referente a instalação 2222222222 , para a troca do medidor bidirecional, com o prazo de execução de até 5 dias úteis. Motivo da rejeição: Fechado Sem Acesso ao Centro de Medição. 06.10.2026 Protocolo: 9876543210 . Atenciosamente`;
const FALHA_SEM_NOTA = 'Identificamos que a tentativa de troca do medidor no dia 15/09 não foi executada pelo seguinte motivo: Cliente Não Permitiu Execução.';
const COM_CITACAO = `Reenviamos a nota de serviço ${NOTA11} , para a troca do medidor bidirecional. -------------- Mensagem original -------------- De: Equipe [equipe@exemplo.test] Assunto: TROCA DE RELOGIO Prezado, nota de serviço criada ${OUTRA11} para a troca do medidor`;
// A troca feita, na redação do canalgd (a mesma do teste do classificador), com a NT de 9 dígitos na frente da nota
const TROCA_REALIZADA = `Prezado, bom dia! De acordo com os registros em sistema, a troca do medidor referente à nota GD 391000001 , já foi realizada através da nota de serviço ${NOTA11} no dia 02/10/2026. Protocolo: 9876543210 . Atenciosamente`;
const NOTA_EXECUTADA = `Prezado(a), boa tarde! Identificamos a nota de serviço ${NOTA11} criada em 03/08/2026 , referente a instalação 2222222222 , para a troca do medidor bidirecional, que se encontra executada em 03/09/2026. Protocolo: 9876543210 . Atenciosamente`;
// A reprogramação também é o fim do serviço (o medidor já era bidirecional)
const REPROGRAMACAO_EXECUTADA = `Prezado, bom dia! Identificamos a nota de serviço ${NOTA11} criada em 23/09 , referente a instalação 2222222222 , para a reprogramação do medidor bidirecional, que se encontra executada em 24/09/2026. Protocolo: 9876543210 . Atenciosamente`;
const JA_HOUVE_A_REPROGRAMACAO = `Prezado, bom dia. De acordo com registros em sistema, verificamos que já houve a reprogramação do medidor em 30/07/2026 , através da nota ${NOTA11} . Informamos que caso não esteja reprogramado, é necessário o envio de vídeo e fotos do medidor atualmente instalado através de um novo e-mail. Protocolo: 9876543210. Atenciosamente`;

// A migração que vale (a dos ajustes da revisão): ela tira o '%' da expressão e põe o limite das referências.
const MIGRACAO_DOS_AJUSTES = new URL('../../../../supabase/migrations/20261025120000_ludmilla_cobranca_ajustes.sql', import.meta.url);

// ── a nota de serviço ──────────────────────────────────────────────────────

test('notaDeServico: 11 dígitos ou 12 com zero à esquerda dão a MESMA nota, canônica (12 com zero)', () => {
  assert.equal(notaDeServico(`nota de serviço ${NOTA11} criada em 23/09`), NOTA12);
  assert.equal(notaDeServico(`nota de serviço ${NOTA12} criada em 23/09`), NOTA12);
  assert.equal(notaDeServico(AGENDADA), NOTA12);
  assert.equal(notaDeServico(REENVIO), NOTA12);
  assert.equal(notaDeServico(`informamos que a nota de serviço ${NOTA11} , referente a instalação: 2222222222 , foi criada`), NOTA12);
});

test('notaDeServico: o termo pode ser "nota de serviço", só "nota" ou "ordem", com "nº" no meio', () => {
  assert.equal(notaDeServico(`através da nota ${NOTA11} .`), NOTA12);
  assert.equal(notaDeServico(JA_HOUVE_A_REPROGRAMACAO), NOTA12);
  assert.equal(notaDeServico(`Ordem de serviço nº ${NOTA11} para a troca do medidor`), NOTA12);
  assert.equal(notaDeServico(`a ordem ${NOTA11} foi aberta`), NOTA12);
  assert.equal(notaDeServico(`a ordem ${NOTA12} foi aberta`), NOTA12);
});

test('notaDeServico: a nota de uma REPROGRAMAÇÃO também vale', () => {
  assert.equal(notaDeServico(REPROGRAMACAO_EXECUTADA), NOTA12);
});

test('notaDeServico: a NT de 9 dígitos NUNCA casa, nem junto do termo "nota"', () => {
  assert.equal(notaDeServico('nota 391000010'), null);
  assert.equal(notaDeServico('Comunicado técnico sobre a nota: 391000010 - Vistoria aprovada'), null);
  assert.equal(notaDeServico(`nota 391000010 , protocolo ${NOTA11}`), null, 'o protocolo não tem o termo');
  // a NT na frente da nota de verdade: a nota vale, a NT é ignorada
  assert.equal(notaDeServico(TROCA_REALIZADA), NOTA12);
});

test('notaDeServico: 12 dígitos SEM o zero na frente não é nota', () => {
  assert.equal(notaDeServico('nota de serviço 407123456789 criada'), null);
  assert.equal(notaDeServico('nota 170712345678'), null);
});

test('notaDeServico: entidades HTML decodificadas', () => {
  assert.equal(notaDeServico(`Reenviamos a nota de servi&ccedil;o ${NOTA11} , para a troca`), NOTA12);
  assert.equal(notaDeServico(`Reenviamos a nota de servi&amp;ccedil;o&nbsp;${NOTA11} , para a troca`), NOTA12);
});

test('notaDeServico: só a parte NOVA do e-mail (a citação traz a nota antiga)', () => {
  assert.equal(notaDeServico(COM_CITACAO), NOTA12);
});

test('notaDeServico: regra estrita — ambíguo, curto, longo, longe ou sem o termo = null', () => {
  assert.equal(notaDeServico(`nota de serviço ${NOTA11} e nota de serviço ${OUTRA11}`), null, 'duas notas diferentes');
  assert.equal(notaDeServico(`nota de serviço ${NOTA11} e de novo a nota de serviço ${NOTA11}`), NOTA12, 'a mesma, repetida');
  assert.equal(notaDeServico(`nota de serviço ${NOTA11} e depois a ordem ${NOTA12}`), NOTA12, 'a mesma, escrita dos dois jeitos');
  assert.equal(notaDeServico('nota de serviço 7071234567 criada'), null, '10 dígitos');
  assert.equal(notaDeServico('nota de serviço 0707123456789 criada'), null, '13 dígitos');
  assert.equal(notaDeServico(`nota de serviço referente à instalação 2222222222 e ao pedido ${NOTA11}`), null, 'outro número antes');
  assert.equal(notaDeServico(`nota de serviço ${'x'.repeat(60)} ${NOTA11}`), null, 'mais de 40 caracteres de distância');
  assert.equal(notaDeServico(`protocolo ${NOTA11}`), null, 'sem o termo');
  assert.equal(notaDeServico(`notamos que ${NOTA11} mudou`), null, '"notamos" não é o termo');
  assert.equal(notaDeServico(`o titular anotou ${NOTA11}`), null, '"anotou" não é o termo');
  assert.equal(notaDeServico(''), null);
  assert.equal(notaDeServico(null), null);
  assert.equal(notaDeServico(undefined), null);
});

test('textoNovo: corta a citação e decodifica (o mesmo texto que o classificador lê)', () => {
  assert.doesNotMatch(textoNovo(COM_CITACAO), new RegExp(OUTRA11));
  assert.match(textoNovo('servi&ccedil;o'), /serviço/);
  assert.equal(textoNovo(null), '');
  assert.equal(textoNovo(undefined), '');
});

// ── o destinatário ─────────────────────────────────────────────────────────

test('enderecoDoRemetente: o endereço entre <>, minúsculo; ou o endereço sozinho', () => {
  assert.equal(enderecoDoRemetente('Canal GD <canalgd.sp@br.enel.com>'), 'canalgd.sp@br.enel.com');
  assert.equal(enderecoDoRemetente('"ENEL, Canal GD" <CanalGD.SP@BR.ENEL.COM>'), 'canalgd.sp@br.enel.com');
  assert.equal(enderecoDoRemetente('  tecnico.abc@enel.com  '), 'tecnico.abc@enel.com');
});

test('enderecoDoRemetente: mais de um endereço, espaço ou quebra de linha = null', () => {
  assert.equal(enderecoDoRemetente('a <x@enel.com>, b <y@enel.com>'), null);
  assert.equal(enderecoDoRemetente('x@enel.com y@enel.com'), null);
  assert.equal(enderecoDoRemetente('x@enel.com, y@enel.com'), null);
  assert.equal(enderecoDoRemetente('Nome <x@enel.com>\r\nBcc: y@exemplo.test'), null);
  assert.equal(enderecoDoRemetente(''), null);
  assert.equal(enderecoDoRemetente(null), null);
});

test('destinatarioDaEnel: só @enel.com e @br.enel.com, um endereço, já minúsculo', () => {
  assert.equal(destinatarioDaEnel('canalgd.sp@br.enel.com'), true);
  assert.equal(destinatarioDaEnel('tecnico.abc@enel.com'), true);
  assert.equal(destinatarioDaEnel('tecnico+gd@enel.com'), true);
  for (const fora of [
    'x@enel.com.br', 'canalgd.sp@br.enel.com.exemplo.test', 'x@evil.enel.com', 'x@enelxcom', 'X@ENEL.COM',
    'x y@enel.com', 'a@enel.com,b@exemplo.test', '.x@enel.com', '@enel.com', 'x@enel.com\nBcc: y@exemplo.test', 'x@enel.com\n', '',
  ]) {
    assert.equal(destinatarioDaEnel(fora), false, JSON.stringify(fora));
  }
  assert.equal(destinatarioDaEnel(null), false);
});

test('destinatarioDaEnel: "%" não vale (x%evil.com@enel.com)', () => {
  assert.equal(destinatarioDaEnel('x%evil.com@enel.com'), false);
  assert.equal(destinatarioDaEnel('canalgd%evil.test@br.enel.com'), false);
  assert.ok(!REGEX_DESTINATARIO_ENEL.source.includes('%'), 'a expressão não tem %');
});

test('a trava do destinatário é a MESMA no worker e no banco (migração 20261025120000)', () => {
  const sql = readFileSync(MIGRACAO_DOS_AJUSTES, 'utf8');
  assert.equal(REGEX_DESTINATARIO_ENEL.flags, '', 'sem i: maiúscula não passa (o endereço chega normalizado)');
  const doBanco = /FUNCTION public\.ludmilla_endereco_da_enel\([\s\S]*?p_endereco ~ '([^']+)'/.exec(sql);
  assert.ok(doBanco, 'a migração não define ludmilla_endereco_da_enel');
  assert.equal(REGEX_DESTINATARIO_ENEL.source, doBanco[1], 'a expressão do worker difere da do banco');
});

// ── a resposta na conversa da nota ─────────────────────────────────────────

test('assuntoDaResposta: "RE: " uma vez só, sem quebra de linha, até 300', () => {
  assert.equal(assuntoDaResposta('TROCA DE RELÓGIO - NT 391000010'), 'RE: TROCA DE RELÓGIO - NT 391000010');
  assert.equal(assuntoDaResposta('RE: TROCA DE RELÓGIO - NT 391000010'), 'RE: TROCA DE RELÓGIO - NT 391000010');
  assert.equal(assuntoDaResposta('re: troca'), 're: troca');
  assert.equal(assuntoDaResposta('RES: troca'), 'RES: troca');
  assert.equal(assuntoDaResposta('troca\r\nBcc: y@exemplo.test'), 'RE: troca Bcc: y@exemplo.test');
  assert.equal(assuntoDaResposta('troca\u0085x\u007fy'), 'RE: troca x y', 'DEL e controle C1 também (como no banco)');
  assert.equal(assuntoDaResposta(''), 'RE: TROCA DE RELÓGIO');
  assert.equal(assuntoDaResposta(null), 'RE: TROCA DE RELÓGIO');
  assert.equal(assuntoDaResposta('x'.repeat(400)).length, 300);
});

test('cabecalhosDaResposta: In-Reply-To = a nota; References = as dela + a nota, no fim', () => {
  assert.deepEqual(
    cabecalhosDaResposta('<n@enel.test>', ['<a@exemplo.test>', '<n@enel.test>', 'lixo', '<b@exemplo.test>', '<a@exemplo.test>']),
    { inReplyTo: '<n@enel.test>', referencias: ['<a@exemplo.test>', '<b@exemplo.test>', '<n@enel.test>'] },
  );
  assert.deepEqual(cabecalhosDaResposta('<n@enel.test>'), { inReplyTo: '<n@enel.test>', referencias: ['<n@enel.test>'] });
});

test('cabecalhosDaResposta: sem Message-ID de verdade, não liga a nada inventado', () => {
  assert.deepEqual(cabecalhosDaResposta('imap-uid-7', ['<a@exemplo.test>']), { inReplyTo: null, referencias: ['<a@exemplo.test>'] });
  assert.deepEqual(cabecalhosDaResposta('<a@b>\r\nBcc: x', []), { inReplyTo: null, referencias: [] });
});

test('cabecalhosDaResposta: no máximo 20 referências, a nota sempre a última', () => {
  assert.equal(MAX_REFERENCIAS, 20);
  const muitas = Array.from({ length: 30 }, (_, i) => `<r${i}@exemplo.test>`);
  const r = cabecalhosDaResposta('<n@enel.test>', muitas);
  assert.equal(r.referencias.length, 20);
  assert.equal(r.referencias.at(-1), '<n@enel.test>');
  assert.equal(r.referencias[0], '<r11@exemplo.test>', 'ficam as 19 mais novas + a nota');
  assert.equal(cabecalhosDaResposta('<n@enel.test>', muitas.slice(0, 19)).referencias.length, 20, '19 + a nota = 20 cabe inteiro');
});

test('cabecalhosDaResposta: no máximo 2000 caracteres no total (as mais antigas saem primeiro)', () => {
  assert.equal(MAX_CARACTERES_REFERENCIAS, 2000);
  const grande = (n: number) => `<${'a'.repeat(391)}${n}@exemplo.test>`; // 407 caracteres cada
  const velhas = Array.from({ length: 6 }, (_, i) => grande(i));
  const r = cabecalhosDaResposta('<n@enel.test>', velhas);
  assert.ok(r.referencias.join(' ').length <= 2000, 'passou de 2000');
  assert.equal(r.referencias.at(-1), '<n@enel.test>');
  assert.deepEqual(r.referencias, [...velhas.slice(2), '<n@enel.test>'], 'saíram as duas mais antigas, e só elas');
  // um id maior que o limite de linha (998) não é id: sem nota e sem nada que sirva, nenhum References
  const enorme = `<${'b'.repeat(1100)}@exemplo.test>`;
  assert.deepEqual(cabecalhosDaResposta(enorme, [enorme]), { inReplyTo: null, referencias: [] });
  assert.deepEqual(cabecalhosDaResposta(enorme, ['<a@exemplo.test>']), { inReplyTo: null, referencias: ['<a@exemplo.test>'] });
});

test('cabecalhosDaResposta: caractere de controle ou espaço no id = o id não passa', () => {
  assert.deepEqual(cabecalhosDaResposta('<n@enel.test>', ['<a\u0001b@exemplo.test>', '<c@exemplo.test>']).referencias, ['<c@exemplo.test>', '<n@enel.test>']);
  assert.deepEqual(cabecalhosDaResposta('<n@enel.test>', ['<a\u0085b@exemplo.test>', '<a\u007fb@exemplo.test>', '<a b@exemplo.test>']).referencias, ['<n@enel.test>']);
  assert.equal(cabecalhosDaResposta('<n\u0001@enel.test>', []).inReplyTo, null);
  assert.equal(cabecalhosDaResposta('<n\u007f@enel.test>', []).inReplyTo, null);
});

test('os limites dos cabeçalhos são os MESMOS do banco (migração 20261025120000)', () => {
  const sql = readFileSync(MIGRACAO_DOS_AJUSTES, 'utf8');
  assert.ok(sql.includes('length(referencias) <= 2000'), 'o banco não limita References a 2000');
  assert.ok(sql.includes('){0,19}$'), 'o banco não limita References a 20 itens');
});

// ── quando vence, a data e a saudação ──────────────────────────────────────

test('vencimento: 7 dias depois', () => {
  assert.equal(DIAS_ENTRE_COBRANCAS, 7);
  assert.equal(vencimento(new Date('2026-10-01T15:00:00Z')).toISOString(), '2026-10-08T15:00:00.000Z');
});

test('dataBr: dd/mm/aaaa no horário de Brasília', () => {
  assert.equal(dataBr(new Date('2026-10-01T02:00:00Z')), '30/09/2026');
  assert.equal(dataBr('2026-10-08T15:00:00Z'), '08/10/2026');
  assert.equal(dataBr('ontem'), '', 'data ilegível não derruba o run');
});

test('horaEmBrasilia: 0 a 23 (a meia-noite é 0, nunca 24)', () => {
  assert.equal(horaEmBrasilia(new Date('2026-10-24T03:00:00Z')), 0);
  assert.equal(horaEmBrasilia(new Date('2026-10-24T14:59:00Z')), 11);
  assert.equal(horaEmBrasilia(new Date('2026-10-25T02:59:00Z')), 23);
});

test('saudacaoNaHora: "bom dia" até 11:59 de Brasília, "boa tarde" a partir do meio-dia', () => {
  assert.equal(saudacaoNaHora(new Date('2026-10-24T03:00:00Z')), 'bom dia', 'meia-noite');
  assert.equal(saudacaoNaHora(new Date('2026-10-24T10:00:00Z')), 'bom dia');
  assert.equal(saudacaoNaHora(new Date('2026-10-24T14:00:00Z')), 'bom dia', '11:00 ainda é de manhã');
  assert.equal(saudacaoNaHora(new Date('2026-10-24T14:59:00Z')), 'bom dia', '11:59');
  assert.equal(saudacaoNaHora(new Date('2026-10-24T15:00:00Z')), 'boa tarde', '12:00');
  assert.equal(saudacaoNaHora(new Date('2026-10-25T02:00:00Z')), 'boa tarde');
});

test('ajustarSaudacao: troca só a 1ª linha do modelo; texto que a pessoa mexeu fica', () => {
  const tarde = new Date('2026-10-24T16:00:00Z');
  assert.equal(ajustarSaudacao('Prezados, bom dia.\n\nResto do texto.', tarde), 'Prezados, boa tarde.\n\nResto do texto.');
  assert.equal(ajustarSaudacao('Prezados, boa tarde.\n\nResto.', new Date('2026-10-24T12:00:00Z')), 'Prezados, bom dia.\n\nResto.');
  assert.equal(ajustarSaudacao('Olá, equipe.\n\nResto.', tarde), 'Olá, equipe.\n\nResto.');
  assert.equal(ajustarSaudacao('Prezados, retomando o e-mail abaixo:\n\nResto.', tarde), 'Prezados, retomando o e-mail abaixo:\n\nResto.');
  assert.equal(ajustarSaudacao('Topo.\n> Prezados, bom dia.', tarde), 'Topo.\n> Prezados, bom dia.', 'a citação não muda');
});

// ── o e-mail da nota vira os dados da cobrança ─────────────────────────────

const mensagem = (o: Partial<{ messageId: string; assunto: string; remetente: string; recebidoEm: Date | null; texto: string; referencias: string[] }> = {}) => ({
  messageId: '<cob-nota-1@enel.test>', assunto: 'RE: TROCA DE RELÓGIO - NT 391000010',
  remetente: 'Canal GD <canalgd.sp@br.enel.com>', recebidoEm: new Date('2026-10-01T15:00:00Z'),
  texto: AGENDADA, referencias: ['<cob-pedido@exemplo.test>'], ...o,
});
const AGORA = new Date('2026-10-24T12:00:00Z');

test('cobrancaDaMensagem: a troca agendada vira a cobrança, com a nota canônica e tudo o que a resposta precisa', () => {
  assert.deepEqual(cobrancaDaMensagem(classificarCorpo(AGENDADA), mensagem(), AGORA), {
    tipo: 'nota',
    dados: {
      nota: NOTA12, dataNota: '2026-10-01T15:00:00.000Z', prazoDias: 7,
      para: 'canalgd.sp@br.enel.com', assunto: 'RE: TROCA DE RELÓGIO - NT 391000010',
      inReplyTo: '<cob-nota-1@enel.test>', referencias: ['<cob-pedido@exemplo.test>', '<cob-nota-1@enel.test>'],
    },
  });
});

test('cobrancaDaMensagem: a nota escrita com 11 ou com 12 dígitos dá a mesma cobrança (não duplica)', () => {
  const com12 = AGENDADA.replace(NOTA11, NOTA12);
  assert.notEqual(com12, AGENDADA);
  const a = cobrancaDaMensagem(classificarCorpo(AGENDADA), mensagem(), AGORA);
  const b = cobrancaDaMensagem(classificarCorpo(com12), mensagem({ texto: com12 }), AGORA);
  assert.deepEqual(a, b);
});

test('cobrancaDaMensagem: o reenvio da nota (troca que falhou COM o número) reabre a mesma nota, sem prazo', () => {
  const r = cobrancaDaMensagem(classificarCorpo(REENVIO), mensagem({ texto: REENVIO }), AGORA);
  assert.equal(r.tipo, 'nota');
  if (r.tipo === 'nota') { assert.equal(r.dados.nota, NOTA12); assert.equal(r.dados.prazoDias, null); }
});

test('cobrancaDaMensagem: falha SEM número, vistoria, carta ou nada = nenhuma', () => {
  assert.deepEqual(cobrancaDaMensagem(classificarCorpo(FALHA_SEM_NOTA), mensagem({ texto: FALHA_SEM_NOTA }), AGORA), { tipo: 'nenhuma' });
  assert.deepEqual(cobrancaDaMensagem({ tipo: 'resultado_vistoria', aprovada: true }, mensagem(), AGORA), { tipo: 'nenhuma' });
  assert.deepEqual(cobrancaDaMensagem(null, mensagem(), AGORA), { tipo: 'nenhuma' });
});

test('cobrancaDaMensagem: a troca/reprogramação JÁ FEITA não abre cobrança (ela encerra)', () => {
  for (const texto of [TROCA_REALIZADA, NOTA_EXECUTADA, REPROGRAMACAO_EXECUTADA, JA_HOUVE_A_REPROGRAMACAO]) {
    assert.deepEqual(cobrancaDaMensagem(classificarCorpo(texto), mensagem({ texto }), AGORA), { tipo: 'nenhuma' }, texto.slice(0, 50));
  }
});

test('cobrancaDaMensagem: remetente que só PARECE da ENEL não vira cobrança', () => {
  for (const remetente of ['Canal <canalgd.sp@br.enel.com.exemplo.test>', 'x%evil.com@enel.com', 'Fulano <fulano@exemplo.test>', '', 'a <x@enel.com>, b <y@enel.com>']) {
    assert.deepEqual(
      cobrancaDaMensagem(classificarCorpo(AGENDADA), mensagem({ remetente }), AGORA),
      { tipo: 'fora_da_enel' },
      remetente,
    );
  }
});

test('cobrancaDaMensagem: nota sem número legível ainda vira cobrança (a tela pede conferir)', () => {
  const sem = 'Nota de serviço criada , para a troca do medidor bidirecional, com o prazo de execução de até 7 dias úteis.';
  const r = cobrancaDaMensagem(classificarCorpo(sem), mensagem({ texto: sem }), AGORA);
  assert.equal(r.tipo, 'nota');
  if (r.tipo === 'nota') assert.equal(r.dados.nota, null);
});

test('cobrancaDaMensagem: só a NT no texto (9 dígitos) também deixa a nota sem número', () => {
  const nt = 'Nota de serviço criada para a troca do medidor bidirecional da NT 391000010, com o prazo de execução de até 7 dias úteis.';
  const r = cobrancaDaMensagem(classificarCorpo(nt), mensagem({ texto: `${nt} Ver nota 391000010.` }), AGORA);
  assert.equal(r.tipo, 'nota');
  if (r.tipo === 'nota') assert.equal(r.dados.nota, null);
});

test('cobrancaDaMensagem: sem data no e-mail vale a hora da leitura; prazo absurdo vira nulo', () => {
  const r = cobrancaDaMensagem({ tipo: 'troca_relogio', estado: 'agendada', prazoDias: 999 }, mensagem({ recebidoEm: null }), AGORA);
  assert.equal(r.tipo, 'nota');
  if (r.tipo === 'nota') { assert.equal(r.dados.dataNota, AGORA.toISOString()); assert.equal(r.dados.prazoDias, null); }
  const ruim = cobrancaDaMensagem({ tipo: 'troca_relogio', estado: 'agendada', prazoDias: 7 }, mensagem({ recebidoEm: new Date('lixo') }), AGORA);
  assert.equal(ruim.tipo, 'nota');
  if (ruim.tipo === 'nota') assert.equal(ruim.dados.dataNota, AGORA.toISOString(), 'data inválida não derruba o run');
});

test('cobrancaDaMensagem: prazo de 1 a 365 dias vale; 0 e 366 viram nulo', () => {
  const prazo = (prazoDias: number) => {
    const r = cobrancaDaMensagem({ tipo: 'troca_relogio', estado: 'agendada', prazoDias }, mensagem(), AGORA);
    return r.tipo === 'nota' ? r.dados.prazoDias : 'sem nota';
  };
  assert.equal(prazo(1), 1);
  assert.equal(prazo(365), 365);
  assert.equal(prazo(0), null);
  assert.equal(prazo(366), null);
});

test('cobrancaDaMensagem: sem o cabeçalho References, só a nota', () => {
  const r = cobrancaDaMensagem(classificarCorpo(AGENDADA), { ...mensagem(), referencias: undefined }, AGORA);
  if (r.tipo !== 'nota') throw new Error('esperava nota');
  assert.deepEqual(r.dados.referencias, ['<cob-nota-1@enel.test>']);
});

test('trocaFoiRealizada: a troca feita e a reprogramação feita; nada mais', () => {
  assert.equal(trocaFoiRealizada(classificarCorpo(TROCA_REALIZADA)), true);
  assert.equal(trocaFoiRealizada(classificarCorpo(NOTA_EXECUTADA)), true);
  assert.equal(trocaFoiRealizada(classificarCorpo(REPROGRAMACAO_EXECUTADA)), true, 'reprogramação executada = serviço feito');
  assert.equal(trocaFoiRealizada(classificarCorpo(JA_HOUVE_A_REPROGRAMACAO)), true, '"já houve a reprogramação"');
  assert.equal(trocaFoiRealizada(classificarCorpo(AGENDADA)), false);
  assert.equal(trocaFoiRealizada(classificarCorpo(REENVIO)), false);
  assert.equal(trocaFoiRealizada(classificarCorpo(FALHA_SEM_NOTA)), false);
  assert.equal(trocaFoiRealizada({ tipo: 'resultado_vistoria', aprovada: true }), false);
  assert.equal(trocaFoiRealizada({ tipo: 'troca_relogio', estado: 'agendada', prazoDias: 7 }), false);
  assert.equal(trocaFoiRealizada(null), false);
});

// ── a trava do envio no worker ─────────────────────────────────────────────

const ESTADO: EstadoDoEnvio = {
  situacaoAnterior: 'aguardando_envio', aprovadaPor: 'pessoa-1', ultimaEnviadaEm: null,
  para: 'canalgd.sp@br.enel.com', texto: 'Prezados, bom dia.\n\nTexto aprovado de exemplo.',
};
const DIA = 86_400_000;

test('podeEnviar: aprovada, esperando, para a ENEL, com texto = pode', () => {
  assert.deepEqual(podeEnviar(ESTADO, AGORA), { ok: true });
});

test('podeEnviar: sem a pessoa que aprovou = não', () => {
  for (const aprovadaPor of [null, '']) {
    const r = podeEnviar({ ...ESTADO, aprovadaPor }, AGORA);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.motivo, /aprovada por uma pessoa/);
  }
});

test('podeEnviar: fora de aguardando_envio, fora da ENEL ou sem texto = não', () => {
  assert.equal(podeEnviar({ ...ESTADO, situacaoAnterior: 'agendada' }, AGORA).ok, false);
  assert.equal(podeEnviar({ ...ESTADO, situacaoAnterior: null }, AGORA).ok, false);
  assert.equal(podeEnviar({ ...ESTADO, para: 'canal@exemplo.test' }, AGORA).ok, false);
  assert.equal(podeEnviar({ ...ESTADO, para: 'x%evil.com@enel.com' }, AGORA).ok, false);
  assert.equal(podeEnviar({ ...ESTADO, para: 'Canal <canalgd.sp@br.enel.com>' }, AGORA).ok, false, 'tem de vir normalizado');
  assert.equal(podeEnviar({ ...ESTADO, para: null }, AGORA).ok, false);
  assert.equal(podeEnviar({ ...ESTADO, texto: '   ' }, AGORA).ok, false);
  assert.equal(podeEnviar({ ...ESTADO, texto: null }, AGORA).ok, false);
});

test('podeEnviar: 7 dias cravados desde o último envio pode; um minuto antes, não; data ilegível, não', () => {
  const ha = (ms: number) => new Date(AGORA.getTime() - ms).toISOString();
  assert.equal(podeEnviar({ ...ESTADO, ultimaEnviadaEm: ha(7 * DIA) }, AGORA).ok, true);
  assert.equal(podeEnviar({ ...ESTADO, ultimaEnviadaEm: ha(30 * DIA) }, AGORA).ok, true);
  assert.equal(podeEnviar({ ...ESTADO, ultimaEnviadaEm: ha(7 * DIA - 60_000) }, AGORA).ok, false);
  assert.equal(podeEnviar({ ...ESTADO, ultimaEnviadaEm: ha(DIA) }, AGORA).ok, false);
  assert.equal(podeEnviar({ ...ESTADO, ultimaEnviadaEm: ha(-DIA) }, AGORA).ok, false, 'envio "no futuro" também trava');
  assert.equal(podeEnviar({ ...ESTADO, ultimaEnviadaEm: 'ontem' }, AGORA).ok, false);
});
