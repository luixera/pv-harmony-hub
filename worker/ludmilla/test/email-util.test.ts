import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  casaEndereco, casaProtocolo, casaTitular, chaveProtocolo, comparavelTitular, destinoNoBucket, ehImagem,
  ehPdf, idArquivoDeEmail, LIMITE_BUCKET_BYTES, nomeCitaProtocolo, ocorrenciasPorNome, pdfDoParecer,
  protocoloDoAssunto, protocolosNoAssunto, recomendacaoDoVeredito, regraQueCasa, separarPorProtocolo,
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

// ── E1: quantos dos NOSSOS protocolos o assunto cita ────────────────────────

const NOSSOS = ['045006443920', '045006443921', '040008312722'];

test('protocolosNoAssunto devolve só os NOSSOS protocolos que o assunto cita', () => {
  assert.deepEqual(
    protocolosNoAssunto('ENVIO DE PARECER - NOTAS 45006443920 e 45006443921', NOSSOS),
    ['045006443920', '045006443921'],
  );
  assert.deepEqual(protocolosNoAssunto('ENVIO DE PARECER - NOTA 45006443920', NOSSOS), ['045006443920']);
  assert.deepEqual(protocolosNoAssunto('Comunicado geral da EDP', NOSSOS), []);
});

test('protocolosNoAssunto ignora número que não é nosso, e o curto demais', () => {
  // o número da rua, o CEP e o protocolo de atendimento da EDP não contam
  assert.deepEqual(protocolosNoAssunto('NOTA 45006443920 - atendimento 0460917635 - CEP 1310000', NOSSOS), ['045006443920']);
  assert.deepEqual(protocolosNoAssunto('PEDIDO 1234567', ['1234567']), [], 'menos de 8 dígitos nunca casa');
});

test('protocolosNoAssunto não conta duas vezes o protocolo repetido no assunto nem na lista', () => {
  assert.deepEqual(protocolosNoAssunto('NOTA 45006443920 / NOTA 45006443920', NOSSOS), ['045006443920']);
  // 045006443920 e 45006443920 são o MESMO protocolo (zero à esquerda)
  assert.deepEqual(protocolosNoAssunto('NOTA 45006443920', ['045006443920', '45006443920']), ['045006443920']);
});

// ── E1: de qual protocolo é o ARQUIVO ───────────────────────────────────────

test('nomeCitaProtocolo compara por dígitos, sem o zero à esquerda do sistema', () => {
  assert.ok(nomeCitaProtocolo('PARECER_45006441002.pdf', '045006441002'), 'o nome que a EDP usa');
  assert.ok(nomeCitaProtocolo('parecer 45006441002 (1).pdf', '045006441002'));
  assert.ok(nomeCitaProtocolo('045006441002.pdf', '45006441002'));
  assert.ok(nomeCitaProtocolo('0045006441002_final.PDF', '045006441002'), 'zeros a mais também saem');
});

test('nomeCitaProtocolo NÃO casa por número parecido, curto ou ausente', () => {
  assert.ok(!nomeCitaProtocolo('PARECER_45006441003.pdf', '045006441002'), 'um dígito diferente é outro protocolo');
  assert.ok(!nomeCitaProtocolo('PARECER_450064410021.pdf', '045006441002'), 'número mais longo não casa por prefixo');
  assert.ok(!nomeCitaProtocolo('PARECER_1234567.pdf', '1234567'), 'menos de 8 dígitos nunca casa');
  assert.ok(!nomeCitaProtocolo('parecer.pdf', '045006441002'));
  assert.ok(!nomeCitaProtocolo('', '045006441002'));
});

const NOME_A = 'PARECER_45006443920.pdf';
const NOME_B = 'PARECER_45006443921.pdf';
const comTamanho = (nome: string, n = 1000) => ({ nome, mime: 'application/pdf', bytes: { length: n } });

test('separarPorProtocolo: cada protocolo fica só com o arquivo que traz o seu número', () => {
  const anexos = [comTamanho(NOME_A, 900_000), comTamanho(NOME_B, 400_000)];
  const citados = ['045006443920', '045006443921'];
  assert.deepEqual(separarPorProtocolo(anexos, '045006443920', citados).meus.map(a => a.nome), [NOME_A]);
  assert.deepEqual(separarPorProtocolo(anexos, '045006443921', citados).meus.map(a => a.nome), [NOME_B]);
  assert.deepEqual(separarPorProtocolo(anexos, '045006443920', citados).outros.map(a => a.nome), [NOME_B]);
});

test('separarPorProtocolo: arquivo sem número no nome não é de ninguém', () => {
  const anexos = [comTamanho('carta.pdf'), comTamanho(NOME_A)];
  const r = separarPorProtocolo(anexos, '045006443920', ['045006443920', '045006443921']);
  assert.deepEqual(r.meus.map(a => a.nome), [NOME_A]);
  assert.deepEqual(r.outros.map(a => a.nome), ['carta.pdf']);
});

test('separarPorProtocolo: arquivo que cita OS DOIS protocolos é ambíguo e não é de nenhum', () => {
  // Anexar nos dois cards seria entregar a um cliente o documento que fala do outro.
  const juntos = comTamanho('PARECER_45006443920_45006443921.pdf');
  const citados = ['045006443920', '045006443921'];
  assert.deepEqual(separarPorProtocolo([juntos], '045006443920', citados).meus, []);
  assert.deepEqual(separarPorProtocolo([juntos], '045006443921', citados).meus, []);
});

// ── E2: o que o bucket project-documents de fato aceita ─────────────────────
// Lista e limite lidos de storage.buckets em 12/10/2026:
//   allowed_mime_types = pdf, xls, xlsx, docx, jpeg, png, webp · file_size_limit = 10485760

test('o limite do bucket é o do banco: 10485760 bytes (10 MiB)', () => {
  assert.equal(LIMITE_BUCKET_BYTES, 10_485_760);
});

test('destinoNoBucket aceita os quatro tipos de documento e devolve o mime que o bucket conhece', () => {
  const xlsx = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const docx = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  assert.deepEqual(destinoNoBucket(comTamanho('a.pdf')), { aceito: true, mime: 'application/pdf' });
  assert.deepEqual(destinoNoBucket({ nome: 'a.xls', mime: 'application/vnd.ms-excel', bytes: { length: 9 } }),
    { aceito: true, mime: 'application/vnd.ms-excel' });
  assert.deepEqual(destinoNoBucket({ nome: 'a.xlsx', mime: xlsx, bytes: { length: 9 } }), { aceito: true, mime: xlsx });
  assert.deepEqual(destinoNoBucket({ nome: 'a.docx', mime: docx, bytes: { length: 9 } }), { aceito: true, mime: docx });
});

test('destinoNoBucket: mime genérico com extensão conhecida sobe com o mime da extensão', () => {
  // Cliente de e-mail que declara octet-stream para um PDF: o storage recusaria
  // o mime e a mensagem ficaria em retentativa para sempre.
  assert.deepEqual(destinoNoBucket({ nome: 'PARECER.PDF', mime: 'application/octet-stream', bytes: { length: 9 } }),
    { aceito: true, mime: 'application/pdf' });
  assert.deepEqual(
    destinoNoBucket({ nome: 'x.xlsx', mime: 'application/octet-stream', bytes: { length: 9 } }),
    { aceito: true, mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  );
});

test('destinoNoBucket recusa o que o bucket não aceita: p7s, dwg, zip, doc antigo', () => {
  for (const [nome, mime] of [
    ['parecer.p7s', 'application/pkcs7-signature'],
    ['projeto.dwg', 'application/octet-stream'],
    ['pacote.zip', 'application/zip'],
    ['carta.doc', 'application/msword'],
    ['texto.txt', 'text/plain'],
    ['semextensao', 'application/octet-stream'],
  ]) {
    assert.deepEqual(destinoNoBucket({ nome, mime, bytes: { length: 9 } }), { aceito: false, motivo: 'tipo' }, nome);
  }
});

test('destinoNoBucket recusa o que passa de 10 MiB, e aceita o que cabe exatamente', () => {
  assert.deepEqual(destinoNoBucket(comTamanho('grande.pdf', LIMITE_BUCKET_BYTES + 1)), { aceito: false, motivo: 'tamanho' });
  assert.equal(destinoNoBucket(comTamanho('justo.pdf', LIMITE_BUCKET_BYTES)).aceito, true);
});

test('destinoNoBucket diz "tipo" antes de "tamanho": o p7s gigante é um tipo errado', () => {
  assert.deepEqual(
    destinoNoBucket({ nome: 'a.p7s', mime: 'application/pkcs7-signature', bytes: { length: LIMITE_BUCKET_BYTES * 2 } }),
    { aceito: false, motivo: 'tipo' });
});

// ── E5: dois anexos de MESMO nome na mesma mensagem ─────────────────────────

test('ocorrenciasPorNome numera os anexos de mesmo nome, na ordem da mensagem', () => {
  const nomes = ['parecer.pdf', 'carta.pdf', 'parecer.pdf', 'parecer.pdf', 'Parecer.pdf'].map(nome => ({ nome }));
  assert.deepEqual(ocorrenciasPorNome(nomes), [1, 1, 2, 3, 1], 'caixa diferente é nome diferente');
  assert.deepEqual(ocorrenciasPorNome([]), []);
});

test('idArquivoDeEmail: o primeiro arquivo do nome mantém a chave de sempre, os repetidos ganham o índice', () => {
  const id = (n?: number) => idArquivoDeEmail('<um@edp>', '045006443920', 'parecer.pdf', n);
  assert.equal(id(), '<um@edp>#045006443920#parecer.pdf', 'sem índice = o formato que já existe no banco');
  assert.equal(id(1), '<um@edp>#045006443920#parecer.pdf', 'o primeiro NÃO muda de chave');
  assert.equal(id(2), '<um@edp>#045006443920#parecer.pdf#2');
  assert.equal(id(3), '<um@edp>#045006443920#parecer.pdf#3');
  assert.notEqual(id(2), id(1), 'foi aqui que o segundo sumia como "já resolvido"');
});
