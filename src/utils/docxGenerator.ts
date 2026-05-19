import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';

/**
 * Detect whether a .docx template contains single-brace tags ( {field} ).
 * Strips XML markup first so fragmented runs don't cause false negatives.
 *
 * @returns { hasTags, tags } — hasTags=true when ≥1 tag found; tags = unique list
 */
export async function detectTemplateTags(
  buffer: ArrayBuffer,
): Promise<{ hasTags: boolean; tags: string[] }> {
  try {
    const zip = new PizZip(buffer);
    const docXml = zip.file('word/document.xml');
    if (!docXml) return { hasTags: false, tags: [] };

    // Strip XML markup to inspect plain text only
    const textOnly = docXml
      .asText()
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ');

    // Match {field_name} — letters/digits/underscores only
    // Ignores XML namespace URIs like {http://...}
    const matches = textOnly.match(/\{[a-zA-Z_][a-zA-Z0-9_]*\}/g) ?? [];
    // Strip the surrounding { } so returned names match buildProjectValues keys
    const tags = [...new Set(matches.map(m => m.slice(1, -1)))];

    console.log('[docxGenerator] Tags detectadas no template:', tags);

    return { hasTags: tags.length > 0, tags };
  } catch (err) {
    console.error('[docxGenerator] Erro ao detectar tags:', err);
    return { hasTags: false, tags: [] };
  }
}

/**
 * Fill a .docx template using Docxtemplater with single-brace delimiters { }.
 * Missing tags are silently replaced with an empty string (nullGetter).
 *
 * @param templateBuffer  The original .docx template as an ArrayBuffer.
 * @param values          Key-value map matching the template tags (keys without braces).
 * @returns               A Blob with the filled document ready for download.
 */
export async function generateDocxFromTemplate(
  templateBuffer: ArrayBuffer,
  values: Record<string, string>,
): Promise<Blob> {
  console.log('[docxGenerator] Gerando docx com valores:', values);

  const zip = new PizZip(templateBuffer);
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    // ← SINGLE-BRACE delimiters to match {campo} tags
    delimiters: { start: '{', end: '}' },
    // ← Return empty string for any unmapped tag instead of throwing
    nullGetter() {
      return '';
    },
  });

  try {
    doc.render(values);
  } catch (error: unknown) {
    // Log details but don't abort — partially rendered output is still usable
    const e = error as { properties?: { errors?: unknown[] } };
    if (e?.properties?.errors?.length) {
      console.warn('[docxGenerator] Tags não mapeadas:', e.properties.errors);
    } else {
      console.error('[docxGenerator] Erro ao renderizar:', error);
    }
  }

  const output = doc.getZip().generate({
    type: 'arraybuffer',
    mimeType:
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });

  return new Blob([output], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
}
