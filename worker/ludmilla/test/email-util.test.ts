import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  casaEndereco, casaProtocolo, casaTitular, chaveProtocolo, comparavelTitular, ehImagem, ehPdf,
  idArquivoDeEmail, pdfDoParecer, protocoloDoAssunto, recomendacaoDoVeredito, regraQueCasa,
  type RegraEmail,
} from '../src/email/util.js';

const REGRAS: RegraEmail[] = [
  { id: '1', remetente: 'relacionamento.edp', assunto: 'ENVIO DE PARECER', tipo_documento: 'parecer', anexar: true, ler_pdf: true },
  { id: '2', remetente: null, assunto: 'CARTA DE OBRAS', tipo_documento: 'carta_obras', anexar: true, ler_pdf: false },
  { id: '3', remetente: null, assunto: 'NOTA -', tipo_documento: 'nota', anexar: true, ler_pdf: false },
];

test('chaveProtocolo tira pontuação e zeros à esquerda', () => {
  assert.equal(chaveProtocolo('045006443920'), '45006443920');
  assert.equal(chaveProtocolo('45006443920'), '45006443920');
  assert.equal(chaveProtocolo('0.400.083.127-22'), '40008312722');
  assert.equal(chaveProtocolo(''), '');
});

test('casaProtocolo ignora o zero à esquerda do sistema', () => {
  assert.ok(casaProtocolo('045006443920', '45006443920'));
  assert.ok(!casaProtocolo('045006443920', '45006439205'));
  // número curto demais não casa: evita colar e-mail pelo número da rua
  assert.ok(!casaProtocolo('123', '123'));
});

test('protocoloDoAssunto acha o protocolo do projeto dentro do assunto', () => {
  const candidatos = ['045006443920', '040008312722'];
  assert.equal(protocoloDoAssunto('ENVIO DE PARECER - NOTA 45006443920', candidatos), '045006443920');
  assert.equal(protocoloDoAssunto('NOTA - 40008312722', candidatos), '040008312722');
  assert.equal(protocoloDoAssunto('RA HugMe - EDP São Paulo te mandou mensagem', candidatos), null);
});

test('regraQueCasa usa assunto e, quando houver, remetente', () => {
  assert.equal(regraQueCasa(REGRAS, 'ENVIO DE PARECER - NOTA 45006443920', 'relacionamento.edp@edp.com.br')?.tipo_documento, 'parecer');
  // assunto de parecer vindo de outro remetente não vale como parecer
  assert.equal(regraQueCasa(REGRAS, 'ENVIO DE PARECER - NOTA 1', 'estranho@exemplo.com'), null);
  assert.equal(regraQueCasa(REGRAS, 'EDP - CARTA DE OBRAS', 'edpdocumentoporemail@edpbr.com.br')?.tipo_documento, 'carta_obras');
  assert.equal(regraQueCasa(REGRAS, 'Protocolo de Atendimento EDP 0460917635', 'protocolodoatendimentosp@edp.com.br'), null);
});

test('casaTitular compara primeiro e último nome, sem acento', () => {
  assert.ok(casaTitular('WERLHE DE ARAUJO LIMA', 'Sr. Werlhe de Araújo Lima'));
  assert.ok(!casaTitular('WERLHE DE ARAUJO LIMA', 'Miguel Arcanjo Corcini'));
  assert.ok(!casaTitular('', 'Werlhe de Araujo Lima'));
});

test('casaEndereco compara rua e número normalizados', () => {
  assert.ok(casaEndereco('RUA DAS FLORES 120', 'Rua das Flores, nº 120 - Centro'));
  assert.ok(!casaEndereco('RUA DAS FLORES 120', 'Rua das Flores, nº 999'));
  assert.ok(!casaEndereco('', 'Rua das Flores 120'));
});

test('recomendacaoDoVeredito só recomenda etapa para parecer', () => {
  assert.equal(recomendacaoDoVeredito('parecer', 'favoravel'), 'approved');
  assert.equal(recomendacaoDoVeredito('parecer', 'pendencia'), 'pendencia');
  assert.equal(recomendacaoDoVeredito('parecer', 'inconclusivo'), null);
  assert.equal(recomendacaoDoVeredito('carta_obras', 'favoravel'), null);
});

test('casaEndereco usa o ÚLTIMO número do endereço, não o primeiro', () => {
  // AV 9 DE JULHO 1500: pega 1500, não 9
  assert.ok(!casaEndereco('AV 9 DE JULHO 1500', 'Av 9 de Julho 3000'));
  assert.ok(casaEndereco('AV 9 DE JULHO 1500', 'Avenida 9 de Julho, 1500 - Centro'));
});

test('casaEndereco compara palavras da rua por palavra inteira, não substring', () => {
  // FLORES não é substring de FLORESTA (bem como não caso palavra inteira)
  assert.ok(!casaEndereco('RUA DAS FLORES 120', 'Rua da Floresta 120'));
});

test('casaTitular rejeita nome com uma palavra só', () => {
  assert.ok(!casaTitular('JOSE', 'Maria Jose Santos'));
  // confirmação que continua funcionando com dois nomes
  assert.ok(casaTitular('WERLHE DE ARAUJO LIMA', 'Sr. Werlhe de Araújo Lima'));
});

test('regraQueCasa encontra regra de nota com remetente qualquer', () => {
  assert.equal(regraQueCasa(REGRAS, 'NOTA - 40008312722', 'relacionamento@edp.com.br')?.tipo_documento, 'nota');
});

test('casaProtocolo respeita piso de 8 dígitos', () => {
  // 7 dígitos não casam
  assert.ok(!casaProtocolo('1234567', '1234567'));
  // 8 dígitos casam
  assert.ok(casaProtocolo('12345678', '12345678'));
});

test('comparavelTitular separa "falta de dado" de "é outra pessoa"', () => {
  // `casaTitular` devolve false nos dois casos; isto desempata
  assert.ok(!comparavelTitular('Ivanildo'));
  assert.ok(!comparavelTitular('A B'), 'palavras de até 2 letras não contam');
  assert.ok(!comparavelTitular(''));
  assert.ok(!comparavelTitular(null));
  assert.ok(comparavelTitular('WERLHE LIMA'));
  assert.ok(comparavelTitular('PADARIA IRMAOS'));
});

test('ehImagem pega mime e extensão, e deixa passar todo o resto', () => {
  // assinatura HTML de e-mail: image001.png…image004.png viravam documento do
  // projeto e comentário no card do cliente
  assert.ok(ehImagem({ nome: 'image001.png', mime: 'image/png' }));
  assert.ok(ehImagem({ nome: 'logo', mime: 'image/gif' }), 'pelo mime, mesmo sem extensão');
  assert.ok(ehImagem({ nome: 'FOTO.JPEG', mime: 'application/octet-stream' }), 'pela extensão, mesmo com mime genérico');
  assert.ok(ehImagem({ nome: 'desenho.svg', mime: 'application/octet-stream' }));
  assert.ok(ehImagem({ nome: 'scan.tiff', mime: 'application/octet-stream' }));
  // por EXCLUSÃO: tudo o que não é imagem continua subindo
  assert.ok(!ehImagem({ nome: 'parecer.pdf', mime: 'application/pdf' }));
  assert.ok(!ehImagem({ nome: 'planilha.xlsx', mime: 'application/vnd.ms-excel' }));
  assert.ok(!ehImagem({ nome: 'projeto.dwg', mime: 'application/octet-stream' }));
  assert.ok(!ehImagem({ nome: 'pacote.zip', mime: 'application/zip' }));
  assert.ok(!ehImagem({ nome: 'assinatura.p7s', mime: 'application/pkcs7-signature' }));
  // "pngfile.pdf" não é imagem: a extensão é a do FIM do nome
  assert.ok(!ehImagem({ nome: 'pngfile.pdf', mime: 'application/pdf' }));
});

test('ehPdf aceita pelo mime ou pela extensão', () => {
  assert.ok(ehPdf({ nome: 'x', mime: 'application/pdf' }));
  assert.ok(ehPdf({ nome: 'parecer.PDF', mime: 'application/octet-stream' }));
  assert.ok(!ehPdf({ nome: 'nota.xml', mime: 'text/xml' }));
});

test('pdfDoParecer escolhe o PDF MAIOR, não o primeiro da lista', () => {
  const anexos = [
    { nome: 'anexo-tecnico.pdf', mime: 'application/pdf', bytes: Buffer.alloc(20_000) },
    { nome: 'parecer.pdf', mime: 'application/pdf', bytes: Buffer.alloc(900_000) },
    { nome: 'image001.png', mime: 'image/png', bytes: Buffer.alloc(4_000_000) },
  ];
  assert.equal(pdfDoParecer(anexos)?.nome, 'parecer.pdf', 'a imagem gigante não entra');
  // a ordem não muda a escolha
  assert.equal(pdfDoParecer([...anexos].reverse())?.nome, 'parecer.pdf');
});

test('pdfDoParecer devolve null quando não há PDF, e desempata pelo primeiro', () => {
  assert.equal(pdfDoParecer([]), null);
  assert.equal(pdfDoParecer([{ nome: 'a.xlsx', mime: 'application/vnd.ms-excel', bytes: Buffer.alloc(9) }]), null);
  const empate = [
    { nome: 'primeiro.pdf', mime: 'application/pdf', bytes: Buffer.alloc(1000) },
    { nome: 'segundo.pdf', mime: 'application/pdf', bytes: Buffer.alloc(1000) },
  ];
  assert.equal(pdfDoParecer(empate)?.nome, 'primeiro.pdf', 'a escolha tem de ser a mesma em todo run');
});

// ── A chave do anexo (D1): o protocolo é parte dela ─────────────────────────
// O formato é contrato com o banco (`ludmilla_email_id_arquivo`). Se uma ponta
// mudar sozinha, a robô re-anexa o que já anexou — por isso o formato está
// escrito aqui, literal, e não só derivado.

test('idArquivoDeEmail é mensagem#protocolo#arquivo, com o protocolo no meio', () => {
  assert.equal(
    idArquivoDeEmail('<abc-123@edp.com.br>', '045006443920', 'parecer.pdf'),
    '<abc-123@edp.com.br>#045006443920#parecer.pdf',
  );
});

test('o MESMO anexo em dois protocolos dá duas chaves diferentes', () => {
  // Era aqui que o documento ia para o card do cliente errado: um e-mail que
  // cita dois protocolos serve dois projetos, e a chave antiga
  // (mensagem#arquivo) era a mesma para os dois.
  const a = idArquivoDeEmail('<um@edp>', '045006443920', 'PARECER.pdf');
  const b = idArquivoDeEmail('<um@edp>', '045006443921', 'PARECER.pdf');
  assert.notEqual(a, b);
  // e o mesmo protocolo com a mesma mensagem continua dando a MESMA chave:
  // é o que faz a retentativa retomar a linha em vez de criar outra
  assert.equal(a, idArquivoDeEmail('<um@edp>', '045006443920', 'PARECER.pdf'));
});
