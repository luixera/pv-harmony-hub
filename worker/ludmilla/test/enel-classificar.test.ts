// worker/ludmilla/test/enel-classificar.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classificarAssunto, classificarCorpo, semCitacao } from '../src/email/enel/classificar.js';

const VISTORIA_OK = 'INTERNAL Prezado(a) Senhor(a), Informamos que após realização da vistoria através de relatorio fotográfico, a vistoria do sistema de microgeração fotovoltaica está APROVADA. Importante: Quaisquer itens não visíveis…';
const TROCA_AGENDADA = 'Prezado Luiz, boa tarde! Nota de serviço criada 400012345678 , na data de 01/10/2026 , referente a instalação 2222222222 , para a troca do medidor bidirecional, com o prazo de execução de até 7 dias úteis. Protocolo: 9876543210 . Atenciosamente';
const TROCA_FALHOU = 'Prezado(a), bom dia! Identificamos pelo registro em sistema que a tentativa de troca do medidor no dia 15/09 , não foi executada pelo seguinte motivo: Cliente Não Permitiu Execução. Reenviamos a nota de serviço 400012345678 , referente a instalação 2222222222 , para a troca do medidor bidirecional, com o prazo de execução de até 5 dias úteis. -------------- Mensagem original -------------- De: Equipe [equipe@exemplo.com] Assunto: TROCA DE RELOGIO Prezado, nota de serviço criada 400099999999 para a troca do medidor';

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
  assert.match((r as { motivo: string }).motivo, /cliente nao permitiu/);
});

test('a citação não conta: só a parte nova da mensagem', () => {
  const corpo = 'Prezado, segue. -------------- Mensagem original -------------- A vistoria do sistema está APROVADA.';
  assert.equal(classificarCorpo(corpo), null);
  assert.equal(semCitacao('Novo. Em qua., 10 de set. de 2026 às 10:00, Canal GD <canalgd.sp@br.enel.com> escreveu: velho'), 'Novo. ');
});

test('pedido NOSSO citado ("foi aprovada na etapa de vistoria") não vira resultado', () => {
  const corpo = 'Nota de serviço criada 400012345678 para a troca do medidor bidirecional. -------------- Mensagem original -------------- A NT 123456789 foi aprovada na etapa de vistoria.';
  assert.equal(classificarCorpo(corpo)?.tipo, 'troca_relogio');
});

test('resposta automática e corpo vazio não classificam', () => {
  assert.equal(classificarCorpo('Olá, Informamos que seu e-mail foi recebido com sucesso, gerando o número de atendimento SF0123456789'), null);
  assert.equal(classificarCorpo(''), null);
  assert.equal(classificarCorpo(null), null);
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

test('assunto: nulo e vazio não classificam', () => {
  assert.equal(classificarAssunto(null), null);
  assert.equal(classificarAssunto(undefined), null);
  assert.equal(classificarAssunto(''), null);
});
