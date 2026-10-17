// worker/ludmilla/test/enel-classificar.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classificarAssunto, classificarCorpo, semCitacao } from '../src/email/enel/classificar.js';

const VISTORIA_OK = 'INTERNAL Prezado(a) Senhor(a), Informamos que após realização da vistoria através de relatorio fotográfico, a vistoria do sistema de microgeração fotovoltaica está APROVADA. Importante: Quaisquer itens não visíveis…';
const TROCA_AGENDADA = 'Prezado Luiz, boa tarde! Nota de serviço criada 400012345678 , na data de 01/10/2026 , referente a instalação 2222222222 , para a troca do medidor bidirecional, com o prazo de execução de até 7 dias úteis. Protocolo: 9876543210 . Atenciosamente';
const TROCA_FALHOU = 'Prezado(a), bom dia! Identificamos pelo registro em sistema que a tentativa de troca do medidor no dia 15/09 , não foi executada pelo seguinte motivo: Cliente Não Permitiu Execução. Reenviamos a nota de serviço 400012345678 , referente a instalação 2222222222 , para a troca do medidor bidirecional, com o prazo de execução de até 5 dias úteis. -------------- Mensagem original -------------- De: Equipe [equipe@exemplo.com] Assunto: TROCA DE RELOGIO Prezado, nota de serviço criada 400099999999 para a troca do medidor';
// A parte da mensagem de falha que repete o "agendada": a falha tem de vencer.
const REENVIO = 'Reenviamos a nota de serviço 400012345678 , referente a instalação 2222222222 , para a troca do medidor bidirecional, com o prazo de execução de até 5 dias úteis.';

test('vistoria aprovada no corpo', () => {
  assert.deepEqual(classificarCorpo(VISTORIA_OK), { tipo: 'resultado_vistoria', aprovada: true });
});

test('vistoria reprovada no corpo', () => {
  assert.deepEqual(classificarCorpo('Informamos que a vistoria do sistema de microgeração está REPROVADA pelos motivos abaixo'),
    { tipo: 'resultado_vistoria', aprovada: false });
});

test('troca agendada, com o prazo', () => {
  assert.deepEqual(classificarCorpo(TROCA_AGENDADA), { tipo: 'troca_relogio', estado: 'agendada', prazoDias: 7 });
});

test('troca agendada na outra redação ("o prazo para execução é de até")', () => {
  const r = classificarCorpo('informamos que a nota de serviço 400012345678 , referente a instalação: 2222222222 , para a troca do medidor bidirecional, foi criada em 01/10/2026 , o prazo para execução é de até 10 dias úteis.');
  assert.deepEqual(r, { tipo: 'troca_relogio', estado: 'agendada', prazoDias: 10 });
});

test('troca que FALHOU vence o "nota de serviço" da mesma mensagem, e traz o motivo', () => {
  const r = classificarCorpo(TROCA_FALHOU);
  assert.equal(r?.tipo, 'troca_relogio');
  assert.equal(r && r.tipo === 'troca_relogio' && r.estado, 'nao_executada');
  // o trecho do texto ORIGINAL (maiúsculas e acentos), não a versão normalizada
  assert.equal((r as { motivo: string }).motivo, 'Cliente Não Permitiu Execução');
});

test('a citação não conta: só a parte nova da mensagem', () => {
  const corpo = 'Prezado, segue. -------------- Mensagem original -------------- A vistoria do sistema está APROVADA.';
  assert.equal(classificarCorpo(corpo), null);
  assert.equal(semCitacao('Novo. Em qua., 10 de set. de 2026 às 10:00, Canal GD <canalgd.sp@br.enel.com> escreveu: velho'), 'Novo. ');
});

test('o que está CITADO (o pedido nosso, o histórico) não vira resultado nem troca', () => {
  // A parte nova não diz nada. Só o corte da citação impede que o histórico
  // ("a vistoria … está APROVADA", "nota de serviço … troca do medidor") classifique.
  const nova = 'Prezado, recebemos o seu pedido e vamos analisar.';
  const citadoVistoria = 'A NT 123456789 foi aprovada: a vistoria do sistema de microgeração fotovoltaica está APROVADA na etapa de vistoria.';
  const citadoTroca = 'Nota de serviço criada 400012345678 para a troca do medidor bidirecional, com o prazo de execução de até 5 dias úteis.';
  assert.equal(classificarCorpo(`${nova} -------------- Mensagem original -------------- ${citadoVistoria}`), null);
  assert.equal(classificarCorpo(`${nova} -------------- Mensagem original -------------- ${citadoTroca}`), null);
  // e a parte nova, sozinha, ainda classifica
  assert.deepEqual(classificarCorpo(citadoVistoria), { tipo: 'resultado_vistoria', aprovada: true });
});

test('resposta automática e corpo vazio não classificam', () => {
  assert.equal(classificarCorpo('Olá, Informamos que seu e-mail foi recebido com sucesso, gerando o número de atendimento SF0123456789'), null);
  assert.equal(classificarCorpo(''), null);
  assert.equal(classificarCorpo(null), null);
});

// ---------------------------------------------------------------------------
// I-1: a troca que FALHOU tem três redações reais, e vence o "agendada"
// ---------------------------------------------------------------------------

test('troca que falhou: "não sendo executada pelo seguinte motivo"', () => {
  const r = classificarCorpo('Prezado(a), bom dia! Identificamos que a equipe compareceu ao local para tentativa de troca do medidor no dia 21/08/2026, não sendo executada pelo seguinte motivo: Cliente Não Permitiu Execução . Realizamos o reenviamos da nota de serviço 400012345678, referente a instalação 2222222222, para a troca do medidor bidirecional, com o prazo de execução de até 5 dias úteis.');
  assert.deepEqual(r, { tipo: 'troca_relogio', estado: 'nao_executada', motivo: 'Cliente Não Permitiu Execução' });
});

test('troca que falhou: "Motivo da rejeição" sem dois-pontos e com a data colada', () => {
  const r = classificarCorpo(`Prezado(a), bom dia! ${REENVIO} Motivo da rejeição Cliente Não Permitiu Execução 21.08.2026 Protocolo: 9876543210 . Atenciosamente`);
  assert.deepEqual(r, { tipo: 'troca_relogio', estado: 'nao_executada', motivo: 'Cliente Não Permitiu Execução' });
});

test('troca que falhou: "Motivo da rejeição:" com "em <data>" e com ponto antes da data', () => {
  const comEm = classificarCorpo(`${REENVIO} Motivo da rejeição: Fechado Sem Acesso ao Centro de Medição em 14.05.2026 Protocolo: 9876543210 . Atenciosamente`);
  assert.deepEqual(comEm, { tipo: 'troca_relogio', estado: 'nao_executada', motivo: 'Fechado Sem Acesso ao Centro de Medição' });
  const comPonto = classificarCorpo(`${REENVIO} Motivo da rejeição: Fechado Sem Acesso ao Centro de Medição. 06.10.2026 Protocolo: 9876543210 . Atenciosamente`);
  assert.deepEqual(comPonto, { tipo: 'troca_relogio', estado: 'nao_executada', motivo: 'Fechado Sem Acesso ao Centro de Medição' });
});

test('"não foi executada" fora da troca do medidor não vira troca que falhou', () => {
  assert.equal(classificarCorpo('A visita não foi executada pelo seguinte motivo: chuva forte no local.'), null);
});

// ---------------------------------------------------------------------------
// M-4: o motivo termina onde a frase termina e não vaza para o sino
// ---------------------------------------------------------------------------

test('o motivo para antes de "Reenviamos", "Realizamos", "Protocolo" e "nota de serviço"', () => {
  const abertura = 'Identificamos que a tentativa de troca do medidor no dia 21/08, não foi executada pelo seguinte motivo: Cliente Não Permitiu Execução';
  for (const seguinte of [
    'Reenviamos a nota de serviço 400012345678 , referente a instalação 2222222222 , para a troca do medidor',
    'Realizamos o reenvio da nota 400012345678 , referente a instalação 2222222222',
    'Protocolo: 9876543210 , referente a instalação 2222222222',
    'Nota de serviço 400012345678 , referente a instalação 2222222222',
  ]) {
    const r = classificarCorpo(`${abertura} ${seguinte}`);
    assert.equal(r && r.tipo === 'troca_relogio' && r.estado === 'nao_executada' && r.motivo, 'Cliente Não Permitiu Execução', seguinte);
  }
});

test('o motivo tem no máximo ~80 caracteres e não termina no meio de uma palavra', () => {
  const r = classificarCorpo(`Identificamos que a tentativa de troca do medidor não foi executada pelo seguinte motivo: ${'Palavra '.repeat(40)}`);
  const motivo = r && r.tipo === 'troca_relogio' && r.estado === 'nao_executada' ? r.motivo : null;
  assert.ok(motivo, 'devia ter motivo');
  assert.ok(motivo.length <= 80, `motivo com ${motivo.length} caracteres`);
  assert.ok(motivo.endsWith('Palavra'), motivo);
});

// ---------------------------------------------------------------------------
// I-2: negação e "o projeto foi aprovado" não viram resultado da vistoria
// ---------------------------------------------------------------------------

test('vistoria com negação não é aprovada (na dúvida, null: a robô só anota)', () => {
  assert.equal(classificarCorpo('Informamos que a vistoria do sistema de microgeração não foi aprovada, conforme apontamentos abaixo.'), null);
  assert.equal(classificarCorpo('Informamos que a vistoria ainda não está aprovada.'), null);
  assert.equal(classificarCorpo('A VISTORIA NÃO ESTÁ APROVADA.'), null);
  assert.equal(classificarCorpo('Informamos que a vistoria do sistema de microgeração não foi reprovada.'), null);
});

test('o "aprovado" do projeto não é o da vistoria', () => {
  assert.equal(classificarCorpo('Sua solicitação de vistoria foi registrada e o projeto foi aprovado.'), null);
  assert.equal(classificarCorpo('A vistoria será agendada e o projeto está aprovado.'), null);
  // sem "e" no caminho: só o outro verbo ("foi registrada", "está agendada") segura
  assert.equal(classificarCorpo('Sua solicitação de vistoria foi registrada, o projeto foi aprovado.'), null);
  assert.equal(classificarCorpo('A vistoria está agendada, o projeto está aprovado.'), null);
  // sem outro verbo no caminho: só a conjunção segura
  assert.equal(classificarCorpo('A vistoria agendada para amanhã e o cadastro aprovado, tudo certo, está aprovado.'), null);
});

test('negação ANTES da vistoria, na mesma frase, também anula', () => {
  assert.equal(classificarCorpo('Não foi possível confirmar que a vistoria foi aprovada.'), null);
  // mas a negação de OUTRA frase não atrapalha
  assert.deepEqual(classificarCorpo('Não responda a este e-mail. Informamos que a vistoria do sistema está APROVADA.'),
    { tipo: 'resultado_vistoria', aprovada: true });
});

test('as redações reais de aprovada e reprovada continuam casando', () => {
  const reprovadaComNaoDepois = classificarCorpo('INTERNAL Prezado(a) cliente, Informamos que a vistoria foi reprovada em razão do não atendimento aos requisitos normativos.');
  assert.deepEqual(reprovadaComNaoDepois, { tipo: 'resultado_vistoria', aprovada: false });
  assert.deepEqual(classificarCorpo('Informamos que após a vistoria da microgeração fotovoltaica do endereço acima, foi aprovada. A Distribuidora não possui responsabilidade'),
    { tipo: 'resultado_vistoria', aprovada: true });
  assert.deepEqual(classificarCorpo('Prezado, informamos que a vistoria está reprovada, conforme apontamentos técnicos abaixo: Motivos'),
    { tipo: 'resultado_vistoria', aprovada: false });
  assert.deepEqual(classificarCorpo('a vistoria do sistema de mini geração fotovoltaica está APROVADO. Importante: Quaisquer itens não visíveis'),
    { tipo: 'resultado_vistoria', aprovada: true });
});

// ---------------------------------------------------------------------------
// M-1: o texto chega ACHATADO (caixa.ts troca todo \s+ por um espaço): cada
// marca de citação tem de funcionar sem quebra de linha
// ---------------------------------------------------------------------------

const CITADO = 'A vistoria do sistema de microgeração fotovoltaica está APROVADA.';

test('citação achatada: "Mensagem original" e "Original Message"', () => {
  assert.equal(semCitacao(`Ciente. -------------- Mensagem original -------------- ${CITADO}`), 'Ciente. ');
  assert.equal(semCitacao(`Ciente. -----Original Message----- ${CITADO}`), 'Ciente. ');
});

test('citação achatada: "Em … escreveu:" do Gmail', () => {
  const corpo = `Ciente. Em qua., 10 de set. de 2026 às 10:00, Canal GD <canalgd.sp@br.enel.com> escreveu: ${CITADO}`;
  assert.equal(semCitacao(corpo), 'Ciente. ');
  assert.equal(classificarCorpo(corpo), null);
});

test('citação achatada: cabeçalho do Outlook "De: … Enviado em: …"', () => {
  for (const rotulo of ['Enviado em:', 'Enviada em:', 'Enviado(a) em:', 'Enviado:']) {
    const corpo = `Segue ciente. De: Equipe GD [equipe@exemplo.com] ${rotulo} quarta-feira, 10 de setembro de 2026 10:00 Para: Luiz Assunto: VISTORIA ${CITADO}`;
    assert.equal(semCitacao(corpo), 'Segue ciente. ', rotulo);
    assert.equal(classificarCorpo(corpo), null, rotulo);
  }
});

test('citação achatada: cabeçalho do Outlook em inglês "From: … Sent: …"', () => {
  const corpo = `Ok, thanks. From: Team GD <equipe@exemplo.com> Sent: Wednesday, September 10, 2026 10:00 AM To: Luiz Subject: VISTORIA ${CITADO}`;
  assert.equal(semCitacao(corpo), 'Ok, thanks. ');
  assert.equal(classificarCorpo(corpo), null);
});

test('citação achatada: marcador ">" de resposta', () => {
  const corpo = `Ciente. > ${CITADO} > mais um trecho do histórico`;
  assert.equal(semCitacao(corpo), 'Ciente.');
  assert.equal(classificarCorpo(corpo), null);
  assert.equal(semCitacao(`> ${CITADO}`), '');
});

test('"De:" sem "Enviado" por perto não é citação', () => {
  // o rótulo isolado, na parte nova, não pode engolir a mensagem
  assert.deepEqual(classificarCorpo(`Resultado De: Teste. ${CITADO}`), { tipo: 'resultado_vistoria', aprovada: true });
  assert.equal(semCitacao('Obrigado pela atenção, aguardo retorno. >=5 dias'), 'Obrigado pela atenção, aguardo retorno. >=5 dias');
});

// ---------------------------------------------------------------------------
// M-2: "Em … escreveu:" corta no "Em" mais perto do "escreveu:"
// ---------------------------------------------------------------------------

test('o "em" da parte nova não vira o começo da citação', () => {
  const cabecalho = 'Em seg., 12 de out. de 2026 às 09:00, Canal GD <canalgd.sp@br.enel.com> escreveu: texto antigo';
  const minusculo = `Olá, em resposta ao seu pedido, a vistoria do sistema está APROVADA. ${cabecalho}`;
  assert.deepEqual(classificarCorpo(minusculo), { tipo: 'resultado_vistoria', aprovada: true });
  const maiusculo = `Em resposta ao seu pedido, a vistoria do sistema está APROVADA. ${cabecalho}`;
  assert.deepEqual(classificarCorpo(maiusculo), { tipo: 'resultado_vistoria', aprovada: true });
  assert.equal(semCitacao(maiusculo), 'Em resposta ao seu pedido, a vistoria do sistema está APROVADA. ');
});

// ---------------------------------------------------------------------------
// Entrada enorme: nenhuma marca pode ser quadrática (o revisor mediu 5 a 11 s)
// ---------------------------------------------------------------------------

test('muitas linhas em branco não deixam a leitura lenta', () => {
  for (const enchimento of ['\n', ' ', '\n \n', 'Em ', 'De: ']) {
    const inicio = Date.now();
    const r = classificarCorpo(`${enchimento.repeat(100000)} Informamos que a vistoria do sistema está APROVADA.`);
    const ms = Date.now() - inicio;
    assert.ok(ms < 1500, `enchimento ${JSON.stringify(enchimento)} levou ${ms} ms`);
    if (enchimento === '\n' || enchimento === ' ' || enchimento === '\n \n') {
      assert.deepEqual(r, { tipo: 'resultado_vistoria', aprovada: true });
    }
  }
});

// ---------------------------------------------------------------------------
// O resultado no ASSUNTO — os avisos do atendimento.edsp (21 de 21 e-mails)
// ---------------------------------------------------------------------------

test('assunto: "Vistoria aprovada" do atendimento.edsp', () => {
  assert.deepEqual(classificarAssunto('Comunicado técnico sobre a nota: 390698066 - Vistoria aprovada'),
    { tipo: 'resultado_vistoria', aprovada: true });
});

test('assunto: "Vistoria reprovada" do atendimento.edsp', () => {
  assert.deepEqual(classificarAssunto('Comunicado técnico sobre a nota: 391813988 - Vistoria reprovada'),
    { tipo: 'resultado_vistoria', aprovada: false });
});

test('assunto da própria equipe não casa (o padrão é estrito)', () => {
  assert.equal(classificarAssunto('RE: VISTORIA - NIKSON AMARAL DA SILVA - NT 390698066'), null);
  assert.equal(classificarAssunto('Resposta Automática - VISTORIA - TALICE FERREIRA DE AGUIAR - NT 392065341'), null);
  // o resultado deste vem no corpo
  assert.equal(classificarAssunto('VISTORIA GD 391901851 - R STO ANTONIO 196'), null);
});

test('assunto: dizer "vistoria aprovada" sem o "nota: <NT> -" não basta', () => {
  // Pega o padrão solto (/vistoria\s+(aprovad|reprovad)/): estes assuntos têm a
  // palavra, mas não são o aviso por projeto do atendimento.edsp.
  assert.equal(classificarAssunto('Vistoria aprovada - NT 390698066'), null);
  assert.equal(classificarAssunto('RE: Vistoria reprovada - NIKSON AMARAL DA SILVA'), null);
  assert.equal(classificarAssunto('Comunicado técnico sobre a nota: Vistoria aprovada'), null);
  assert.equal(classificarAssunto('Comunicado técnico sobre a nota: 390698066 - Troca do medidor - Vistoria aprovada'), null);
});

test('assunto: âncora no começo e no fim (M-5)', () => {
  // sufixo: "aprovada com ressalvas" não é aprovada, só anota
  assert.equal(classificarAssunto('Comunicado técnico sobre a nota: 390698066 - Vistoria aprovada com ressalvas'), null);
  assert.equal(classificarAssunto('Comunicado técnico sobre a nota: 391813988 - Vistoria reprovada - segunda análise'), null);
  // prefixo: resposta/encaminhamento de alguém da equipe
  assert.equal(classificarAssunto('RE: Comunicado técnico sobre a nota: 390698066 - Vistoria aprovada'), null);
  assert.equal(classificarAssunto('ENC: Comunicado técnico sobre a nota: 390698066 - Vistoria reprovada'), null);
  // espaços nas pontas e na caixa não atrapalham
  assert.deepEqual(classificarAssunto('  COMUNICADO TÉCNICO SOBRE A NOTA: 390698066 - VISTORIA APROVADA  '),
    { tipo: 'resultado_vistoria', aprovada: true });
});

test('assunto: nulo e vazio não classificam', () => {
  assert.equal(classificarAssunto(null), null);
  assert.equal(classificarAssunto(undefined), null);
  assert.equal(classificarAssunto(''), null);
});
