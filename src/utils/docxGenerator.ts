import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';

// ── Parsing de tags em .docx (robusto a runs fragmentados do Word) ────────────
//
// O Word frequentemente quebra `{cidade}` em vários nós de texto:
//   <w:t>{</w:t><w:t>cidade</w:t><w:t>}</w:t>
// Por isso o texto dos <w:t> de cada PARÁGRAFO é concatenado (sem separador)
// antes de procurar as tags. Também são analisados cabeçalhos e rodapés.

const TAG_RE = /\{[a-zA-Z_][a-zA-Z0-9_]*\}/g;
const DOCX_PARTS_RE = /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/;

interface WtNode {
  innerStart: number; // posição do texto dentro do chunk XML
  innerEnd: number;
  openStart: number;  // início da tag <w:t ...>
  attrs: string;
  text: string;
}

function parseWtNodes(chunk: string): WtNode[] {
  const nodes: WtNode[] = [];
  const re = /<w:t(\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(chunk))) {
    const attrs = m[1] ?? '';
    const text = m[2];
    const innerStart = m.index + `<w:t${attrs}>`.length;
    nodes.push({ innerStart, innerEnd: innerStart + text.length, openStart: m.index, attrs, text });
  }
  return nodes;
}

/**
 * Processa um chunk XML (um "parágrafo lógico"): encontra as tags no texto
 * concatenado dos <w:t> e, se `mapper` for passado, reescreve cada tag inteira
 * dentro de um único nó (consolidando fragmentos) com o valor retornado.
 */
function processChunk(
  chunk: string,
  mapper: ((tag: string) => string) | null,
  found: Set<string>,
): string {
  const nodes = parseWtNodes(chunk);
  if (nodes.length === 0) return chunk;

  const starts: number[] = [];
  let joined = '';
  for (const n of nodes) { starts.push(joined.length); joined += n.text; }

  const matches: { s: number; e: number; tag: string }[] = [];
  let m: RegExpExecArray | null;
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(joined))) {
    const tag = m[0].slice(1, -1);
    found.add(tag);
    matches.push({ s: m.index, e: m.index + m[0].length, tag });
  }
  if (!mapper || matches.length === 0) return chunk;

  const ends = nodes.map((n, i) => starts[i] + n.text.length);
  const newTexts = nodes.map(n => n.text);

  // direita → esquerda para manter os offsets originais válidos
  for (let k = matches.length - 1; k >= 0; k--) {
    const { s, e, tag } = matches[k];
    const R = mapper(tag);
    const first = nodes.findIndex((_, i) => starts[i] <= s && s < ends[i]);
    let last = nodes.findIndex((_, i) => starts[i] < e && e <= ends[i]);
    if (first === -1) continue;
    if (last === -1) last = nodes.length - 1;

    if (first === last) {
      const sOff = s - starts[first], eOff = e - starts[first];
      newTexts[first] = newTexts[first].slice(0, sOff) + R + newTexts[first].slice(eOff);
    } else {
      newTexts[first] = newTexts[first].slice(0, s - starts[first]) + R;
      for (let i = first + 1; i < last; i++) newTexts[i] = '';
      newTexts[last] = newTexts[last].slice(e - starts[last]);
    }
  }

  // Reescreve os nós alterados (direita → esquerda)
  let out = chunk;
  for (let i = nodes.length - 1; i >= 0; i--) {
    if (newTexts[i] === nodes[i].text) continue;
    const needsPreserve = /^\s|\s$/.test(newTexts[i]);
    const attrs = needsPreserve && !nodes[i].attrs.includes('xml:space')
      ? `${nodes[i].attrs} xml:space="preserve"` : nodes[i].attrs;
    out = out.slice(0, nodes[i].openStart)
      + `<w:t${attrs}>` + newTexts[i] + '</w:t>'
      + out.slice(nodes[i].innerEnd + '</w:t>'.length);
  }
  return out;
}

function processXml(xml: string, mapper: ((tag: string) => string) | null, found: Set<string>): string {
  // Divide por fim de parágrafo para que uma tag nunca "atravesse" parágrafos
  const parts = xml.split('</w:p>');
  const outParts = parts.map(p => processChunk(p, mapper, found));
  return outParts.join('</w:p>');
}

/**
 * Detect whether a .docx template contains single-brace tags ( {field} ).
 * Junta os runs fragmentados do Word e analisa corpo + cabeçalhos + rodapés.
 *
 * @returns { hasTags, tags } — hasTags=true when ≥1 tag found; tags = unique list
 */
export async function detectTemplateTags(
  buffer: ArrayBuffer,
): Promise<{ hasTags: boolean; tags: string[] }> {
  try {
    const zip = new PizZip(buffer);
    const found = new Set<string>();
    for (const name of Object.keys(zip.files)) {
      if (!DOCX_PARTS_RE.test(name)) continue;
      processXml(zip.files[name].asText(), null, found);
    }
    const tags = [...found];
    console.log('[docxGenerator] Tags detectadas no template:', tags);
    return { hasTags: tags.length > 0, tags };
  } catch (err) {
    console.error('[docxGenerator] Erro ao detectar tags:', err);
    return { hasTags: false, tags: [] };
  }
}

/**
 * Reescreve as tags de um .docx:
 * - consolida cada tag fragmentada em um único nó de texto (torna o
 *   preenchimento pelo docxtemplater mais confiável);
 * - renomeia as tags presentes em `mapping` (ex.: { titular: 'nome_titular' }).
 *
 * @returns novo ArrayBuffer do .docx corrigido
 */
export function renameTagsInDocx(
  buffer: ArrayBuffer,
  mapping: Record<string, string> = {},
): ArrayBuffer {
  const zip = new PizZip(buffer);
  const found = new Set<string>();
  const mapper = (tag: string) => `{${mapping[tag] ?? tag}}`;
  for (const name of Object.keys(zip.files)) {
    if (!DOCX_PARTS_RE.test(name)) continue;
    const xml = zip.files[name].asText();
    const newXml = processXml(xml, mapper, found);
    if (newXml !== xml) zip.file(name, newXml);
  }
  return zip.generate({ type: 'arraybuffer' }) as ArrayBuffer;
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
