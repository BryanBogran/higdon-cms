import test from 'node:test';
import assert from 'node:assert/strict';
import { readXlsx, looksLikeXlsx, serialToISO, columnIndex } from '@/lib/domain/xlsx';

/* ------------------------------------------------------------------ *
 * A minimal ZIP writer, so the fixtures are readable source rather
 * than a checked-in binary nobody can diff.
 *
 * Entries are STORED (method 0), which every ZIP reader accepts and
 * which keeps this helper to a few lines. The deflate path is exercised
 * separately, against a real Filevine export, by hand.
 * ------------------------------------------------------------------ */
function zip(files) {
  const enc = new TextEncoder();
  const parts = [];
  const dir = [];
  let offset = 0;

  const crcTable = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[i] = c >>> 0;
    }
    return t;
  })();
  const crc32 = (b) => {
    let c = 0xffffffff;
    for (const byte of b) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };

  for (const [name, text] of Object.entries(files)) {
    const nameBytes = enc.encode(name);
    const data = enc.encode(text);
    const crc = crc32(data);

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(8, 0, true);            // stored
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(10, 0, true);           // stored
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    central.set(nameBytes, 46);

    parts.push(local, data);
    dir.push(central);
    offset += local.length + data.length;
  }

  const dirSize = dir.reduce((n, d) => n + d.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, dir.length, true);
  ev.setUint16(10, dir.length, true);
  ev.setUint32(12, dirSize, true);
  ev.setUint32(16, offset, true);

  const all = [...parts, ...dir, end];
  const total = all.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of all) { out.set(p, at); at += p.length; }
  return out;
}

const SHEET = (rows) =>
  `<?xml version="1.0"?><worksheet><sheetData>${rows}</sheetData></worksheet>`;

const book = (rows, { shared = [], styles = '' } = {}) => zip({
  'xl/worksheets/sheet1.xml': SHEET(rows),
  'xl/sharedStrings.xml': `<sst>${shared.map((s) => `<si><t>${s}</t></si>`).join('')}</sst>`,
  'xl/styles.xml': styles || '<styleSheet><cellXfs count="1"><xf numFmtId="0"/></cellXfs></styleSheet>',
});

/* ------------------------------------------------------------------ */

test('reads shared strings, which is where the text actually lives', async () => {
  const bytes = book(
    '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>',
    { shared: ['Name', 'Phase'] },
  );
  assert.deepEqual(await readXlsx(bytes), [['Name', 'Phase']]);
});

test('AN EMPTY CELL DOES NOT SHIFT THE ROW', async () => {
  /*
   * The bug this file was written for. A self-closing <c/> let a greedy
   * attribute match run on to the next cell's </c>, so every column after
   * the first blank moved one to the left. On the real Case Status Report
   * that put the attorney's name under "Court Date" — a wrong value that
   * looked entirely plausible, which is the worst kind.
   */
  const bytes = book(
    '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" s="0" /><c r="C1" t="s"><v>1</v></c></row>',
    { shared: ['left', 'right'] },
  );
  assert.deepEqual(await readXlsx(bytes), [['left', '', 'right']]);
});

test('a gap of several columns is filled, not collapsed', async () => {
  // Excel omits empty cells entirely rather than writing them, so position
  // has to come from the r="" reference.
  const bytes = book(
    '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="E1" t="s"><v>1</v></c></row>',
    { shared: ['first', 'fifth'] },
  );
  assert.deepEqual(await readXlsx(bytes), [['first', '', '', '', 'fifth']]);
});

test('an empty row does not swallow the rows after it', async () => {
  const bytes = book(
    '<row r="1"><c r="A1" t="s"><v>0</v></c></row><row r="2"/><row r="3"><c r="A3" t="s"><v>1</v></c></row>',
    { shared: ['top', 'bottom'] },
  );
  assert.deepEqual(await readXlsx(bytes), [['top'], [], ['bottom']]);
});

test('date cells become ISO, including format 27 which Filevine uses', async () => {
  /*
   * numFmtId 27 is the one that matters here: every date cell in the
   * firm's export carries it, and a short built-in list that stops at 22
   * returns the raw serial 46251 instead of a date.
   */
  const styles = '<styleSheet><cellXfs count="3">'
    + '<xf numFmtId="0"/><xf numFmtId="27"/><xf numFmtId="14"/>'
    + '</cellXfs></styleSheet>';
  const bytes = book(
    '<row r="1"><c r="A1" s="1"><v>46251</v></c><c r="B1" s="2"><v>46251</v></c>'
    + '<c r="C1" s="0"><v>46251</v></c></row>',
    { styles },
  );
  const [row] = await readXlsx(bytes);
  assert.equal(row[0], '2026-08-17', 'format 27 is a date');
  assert.equal(row[1], '2026-08-17', 'format 14 is a date');
  assert.equal(row[2], '46251', 'no date format means leave the number alone');
});

test('a time format is NOT treated as a date', async () => {
  // Serial 0.5 under h:mm is midday, not 1899-12-30. A wrong date is worse
  // than a number you can see is wrong.
  const styles = '<styleSheet><cellXfs count="1"><xf numFmtId="20"/></cellXfs></styleSheet>';
  const [row] = await readXlsx(book('<row r="1"><c r="A1" s="0"><v>0.5</v></c></row>', { styles }));
  assert.equal(row[0], '0.5');
});

test('a custom date format is recognised, a custom money format is not', async () => {
  const styles = '<styleSheet>'
    + '<numFmts count="2">'
    + '<numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd"/>'
    + '<numFmt numFmtId="165" formatCode="&quot;d&quot;#,##0.00"/>'
    + '</numFmts>'
    + '<cellXfs count="2"><xf numFmtId="164"/><xf numFmtId="165"/></cellXfs></styleSheet>';
  const [row] = await readXlsx(book(
    '<row r="1"><c r="A1" s="0"><v>46251</v></c><c r="B1" s="1"><v>46251</v></c></row>',
    { styles },
  ));
  assert.equal(row[0], '2026-08-17');
  assert.equal(row[1], '46251', 'the "d" is a currency label, not a day token');
});

test('inline strings and formula results both read', async () => {
  const bytes = book(
    '<row r="1"><c r="A1" t="inlineStr"><is><t>inline</t></is></c>'
    + '<c r="B1" t="str"><v>cached</v></c></row>',
  );
  assert.deepEqual(await readXlsx(bytes), [['inline', 'cached']]);
});

test('rich text runs join into one value', async () => {
  const bytes = book('<row r="1"><c r="A1" t="s"><v>0</v></c></row>', { shared: [] });
  // Built by hand: a shared string split across runs, as Excel writes bolding.
  const custom = zip({
    'xl/worksheets/sheet1.xml': SHEET('<row r="1"><c r="A1" t="s"><v>0</v></c></row>'),
    'xl/sharedStrings.xml': '<sst><si><r><t>Rivera, </t></r><r><t>Marcus</t></r></si></sst>',
    'xl/styles.xml': '<styleSheet><cellXfs count="1"><xf numFmtId="0"/></cellXfs></styleSheet>',
  });
  assert.ok(bytes);
  assert.deepEqual(await readXlsx(custom), [['Rivera, Marcus']]);
});

test('XML entities are decoded', async () => {
  const bytes = book('<row r="1"><c r="A1" t="s"><v>0</v></c></row>', {
    shared: ['All NOFA&apos;s Filed? &amp; served &lt;yes&gt;'],
  });
  assert.deepEqual(await readXlsx(bytes), [["All NOFA's Filed? & served <yes>"]]);
});

test('an error cell comes through empty, not as the literal #N/A', async () => {
  const [row] = await readXlsx(book('<row r="1"><c r="A1" t="e"><v>#N/A</v></c></row>'));
  assert.equal(row[0], '');
});

test('booleans read as TRUE and FALSE', async () => {
  const [row] = await readXlsx(book(
    '<row r="1"><c r="A1" t="b"><v>1</v></c><c r="B1" t="b"><v>0</v></c></row>',
  ));
  assert.deepEqual(row, ['TRUE', 'FALSE']);
});

test('the lowest-numbered worksheet is used, not literally sheet1', async () => {
  const bytes = zip({
    'xl/worksheets/sheet2.xml': SHEET('<row r="1"><c r="A1" t="inlineStr"><is><t>second</t></is></c></row>'),
    'xl/worksheets/sheet3.xml': SHEET('<row r="1"><c r="A1" t="inlineStr"><is><t>third</t></is></c></row>'),
  });
  assert.deepEqual(await readXlsx(bytes), [['second']]);
});

test('a file that is not a zip is refused with a sentence, not a stack trace', async () => {
  await assert.rejects(
    () => readXlsx(new TextEncoder().encode('Name,Phase\nRivera,Litigation')),
    /Not a .xlsx file/,
  );
});

test('a zip with no worksheet is refused clearly', async () => {
  await assert.rejects(() => readXlsx(zip({ 'docProps/app.xml': '<x/>' })), /no worksheet/);
});

test('looksLikeXlsx separates a workbook from a CSV', () => {
  assert.equal(looksLikeXlsx(zip({ 'a.xml': '<x/>' })), true);
  assert.equal(looksLikeXlsx(new TextEncoder().encode('Name,Phase')), false);
  assert.equal(looksLikeXlsx(new Uint8Array(0)), false);
});

test('serialToISO converts the serials a case file actually contains', () => {
  assert.equal(serialToISO(46251), '2026-08-17');
  assert.equal(serialToISO(61), '1900-03-01');
  assert.equal(serialToISO(36585), '2000-02-29');   // a real leap day
  assert.equal(serialToISO(0), '');
  assert.equal(serialToISO(''), '');
  assert.equal(serialToISO('not a number'), '');
});

test('serials before March 1900 are off by one, and that is accepted', () => {
  /*
   * Excel believes 1900-02-29 existed. It did not. Real-calendar
   * arithmetic therefore lands one day early for any serial below 61, so
   * serial 1 — Excel's 1900-01-01 — comes back as 1899-12-31.
   *
   * Not corrected, deliberately. Compensating would mean a branch on every
   * conversion to fix dates 126 years before the earliest statute of
   * limitations this firm could possibly hold, and a serial that low in a
   * case report means a corrupt cell, not a Victorian accident. Asserted
   * so the behaviour is a known quantity rather than a surprise.
   */
  assert.equal(serialToISO(1), '1899-12-31');
  assert.equal(serialToISO(61), '1900-03-01', 'and correct from March 1900 on');
});

test('columnIndex handles the two-letter columns a wide report reaches', () => {
  assert.equal(columnIndex('A1'), 0);
  assert.equal(columnIndex('Z9'), 25);
  assert.equal(columnIndex('AA1'), 26);
  assert.equal(columnIndex('BC12'), 54);
  assert.equal(columnIndex(''), -1);
});
