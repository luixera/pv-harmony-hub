import { PDFDocument, type PDFFont, StandardFonts, rgb } from 'pdf-lib';
import { plainAddPlaceholder } from '@signpdf/placeholder-plain';
import { P12Signer } from '@signpdf/signer-p12';
import signpdfModule, { type SignPdf } from '@signpdf/signpdf';
import { cpfMascarado } from './certificado.js';

// @signpdf/signpdf é CJS: sob NodeNext o import default vem como o objeto de
// exports (`{ default: <instância>, SignPdf, ... }`), então desembrulhamos.
type Assinador = Pick<SignPdf, 'sign'>;
const signpdf: Assinador =
  (signpdfModule as unknown as { default?: Assinador }).default ?? (signpdfModule as unknown as Assinador);
if (typeof signpdf.sign !== 'function') {
  throw new Error('@signpdf/signpdf não expôs sign() — formato do pacote mudou.');
}

export interface Estampa {
  titularNome: string;
  cpf: string;
  codigo: string;
  cidade: string;
  quando: Date;
}

/**
 * Deixa só o que a fonte padrão (WinAnsi) consegue desenhar: o acento comum do
 * português já é WinAnsi e passa intacto; o que não for, tenta-se sem diacrítico
 * (NFD) e, em último caso, vira "?". `drawText` LANÇA erro com caractere fora do
 * conjunto — e um nome estrangeiro não pode derrubar a assinatura.
 */
function paraWinAnsi(texto: string, aceitos: Set<number>): string {
  let saida = '';
  for (const ch of texto) {
    if (aceitos.has(ch.codePointAt(0)!)) { saida += ch; continue; }
    const base = ch.normalize('NFD').replace(/\p{M}/gu, '');
    saida += base && [...base].every(c => aceitos.has(c.codePointAt(0)!)) ? base : '?';
  }
  return saida;
}

/** Corta com "…" até caber em `max` pontos. */
function caber(texto: string, fonte: PDFFont, tamanho: number, max: number): string {
  if (fonte.widthOfTextAtSize(texto, tamanho) <= max) return texto;
  let t = texto;
  while (t.length > 1 && fonte.widthOfTextAtSize(t + '…', tamanho) > max) t = t.slice(0, -1);
  return t.trimEnd() + '…';
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
  const aceitos = new Set(fonte.getCharacterSet());
  const nome = caber(paraWinAnsi(e.titularNome, aceitos), negrito, 10, larg - 16);
  ultima.drawText(nome, { x: x + 8, y: y + alt - 28, size: 10, font: negrito, color: rgb(0.1, 0.1, 0.1) });
  ultima.drawText(`CPF ${cpfMascarado(e.cpf)}`, { x: x + 8, y: y + alt - 40, size: 8, font: fonte, color: rgb(0.25, 0.25, 0.25) });
  ultima.drawText(
    caber(paraWinAnsi(`${e.cidade || '—'} · ${e.quando.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`, aceitos), fonte, 7, larg - 16),
    { x: x + 8, y: y + alt - 51, size: 7, font: fonte, color: rgb(0.35, 0.35, 0.35) },
  );
  ultima.drawText(paraWinAnsi(`Código ${e.codigo} · confira no GD Manager`, aceitos), { x: x + 8, y: y + 6, size: 6.5, font: fonte, color: rgb(0.45, 0.45, 0.45) });

  // xref CLÁSSICA — exigência do plainAddPlaceholder
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}

/**
 * Anexa a assinatura PAdES ao PDF **já aprovado**. Nenhum byte do que a pessoa
 * conferiu é reescrito: o resultado tem o aprovado como prefixo exato.
 *
 * A garantia é ESTRUTURAL: antes de devolver, confere o resultado e LANÇA erro
 * se o aprovado não for prefixo exato ou se a assinatura não estiver preenchida.
 * (Caminho real de quebra: `plainAddPlaceholder` corta \n/\r finais e re-adiciona
 * só \n, então um aprovado terminando em CRLF perderia o \r em silêncio.)
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
  const assinado = Buffer.from(await signpdf.sign(comPlaceholder, new P12Signer(pfx, { passphrase: senha })));

  const v = conferirAssinado(pdfAprovado, assinado);
  if (!v.prefixoOk) {
    throw new Error('O PDF assinado não preserva os bytes do PDF aprovado — assinatura descartada.');
  }
  if (!v.temByteRange || !v.contentsPreenchido) {
    throw new Error('O PDF assinado não traz uma assinatura completa (/ByteRange ou /Contents vazio) — assinatura descartada.');
  }
  return assinado;
}

export interface ConferenciaAssinado {
  /** os bytes aprovados são prefixo exato do assinado (e o assinado é maior) */
  prefixoOk: boolean;
  /** há um /ByteRange com os quatro números reais (o placeholder tem asteriscos) */
  temByteRange: boolean;
  /** o último /Contents não é só zeros (o placeholder é todo zeros; a assinatura põe o CMS ali) */
  contentsPreenchido: boolean;
}

/** Conferência final: prefixo exato + assinatura de verdade (e não só o placeholder). */
export function conferirAssinado(aprovado: Buffer, assinado: Buffer): ConferenciaAssinado {
  const texto = assinado.toString('latin1');
  const contents = [...texto.matchAll(/\/Contents\s*<([0-9A-Fa-f]+)>/g)].pop();
  return {
    prefixoOk: assinado.length > aprovado.length && assinado.subarray(0, aprovado.length).equals(aprovado),
    temByteRange: /\/ByteRange\s*\[\s*0\s+\d+\s+\d+\s+\d+\s*\]/.test(texto),
    contentsPreenchido: !!contents && /[1-9A-Fa-f]/.test(contents[1]),
  };
}
