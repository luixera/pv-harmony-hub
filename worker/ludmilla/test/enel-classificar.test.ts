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

test('citação achatada: "No dia … escreveu:" e "On … wrote:"', () => {
  const noDia = `Ciente. No dia 10/09/2026 às 10:00, Canal GD <canalgd.sp@br.enel.com> escreveu: ${CITADO}`;
  assert.equal(semCitacao(noDia), 'Ciente. ');
  assert.equal(classificarCorpo(noDia), null);
  const on = `Ok. On Wed, Sep 10, 2026 at 10:00 AM Canal GD <canalgd.sp@br.enel.com> wrote: ${CITADO}`;
  assert.equal(semCitacao(on), 'Ok. ');
  assert.equal(classificarCorpo(on), null);
});

test('citação achatada: mensagem encaminhada ("Forwarded message", "Mensagem encaminhada")', () => {
  assert.equal(semCitacao(`Segue. ---------- Forwarded message --------- De: Canal GD Date: qua 10 set ${CITADO}`), 'Segue. ');
  assert.equal(semCitacao(`Segue. ---------- Mensagem encaminhada ---------- De: Canal GD Data: qua 10 set ${CITADO}`), 'Segue. ');
  assert.equal(classificarCorpo(`Segue. ---------- Mensagem encaminhada ---------- ${CITADO}`), null);
});

test('o marcador ">" NÃO é mais citação: não corta texto novo legítimo (P2)', () => {
  // "Prazo > 5 dias" e "Menu > Detalhes" são texto da parte nova; cortar aqui perdia a falha
  assert.deepEqual(classificarCorpo(`Prazo &gt; 5 dias. ${CITADO}`), { tipo: 'resultado_vistoria', aprovada: true });
  assert.deepEqual(classificarCorpo(`Prazo > 5 dias. ${CITADO}`), { tipo: 'resultado_vistoria', aprovada: true });
  assert.deepEqual(classificarCorpo(`Menu > Detalhes. ${CITADO}`), { tipo: 'resultado_vistoria', aprovada: true });
  const falha = classificarCorpo('Acesse Menu &gt; Notas &gt; Detalhes: a tentativa de troca do medidor não foi executada pelo seguinte motivo: Cliente Não Permitiu Execução.');
  assert.deepEqual(falha, { tipo: 'troca_relogio', estado: 'nao_executada', motivo: 'Cliente Não Permitiu Execução' });
  assert.equal(semCitacao(`Ciente. > ${CITADO}`), `Ciente. > ${CITADO}`);
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

test('entrada enorme não deixa a leitura lenta (nenhuma marca é quadrática)', () => {
  // '-' e '- ': a marca de hífens era quadrática (50 mil hífens levavam 10 s; 200 mil, 115 s)
  for (const enchimento of ['\n', ' ', '\n \n', 'Em ', 'De: ', '-', '- ', '&amp;']) {
    const inicio = Date.now();
    const r = classificarCorpo(`${enchimento.repeat(100000)} Informamos que a vistoria do sistema está APROVADA.`);
    const ms = Date.now() - inicio;
    assert.ok(ms < 1500, `enchimento ${JSON.stringify(enchimento)} levou ${ms} ms`);
    if (enchimento !== 'Em ' && enchimento !== 'De: ') {
      assert.deepEqual(r, { tipo: 'resultado_vistoria', aprovada: true }, JSON.stringify(enchimento));
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

// ---------------------------------------------------------------------------
// Rodada 2 · Important 1: "o verbo é da vistoria" — outro sujeito e furos da negação
// ---------------------------------------------------------------------------

test('o "aprovado" depois de "vistoria," é de OUTRO sujeito (projeto, documentação, solicitação)', () => {
  for (const frase of [
    'Em relação à vistoria, o projeto foi aprovado em 25/08.',
    'Solicitação de vistoria: o projeto foi aprovado.',
    'Quanto à vistoria, a documentação está aprovada.',
    'Sobre a vistoria técnica, a solicitação foi aprovada e será agendada.',
    'Sobre a vistoria; a documentação foi aprovada.',
    'Quanto à vistoria: a documentação está aprovada.', // ":" sem o núcleo "solicitação de"
  ]) assert.equal(classificarCorpo(frase), null, frase);
});

test('a vírgula DIRETA antes do verbo continua casando, e vale a vistoria mais perto do verbo', () => {
  assert.deepEqual(classificarCorpo('Informamos que após a vistoria da microgeração fotovoltaica do endereço acima, foi aprovada.'),
    { tipo: 'resultado_vistoria', aprovada: true });
  // a 1ª "vistoria" tem vírgula + outra palavra no caminho; a 2ª é a do verbo
  assert.deepEqual(classificarCorpo('Em relação à vistoria, a vistoria do sistema foi aprovada.'),
    { tipo: 'resultado_vistoria', aprovada: true });
});

test('nenhum, nenhuma, ninguém, nada e tampouco também negam', () => {
  for (const frase of [
    'Nenhum item da vistoria foi aprovado.',
    'Nenhuma vistoria foi aprovada.',
    'Nem a vistoria foi aprovada.',
    'Ninguém informou que a vistoria foi aprovada.',
    'Nada indica que a vistoria foi aprovada.',
    'A vistoria tampouco foi aprovada.',
  ]) assert.equal(classificarCorpo(frase), null, frase);
});

test('a data no meio da frase não quebra a frase da negação', () => {
  assert.equal(classificarCorpo('Não foi possível confirmar em 21.08.2026 que a vistoria foi aprovada.'), null);
});

test('negação a mais de 80 caracteres antes, na mesma frase, também anula', () => {
  const frase = 'Não temos certeza do resultado, pois o cadastro do titular, a documentação enviada e os demais itens do projeto ainda dependem de conferência pela distribuidora, mas a vistoria foi aprovada.';
  assert.ok(frase.indexOf('vistoria') - frase.indexOf('Não') > 80);
  assert.equal(classificarCorpo(frase), null);
});

test('condicional: "se a vistoria foi aprovada" não afirma nada', () => {
  assert.equal(classificarCorpo('Para acompanhar se a vistoria foi aprovada, acesse o portal da distribuidora.'), null);
  // o "se" de OUTRA frase não atrapalha
  assert.deepEqual(classificarCorpo('Para acompanhar o pedido, acesse o portal. Informamos que a vistoria do sistema está APROVADA.'),
    { tipo: 'resultado_vistoria', aprovada: true });
});

test('contraditório: afirmações de aprovada E de reprovada no texto novo → null', () => {
  assert.equal(classificarCorpo('Foi aprovada. A vistoria foi reprovada.'), null);
  assert.equal(classificarCorpo('A vistoria está aprovada. Depois: a vistoria foi reprovada.'), null);
  // sozinha, cada uma continua valendo
  assert.deepEqual(classificarCorpo('A vistoria foi reprovada.'), { tipo: 'resultado_vistoria', aprovada: false });
});

test('uma negação da MESMA afirmação em outra frase também anula ("foi aprovada. … não foi aprovada")', () => {
  assert.equal(classificarCorpo('A vistoria foi aprovada. Porém a vistoria não foi aprovada na segunda análise.'), null);
});

test('palavras que quebram o caminho entre "vistoria" e o verbo, uma a uma', () => {
  for (const frase of [
    'Informamos que a vistoria ainda está aprovada.', // ainda
    'Informamos que a vistoria sem laudo foi aprovada.', // sem
    'Informamos que a vistoria nem sequer foi aprovada.', // nem (no caminho; sem "nem foi" colado)
    'Informamos que a vistoria nunca foi aprovada.', // nunca
    'Informamos que a vistoria jamais foi aprovada.', // jamais
    'A vistoria agendada para amanhã e o cadastro aprovado está aprovado.', // e
    'A vistoria agendada ou o cadastro está aprovado.', // ou
    'A vistoria agendada mas o cadastro está aprovado.', // mas
    'A vistoria agendada porém o cadastro está aprovado.', // porem
    'A vistoria do imóvel que o cadastro indica está aprovada.', // que
    'A vistoria foi registrada o projeto foi aprovado.', // foi
    'A vistoria está agendada o projeto está aprovado.', // esta
    'A vistoria das placas estão agendadas o projeto foi aprovado.', // estao
    'A vistoria será agendada o projeto foi aprovado.', // sera
    'A vistoria das placas serão agendadas o projeto foi aprovado.', // serao
  ]) assert.equal(classificarCorpo(frase), null, frase);
});

// ---------------------------------------------------------------------------
// Rodada 2 · P1: entidades HTML (inclusive a codificação dupla) são decodificadas
// ---------------------------------------------------------------------------

test('entidades HTML: "rejei&amp;ccedil;&amp;atilde;o" (codificação dupla) é falha da troca', () => {
  const r = classificarCorpo('Prezado(a), bom dia! Reenviamos a nota de serviço 400012345678 , referente a instalação 2222222222 , para a troca do medidor bidirecional, com o prazo de execu&amp;ccedil;&amp;atilde;o de at&amp;eacute; 5 dias &amp;uacute;teis. Motivo da rejei&amp;ccedil;&amp;atilde;o Cliente N&amp;atilde;o Permitiu Execu&amp;ccedil;&amp;atilde;o 21.08.2026 Protocolo: 9876543210 . Atenciosamente');
  assert.deepEqual(r, { tipo: 'troca_relogio', estado: 'nao_executada', motivo: 'Cliente Não Permitiu Execução' });
});

test('entidades HTML: codificação simples, numéricas e as de pontuação', () => {
  const simples = classificarCorpo('Reenviamos a nota de servi&ccedil;o 400012345678 , para a troca do medidor bidirecional. Motivo da rejei&ccedil;&atilde;o: Fechado Sem Acesso ao Centro de Medi&ccedil;&atilde;o. 06.10.2026 Protocolo: 9876543210');
  assert.deepEqual(simples, { tipo: 'troca_relogio', estado: 'nao_executada', motivo: 'Fechado Sem Acesso ao Centro de Medição' });
  // &#231; = ç, &#xE3; = ã, &nbsp; = espaço
  const numericas = classificarCorpo('Reenviamos a nota de servi&#231;o 400012345678 , para a troca do medidor. Motivo da rejei&#231;&#xE3;o:&nbsp;Cliente&nbsp;N&#227;o Permitiu Execu&#231;&#xE3;o. Protocolo: 9876543210');
  assert.deepEqual(numericas, { tipo: 'troca_relogio', estado: 'nao_executada', motivo: 'Cliente Não Permitiu Execução' });
  // maiúsculas acentuadas e as de pontuação: &Aacute; &Eacute; &Ccedil; &Atilde; &Otilde; &lt; &gt; &quot; &#39; &amp;
  assert.deepEqual(classificarCorpo('A TROCA DO MEDIDOR N&Atilde;O FOI EXECUTADA pelo seguinte motivo: &quot;Cliente &lt;Ausente&gt; &amp; sem acesso&#39;. Protocolo: 9876543210'),
    { tipo: 'troca_relogio', estado: 'nao_executada', motivo: '"Cliente <Ausente> & sem acesso\'' });
});

test('entidades HTML: cada entidade da lista decodifica (vista pelo motivo da falha)', () => {
  const casos: Array<[string, string]> = [
    ['&amp;', '&'], ['&lt;', '<'], ['&gt;', '>'], ['&quot;', '"'], ['&#39;', "'"], ['&nbsp;', ' '],
    ['&aacute;', 'á'], ['&acirc;', 'â'], ['&atilde;', 'ã'], ['&agrave;', 'à'], ['&eacute;', 'é'], ['&ecirc;', 'ê'],
    ['&iacute;', 'í'], ['&oacute;', 'ó'], ['&ocirc;', 'ô'], ['&otilde;', 'õ'], ['&uacute;', 'ú'], ['&ccedil;', 'ç'],
    ['&Aacute;', 'Á'], ['&Acirc;', 'Â'], ['&Atilde;', 'Ã'], ['&Agrave;', 'À'], ['&Eacute;', 'É'], ['&Ecirc;', 'Ê'],
    ['&Iacute;', 'Í'], ['&Oacute;', 'Ó'], ['&Ocirc;', 'Ô'], ['&Otilde;', 'Õ'], ['&Uacute;', 'Ú'], ['&Ccedil;', 'Ç'],
    ['&#231;', 'ç'], ['&#xE7;', 'ç'], ['&#xe7;', 'ç'],
    // rodada 3 (M-2): as que aparecem no corpus real (&ordm; 64×, &ndash; 20×) e as parentes
    ['&ordm;', 'º'], ['&ordf;', 'ª'], ['&deg;', '°'], ['&ndash;', '–'], ['&mdash;', '—'], ['&rarr;', '→'],
    ['&ldquo;', '“'], ['&rdquo;', '”'], ['&lsquo;', '‘'], ['&rsquo;', '’'], ['&apos;', "'"], ['&laquo;', '«'], ['&raquo;', '»'],
    // decimal e hexadecimal com mais de 3 dígitos
    ['&#8211;', '–'], ['&#x2013;', '–'],
    // codificado duas vezes
    ['&amp;ccedil;', 'ç'], ['&amp;#231;', 'ç'], ['&amp;amp;', '&'],
  ];
  for (const [entidade, esperado] of casos) {
    const r = classificarCorpo(`A troca do medidor não foi executada pelo seguinte motivo: X${entidade}X. Protocolo: 9876543210`);
    const motivo = r && r.tipo === 'troca_relogio' && r.estado === 'nao_executada' ? r.motivo : null;
    assert.equal(motivo, `X${esperado}X`, entidade);
  }
});

test('entidades HTML: número impossível não derruba o robô nem some com o texto', () => {
  // String.fromCodePoint lança RangeError acima de 0x10FFFF; surrogate e zero não são caractere
  for (const impossivel of ['&#9999999;', '&#1114112;', '&#xD800;', '&#0;', '&#xFFFFFF;']) {
    const r = classificarCorpo(`A troca do medidor não foi executada pelo seguinte motivo: Obra ${impossivel} no local. Protocolo: 9876543210`);
    assert.equal(r && r.tipo === 'troca_relogio' && r.estado, 'nao_executada', impossivel);
  }
});

test('entidades HTML: o resultado da vistoria e o corte da citação também veem o texto decodificado', () => {
  assert.deepEqual(classificarCorpo('Informamos que a vistoria do sistema de microgera&ccedil;&atilde;o est&aacute; APROVADA.'),
    { tipo: 'resultado_vistoria', aprovada: true });
  assert.equal(classificarCorpo(`Ciente. Em qua., 10 de set. de 2026 &agrave;s 10:00, Canal GD &lt;canalgd.sp@br.enel.com&gt; escreveu: ${CITADO}`), null);
  // entidade desconhecida fica como está (aqui, vista pelo motivo) e, no caminho da vistoria, é dúvida: null
  const r = classificarCorpo('A troca do medidor não foi executada pelo seguinte motivo: Obra &foo; no local. Protocolo: 9876543210');
  assert.equal(r && r.tipo === 'troca_relogio' && r.estado === 'nao_executada' && r.motivo, 'Obra &foo; no local');
  assert.equal(classificarCorpo('A vistoria &foo; do sistema está APROVADA.'), null);
});

// ---------------------------------------------------------------------------
// Rodada 2 · P3: redações de falha ainda não vistas (valem com a troca citada)
// ---------------------------------------------------------------------------

test('troca que não foi feita: as outras redações', () => {
  for (const frase of [
    'A troca do medidor não foi realizada pelo seguinte motivo: Cliente Não Permitiu Execução.', // foi realizada
    'A troca do medidor não pôde ser executada pelo seguinte motivo: Cliente Não Permitiu Execução.', // pôde
    'A troca do medidor não pode ser executada neste momento.', // pode
    'Não foi possível executar a troca do medidor.', // possível executar
    'Não foi possível realizar a troca do medidor.', // possível realizar
    'A troca do medidor está não concluída.', // concluída
    'A troca do medidor, não concluída, será reagendada.', // concluída (vírgula)
  ]) {
    const r = classificarCorpo(frase);
    assert.equal(r?.tipo, 'troca_relogio', frase);
    assert.equal(r && r.tipo === 'troca_relogio' && r.estado, 'nao_executada', frase);
  }
});

test('"reenviamos" sozinho NÃO é falha: há reenvio sem falha', () => {
  assert.deepEqual(classificarCorpo(REENVIO), { tipo: 'troca_relogio', estado: 'agendada', prazoDias: 5 });
});

test('a falha só vale se a mensagem fala da troca: cada palavra do contexto, sozinha', () => {
  for (const frase of [
    'A troca não foi executada pelo seguinte motivo: Cliente Não Permitiu Execução.', // troca
    'A instalação do medidor não foi executada pelo seguinte motivo: Cliente Não Permitiu Execução.', // medidor
    'A nota de serviço 400012345678 não foi executada pelo seguinte motivo: Cliente Não Permitiu Execução.', // nota de servico
    'A substituição não foi executada pelo seguinte motivo: Cliente Não Permitiu Execução.', // substituicao
    'O relógio não foi executado pelo seguinte motivo: Cliente Não Permitiu Execução.', // relogio
  ]) {
    const r = classificarCorpo(frase);
    assert.equal(r && r.tipo === 'troca_relogio' && r.estado, 'nao_executada', frase);
  }
});

// ---------------------------------------------------------------------------
// Rodada 2 · P4: a palavra do contexto que parecia não fazer diferença
// ---------------------------------------------------------------------------

test('"Em … escreveu:" volta a aceitar o "em" minúsculo', () => {
  const corpo = `Ciente. em qua., 10 de set. de 2026 às 10:00, Canal GD <canalgd.sp@br.enel.com> escreveu: ${CITADO}`;
  assert.equal(semCitacao(corpo), 'Ciente. ');
});

test('a janela é temperada com os TRÊS iniciadores: vale o último "Em/No dia/On" antes do "escreveu/wrote"', () => {
  const dist = (corpo: string, de: string, ate: string) => corpo.indexOf(ate) - corpo.indexOf(de);
  // "Em" da parte nova antes de um "No dia … escreveu:"
  const a = 'Em resposta ao seu pedido, a vistoria do sistema está APROVADA. No dia 10/09/2026 às 10:00, Canal GD <c@enel.com> escreveu: antigo';
  assert.ok(dist(a, 'Em resposta', 'escreveu:') < 160);
  assert.deepEqual(classificarCorpo(a), { tipo: 'resultado_vistoria', aprovada: true });
  // "no dia" da parte nova antes de um "On … wrote:"
  const b = 'A tentativa de troca do medidor no dia 15/09, não foi executada pelo seguinte motivo: Cliente ausente. On Wed, Sep 10, 2026 at 10:00 AM Canal GD <c@enel.com> wrote: old';
  assert.ok(dist(b, 'no dia', 'wrote:') < 160);
  assert.deepEqual(classificarCorpo(b), { tipo: 'troca_relogio', estado: 'nao_executada', motivo: 'Cliente ausente' });
  // "On" da parte nova antes de um "Em … escreveu:"
  const c = 'Segue on-line o resultado, On resposta: a vistoria do sistema está APROVADA. Em seg., 12 de out. de 2026 às 09:00, Canal GD <c@enel.com> escreveu: antigo';
  assert.ok(dist(c, 'On resposta', 'escreveu:') < 160);
  assert.deepEqual(classificarCorpo(c), { tipo: 'resultado_vistoria', aprovada: true });
});

test('o "no dia" da parte nova não vira o começo da citação (a falha cita o dia)', () => {
  const corpo = 'A tentativa de troca do medidor no dia 15/09 , não foi executada pelo seguinte motivo: Cliente Não Permitiu Execução. Em seg., 12 de out. de 2026 às 09:00, Canal GD <canalgd.sp@br.enel.com> escreveu: antigo';
  assert.deepEqual(classificarCorpo(corpo), { tipo: 'troca_relogio', estado: 'nao_executada', motivo: 'Cliente Não Permitiu Execução' });
});


// ---------------------------------------------------------------------------
// Rodada 3 · I-1: a `reprovada` verdadeira não é desfeita por "aprovado" de OUTRO assunto
// ---------------------------------------------------------------------------

test('reprovada verdadeira: "o projeto/documentação/parecer/vídeo" aprovado ou não aprovado não a desfaz', () => {
  for (const frase of [
    'O projeto foi aprovado. A vistoria foi reprovada.',
    'A documentação está aprovada e a vistoria foi reprovada.',
    'Informamos que a vistoria foi reprovada. O projeto está aprovado, porém os itens abaixo devem ser corrigidos.',
    'Informamos que o projeto foi aprovado em 25/08, mas a vistoria foi reprovada em razão do não atendimento aos requisitos.',
    'A vistoria foi reprovada. O parecer de acesso foi aprovado anteriormente.',
    // é assim que a ENEL lista os motivos da reprovação
    'Informamos que a vistoria foi reprovada. Motivos: 1. Cabeamento fora do padrão. 2. O vídeo não foi aprovado.',
  ]) assert.deepEqual(classificarCorpo(frase), { tipo: 'resultado_vistoria', aprovada: false }, frase);
});

test('o contraditório SOBRE A VISTORIA continua anulando, nos dois sentidos', () => {
  for (const frase of [
    'Foi aprovada. A vistoria foi reprovada.', // "Foi aprovada." solto, sem sujeito
    'Está aprovada. A vistoria foi reprovada.',
    'A vistoria está aprovada. Depois: a vistoria foi reprovada.',
    'A vistoria está aprovada. Depois a vistoria está reprovada.', // "está reprovada"
    'A vistoria foi reprovada. Depois a vistoria está aprovada.',
  ]) assert.equal(classificarCorpo(frase), null, frase);
});

test('reprovada: um "aprovado" de OUTRO sujeito, mesmo depois de "vistoria,", não a desfaz', () => {
  assert.deepEqual(classificarCorpo('A vistoria foi reprovada. Sobre a vistoria, o projeto foi aprovado.'),
    { tipo: 'resultado_vistoria', aprovada: false });
  // (e "Sua solicitação de vistoria foi aprovada" depois de uma reprovada fica null: na dúvida, só anota)
  assert.equal(classificarCorpo('A vistoria foi reprovada. Sua solicitação de vistoria foi aprovada anteriormente.'), null);
});

test('aprovada continua desfeita por qualquer reprovada ou afirmação negada no texto', () => {
  assert.equal(classificarCorpo('A vistoria foi aprovada. O projeto foi reprovado.'), null);
  for (const negacao of ['não', 'nem', 'nunca', 'jamais', 'nenhum', 'nenhuma', 'ninguém', 'nada', 'tampouco']) {
    assert.equal(classificarCorpo(`A vistoria foi aprovada. Mas ${negacao} foi aprovado.`), null, negacao);
  }
  assert.equal(classificarCorpo('A vistoria foi aprovada. Mas o item não está aprovado.'), null);
});

// ---------------------------------------------------------------------------
// Rodada 3 · I-2: o sujeito é outro (núcleo, separador, "se", pergunta)
// ---------------------------------------------------------------------------

test('o núcleo do sujeito não é a vistoria: "solicitação/pedido/taxa … de vistoria foi aprovada"', () => {
  assert.equal(classificarCorpo('Sua solicitação de vistoria foi aprovada e será agendada.'), null);
  for (const nucleo of [
    'solicitação', 'pedido', 'agendamento', 'reagendamento', 'requerimento', 'abertura', 'marcação', 'taxa', 'data',
    'prazo', 'protocolo', 'nota', 'ordem', 'cadastro', 'documentação', 'projeto', 'relatório', 'laudo', 'formulário',
    'ficha', 'termo', 'orçamento',
  ]) assert.equal(classificarCorpo(`O ${nucleo} de vistoria foi aprovado.`), null, nucleo);
  for (const ligacao of ['de', 'da', 'do', 'para', 'pra', 'para a', 'para sua', 'de essa', 'da sua']) {
    assert.equal(classificarCorpo(`O cadastro ${ligacao} vistoria foi aprovado.`), null, ligacao);
  }
  assert.equal(classificarCorpo('O cadastro para a vistoria foi aprovado.'), null);
  assert.equal(classificarCorpo('A taxa de vistoria foi aprovada.'), null);
});

test('separadores entre "vistoria" e o verbo: ? ! ( ) | / – — & e o hífen com espaço', () => {
  for (const frase of [
    'Dúvidas sobre a vistoria? O seu projeto foi aprovado!',
    'Vistoria! O projeto foi aprovado.',
    'Vistoria (o projeto está aprovado).',
    'Vistoria GD) o projeto está aprovado.',
    'Vistoria | projeto foi aprovado.',
    'Vistoria / projeto foi aprovado.',
    'Vistoria – o projeto foi aprovado.',
    'Vistoria — o projeto foi aprovado.',
    'Vistoria & projeto foi aprovado.',
    'Vistoria - o projeto foi aprovado.',
    'Vistoria &ndash; o projeto foi aprovado.',
    'Vistoria &mdash; o projeto foi aprovado.',
  ]) assert.equal(classificarCorpo(frase), null, frase);
  // o hífen DENTRO de palavra não é separador
  assert.deepEqual(classificarCorpo('Informamos que a vistoria do sistema pré-instalado está APROVADA.'),
    { tipo: 'resultado_vistoria', aprovada: true });
});

test('"se" depois de "vistoria" ("para saber se foi aprovada") não afirma nada', () => {
  assert.equal(classificarCorpo('Consulte a vistoria para saber se foi aprovada.'), null);
});

test('pergunta: "a vistoria foi aprovada?" não afirma nada', () => {
  assert.equal(classificarCorpo('A vistoria foi aprovada?'), null);
  assert.equal(classificarCorpo('Gostaria de saber: a vistoria foi aprovada?'), null);
  assert.equal(classificarCorpo('A vistoria foi aprovada ?'), null);
  assert.deepEqual(classificarCorpo('A vistoria foi aprovada.'), { tipo: 'resultado_vistoria', aprovada: true });
});

// ---------------------------------------------------------------------------
// Rodada 3 · M-1: &#10; vira \n e furava a janela do "Em … escreveu:"
// ---------------------------------------------------------------------------

test('entidade de quebra de linha (&#10;, &#xA;, &#13;&#10;) não fura a citação', () => {
  for (const quebra of ['&#10;', '&#xA;', '&#13;&#10;', '&amp;#10;']) {
    const corpo = `Ciente. Em qua., 10 de set. de 2026 às 10:00,${quebra}Canal GD <canalgd.sp@br.enel.com> escreveu: ${CITADO}`;
    assert.equal(classificarCorpo(corpo), null, quebra);
  }
});

// ---------------------------------------------------------------------------
// Rodada 3 · M-2: mais entidades; o "…" termina o motivo; "nº" sai decodificado
// ---------------------------------------------------------------------------

test('o motivo sai com "nº" decodificado e termina no "…" (&hellip;)', () => {
  const numero = classificarCorpo('A troca do medidor não foi executada pelo seguinte motivo: Sem acesso ao n&ordm; 25 do condom&iacute;nio. Protocolo: 9876543210');
  assert.equal(numero && numero.tipo === 'troca_relogio' && numero.estado === 'nao_executada' && numero.motivo, 'Sem acesso ao nº 25 do condomínio');
  for (const reticencias of ['&hellip;', '&#8230;', '&#x2026;']) {
    const r = classificarCorpo(`A troca do medidor não foi executada pelo seguinte motivo: Cliente Não Permitiu Execução${reticencias} Reenviamos a nota de serviço 400012345678`);
    assert.equal(r && r.tipo === 'troca_relogio' && r.estado === 'nao_executada' && r.motivo, 'Cliente Não Permitiu Execução', reticencias);
  }
});

test('o ";" de entidade real não atrapalha, o de "R&D;" (entidade inexistente) é dúvida', () => {
  assert.deepEqual(classificarCorpo('Informamos que a vistoria do n&ordm; 25 está APROVADA.'), { tipo: 'resultado_vistoria', aprovada: true });
  assert.equal(classificarCorpo('Informamos que a vistoria da R&D; do sistema está APROVADA.'), null);
});

// ---------------------------------------------------------------------------
// Rodada 3 · M-3: "ainda", "sem", "impossível" e as abreviações que não fecham frase
// ---------------------------------------------------------------------------

test('"ainda", "sem" e "impossível" antes da vistoria, na mesma frase, também anulam', () => {
  assert.equal(classificarCorpo('Ainda aguardamos o retorno de que a vistoria foi aprovada.'), null);
  assert.equal(classificarCorpo('Informamos que, sem ressalvas, a vistoria foi aprovada.'), null);
  assert.equal(classificarCorpo('É impossível confirmar que a vistoria foi aprovada.'), null);
  // o de OUTRA frase não atrapalha
  assert.deepEqual(classificarCorpo('Ainda aguardamos o seu retorno. Informamos que a vistoria do sistema está APROVADA.'),
    { tipo: 'resultado_vistoria', aprovada: true });
});

test('a frase não quebra em Sr., Sra., Dr., Dra., art., n. e nº.', () => {
  for (const abreviacao of ['Sr.', 'Sra.', 'Dr.', 'Dra.', 'art.', 'n.', 'nº.', 'n°.']) {
    assert.equal(classificarCorpo(`Não foi possível confirmar, conforme ${abreviacao} 25, que a vistoria foi aprovada.`), null, abreviacao);
  }
  assert.equal(classificarCorpo('Não foi possível confirmar ao Sr. Silva que a vistoria foi aprovada.'), null);
});

// ---------------------------------------------------------------------------
// Rodada 3 · M-4: o que as mutações ainda não derrubavam
// ---------------------------------------------------------------------------

test('a janela da frase: negação a 260 caracteres antes ainda vale', () => {
  const frase = `Não ${'palavra '.repeat(32)}a vistoria foi aprovada.`;
  const distancia = frase.indexOf('vistoria') - frase.indexOf('Não');
  assert.ok(distancia > 200 && distancia < 300, `distância ${distancia}`);
  assert.equal(classificarCorpo(frase), null);
});

test('a frase quebra também em ";", "!" e "?"', () => {
  for (const separador of [';', '!', '?']) {
    assert.deepEqual(classificarCorpo(`Você não recebeu o aviso${separador} a vistoria do sistema está APROVADA.`),
      { tipo: 'resultado_vistoria', aprovada: true }, separador);
  }
});

test('a marca de hífens: maiúsculas, minúsculas e só 3 hífens', () => {
  assert.equal(semCitacao('Ciente. -----MENSAGEM ORIGINAL----- x'), 'Ciente. ');
  assert.equal(semCitacao('Ciente. -----original message----- x'), 'Ciente. ');
  assert.equal(semCitacao('Segue. --- Mensagem encaminhada --- x'), 'Segue. ');
  assert.equal(semCitacao('Segue. --- FORWARDED MESSAGE --- x'), 'Segue. ');
});

test('os cabeçalhos "De: … Enviado" e "From: … Sent:" valem com 100 caracteres entre os rótulos', () => {
  const de = `Segue ciente. De: Equipe de Atendimento ao Cliente - Distribuição de Energia Elétrica [atendimento.cliente@exemplo.com.br] Enviado em: quarta-feira ${CITADO}`;
  const entreDe = de.indexOf('Enviado') - de.indexOf('De:');
  assert.ok(entreDe > 50 && entreDe < 200, `entre De e Enviado: ${entreDe}`);
  assert.equal(semCitacao(de), 'Segue ciente. ');
  const from = `Ok. From: Team of Customer Service and Distribution <customer.service.team@example.com.br> Sent: Wednesday ${CITADO}`;
  const entreFrom = from.indexOf('Sent:') - from.indexOf('From:');
  assert.ok(entreFrom > 50 && entreFrom < 200, `entre From e Sent: ${entreFrom}`);
  assert.equal(semCitacao(from), 'Ok. ');
});

// ---------------------------------------------------------------------------
// Rodada 4 · N-1: "/", ":", "," e "." de data, hora e número não são outro sujeito
// ---------------------------------------------------------------------------

test('data, hora e número entre "vistoria" e o verbo não derrubam o resultado', () => {
  const casos: Array<[string, boolean]> = [
    ['Informamos que a vistoria realizada em 10/08/2026 foi reprovada.', false],
    ['Informamos que a vistoria realizada em 10/08/2026 foi aprovada.', true],
    ['Informamos que a vistoria da UC 12345/6 foi reprovada.', false],
    ['Informamos que a vistoria da UC 4/5 está APROVADA.', true],
    ['Informamos que a vistoria realizada às 10:30 foi aprovada.', true], // hora
    ['Informamos que a vistoria do sistema de 5,5 kWp está APROVADA.', true], // decimal
    ['Informamos que a vistoria cobrada em R$ 1,50 foi reprovada.', false], // dinheiro
    ['Informamos que a vistoria realizada em 10.08.2026 foi aprovada.', true], // data com pontos
    ['Informamos que a vistoria realizada em 10.08.2026 foi reprovada.', false],
  ];
  for (const [frase, aprovada] of casos) {
    assert.deepEqual(classificarCorpo(frase), { tipo: 'resultado_vistoria', aprovada }, frase);
  }
});

test('depois de número, separador com espaço continua sendo outro sujeito, e o ponto final continua quebrando', () => {
  for (const frase of [
    'Sobre a vistoria da UC 12345, o projeto foi aprovado.',
    'Sobre a vistoria de 10/08: o projeto foi aprovado.',
    'Sobre a vistoria da UC 12345. O projeto foi aprovado.',
    'Sobre a vistoria da UC 12345.O projeto foi aprovado.',
  ]) assert.equal(classificarCorpo(frase), null, frase);
});

// ---------------------------------------------------------------------------
// Rodada 4 · N-2: nome herdado de Object.prototype não é entidade
// ---------------------------------------------------------------------------

test('&constructor;, &toString; e &valueOf; ficam como estão no texto', () => {
  for (const nome of ['&constructor;', '&toString;', '&valueOf;']) {
    const r = classificarCorpo(`A troca do medidor não foi executada pelo seguinte motivo: X${nome}X. Protocolo: 9876543210`);
    assert.equal(r && r.tipo === 'troca_relogio' && r.estado === 'nao_executada' && r.motivo, `X${nome}X`, nome);
  }
});

// ---------------------------------------------------------------------------
// Rodada 4 · N-3: as mutações que ainda sobreviviam
// ---------------------------------------------------------------------------

test('o caminho entre "vistoria" e o verbo aceita mais de 60 caracteres', () => {
  const frase = 'Informamos que a vistoria do sistema de microgeração fotovoltaica instalado no endereço cadastrado na unidade consumidora indicada no pedido está APROVADA.';
  const caminho = frase.indexOf('está') - frase.indexOf('vistoria') - 'vistoria'.length;
  assert.ok(caminho > 60 && caminho < 160, `caminho com ${caminho} caracteres`);
  assert.deepEqual(classificarCorpo(frase), { tipo: 'resultado_vistoria', aprovada: true });
});

test('o "Foi aprovada." solto também vale depois de "!", "?" e ";"', () => {
  for (const antes of ['Prezado cliente!', 'Recebeu o aviso?', 'Conforme solicitado;']) {
    assert.equal(classificarCorpo(`${antes} Foi aprovada. A vistoria foi reprovada.`), null, antes);
  }
});

test('entidade hexadecimal com X maiúsculo (&#XE7;) também decodifica', () => {
  const r = classificarCorpo('A troca do medidor não foi executada pelo seguinte motivo: X&#XE7;X. Protocolo: 9876543210');
  assert.equal(r && r.tipo === 'troca_relogio' && r.estado === 'nao_executada' && r.motivo, 'XçX');
});
