/**
 * Read an .xlsx into rows of strings. No dependency.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 *
 * Every report Filevine produced for this firm is .xlsx, and the importer
 * only read CSV. The obvious workaround — open each of the 24 files and
 * "Save as CSV" — is worse than it looks, because that round trip is where
 * dates go wrong. Excel writes a date cell out using the machine's locale,
 * so a Statute of Limitations of 3 August becomes "8/3/26" on one laptop and
 * "3/8/26" on another, and the importer then has to guess which. It guesses
 * well, and on a column where every day of the month is under 13 it cannot
 * guess at all.
 *
 * Inside the .xlsx that date is not text. It is the number 46237. Reading
 * the file directly means the ambiguity never exists — which on the SOL
 * column is the difference between a correct deadline and a malpractice
 * claim.
 *
 * ── What an .xlsx actually is ─────────────────────────────────────────────
 *
 * A ZIP of XML. Three members matter:
 *
 *   xl/worksheets/sheet1.xml   the cells
 *   xl/sharedStrings.xml       every string, deduplicated; cells reference
 *                              them BY INDEX, so a sheet read without this
 *                              yields numbers where the text should be
 *   xl/styles.xml              number formats — the only way to tell the
 *                              date 46237 from the dollar amount 46237
 *
 * ── Scope, stated plainly ─────────────────────────────────────────────────
 *
 * This reads the first worksheet of an uncompressed-or-deflated xlsx and
 * returns a grid of strings. It does not do formulas (it returns the cached
 * value Excel stored, which is what a report export contains), charts,
 * multiple sheets, or anything else. It is a report reader, not a
 * spreadsheet engine. Anything beyond that should use a real library.
 */

/* ------------------------------------------------------------------ *
 * ZIP
 * ------------------------------------------------------------------ */

const dv = (buf) => new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

/**
 * Locate members via the End Of Central Directory record.
 *
 * Scanned from the END, not by walking local headers from the front. A local
 * header may carry sizes of zero with the real values in a trailing data
 * descriptor, so front-to-back parsing breaks on files written by streaming
 * producers — which is most of them.
 */
function zipEntries(bytes) {
  const view = dv(bytes);
  let eocd = -1;
  // The comment field is up to 64 KB, so the signature can be that far in.
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65558); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a .xlsx file — no ZIP directory found.');

  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const entries = new Map();

  for (let i = 0; i < count; i++) {
    if (view.getUint32(p, true) !== 0x02014b50) break;
    const method = view.getUint16(p + 10, true);
    const compressedSize = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOffset = view.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));

    // The local header's own name/extra lengths, not the directory's: the
    // extra field is routinely a different length in the two places.
    const lNameLen = view.getUint16(localOffset + 26, true);
    const lExtraLen = view.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + lNameLen + lExtraLen;

    entries.set(name, { method, start, compressedSize });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function inflate(bytes, method) {
  if (method === 0) return bytes;                       // stored
  if (method !== 8) throw new Error(`Unsupported ZIP compression (${method}).`);
  // DecompressionStream is in Node 18+ and every current browser, so the
  // deflate implementation is the platform's rather than ours.
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/* ------------------------------------------------------------------ *
 * XML — enough of it, and no more
 * ------------------------------------------------------------------ */

const XML_ENTITY = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

function unescapeXml(s) {
  return s.replace(/&(#x?[0-9a-fA-F]+|lt|gt|amp|quot|apos);/g, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return XML_ENTITY[e] ?? m;
  });
}

/** Concatenated text of every <t> in a chunk. A run-formatted cell has several. */
function textOf(chunk) {
  let out = '';
  for (const m of chunk.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t\s*\/>/g)) {
    out += unescapeXml(m[1] ?? '');
  }
  return out;
}

function sharedStrings(xml) {
  if (!xml) return [];
  // Split on <si> rather than matching across them, so one unterminated
  // element cannot swallow the rest of the table.
  return [...xml.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]));
}

/* ------------------------------------------------------------------ *
 * Dates
 * ------------------------------------------------------------------ */

/**
 * Which style ids are dates.
 *
 * A cell says "I am style 3"; style 3 says "I use number format 14"; format
 * 14 is `m/d/yy`. Built-in formats below 164 are not written into the file
 * at all — they are defined by the spec — so the numeric ids have to be
 * recognised by value. Custom formats (164+) carry their own format string,
 * and are dates if that string contains an unquoted date token.
 */
const BUILTIN_DATE_FORMATS = new Set([
  14, 15, 16, 17, 22,             // m/d/yyyy, d-mmm-yy, d-mmm, mmm-yy, datetime
  27, 28, 29, 30, 31, 32, 33, 34, 35, 36,   // East Asian date formats
  50, 51, 52, 53, 54, 55, 56, 57, 58,       // more of the same
]);

/*
 * 18–21 and 45–47 are TIMES, not dates, and are deliberately absent.
 * Their serial is a fraction of a day, so running one through serialToISO
 * yields 1899-12-30 — a wrong date is worse than a visible number.
 *
 * 27 is why this list is not just 14–22. Filevine's exporter writes every
 * date cell with numFmtId 27, which is outside the range most short lists
 * cover, so a Statute of Limitations came back as the raw serial 46232.
 * That would have imported as text into a date field.
 */

function dateStyleIds(stylesXml) {
  const dates = new Set();
  if (!stylesXml) return dates;

  const customDate = new Set();
  for (const m of stylesXml.matchAll(/<numFmt[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g)) {
    // Strip quoted literals first: a currency format like "d"#,##0 must not
    // be read as a day token.
    const code = unescapeXml(m[2]).replace(/"[^"]*"/g, '').replace(/\\./g, '');
    if (/[ymdhs]/i.test(code) && !/^[#0.,%\s]*$/.test(code)) customDate.add(Number(m[1]));
  }

  const cellXfs = stylesXml.match(/<cellXfs[\s\S]*?<\/cellXfs>/);
  if (!cellXfs) return dates;
  let index = 0;
  for (const xf of cellXfs[0].matchAll(/<xf\b[^>]*\/?>/g)) {
    const id = Number(/numFmtId="(\d+)"/.exec(xf[0])?.[1] ?? 0);
    if (BUILTIN_DATE_FORMATS.has(id) || customDate.has(id)) dates.add(index);
    index += 1;
  }
  return dates;
}

/**
 * Excel serial -> ISO date.
 *
 * Epoch is 1899-12-30, not 1900-01-01: Excel believes 1900 was a leap year,
 * a bug kept since Lotus 1-2-3 for compatibility, and offsetting the epoch by
 * two days is how every reader absorbs it. `lib/domain/import.js` carries the
 * same constant for CSV cells that hold a bare serial.
 */
export function serialToISO(serial) {
  const n = Number(serial);
  if (!Number.isFinite(n) || n <= 0) return '';
  const ms = Math.round((n - 25569) * 86400000);
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

/* ------------------------------------------------------------------ *
 * Cells
 * ------------------------------------------------------------------ */

/** "BC12" -> 54. Column letters are base-26 with no zero. */
export function columnIndex(ref) {
  const letters = /^([A-Z]+)/.exec(String(ref || '').toUpperCase())?.[1];
  if (!letters) return -1;
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function parseSheet(xml, strings, dateStyles) {
  const rows = [];
  // Self-closing branch FIRST, and lazy attributes, for the same reason as
  // the cell regex below: otherwise an empty `<row r="5"/>` consumes the
  // rows after it.
  for (const rowMatch of xml.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const inner = rowMatch[1] ?? '';
    const cells = [];
    /*
     * `[^>]*?` LAZY, and it matters.
     *
     * Greedy, the attribute run swallows the trailing slash of a
     * self-closing `<c r="D4" s="4" />`; the `\/>` branch then fails, the
     * `>` branch matches instead, and the lazy body scan runs on to the
     * NEXT cell's `</c>` — eating the following cell whole. The symptom is
     * not an error. It is every column after the first empty one shifted
     * left by one, so on the real Case Status Report the attorney's name
     * arrived in the Court Date column and looked like a plausible value.
     * Caught by reading an actual export rather than a fixture.
     */
    for (const c of inner.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1] || '';
      const body = c[2] || '';
      const ref = /r="([A-Z]+\d+)"/.exec(attrs)?.[1];
      const type = /t="([^"]+)"/.exec(attrs)?.[1] || 'n';
      const style = Number(/s="(\d+)"/.exec(attrs)?.[1] ?? -1);

      let value = '';
      if (type === 's') {
        const i = Number(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1]);
        value = strings[i] ?? '';
      } else if (type === 'inlineStr') {
        value = textOf(body);
      } else if (type === 'str') {
        // A formula's cached string result.
        value = unescapeXml(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? '');
      } else if (type === 'b') {
        value = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1] === '1' ? 'TRUE' : 'FALSE';
      } else if (type === 'e') {
        // #N/A and friends. Emptied rather than imported as the literal
        // "#N/A", which would otherwise land in a client's record.
        value = '';
      } else {
        const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? '';
        value = raw && dateStyles.has(style) ? serialToISO(raw) : raw;
      }

      // Empty cells are omitted from the XML entirely, so position comes
      // from the reference and gaps are filled. Without this every row with
      // a blank middle column would shift left and misalign with its header.
      const at = ref ? columnIndex(ref) : cells.length;
      while (cells.length < at) cells.push('');
      cells[at] = value;
    }
    rows.push(cells);
  }
  return rows;
}

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

/**
 * @param {ArrayBuffer|Uint8Array} input
 * @returns {Promise<string[][]>} Rows of cells, first row included.
 */
export async function readXlsx(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const entries = zipEntries(bytes);

  const read = async (name) => {
    const e = entries.get(name);
    if (!e) return '';
    const raw = bytes.subarray(e.start, e.start + e.compressedSize);
    return new TextDecoder().decode(await inflate(raw, e.method));
  };

  // Sheets are not always sheet1.xml — a workbook whose first tab was
  // deleted starts at sheet2. Take the lowest-numbered one present.
  const sheetName = [...entries.keys()]
    .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]))[0];
  if (!sheetName) throw new Error('That .xlsx has no worksheet in it.');

  const [sheetXml, sharedXml, stylesXml] = await Promise.all([
    read(sheetName), read('xl/sharedStrings.xml'), read('xl/styles.xml'),
  ]);

  return parseSheet(sheetXml, sharedStrings(sharedXml), dateStyleIds(stylesXml));
}

/** True for bytes that begin with the ZIP local-header signature "PK\3\4". */
export function looksLikeXlsx(input) {
  const b = input instanceof Uint8Array ? input : new Uint8Array(input);
  return b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
}
