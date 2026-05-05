import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Formata um número como moeda brasileira: R$ 1.234,56
 * Trata null / undefined / NaN → R$ 0,00
 */
export function formatCurrency(value: number | null | undefined): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value ?? 0);
}

// ── Security helpers ──────────────────────────────────────────────────────────

/** Tipos MIME permitidos para upload de documentos */
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',       // .xlsx
  'application/msword',       // .doc
  'application/vnd.ms-excel', // .xls
]);

/** Tamanho máximo de upload: 10 MB */
const MAX_FILE_SIZE = 10 * 1024 * 1024;

/**
 * Valida tipo MIME e tamanho de um arquivo antes do upload.
 * Retorna null se OK, ou string de erro se inválido.
 */
export function validateFile(file: File): string | null {
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return `Tipo de arquivo não permitido: ${file.type || 'desconhecido'}. Use PDF, imagem ou documento Office.`;
  }
  if (file.size > MAX_FILE_SIZE) {
    return `Arquivo muito grande (${(file.size / 1024 / 1024).toFixed(1)} MB). Máximo: 10 MB.`;
  }
  return null;
}

/**
 * Sanitiza o nome de um arquivo: remove caracteres especiais,
 * previne path traversal e limita o comprimento.
 */
export function sanitizeFileName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9._\-\u00C0-\u024F]/g, '_') // keep accented latin chars
    .replace(/\.{2,}/g, '.')                          // no double dots (path traversal)
    .replace(/^[._]+/, '')                            // no leading dots/underscores
    .substring(0, 100);                               // max 100 chars
}

/**
 * Escapa caracteres HTML para prevenir XSS em conteúdo inserido via innerHTML.
 * Para React JSX normal não é necessário — React já escapa automaticamente.
 */
export function sanitizeInput(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .trim();
}

/**
 * Mascara CPF/CNPJ para roles sem permissão de ver dado completo.
 * Admin vê completo; outros veem parcialmente mascarado.
 */
export function maskDocument(doc: string, role: string): string {
  if (!doc || role === 'admin') return doc;
  // CPF: 000.000.000-00 → 0**.***.**0-00
  if (doc.replace(/\D/g, '').length === 11) {
    return doc.replace(/(\d{3})[\d.*]{3}\.[\d.*]{3}(-\d{2})/, '$1.***.***$2');
  }
  // CNPJ: 00.000.000/0000-00 → 00.***.***/**00-00
  return doc.replace(/(\d{2})\.\d{3}\.\d{3}\/(\d{2})\d{2}(-\d{2})/, '$1.***.***/$200$3');
}
