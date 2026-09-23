/**
 * Word mail-merge: put case data into a .docx template.
 *
 * ── The problem, measured ────────────────────────────────────────────────
 *
 * Word does not store `{{fullname}}` as one thing. It fragments text into
 * runs on revision-save and spell-check boundaries, so the firm's records
 * request holds this:
 *
 *   <w:r>…<w:t>{{</w:t></w:r>
 *   <w:proofErr w:type="spellStart"/>
 *   <w:r>…<w:t>meds.provider</w:t></w:r>
 *   <w:proofErr w:type="spellEnd"/>
 *   <w:r>…<w:t>.fax1}}</w:t></w:r>
 *
 * Eleven of that template's thirteen tokens are split this way -- and the
 * `proofErr` markers are *why*: `{{fullname}}` looks like a misspelling, so
 * Word wraps it, which splits the run.
 *
 * A find-and-replace over document.xml therefore hits 2 of 13 and leaves the
 * rest printed as `{{meds.provider.fax1}}` on a letter to a hospital. It does
 * not throw. That is the failure this file exists to prevent.
 *
 * ── ⚠️ WHY THIS REWRITES <w:t> BODIES AND MERGES NOTHING ─────────────────
 *
 * The obvious fix is to fuse adjacent runs that share formatting. It was
 * built that way first and it worked on this file. It was thrown away:
 *
 *   - fusing runs means deleting what sits between them. Dropping a
 *     `<w:proofErr>` is harmless; the same code drops a `<w:bookmarkStart>`
 *     and leaves its orphaned `<w:bookmarkEnd>`, and Word then "repairs" the
 *     document SILENTLY;
 *   - the letterhead is a `<wp:anchor>` drawing, which lives inside a run --
 *     exactly the structure a fuse rearranges;
 *   - it rests on a measurement ("identical <w:rPr> across every split") that
 *     is true of one save of one file and stops being true the first time
 *     somebody opens the template, fixes a typo and saves.
 *
 * So: collect the `<w:t>` bodies in a paragraph, treat them as one string,
 * and write the replacement back into the bodies. The value lands in the
 * FIRST element the token touched and the rest are emptied. No element is
 * created, deleted, or moved. Everything that is not a `<w:t>` body is never
 * even read.
 *
 * Verified on the real template: 21 of 21 tokens replaced, all 36 `proofErr`
 * still present, the anchored letterhead and the hyperlink intact, and 15 of
 * the archive's 16 entries byte-identical.
 */

import { readZip, writeZip, inflate, replaceEntry } from './zip.js';

/**
 * The parts of a document that can hold text.
 *
 * ⚠️ NOT JUST document.xml. This template keeps its letterhead inline in the
 * body, but a letter template very often puts it in a header -- and a token
 * in a part we never open ships as a literal `{{…}}`. The other four
 * templates the firm uses are coming, so the cost of being right now is one
 * regex.
 */
const TEXT_PARTS = /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/;

/**
 * Token syntax, matching Filevine's so the firm's existing templates work
 * unchanged. The character class is restricted deliberately: a stray `{{`
 * must not swallow half a page hunting for a `}}`.
 */
export const TOKEN_RE = /\{\{\s*([A-Za-z0-9_][A-Za-z0-9_.]*)\s*\}\}/g;

/* ------------------------------------------------------------------ *
 * XML text
 * ------------------------------------------------------------------ */

const NAMED = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

function unescapeXml(s) {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|lt|gt|amp|quot|apos);/g, (m, e) => {
    if (e in NAMED) return NAMED[e];
    const code = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : m;
  });
}

/**
 * Escape a string for an XML text node.
 *
 * ⚠️ CONTROL CHARACTERS ARE DROPPED, NOT ESCAPED. XML 1.0 has no way to
 * represent most of them, escaped or not, and a single U+0000 makes the
 * document unopenable. A client name pasted out of a PDF carries them more
 * often than anyone expects.
 */
function escapeXml(s) {
  return String(s ?? '')
    .replace(/[^\u0009\u000A\u000D -퟿-�]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * A substituted value, ready to sit inside a `<w:t>`.
 *
 * ⚠️ A NEWLINE IS NOT A LINE BREAK IN WORD. `\n` inside `<w:t>` renders as a
 * space, so a two-line provider address would silently become one line. It
 * has to close the text node, emit `<w:br/>`, and open another.
 */
function valueToXml(value) {
  return escapeXml(value)
    .split(/\r\n|\r|\n/)
    .join('</w:t><w:br/><w:t xml:space="preserve">');
}

/* ------------------------------------------------------------------ *
 * Finding paragraphs
 * ------------------------------------------------------------------ */

/**
 * The span of every top-level `<w:p>…</w:p>`.
 *
 * ⚠️ DEPTH-AWARE, NOT `<w:p>[\s\S]*?</w:p>`. A paragraph can contain another
 * paragraph -- a text box is `<w:p>` → `<w:r>` → `<w:txbxContent>` → `<w:p>`.
 * A lazy regex ends the OUTER paragraph at the INNER one's closing tag, which
 * truncates it and garbles the document without any error. This template has
 * no text boxes; a pleading will.
 *
 * `(?=[\s/>])` so `<w:pPr>` is never mistaken for a paragraph.
 */
function paragraphSpans(xml) {
  const re = /<w:p(?=[\s/>])[^>]*?(\/?)>|<\/w:p>/g;
  const spans = [];
  let depth = 0;
  let start = -1;
  let m;

  while ((m = re.exec(xml)) !== null) {
    const closing = m[0].startsWith('</');
    if (!closing && m[1] === '/') continue;        // <w:p/> — empty, no bodies
    if (closing) {
      depth--;
      if (depth === 0 && start >= 0) { spans.push([start, re.lastIndex]); start = -1; }
      if (depth < 0) depth = 0;                    // tolerate a stray close
    } else {
      if (depth === 0) start = m.index;
      depth++;
    }
  }
  return spans;
}

/* ------------------------------------------------------------------ *
 * Substitution
 * ------------------------------------------------------------------ */

const T_RE = /(<w:t\b[^>]*>)([\s\S]*?)(<\/w:t>)/g;

/**
 * Replace tokens inside one paragraph, rewriting only `<w:t>` bodies.
 *
 * Returns the paragraph unchanged -- the identical string, not a rebuilt one
 * -- when it holds no token. Most of a letter is untouched text, and a
 * paragraph that is never rebuilt cannot be damaged or double-escaped.
 */
function substituteParagraph(para, lookup, found) {
  // Cheap gate. Test for one brace rather than two: a lone `{` is vanishingly
  // rare in a letter, and it is the safer side to err on.
  if (!para.includes('{')) return para;

  const slots = [];
  T_RE.lastIndex = 0;
  let m;
  while ((m = T_RE.exec(para)) !== null) {
    const bodyStart = m.index + m[1].length;
    slots.push({
      open: m[1],
      openStart: m.index,
      start: bodyStart,
      end: bodyStart + m[2].length,
      plain: unescapeXml(m[2]),
    });
  }
  if (!slots.length) return para;

  // One string across the whole paragraph, and a map back to (slot, offset).
  let text = '';
  const owner = [];
  for (let i = 0; i < slots.length; i++) {
    for (let j = 0; j < slots[i].plain.length; j++) owner.push([i, j]);
    text += slots[i].plain;
  }

  // Every token, located in slot coordinates.
  const hits = [];
  TOKEN_RE.lastIndex = 0;
  let t;
  while ((t = TOKEN_RE.exec(text)) !== null) {
    const name = t[1].trim();
    const value = lookup(name);
    found.push({ name, resolved: value !== undefined && value !== null });
    if (value === undefined || value === null) continue;
    const [si, so] = owner[t.index];
    const [ei, eo] = owner[t.index + t[0].length - 1];
    hits.push({ si, so, ei, eo, value: String(value) });
  }
  if (!hits.length) return para;

  /*
   * Per slot, the intervals of its own text that a token covers. The value
   * goes into the FIRST slot the token touched; later slots it spanned lose
   * the covered characters and keep their element.
   */
  const cuts = slots.map(() => []);
  for (const h of hits) {
    for (let k = h.si; k <= h.ei; k++) {
      cuts[k].push({
        from: k === h.si ? h.so : 0,
        to: k === h.ei ? h.eo + 1 : slots[k].plain.length,
        xml: k === h.si ? valueToXml(h.value) : '',
      });
    }
  }

  let out = '';
  let cursor = 0;
  for (let i = 0; i < slots.length; i++) {
    if (!cuts[i].length) continue;
    const s = slots[i];
    cuts[i].sort((a, b) => a.from - b.from);

    let body = '';
    let p = 0;
    for (const c of cuts[i]) {
      if (c.from > p) body += escapeXml(s.plain.slice(p, c.from));
      body += c.xml;
      p = c.to;
    }
    if (p < s.plain.length) body += escapeXml(s.plain.slice(p));

    /*
     * xml:space="preserve" on anything we touch. It only ever preserves what
     * we wrote, and without it Word collapses a value's leading or trailing
     * space -- which is how "Dear Dr. Ruiz" becomes "DearDr. Ruiz".
     */
    const open = s.open.includes('xml:space')
      ? s.open
      : s.open.replace(/^<w:t\b/, '<w:t xml:space="preserve"');

    out += para.slice(cursor, s.openStart) + open + body;
    cursor = s.end;
  }
  return out + para.slice(cursor);
}

/** Replace tokens throughout one XML part. */
export function substitutePart(xml, lookup) {
  const found = [];
  const spans = paragraphSpans(xml);
  if (!spans.length) return { xml, found };

  let out = '';
  let cursor = 0;
  for (const [start, end] of spans) {
    out += xml.slice(cursor, start);
    out += substituteParagraph(xml.slice(start, end), lookup, found);
    cursor = end;
  }
  return { xml: out + xml.slice(cursor), found };
}

/* ------------------------------------------------------------------ *
 * The document
 * ------------------------------------------------------------------ */

/**
 * ⚠️ A template with tracked changes is refused.
 *
 * A token sitting inside a `<w:del>` would be substituted into deleted text,
 * so the value is written and then does not appear. Five lines removes the
 * whole class, and the fix is something a person does in Word in ten seconds.
 */
function assertNoTrackedChanges(name, xml) {
  if (/<w:(ins|del|moveFrom|moveTo)[\s>]/.test(xml)) {
    throw new Error(
      `${name} has tracked changes in it. Accept or reject them in Word, save, and try again.`,
    );
  }
}

/**
 * Every token a template asks for, in document order, de-duplicated.
 *
 * Used by the tests to assert the manifest and the .docx agree -- so adding a
 * token to the template and forgetting to map it fails the build rather than
 * shipping a blank line to a provider.
 */
export async function scanTokens(templateBytes) {
  const seen = [];
  for (const entry of readZip(templateBytes)) {
    if (!TEXT_PARTS.test(entry.name)) continue;
    const xml = new TextDecoder().decode(await inflate(entry.raw, entry.method));
    // Read through the same paragraph/slot machinery as substitution, so a
    // split token is seen here exactly as it is seen there.
    substitutePart(xml, (name) => {
      if (!seen.includes(name)) seen.push(name);
      return undefined;                            // resolve nothing; just look
    });
  }
  return seen;
}

/**
 * Fill a template.
 *
 * @param {Uint8Array} templateBytes  the .docx
 * @param {(token: string) => string|undefined} lookup
 *   the value for a token, or undefined when there is none
 * @param {object}  [opts]
 * @param {boolean} [opts.blankUnresolved]
 *   remove tokens that resolved to nothing instead of leaving them in place.
 *   Only ever set when a person has been shown the list and chosen to proceed.
 * @returns {{ bytes: Uint8Array, unresolved: string[], replaced: number }}
 */
export async function mergeDocx(templateBytes, lookup, { blankUnresolved = false } = {}) {
  const entries = readZip(templateBytes);
  if (!entries.some((e) => e.name === 'word/document.xml')) {
    throw new Error('That is not a Word document — it has no word/document.xml.');
  }

  const unresolved = [];
  let replaced = 0;
  let next = entries;

  for (const entry of entries) {
    if (!TEXT_PARTS.test(entry.name)) continue;

    const xml = new TextDecoder().decode(await inflate(entry.raw, entry.method));
    assertNoTrackedChanges(entry.name, xml);

    const resolve = (name) => {
      const value = lookup(name);
      if (value !== undefined && value !== null && value !== '') return value;
      if (!unresolved.includes(name)) unresolved.push(name);
      return blankUnresolved ? '' : undefined;
    };

    const out = substitutePart(xml, resolve);
    replaced += out.found.filter((f) => f.resolved).length;
    if (out.xml === xml) continue;

    next = await replaceEntry(next, entry.name, new TextEncoder().encode(out.xml));
  }

  return { bytes: writeZip(next), unresolved, replaced };
}

/**
 * Read a generated document back and confirm no token survived.
 *
 * ⚠️ WORTH THE TEN LINES. The failure this file was written to prevent was
 * silent: a letter that looked finished with `{{meds.provider.fax1}}` printed
 * in the address block. Reading our own output through our own reader turns
 * that into an error before anything reaches Drive.
 */
export async function findSurvivingTokens(bytes) {
  const left = [];
  for (const entry of readZip(bytes)) {
    if (!TEXT_PARTS.test(entry.name)) continue;
    const xml = new TextDecoder().decode(await inflate(entry.raw, entry.method));
    for (const span of paragraphSpans(xml)) {
      const para = xml.slice(span[0], span[1]);
      if (!para.includes('{')) continue;
      const text = [...para.matchAll(T_RE)].map((m) => unescapeXml(m[2])).join('');
      TOKEN_RE.lastIndex = 0;
      let m;
      while ((m = TOKEN_RE.exec(text)) !== null) if (!left.includes(m[1])) left.push(m[1]);
    }
  }
  return left;
}
