import { sanitizeFileName } from '@/lib/utils';

export type DocKind = 'datasheet' | 'inmetro';

const KIND_LABEL: Record<DocKind, string> = {
  datasheet: 'DATASHEET',
  inmetro: 'INMETRO',
};

/**
 * Nome padronizado do documento: "DATASHEET MARCA MODELO.pdf" (tudo em caixa alta).
 * Independe do nome original do arquivo enviado.
 */
export function buildEquipmentDocName(kind: DocKind, brand: string, model: string): string {
  const base = `${KIND_LABEL[kind]} ${brand} ${model}`.toUpperCase().replace(/\s+/g, ' ').trim();
  return `${base}.pdf`;
}

/** Caminho de storage seguro para o documento (sanitizado). */
export function buildEquipmentDocPath(equipmentKey: string, kind: DocKind, brand: string, model: string): string {
  return `${equipmentKey}/${kind}/${sanitizeFileName(buildEquipmentDocName(kind, brand, model))}`;
}

function fileToDataUrl(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/** Converte uma imagem (JPG/PNG) em um PDF de uma página, ajustado ao tamanho da imagem. */
export async function imageToPdfBlob(file: File): Promise<Blob> {
  const { default: jsPDF } = await import('jspdf');
  const dataUrl = await fileToDataUrl(file);
  const img = await loadImage(dataUrl);
  const w = img.naturalWidth || 1240;
  const h = img.naturalHeight || 1754;
  const orientation = w >= h ? 'landscape' : 'portrait';
  const pdf = new jsPDF({ orientation, unit: 'px', format: [w, h] });
  const fmt = file.type.includes('png') ? 'PNG' : 'JPEG';
  pdf.addImage(dataUrl, fmt, 0, 0, w, h);
  return pdf.output('blob');
}

/**
 * Prepara o arquivo para upload: se for imagem, converte para PDF.
 * Retorna sempre um Blob PDF.
 */
export async function ensurePdf(file: File): Promise<Blob> {
  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) return file;
  if (file.type.startsWith('image/')) return imageToPdfBlob(file);
  // fallback: sobe como está
  return file;
}
