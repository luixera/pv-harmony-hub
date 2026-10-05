import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { plainAddPlaceholder } from '@signpdf/placeholder-plain';
import { P12Signer } from '@signpdf/signer-p12';
import signpdfModule, { type SignPdf } from '@signpdf/signpdf';
import { cpfMascarado } from './certificado.js';

// @signpdf/signpdf é CJS: sob NodeNext o import default vem como o objeto de
// exports (`{ default: <instância>, SignPdf, ... }`), então desembrulhamos.
type Assinador = Pick<SignPdf, 'sign'>;
const signpdf: Assinador =
  (signpdfModule as unknown as { default?: Assinador }).default ?? (signpdfModule as unknown as Assinador);

export interface Estampa {
  titularNome: string;
  cpf: string;
  codigo: string;
  cidade: string;
  quando: Date;
}

/**
 * Desenha a estampa visível da assinatura na ÚLTIMA página e devolve o PDF
 * com tabela xref CLÁSSICA (`useObjectStreams: false`).
 *
 * Duas razões para a estampa vir antes da assinatura:
 *  1. é este arquivo que a pessoa confere — a conferência cobre a estampa;
 *  2. `plainAddPlaceholder` não lê PDF com xref stream (o padrão do pdf-lib):
 *     falha com "Expected xref at NaN". Gravando sem object streams, a
 *     assinatura seguinte é um append puro.
 */
export async function estampar(pdf: Buffer, e: Estampa): Promise<Buffer> {
  const doc = await PDFDocument.load(pdf);
  const fonte = await doc.embedFont(StandardFonts.Helvetica);
  const negrito = await doc.embedFont(StandardFonts.HelveticaBold);
  const paginas = doc.getPages();
  const ultima = paginas[paginas.length - 1];
  const { width } = ultima.getSize();

  const larg = 290;
  const alt = 62;
  const x = Math.max(36, width - larg - 36);
  const y = 40;

  ultima.drawRectangle({
    x, y, width: larg, height: alt,
    color: rgb(0.965, 0.973, 1), borderColor: rgb(0.11, 0.33, 0.6), borderWidth: 1,
  });
  ultima.drawText('ASSINADO DIGITALMENTE', { x: x + 8, y: y + alt - 14, size: 7, font: negrito, color: rgb(0.11, 0.33, 0.6) });
  ultima.drawText(e.titularNome, { x: x + 8, y: y + alt - 28, size: 10, font: negrito, color: rgb(0.1, 0.1, 0.1) });
  ultima.drawText(`CPF ${cpfMascarado(e.cpf)}`, { x: x + 8, y: y + alt - 40, size: 8, font: fonte, color: rgb(0.25, 0.25, 0.25) });
  ultima.drawText(
    `${e.cidade || '—'} · ${e.quando.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`,
    { x: x + 8, y: y + alt - 51, size: 7, font: fonte, color: rgb(0.35, 0.35, 0.35) },
  );
  ultima.drawText(`Código ${e.codigo} · confira no GD Manager`, { x: x + 8, y: y + 6, size: 6.5, font: fonte, color: rgb(0.45, 0.45, 0.45) });

  // xref CLÁSSICA — exigência do plainAddPlaceholder
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}

/**
 * Anexa a assinatura PAdES ao PDF **já aprovado**. Nenhum byte do que a pessoa
 * conferiu é reescrito: o resultado tem o aprovado como prefixo exato.
 */
export async function assinar(
  pdfAprovado: Buffer, pfx: Buffer, senha: string, info: { nome: string; cidade: string },
): Promise<Buffer> {
  const comPlaceholder = plainAddPlaceholder({
    pdfBuffer: pdfAprovado,
    reason: 'Assinatura do responsável técnico',
    contactInfo: 'GD Manager',
    name: info.nome,
    location: info.cidade || 'Brasil',
  });
  return Buffer.from(await signpdf.sign(comPlaceholder, new P12Signer(pfx, { passphrase: senha })));
}

/** Conferência final: o aprovado é prefixo do assinado e há /ByteRange. */
export function conferirAssinado(aprovado: Buffer, assinado: Buffer): { prefixoOk: boolean; temByteRange: boolean } {
  return {
    prefixoOk: assinado.length > aprovado.length && assinado.subarray(0, aprovado.length).equals(aprovado),
    temByteRange: assinado.includes(Buffer.from('ByteRange')),
  };
}
