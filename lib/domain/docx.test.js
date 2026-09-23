import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mergeDocx, scanTokens, substitutePart, findSurvivingTokens } from './docx.js';
import { readZip, inflate } from './zip.js';

const TEMPLATE = new Uint8Array(readFileSync(new URL('../templates/med-req.docx', import.meta.url)));

/** Every token the firm's real records request carries. */
const VALUES = {
  TODAY_LONG: 'September 23, 2026',
  fullname: 'Charles Wyatt Hollister',
  ssn: '123-45-6789',
  clientBirthdate: 'March 4, 1998',
  incidentDate: 'January 12, 2023',
  'intake.referredfrom.lastFirst': 'Alvarez, Ericka',
  'meds.provider.name': 'Memorial Hermann Southwest',
  'meds.provider.fax1': '(713) 555-0142',
  'meds.provider.work1': '(713) 555-0100',
  'meds.provider.address1line1': '7600 Beechnut St',
  'meds.provider.address1city': 'Houston',
  'meds.provider.address1state': 'TX',
  'meds.provider.address1zip': '77074',
};
const lookup = (k) => VALUES[k];

async function partOf(bytes, name = 'word/document.xml') {
  const e = readZip(bytes).find((x) => x.name === name);
  return new TextDecoder().decode(await inflate(e.raw, e.method));
}

/** The text a reader would see, with tabs and paragraph breaks kept. */
function visibleText(xml) {
  return xml
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

const count = (xml, tag) => (xml.match(new RegExp(`<${tag}(?=[\\s/>])`, 'g')) || []).length;

/* ------------------------------------------------------------------ *
 * The whole point
 * ------------------------------------------------------------------ */

test('⚠️ every token in the firm\'s real template is filled', async () => {
  /*
   * THE REGRESSION TEST FOR THE FEATURE. Eleven of the thirteen tokens are
   * split across runs in this file. A naive replace over document.xml fills
   * two of them and leaves the rest printed on a letter to a hospital --
   * without raising anything.
   *
   * ⚠️ 22, AND THE XML CONTAINS ONLY 21 `{{` SUBSTRINGS. One instance of
   * {{fullname}} is stored as four text nodes — "{" + "{" + "fullname" +
   * "}}" — so even its opening braces are split and it contains no literal
   * `{{` anywhere. Counting `{{` in the raw XML undercounts the work, which
   * is its own small argument for reading text the way Word assembles it
   * rather than the way it happens to be stored.
   */
  const { bytes, unresolved, replaced } = await mergeDocx(TEMPLATE, lookup);

  assert.deepEqual(unresolved, [], 'nothing should be left unresolved');
  assert.equal(replaced, 22, 'the template carries 22 token occurrences');
  assert.deepEqual(await findSurvivingTokens(bytes), [], 'no {{token}} may survive');
});

test('the filled letter reads correctly', async () => {
  const { bytes } = await mergeDocx(TEMPLATE, lookup);
  const text = visibleText(await partOf(bytes));

  assert.match(text, /Via Facsimile: \(713\) 555-0142/);
  assert.match(text, /Memorial Hermann Southwest/);
  assert.match(text, /7600 Beechnut St/);
  assert.match(text, /Houston, TX 77074/);
  assert.match(text, /My Client:\s*\t*Charles Wyatt Hollister/);
  assert.match(text, /September 23, 2026/);
  assert.ok(!text.includes('{{'), 'no placeholder may reach the page');
});

/* ------------------------------------------------------------------ *
 * ⚠️ What must NOT change
 * ------------------------------------------------------------------ */

test('⚠️ nothing structural is added, removed or moved', async () => {
  /*
   * The first version of this engine fused runs together, which meant
   * DELETING what sat between them. It scored the same on the test above and
   * removed all 36 proofErr markers. The same code path would drop a
   * bookmarkStart and orphan its end, and Word repairs that silently.
   *
   * The letterhead is a <wp:anchor> drawing, which lives inside a run -- the
   * exact structure a fuse rearranges.
   */
  const before = await partOf(TEMPLATE);
  const { bytes } = await mergeDocx(TEMPLATE, lookup);
  const after = await partOf(bytes);

  for (const tag of ['w:p', 'w:r', 'w:proofErr', 'w:drawing', 'wp:anchor', 'w:hyperlink', 'w:tab', 'w:sectPr']) {
    assert.equal(count(after, tag), count(before, tag), `${tag} count changed`);
  }
});

test('⚠️ filling nothing changes nothing', async () => {
  // The most valuable test here: it proves the engine does not eat text it
  // was not asked to touch. Every paragraph must survive a no-op pass.
  const before = await partOf(TEMPLATE);
  const { xml } = substitutePart(before, () => undefined);
  assert.equal(xml, before, 'a pass that resolves nothing must be a no-op');
});

test('a paragraph with no token is returned byte-identical', () => {
  // Which is what makes double-escaping impossible in the body of a letter.
  const para = '<w:p><w:r><w:t>Smith &amp; Wesson &lt;tag&gt;</w:t></w:r></w:p>';
  assert.equal(substitutePart(para, () => 'x').xml, para);
});

/* ------------------------------------------------------------------ *
 * Split tokens
 * ------------------------------------------------------------------ */

const RPR = '<w:rPr><w:sz w:val="24"/></w:rPr>';
const split = (...bits) => `<w:p>${bits.join('')}</w:p>`;
const run = (t) => `<w:r>${RPR}<w:t>${t}</w:t></w:r>`;

test('⚠️ a token split across runs, with proofErr between them, is filled', () => {
  /*
   * Exactly how Word stores it. The proofErr markers are why the run is split
   * at all -- `{{fullname}}` looks like a misspelling -- so they sit between
   * the pieces, and they must still be there afterwards.
   */
  const para = split(
    run('{{'),
    '<w:proofErr w:type="spellStart"/>',
    run('meds.provider'),
    '<w:proofErr w:type="spellEnd"/>',
    run('.fax1}}'),
  );
  const { xml } = substitutePart(para, () => '(713) 555-0142');

  assert.match(visibleText(xml), /\(713\) 555-0142/);
  assert.ok(!xml.includes('{{'), 'the token must be gone');
  assert.equal(count(xml, 'w:proofErr'), 2, 'the spell-check markers must survive');
  assert.equal(count(xml, 'w:r'), 3, 'no run may be removed');
});

test('a token split across runs with DIFFERENT formatting still fills', () => {
  // Nothing here depends on the runs matching, which is the whole advantage
  // over fusing them: a paralegal bolding half a token cannot break it.
  const para = '<w:p>'
    + `<w:r><w:rPr><w:b/></w:rPr><w:t>{{ful</w:t></w:r>`
    + `<w:r><w:rPr><w:i/></w:rPr><w:t>lname}}</w:t></w:r>`
    + '</w:p>';
  assert.match(visibleText(substitutePart(para, () => 'Hollister').xml), /Hollister/);
});

test('a run holding a drawing is never touched', () => {
  const drawing = '<w:r><w:rPr/><w:drawing><wp:anchor/></w:drawing></w:r>';
  const para = `<w:p>${run('{{a}}')}${drawing}${run('tail')}</w:p>`;
  const { xml } = substitutePart(para, () => 'X');
  assert.ok(xml.includes(drawing), 'the drawing run must come through untouched');
});

test('text either side of a tab keeps the tab', () => {
  const para = `<w:p>${run('{{a}}')}<w:r><w:tab/></w:r>${run('{{b}}')}</w:p>`;
  const { xml } = substitutePart(para, (k) => (k === 'a' ? 'one' : 'two'));
  assert.equal(count(xml, 'w:tab'), 1);
  assert.equal(visibleText(xml).trim(), 'one\ttwo');
});

test('two tokens in one run both fill', () => {
  const para = split(run('{{a}} and {{b}}'));
  assert.equal(visibleText(substitutePart(para, (k) => k.toUpperCase()).xml).trim(), 'A and B');
});

test('the same token used twice fills both times', async () => {
  // {{fullname}} appears in the letter and in both affidavits.
  const { bytes } = await mergeDocx(TEMPLATE, lookup);
  const hits = visibleText(await partOf(bytes)).match(/Charles Wyatt Hollister/g) || [];
  assert.ok(hits.length >= 3, `expected the client name in all three documents, got ${hits.length}`);
});

/* ------------------------------------------------------------------ *
 * Values
 * ------------------------------------------------------------------ */

test('a value carrying XML metacharacters is escaped', () => {
  const { xml } = substitutePart(split(run('{{p}}')), () => 'Ruiz & Sons <Imaging>');
  assert.ok(xml.includes('Ruiz &amp; Sons &lt;Imaging&gt;'), 'must be escaped in the XML');
  assert.equal(visibleText(xml).trim(), 'Ruiz & Sons <Imaging>', 'and read back as typed');
});

test('⚠️ a multi-line value becomes a real line break', () => {
  // A newline inside <w:t> renders as a SPACE, so a two-line address would
  // silently collapse onto one line in a letter to a provider.
  const { xml } = substitutePart(split(run('{{a}}')), () => '7600 Beechnut St\nSuite 210');
  assert.equal(count(xml, 'w:br'), 1);
  assert.ok(xml.includes('<w:t xml:space="preserve">Suite 210</w:t>'));
});

test('xml:space="preserve" is added to anything we write into', () => {
  // Without it Word eats a value's leading space: "Dear Dr." loses the gap.
  const { xml } = substitutePart(split(run('Dear {{a}}')), () => ' Ruiz');
  assert.ok(xml.includes('xml:space="preserve"'));
});

test('characters XML cannot represent are dropped, not escaped', () => {
  // A name pasted out of a PDF can carry U+0000. Escaped or not, it makes the
  // document refuse to open.
  const { xml } = substitutePart(split(run('{{a}}')), () => 'Ruiz\u0000\u000bClinic');
  assert.equal(visibleText(xml).trim(), 'RuizClinic');
});

/* ------------------------------------------------------------------ *
 * Missing values
 * ------------------------------------------------------------------ */

test('a value nobody can supply is reported and left in place', async () => {
  const { unresolved, bytes } = await mergeDocx(TEMPLATE, (k) => (k === 'ssn' ? undefined : VALUES[k]));
  assert.deepEqual(unresolved, ['ssn']);
  assert.deepEqual(await findSurvivingTokens(bytes), ['ssn'], 'it stays visible so it cannot be missed');
});

test('an empty string counts as missing, not as an answer', async () => {
  // A blank fax number is the failure mode this whole feature guards against.
  const { unresolved } = await mergeDocx(TEMPLATE, (k) => (k === 'meds.provider.fax1' ? '' : VALUES[k]));
  assert.deepEqual(unresolved, ['meds.provider.fax1']);
});

test('blankUnresolved removes the token rather than printing it', async () => {
  // Reached only after a person has seen the list and chosen to proceed. They
  // chose "blank", not "print a placeholder on firm letterhead".
  const { bytes, unresolved } = await mergeDocx(
    TEMPLATE, (k) => (k === 'ssn' ? undefined : VALUES[k]), { blankUnresolved: true },
  );
  assert.deepEqual(unresolved, ['ssn']);
  assert.deepEqual(await findSurvivingTokens(bytes), []);
});

/* ------------------------------------------------------------------ *
 * Refusals and edge shapes
 * ------------------------------------------------------------------ */

test('⚠️ a template with tracked changes is refused', async () => {
  // A token inside a <w:del> would be filled invisibly.
  const entries = readZip(TEMPLATE);
  const doc = entries.find((e) => e.name === 'word/document.xml');
  const xml = new TextDecoder().decode(await inflate(doc.raw, doc.method));
  const { replaceEntry, writeZip } = await import('./zip.js');
  const tampered = writeZip(await replaceEntry(
    entries, 'word/document.xml',
    new TextEncoder().encode(xml.replace('<w:body>', '<w:body><w:ins w:id="1"><w:r><w:t>x</w:t></w:r></w:ins>')),
  ));
  await assert.rejects(() => mergeDocx(tampered, lookup), /tracked changes/);
});

test('something that is not a Word document is refused clearly', async () => {
  const { writeZip, crc32 } = await import('./zip.js');
  const b = new TextEncoder().encode('hi');
  const notDocx = writeZip([{ name: 'a.txt', method: 0, raw: b, crc: crc32(b), uncompressedSize: 2, flags: 0, mtime: 0, mdate: 0x0021, external: 0 }]);
  await assert.rejects(() => mergeDocx(notDocx, lookup), /not a Word document/);
});

test('⚠️ a paragraph nested in a text box does not truncate its parent', () => {
  /*
   * `<w:p>[\s\S]*?</w:p>` ends the OUTER paragraph at the INNER close tag,
   * which silently garbles everything after it. This template has no text
   * boxes; a pleading will.
   */
  const inner = `<w:p>${run('{{b}}')}</w:p>`;
  const para = `<w:p>${run('{{a}}')}<w:r><w:txbxContent>${inner}</w:txbxContent></w:r>${run('tail')}</w:p>`;
  const { xml } = substitutePart(para, (k) => k.toUpperCase());

  assert.match(visibleText(xml), /A/);
  assert.match(visibleText(xml), /B/);
  assert.ok(xml.includes('tail'), 'text after the text box must survive');
  assert.equal(count(xml, 'w:p'), 2);
});

test('an empty self-closing paragraph is left alone', () => {
  const para = '<w:p/>';
  assert.equal(substitutePart(para, () => 'x').xml, para);
});

test('a lone brace is not mistaken for a token', () => {
  const para = split(run('Fee is { see schedule }'));
  assert.equal(substitutePart(para, () => 'X').xml, para);
});

/* ------------------------------------------------------------------ *
 * scanTokens
 * ------------------------------------------------------------------ */

test('scanTokens lists exactly the template\'s thirteen tokens', async () => {
  const found = await scanTokens(TEMPLATE);
  assert.deepEqual([...found].sort(), Object.keys(VALUES).sort());
});
