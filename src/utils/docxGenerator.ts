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

/** Texto concatenado dos <w:t> de um chunk (o que o leitor vê). */
function chunkText(chunk: string): string {
  return parseWtNodes(chunk).map(n => n.text).join('');
}

/**
 * Aplica edições sobre o TEXTO concatenado do chunk, reescrevendo os <w:t>.
 * Cada edição substitui o intervalo [s, e) do texto pelo texto `r`
 * (s === e insere sem apagar nada). Consolida fragmentos automaticamente.
 */
function applyEditsToChunk(chunk: string, edits: { s: number; e: number; r: string }[]): string {
  const nodes = parseWtNodes(chunk);
  if (nodes.length === 0 || edits.length === 0) return chunk;

  const starts: number[] = [];
  let joined = '';
  for (const n of nodes) { starts.push(joined.length); joined += n.text; }
  const ends = nodes.map((n, i) => starts[i] + n.text.length);
  const newTexts = nodes.map(n => n.text);

  // direita → esquerda para manter os offsets originais válidos
  for (const { s, e, r } of [...edits].sort((a, b) => b.s - a.s)) {
    let first = nodes.findIndex((_, i) => starts[i] <= s && s < ends[i]);
    if (first === -1 && s >= joined.length) first = nodes.length - 1; // inserção no fim
    let last = nodes.findIndex((_, i) => starts[i] < e && e <= ends[i]);
    if (first === -1) continue;
    if (last === -1) last = nodes.length - 1;

    if (first === last) {
      newTexts[first] = newTexts[first].slice(0, s - starts[first]) + r + newTexts[first].slice(e - starts[first]);
    } else {
      newTexts[first] = newTexts[first].slice(0, s - starts[first]) + r;
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
  const joined = chunkText(chunk);
  if (!joined) return chunk;

  const edits: { s: number; e: number; r: string }[] = [];
  let m: RegExpExecArray | null;
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(joined))) {
    const tag = m[0].slice(1, -1);
    found.add(tag);
    if (mapper) edits.push({ s: m.index, e: m.index + m[0].length, r: mapper(tag) });
  }
  return applyEditsToChunk(chunk, edits);
}

function processXml(xml: string, mapper: ((tag: string) => string) | null, found: Set<string>): string {
  // Divide por fim de parágrafo para que uma tag nunca "atravesse" parágrafos
  const parts = xml.split('</w:p>');
  const outParts = parts.map(p => processChunk(p, mapper, found));
  return outParts.join('</w:p>');
}

// ── Aparência de "placeholder" (texto cinza dos campos do Word) ───────────────
//
// Campos de formulário usam o estilo "PlaceholderText" / "Texto de Espaço
// Reservado", que pinta o texto de cinza. Ao digitar no campo, o Word remove
// esse estilo — como escrevemos a tag no XML, precisamos fazer o mesmo, senão
// o valor sai cinza no documento gerado.

const PLACEHOLDER_STYLE = /placeholder|espa[çc]?oreservado|espaoreservado/i;

/** Cinza neutro (ex.: 808080)? Preto e cores de verdade são preservados. */
function isGrayColor(colorTag: string): boolean {
  const m = /w:val="([0-9A-Fa-f]{6})"/.exec(colorTag);
  if (!m) return false;
  const v = m[1].toUpperCase();
  const [r, g, b] = [v.slice(0, 2), v.slice(2, 4), v.slice(4, 6)];
  return r === g && g === b && parseInt(r, 16) > 0x40;
}

/** Tira o visual de placeholder de um parágrafo (estilo cinza + marca). */
function stripPlaceholderLook(chunk: string): string {
  let out = chunk.replace(/<w:showingPlcHdr\s*\/>/g, '');
  out = out.replace(/<w:rStyle\s[^>]*w:val="([^"]*)"[^>]*\/>/gi, (m, val: string) =>
    PLACEHOLDER_STYLE.test(val) ? '' : m);
  // sem cor explícita, o texto herda o padrão do documento (preto)
  out = out.replace(/<w:color\s[^>]*\/>/gi, m => (isGrayColor(m) ? '' : m));
  return out;
}

/** Limpa o visual de placeholder apenas dos parágrafos que contêm tags. */
function cleanPlaceholderStyling(xml: string): string {
  return xml.split('</w:p>').map(chunk => {
    TAG_RE.lastIndex = 0;
    return TAG_RE.test(chunkText(chunk)) ? stripPlaceholderLook(chunk) : chunk;
  }).join('</w:p>');
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

// ── Campos preenchíveis (formulários do Word) ─────────────────────────────────

/** Placeholders que o Word mostra em campos vazios (controles de conteúdo). */
const PLACEHOLDER_RE =
  /^(clique aqui|clique ou toque|escolher um item|selecionar um item|click here|click or tap|choose an item|enter a date)/i;

export interface TemplateField {
  /** Identificador estável dentro do buffer atual. */
  id: string;
  part: string;
  start: number;
  end: number;
  /** Rótulo do campo (célula anterior da linha, ou texto próximo). */
  label: string;
  /** Texto atual do campo ("Clique aqui para digitar texto." ou vazio). */
  currentText: string;
  kind: 'placeholder' | 'empty';
}

interface XmlRange { start: number; end: number }

/** Todos os intervalos <tag>…</tag> do XML (com aninhamento). */
function findRanges(xml: string, tag: string): XmlRange[] {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>|</${tag}>`, 'g');
  const stack: number[] = [];
  const out: XmlRange[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    if (m[0].startsWith('</')) {
      const s = stack.pop();
      if (s !== undefined) out.push({ start: s, end: m.index + m[0].length });
    } else if (!m[0].endsWith('/>')) {
      stack.push(m.index);
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Intervalo mais interno que contém o offset. */
function enclosing(ranges: XmlRange[], offset: number): XmlRange | null {
  let best: XmlRange | null = null;
  for (const r of ranges) {
    if (r.start <= offset && offset < r.end && (!best || r.start > best.start)) best = r;
  }
  return best;
}

/** Ordena as partes com o corpo do documento primeiro. */
function docxPartNames(zip: PizZip): string[] {
  return Object.keys(zip.files)
    .filter(n => DOCX_PARTS_RE.test(n))
    .sort((a, b) => (a === 'word/document.xml' ? -1 : b === 'word/document.xml' ? 1 : a.localeCompare(b)));
}

/**
 * Encontra os campos em branco de um formulário .docx: os placeholders do Word
 * ("Clique aqui para digitar texto.") e as células de tabela vazias, já com o
 * rótulo correspondente (normalmente a primeira célula da mesma linha).
 */
export function detectTemplateFields(buffer: ArrayBuffer): TemplateField[] {
  const zip = new PizZip(buffer);
  const out: TemplateField[] = [];

  for (const name of docxPartNames(zip)) {
    const xml = zip.files[name].asText();
    const paras = findRanges(xml, 'w:p');
    const cells = findRanges(xml, 'w:tc');
    const rows = findRanges(xml, 'w:tr');
    const textOf = (r: XmlRange) => chunkText(xml.slice(r.start, r.end));
    const usedCells = new Set<number>();

    for (let i = 0; i < paras.length; i++) {
      const p = paras[i];
      const text = textOf(p).trim();
      TAG_RE.lastIndex = 0;
      if (TAG_RE.test(text)) continue; // já tem tag — aparece no painel de Tags

      const cell = enclosing(cells, p.start);
      let kind: TemplateField['kind'] | null = null;

      if (PLACEHOLDER_RE.test(text)) {
        kind = 'placeholder';
      } else if (text === '' && cell) {
        // célula vazia → só o primeiro parágrafo dela vira campo
        if (usedCells.has(cell.start) || textOf(cell).trim() !== '') continue;
        kind = 'empty';
      }
      if (!kind) continue;
      if (cell) usedCells.add(cell.start);

      // Rótulo: primeira célula da linha (se não for a própria)
      let label = '';
      const row = enclosing(rows, p.start);
      if (row && cell) {
        const firstCell = cells.find(c => c.start >= row.start && c.end <= row.end);
        if (firstCell && firstCell.start !== cell.start) label = textOf(firstCell).trim();
      }
      // Fallback: parágrafo anterior com texto
      if (!label) {
        for (let j = i - 1; j >= 0 && j >= i - 6; j--) {
          const t = textOf(paras[j]).trim();
          if (t && !PLACEHOLDER_RE.test(t)) { label = t; break; }
        }
      }

      out.push({
        id: `${name}:${p.start}`,
        part: name,
        start: p.start,
        end: p.end,
        label: (label.replace(/\s+/g, ' ').slice(0, 90)) || 'Campo sem rótulo',
        currentText: text,
        kind,
      });
    }
  }
  return out;
}

/** Coloca `{tag}` como único conteúdo de um parágrafo (campo do formulário). */
function setParagraphTag(pChunk: string, tag: string): string {
  // o campo vira conteúdo real: sai a marca e o estilo cinza de placeholder
  const chunk = stripPlaceholderLook(pChunk);
  const nodes = parseWtNodes(chunk);
  const R = `{${tag}}`;

  if (nodes.length === 0) {
    const idx = chunk.lastIndexOf('</w:p>');
    if (idx === -1) return chunk;
    return chunk.slice(0, idx) + `<w:r><w:t>${R}</w:t></w:r>` + chunk.slice(idx);
  }
  const joined = nodes.map(n => n.text).join('');
  return applyEditsToChunk(chunk, [{ s: 0, e: joined.length, r: R }]);
}

/** Aplica variáveis aos campos escolhidos. `assignments`: id do campo → tag. */
export function insertTagsInFields(
  buffer: ArrayBuffer,
  fields: TemplateField[],
  assignments: Record<string, string>,
): ArrayBuffer {
  const zip = new PizZip(buffer);
  const byPart = new Map<string, TemplateField[]>();
  for (const f of fields) {
    if (!assignments[f.id]) continue;
    const list = byPart.get(f.part) ?? [];
    list.push(f);
    byPart.set(f.part, list);
  }

  for (const [part, list] of byPart) {
    let xml = zip.files[part].asText();
    // direita → esquerda para os offsets continuarem válidos
    for (const f of [...list].sort((a, b) => b.start - a.start)) {
      const chunk = xml.slice(f.start, f.end);
      xml = xml.slice(0, f.start) + setParagraphTag(chunk, assignments[f.id]) + xml.slice(f.end);
    }
    zip.file(part, xml);
  }
  return zip.generate({ type: 'arraybuffer' }) as ArrayBuffer;
}

// ── Inserção por trecho de texto selecionado na prévia ────────────────────────

/** Quantas vezes um trecho aparece no corpo do documento. */
export function countTextOccurrences(buffer: ArrayBuffer, needle: string): number {
  if (!needle) return 0;
  const zip = new PizZip(buffer);
  const file = zip.files['word/document.xml'];
  if (!file) return 0;
  let count = 0;
  for (const chunk of file.asText().split('</w:p>')) {
    const text = chunkText(chunk);
    let from = 0, idx: number;
    while ((idx = text.indexOf(needle, from)) !== -1) { count++; from = idx + needle.length; }
  }
  return count;
}

/**
 * Insere `{tag}` na N-ésima ocorrência de um trecho de texto do corpo.
 * @param mode 'replace' troca o trecho pela tag; 'after' mantém e insere depois.
 */
export function insertTagAtOccurrence(
  buffer: ArrayBuffer,
  needle: string,
  tag: string,
  occurrenceIndex: number,
  mode: 'replace' | 'after' = 'replace',
): { buffer: ArrayBuffer; ok: boolean } {
  if (!needle) return { buffer, ok: false };
  const zip = new PizZip(buffer);
  const file = zip.files['word/document.xml'];
  if (!file) return { buffer, ok: false };

  const parts = file.asText().split('</w:p>');
  let seen = 0;
  let done = false;

  for (let i = 0; i < parts.length && !done; i++) {
    const text = chunkText(parts[i]);
    let from = 0, idx: number;
    while ((idx = text.indexOf(needle, from)) !== -1) {
      if (seen === occurrenceIndex) {
        const end = idx + needle.length;
        const edit = mode === 'replace'
          ? { s: idx, e: end, r: `{${tag}}` }
          : { s: end, e: end, r: ` {${tag}}` };
        // se o trecho era um placeholder do Word, tira o visual cinza junto
        parts[i] = stripPlaceholderLook(applyEditsToChunk(parts[i], [edit]));
        done = true;
        break;
      }
      seen++;
      from = idx + needle.length;
    }
  }
  if (!done) return { buffer, ok: false };

  zip.file('word/document.xml', parts.join('</w:p>'));
  return { buffer: zip.generate({ type: 'arraybuffer' }) as ArrayBuffer, ok: true };
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

  // Tags em campos de formulário herdam o cinza do placeholder do Word —
  // limpa antes de preencher para o valor sair na cor normal do documento.
  for (const name of docxPartNames(zip)) {
    const xml = zip.files[name].asText();
    const cleaned = cleanPlaceholderStyling(xml);
    if (cleaned !== xml) zip.file(name, cleaned);
  }

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
