// worker/ludmilla/test/enel-decidir.test.ts
// As decisões puras do run da ENEL: ler o PDF (pagar IA)?, que etapa sugerir, a
// sugestão cabe?, que aviso tocar, que janela de busca, quais remetentes, a NT que
// vira protocolo e a trava do titular. Dados 100% inventados.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import {
  avisosEnel, deveAvisar, janelaDeBusca, precisaLerPdf, recomendacaoCabe, recomendacaoEnel, remetentesDoRun,
  remetentesParaBuscar, titularDeOutraPessoa, trocaDeProtocolo,
} from '../src/email/enel/decidir.js';
import { classificarErroEmail } from '../src/erros.js';
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
  // a regra: a vistoria reprovada cabe em Aprovado (a ENEL vistoriou antes do nosso pedido) e em Vistoria solicitada
  assert.equal(recomendacaoCabe('vistoria_reprovada', 'approved'), true);
  assert.equal(recomendacaoCabe('vistoria_reprovada', 'completed'), false);
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

test('I-2: a janela é FIXA em 120 dias, em todo run (a retentativa e o "Ler de novo" alcançam e-mail antigo)', () => {
  assert.equal(janelaDeBusca(new Date('2026-10-13T12:00:00Z')).toISOString(), '2026-06-15T12:00:00.000Z');
  assert.equal(janelaDeBusca(new Date('2026-12-01T00:00:00Z')).toISOString(), '2026-08-03T00:00:00.000Z');
});

// Decisão do usuário (24/10/2026): a janela lê 120 dias, mas o sino só toca para e-mail de até 30.
const AGORA_AVISO = new Date('2026-10-24T12:00:00Z');
const HA = (dias: number, minutos = 0) => new Date(AGORA_AVISO.getTime() - dias * 86_400_000 - minutos * 60_000);

test('deveAvisar: sem data, na dúvida, avisa', () => {
  assert.equal(deveAvisar(null, AGORA_AVISO), true);
  assert.equal(deveAvisar(new Date('data inválida'), AGORA_AVISO), true);
});
test('deveAvisar: e-mail de 29 dias avisa', () => {
  assert.equal(deveAvisar(HA(29), AGORA_AVISO), true);
});
test('deveAvisar: com EXATAMENTE 30 dias ainda avisa; com 30 dias e 1 minuto já não', () => {
  assert.equal(deveAvisar(HA(30), AGORA_AVISO), true);
  assert.equal(deveAvisar(HA(30, 1), AGORA_AVISO), false);
});
test('deveAvisar: e-mail de 31 dias (ou de 119) não avisa', () => {
  assert.equal(deveAvisar(HA(31), AGORA_AVISO), false);
  assert.equal(deveAvisar(HA(119), AGORA_AVISO), false);
});
test('deveAvisar: data no futuro (relógio da caixa adiantado) avisa', () => {
  assert.equal(deveAvisar(new Date(AGORA_AVISO.getTime() + 3_600_000), AGORA_AVISO), true);
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

test('M-6: regras sem remetente nenhum (ou só comunicado) é ERRO de regras, não run "ok" com 0 lidos', () => {
  const regras = [R({ remetente: null }), R({ remetente: 'avisos.gerais@enel.test', tipo_documento: 'comunicado' })];
  assert.throws(() => remetentesDoRun(regras), (e: unknown) => classificarErroEmail(e).classe === 'sem_regras');
  assert.throws(() => remetentesDoRun([]), (e: unknown) => classificarErroEmail(e).classe === 'sem_regras');
  assert.deepEqual(remetentesDoRun([R({ remetente: 'nao.responda@enel.com' })]), ['nao.responda@enel.com']);
});

// ── R3 + I-3: a NT da Carta que o cartão sugere gravar ──────────────────────────

const CARTA = { ok: true, tipo: 'carta_projeto', nt: '391000001' };
/** o projeto como a troca o vê; `analysis` (antes da Carta) quando o teste não diz */
const P = (o: { protocolo: string | null; uc: string | null; status?: string }) => ({ status: 'analysis', ...o });
const SEM = P({ protocolo: 'Sem protocolo', uc: '0077001122' });
const NENHUMA = { tipo: 'nenhuma' };
const pede = (nt: string) => ({ tipo: 'pedir', nt });

test('R3: Carta com NT e cadastro sem protocolo (texto, vazio ou null) → pede gravar a NT', () => {
  assert.deepEqual(trocaDeProtocolo(CARTA, SEM, false), pede('391000001'));
  assert.deepEqual(trocaDeProtocolo(CARTA, P({ protocolo: '', uc: null }), false), pede('391000001'));
  assert.deepEqual(trocaDeProtocolo(CARTA, P({ protocolo: null, uc: null }), false), pede('391000001'));
});
test('R3: NT diferente do protocolo do cadastro, sugestão não barrada → pede', () => {
  assert.deepEqual(trocaDeProtocolo(CARTA, P({ protocolo: '391000777', uc: null }), false), pede('391000001'));
});
test('R3: NT igual ao protocolo (zeros à esquerda, pontuação, dois números no cadastro) → nenhuma', () => {
  for (const protocolo of ['0391000001', 'NT 391.000.001', '391000777 / 391000001']) {
    assert.deepEqual(trocaDeProtocolo(CARTA, P({ protocolo, uc: null }), false), NENHUMA, protocolo);
  }
  assert.deepEqual(trocaDeProtocolo({ ...CARTA, nt: '0391000001' }, P({ protocolo: '391000001', uc: null }), false), NENHUMA);
});
test('I-3b: a NT tem EXATAMENTE 9 dígitos (sem os zeros à esquerda)', () => {
  // "NT 391000001 (SF 01234)" colado pelo numeroOuNulo da edge function vira 14 dígitos
  for (const nt of ['39100000101234', '3910000011', '39100001', '000039100001']) {
    assert.deepEqual(trocaDeProtocolo({ ...CARTA, nt }, SEM, false), NENHUMA, nt);
  }
  assert.deepEqual(trocaDeProtocolo({ ...CARTA, nt: '000391000001' }, SEM, false), pede('391000001'));
});
test('I-3a: a "NT" é a UC do próprio projeto (a IA trocou o campo) → nenhuma', () => {
  assert.deepEqual(trocaDeProtocolo({ ...CARTA, nt: '391000005' }, P({ protocolo: 'Sem protocolo', uc: '0391000005' }), false), NENHUMA);
  assert.deepEqual(trocaDeProtocolo({ ...CARTA, nt: '391000005' }, P({ protocolo: null, uc: '0055001001 / 0391000005' }), false), NENHUMA);
});
test('I-3c: projeto com protocolo numérico e etapa barrada por estar à frente → só conferir, NÃO pede', () => {
  assert.deepEqual(trocaDeProtocolo({ ...CARTA, nt: '391000111' }, P({ protocolo: '391000222', uc: null }), true),
    { tipo: 'conferir', nt: '391000111', doCadastro: '391000222' });
});
test('N1: projeto com protocolo numérico que JÁ PASSOU da fase da Carta → só conferir, mesmo sem etapa barrada', () => {
  // a Carta antiga inconclusiva não sugere etapa nenhuma: `etapaBarrada` é false
  for (const status of ['approved', 'vistoria_solicitada', 'completed']) {
    assert.deepEqual(trocaDeProtocolo({ ...CARTA, nt: '391000111' }, P({ protocolo: '391000222', uc: null, status }), false),
      { tipo: 'conferir', nt: '391000111', doCadastro: '391000222' }, status);
  }
});
test('N1 controle: antes da fase da Carta e sem etapa barrada, NT diferente → pede', () => {
  for (const status of ['pending', 'analysis', 'documentation', 'approval', 'pendencia']) {
    assert.deepEqual(trocaDeProtocolo({ ...CARTA, nt: '391000111' }, P({ protocolo: '391000222', uc: null, status }), false),
      pede('391000111'), status);
  }
});
test('I-3 controle: projeto SEM protocolo numérico, mesmo à frente → pede (o caso que motivou o pedido)', () => {
  assert.deepEqual(trocaDeProtocolo(CARTA, SEM, true), pede('391000001'));
  assert.deepEqual(trocaDeProtocolo(CARTA, P({ protocolo: 'aguardando', uc: null }), true), pede('391000001'));
  assert.deepEqual(trocaDeProtocolo(CARTA, P({ protocolo: 'Sem protocolo', uc: null, status: 'vistoria_solicitada' }), false), pede('391000001'));
});
test('R3: só a Carta, lida pela IA', () => {
  assert.deepEqual(trocaDeProtocolo({ ...CARTA, ok: false }, SEM, false), NENHUMA, 'leitura que falhou');
  assert.deepEqual(trocaDeProtocolo({ ...CARTA, tipo: 'resultado_vistoria' }, SEM, false), NENHUMA, 'não é Carta');
  assert.deepEqual(trocaDeProtocolo({ ...CARTA, tipo: null }, SEM, false), NENHUMA, 'não houve leitura');
  assert.deepEqual(trocaDeProtocolo({ ...CARTA, nt: null }, SEM, false), NENHUMA, 'a IA não achou a NT');
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
  // uma palavra só e um numeral: bate consigo mesmo, mas não tem dois nomes para comparar
  assert.equal(titularDeOutraPessoa('CONDOMINIO 2', 'HERMINIO TAVARES BRANDALISE'), false);
});
test('M-2: nome que nem bate consigo mesmo (sem dois nomes de 3+ letras) é falta de dado: não bloqueia', () => {
  // comparavelTitular diz que dá para comparar, mas mesmoTitular(n, n) = false: bloqueava o próprio nome
  assert.equal(titularDeOutraPessoa('LU SANTOS NETO', 'LU SANTOS NETO'), false);
  assert.equal(titularDeOutraPessoa('ANA ME LTDA', 'ANA ME LTDA'), false);
  assert.equal(titularDeOutraPessoa('LU SANTOS NETO', 'HERMINIO TAVARES BRANDALISE'), false);
  assert.equal(titularDeOutraPessoa('HERMINIO TAVARES BRANDALISE', 'ANA ME LTDA'), false);
});
test('R2: pessoa claramente diferente bloqueia; o mesmo nome com acento e caixa não', () => {
  assert.equal(titularDeOutraPessoa('ZULMIRA PEDROSO CAVALHEIRO', 'HERMINIO TAVARES BRANDALISE'), true);
  assert.equal(titularDeOutraPessoa('ZULMIRA PEDROSO CAVALHEIRO', 'Zulmira Pedroso Cavalheiro'), false);
});

// ── Razão social cortada no documento (decisão do usuário, 24/10/2026) ──────────
// Caso real: o PDF traz "Comercial … Recuperadora De Pecas" e o cadastro a razão social inteira,
// "… ACESSÓRIOS PARA VEÍCULOS E AUTOMOTORES LTDA". É a mesma empresa. A trava só relaxa quando o
// projeto foi achado por NÚMERO (protocolo ou UC), um dos nomes é de PJ e as palavras de um são o
// começo das do outro, com 3 ou mais significativas (conector não conta). Nomes inventados.

const PJ_CADASTRO = 'ALFA BETA COMÉRCIO DE PEÇAS , ACESSÓRIOS PARA VEÍCULOS E AUTOMOTORES LTDA';
const PJ_CORTADO = 'Alfa Beta Comercio De Pecas';

test('PJ: razão social cortada no documento, projeto achado por UC ou protocolo → mesma empresa, não bloqueia', () => {
  assert.equal(titularDeOutraPessoa(PJ_CADASTRO, PJ_CORTADO, 'uc'), false);
  assert.equal(titularDeOutraPessoa(PJ_CADASTRO, PJ_CORTADO, 'protocolo'), false);
});

test('PJ: o sentido inverso (o documento mais longo que o cadastro) também é a mesma empresa', () => {
  assert.equal(titularDeOutraPessoa(PJ_CORTADO, PJ_CADASTRO, 'uc'), false);
  assert.equal(titularDeOutraPessoa('ALFA BETA COMÉRCIO DE PEÇAS', 'Alfa Beta Comercio De Pecas, Acessorios Para Veiculos E Automotores Ltda', 'protocolo'), false);
});

test('PJ: o mesmo par com o projeto achado pelo NOME (ou sem dizer como) continua bloqueando', () => {
  assert.equal(titularDeOutraPessoa(PJ_CADASTRO, PJ_CORTADO, 'titular'), true);
  assert.equal(titularDeOutraPessoa(PJ_CORTADO, PJ_CADASTRO, 'titular'), true);
  assert.equal(titularDeOutraPessoa(PJ_CADASTRO, PJ_CORTADO), true);
  assert.equal(titularDeOutraPessoa(PJ_CADASTRO, PJ_CORTADO, null), true);
});

test('PF: pai × filho (nenhum é PJ) continua bloqueando, mesmo achado por número', () => {
  assert.equal(titularDeOutraPessoa('JOSE CARLOS SANTOS', 'JOSE CARLOS SANTOS FILHO', 'uc'), true);
  assert.equal(titularDeOutraPessoa('JOSE CARLOS SANTOS FILHO', 'JOSE CARLOS SANTOS', 'protocolo'), true);
  // nem sem sufixo de geração: prefixo de 3+ palavras entre duas pessoas físicas
  assert.equal(titularDeOutraPessoa('MARIA DAS GRACAS SILVA PEREIRA', 'MARIA DAS GRACAS SILVA', 'uc'), true);
  // dois nomes sem sufixo de empresa, mesmo com o formato de razão social, não são PJ
  assert.equal(titularDeOutraPessoa('ALFA BETA COMERCIO DE PECAS', 'ALFA BETA COMERCIO', 'uc'), true);
});

test('PJ: prefixo de só 2 palavras significativas continua bloqueando (conector não conta)', () => {
  assert.equal(titularDeOutraPessoa('ALFA BETA COMÉRCIO DE PEÇAS LTDA', 'Alfa Beta', 'uc'), true);
  assert.equal(titularDeOutraPessoa('Alfa Beta', 'ALFA BETA COMÉRCIO DE PEÇAS LTDA', 'uc'), true);
  assert.equal(titularDeOutraPessoa('ALFA DE BETA COMÉRCIO DE PEÇAS LTDA', 'Alfa De Beta', 'uc'), true);
  // com 3 significativas, passa
  assert.equal(titularDeOutraPessoa('ALFA BETA COMÉRCIO DE PEÇAS LTDA', 'Alfa Beta Comercio', 'uc'), false);
});

test('PJ: palavras diferentes no meio ou depois do prefixo: outra empresa, bloqueia', () => {
  assert.equal(titularDeOutraPessoa('ALFA BETA COMÉRCIO DE PEÇAS E ACESSÓRIOS LTDA', 'Alfa Beta Industria De Pecas', 'uc'), true);
  assert.equal(titularDeOutraPessoa('ALFA BETA COMÉRCIO DE PEÇAS E ACESSÓRIOS LTDA', 'Gama Alfa Beta Comercio De Pecas', 'uc'), true);
  assert.equal(titularDeOutraPessoa('ALFA BETA COMÉRCIO DE PEÇAS E ACESSÓRIOS LTDA', 'Alfa Beta Comercio Pecas Veiculos', 'uc'), true);
});

// ── "A troca do relógio já foi realizada" → Concluído (decisão do usuário, 24/10/2026) ──

test('troca realizada sugere Concluído, venha ou não leitura do PDF; sem sino', () => {
  const realizada = { tipo: 'troca_relogio' as const, estado: 'realizada' as const };
  assert.equal(recomendacaoEnel(realizada, { ok: true, tipo: null, veredito: null }), 'completed');
  assert.equal(recomendacaoEnel(realizada, { ok: false, tipo: null, veredito: null }), 'completed');
  // a troca agendada e a que falhou seguem sem etapa
  assert.equal(recomendacaoEnel({ tipo: 'troca_relogio', estado: 'agendada', prazoDias: 7 }, { ok: true, tipo: null, veredito: null }), null);
  assert.equal(recomendacaoEnel({ tipo: 'troca_relogio', estado: 'nao_executada', motivo: null }, { ok: true, tipo: null, veredito: null }), null);
  // o cartão basta: nada de sino
  assert.deepEqual(avisosEnel('troca_relogio', realizada, null, { codigo: 'PRJ-A' }), []);
  assert.deepEqual(avisosEnel('troca_relogio', realizada, { ok: true, tipo: null, veredito: null }, null), []);
});

test('Concluído cabe em qualquer etapa, menos em Concluído (é a última, nunca "para trás")', () => {
  for (const etapa of ['pending', 'analysis', 'documentation', 'approval', 'pendencia', 'approved', 'vistoria_solicitada', 'vistoria_reprovada']) {
    assert.equal(recomendacaoCabe('completed', etapa), true, etapa);
  }
  assert.equal(recomendacaoCabe('completed', 'completed'), false);
});

// ── A fazer da equipe: o TIPO sai do TÍTULO do aviso ────────────────────────────
// A RPC `ludmilla_email_avisar` (migração 20261022200000) deduz `portal_afazeres.tipo`
// do título que `avisosEnel` manda, por ILIKE. Se alguém reescrever o texto do aviso, o
// A fazer cairia em 'aviso' em silêncio e a tela perderia o ícone e a ação certa.
// Este teste lê o CASE da migração MAIS RECENTE que define a função e o aplica aos
// títulos reais, então cai tanto se o aviso mudar quanto se o padrão do banco mudar.
const PASTA_DAS_MIGRACOES = new URL('../../../../supabase/migrations/', import.meta.url);

interface RegrasDoTipo { padroes: Array<{ ilike: string; tipo: string }>; senao: string }

function regrasDoTipoDoAfazer(): RegrasDoTipo {
  const arquivos = readdirSync(PASTA_DAS_MIGRACOES).filter(f => f.endsWith('.sql')).sort();
  let funcao = '';
  for (const f of arquivos) {
    const sql = readFileSync(new URL(f, PASTA_DAS_MIGRACOES), 'utf8');
    const i = sql.search(/CREATE OR REPLACE FUNCTION public\.ludmilla_email_avisar\(/i);
    if (i >= 0) funcao = sql.slice(i); // a última migração que a (re)define é a que vale
  }
  assert.notEqual(funcao, '', 'nenhuma migração define ludmilla_email_avisar');
  const aposInsert = funcao.slice(funcao.search(/INSERT INTO public\.portal_afazeres/i));
  const caso = /CASE\b([\s\S]*?)\bEND\b/.exec(aposInsert);
  assert.ok(caso, 'o CASE do tipo do A fazer não foi achado na migração');
  const padroes = [...caso[1].matchAll(/WHEN\s+p_titulo\s+ILIKE\s+'([^']+)'\s+THEN\s+'([^']+)'/gi)]
    .map(m => ({ ilike: m[1], tipo: m[2] }));
  const senao = /ELSE\s+'([^']+)'/i.exec(caso[1]);
  assert.ok(senao, 'o ELSE do tipo do A fazer não foi achado na migração');
  return { padroes, senao: senao[1] };
}

/** ILIKE do Postgres: `%` = qualquer trecho, `_` = um caractere, sem diferenciar maiúscula. */
function casaIlike(padrao: string, texto: string): boolean {
  const fonte = [...padrao].map(c =>
    c === '%' ? '[\\s\\S]*' : c === '_' ? '[\\s\\S]' : c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('');
  return new RegExp(`^${fonte}$`, 'iu').test(texto);
}

/** O que o banco grava em `tipo` para este título: o primeiro WHEN que casa, senão o ELSE. */
function tipoNoBanco(titulo: string, r: RegrasDoTipo): string {
  return r.padroes.find(p => casaIlike(p.ilike, titulo))?.tipo ?? r.senao;
}

test('A fazer: o parser achou os padrões da migração (senão o teste abaixo não provaria nada)', () => {
  const r = regrasDoTipoDoAfazer();
  assert.deepEqual(r.padroes.map(p => p.tipo), ['devolucao', 'vistoria_aprovada', 'troca_falhou']);
  assert.equal(r.senao, 'aviso');
  assert.equal(casaIlike('%vistoria%aprovada%', 'Vistoria virtual APROVADA na ENEL'), true);
  assert.equal(casaIlike('%rel_gio%', 'A ENEL não trocou o relógio'), true);
  assert.equal(casaIlike('%voltou%', 'nada a ver'), false);
});

test('A fazer: os 3 títulos REAIS de avisosEnel viram o tipo certo no banco (e nenhum cai em "aviso")', () => {
  const r = regrasDoTipoDoAfazer();
  const p = { codigo: 'PRJ-A' };
  const [devolucao] = avisosEnel('devolucao', null, null, null);
  const [vistoria] = avisosEnel('resultado_vistoria', { tipo: 'resultado_vistoria', aprovada: true }, null, p);
  const [troca] = avisosEnel('troca_relogio', { tipo: 'troca_relogio', estado: 'nao_executada', motivo: 'x' }, null, p);
  assert.equal(tipoNoBanco(devolucao.titulo, r), 'devolucao', devolucao.titulo);
  assert.equal(tipoNoBanco(vistoria.titulo, r), 'vistoria_aprovada', vistoria.titulo);
  assert.equal(tipoNoBanco(troca.titulo, r), 'troca_falhou', troca.titulo);
  // o vídeo aprovado que chega pela carta (leitura do PDF) usa o mesmo título
  const [pelaCarta] = avisosEnel('carta_projeto', null, { ok: true, tipo: 'resultado_vistoria', veredito: 'favoravel' }, p);
  assert.equal(pelaCarta.titulo, vistoria.titulo);
});

test('A fazer: título que ninguém previu vira "aviso" (a tela mostra o próprio título)', () => {
  assert.equal(tipoNoBanco('📡 Algo que a ENEL mandou e ninguém previu', regrasDoTipoDoAfazer()), 'aviso');
});
