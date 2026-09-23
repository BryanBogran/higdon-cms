import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  crc32, readZip, writeZip, inflate, deflate, replaceEntry, looksLikeZip,
} from './zip.js';

const TEMPLATE = new Uint8Array(readFileSync(new URL('../templates/med-req.docx', import.meta.url)));
const bytes = (s) => new TextEncoder().encode(s);

/* ------------------------------------------------------------------ *
 * CRC-32
 * ------------------------------------------------------------------ */

test('CRC-32 matches the published check values', () => {
  /*
   * The standard vectors, worth more than any number of hand-made cases: a
   * wrong CRC is the single most likely way to produce an archive Word calls
   * corrupt, and these two catch every table and seed error.
   */
  assert.equal(crc32(bytes('')), 0x00000000);
  assert.equal(crc32(bytes('123456789')), 0xcbf43926);
  assert.equal(crc32(bytes('a')), 0xe8b7be43);
});

/* ------------------------------------------------------------------ *
 * Round trips
 * ------------------------------------------------------------------ */

test('an archive we write is an archive we can read', async () => {
  const hello = bytes('hello world');
  const packed = await deflate(hello);
  const zip = writeZip([
    { name: 'stored.txt', method: 0, raw: hello, crc: crc32(hello), uncompressedSize: hello.length, flags: 0, mtime: 0, mdate: 0x0021, external: 0 },
    { name: 'packed.txt', method: 8, raw: packed, crc: crc32(hello), uncompressedSize: hello.length, flags: 0, mtime: 0, mdate: 0x0021, external: 0 },
  ]);

  const back = readZip(zip);
  assert.deepEqual(back.map((e) => e.name), ['stored.txt', 'packed.txt']);
  for (const e of back) {
    assert.equal(new TextDecoder().decode(await inflate(e.raw, e.method)), 'hello world');
    assert.equal(e.crc, crc32(hello));
  }
});

test('an empty entry and a one-byte entry survive', async () => {
  const empty = new Uint8Array(0);
  const one = bytes('x');
  const zip = writeZip([
    { name: 'empty', method: 0, raw: empty, crc: crc32(empty), uncompressedSize: 0, flags: 0, mtime: 0, mdate: 0x0021, external: 0 },
    { name: 'one', method: 0, raw: one, crc: crc32(one), uncompressedSize: 1, flags: 0, mtime: 0, mdate: 0x0021, external: 0 },
  ]);
  const back = readZip(zip);
  assert.equal((await inflate(back[0].raw, back[0].method)).length, 0);
  assert.equal(new TextDecoder().decode(await inflate(back[1].raw, back[1].method)), 'x');
});

test('replaceEntry stores rather than deflating when deflating is bigger', async () => {
  // Random bytes do not compress. Deflate would add overhead, so STORED is
  // both smaller and valid -- and this is the path that runs if
  // CompressionStream ever misbehaves on a tiny payload.
  const noise = new Uint8Array(64);
  for (let i = 0; i < noise.length; i++) noise[i] = (i * 97 + 31) & 0xff;

  const entries = readZip(TEMPLATE);
  const next = await replaceEntry(entries, 'word/document.xml', noise);
  const changed = next.find((e) => e.name === 'word/document.xml');

  assert.equal(changed.method, 0, 'incompressible bytes should be stored');
  assert.deepEqual(changed.raw, noise);
  assert.equal(changed.crc, crc32(noise));
});

test('replaceEntry refuses a name the archive does not have', async () => {
  await assert.rejects(
    () => replaceEntry(readZip(TEMPLATE), 'word/nope.xml', bytes('x')),
    /No entry named/,
  );
});

/* ------------------------------------------------------------------ *
 * The guarantee this file exists for
 * ------------------------------------------------------------------ */

test('⚠️ rewriting one part leaves every other part byte-identical', async () => {
  /*
   * THE TEST THAT PROVES THE LETTERHEAD IS SAFE.
   *
   * Generating a letter changes word/document.xml and nothing else. The PNG
   * is never decoded, styles.xml is never parsed, and [Content_Types].xml is
   * never rewritten. If any of that stops being true, a letter goes out
   * missing its letterhead -- and Word "recovers" such a file silently,
   * opening it with the content removed rather than reporting an error.
   */
  const before = readZip(TEMPLATE);
  const next = await replaceEntry(before, 'word/document.xml', bytes('<x/>'));
  const after = readZip(writeZip(next));

  assert.equal(after.length, before.length);

  let identical = 0;
  for (let i = 0; i < before.length; i++) {
    assert.equal(after[i].name, before[i].name, 'entry order must be preserved');
    if (before[i].name === 'word/document.xml') continue;
    assert.equal(after[i].method, before[i].method, `${before[i].name} method changed`);
    assert.equal(after[i].crc, before[i].crc, `${before[i].name} crc changed`);
    assert.equal(after[i].uncompressedSize, before[i].uncompressedSize, `${before[i].name} size changed`);
    assert.deepEqual(after[i].raw, before[i].raw, `${before[i].name} bytes changed`);
    identical++;
  }
  assert.equal(identical, 15, 'the template has 16 entries; 15 must come through untouched');
});

test('the letterhead image is never decoded or re-encoded', async () => {
  const before = readZip(TEMPLATE);
  const png = before.find((e) => e.name === 'word/media/image1.png');
  assert.ok(png, 'the fixture should carry the letterhead');

  const after = readZip(writeZip(await replaceEntry(before, 'word/document.xml', bytes('<x/>'))));
  assert.deepEqual(after.find((e) => e.name === 'word/media/image1.png').raw, png.raw);
});

test('[Content_Types].xml stays first', () => {
  // OPC wants it first and Word writes it first. Preserving read order keeps
  // that true by construction -- nothing in this file sorts.
  assert.equal(readZip(TEMPLATE)[0].name, '[Content_Types].xml');
});

/* ------------------------------------------------------------------ *
 * Refusals
 * ------------------------------------------------------------------ */

test('bytes that are not an archive are refused, not guessed at', () => {
  assert.throws(() => readZip(bytes('this is a plain text file')), /no central directory/i);
});

test('⚠️ ZIP64 territory throws rather than silently wrapping', () => {
  // Past 0xFFFFFFFF the offsets wrap and the archive is quietly corrupt. A
  // legal document is the wrong place to find that out.
  const fake = { name: 'big', method: 0, raw: new Uint8Array(0), crc: 0, uncompressedSize: 0xffffffff, flags: 0, mtime: 0, mdate: 0x0021, external: 0 };
  assert.throws(() => writeZip([fake]), /ZIP64/);
});

test('looksLikeZip recognises the template and rejects text', () => {
  assert.equal(looksLikeZip(TEMPLATE), true);
  assert.equal(looksLikeZip(bytes('hello')), false);
  assert.equal(looksLikeZip(new Uint8Array(0)), false);
});

test('a zero DOS date is replaced, because month 0 day 0 is not a date', () => {
  const b = bytes('x');
  const zip = writeZip([{ name: 'a', method: 0, raw: b, crc: crc32(b), uncompressedSize: 1, flags: 0, mtime: 0, mdate: 0, external: 0 }]);
  assert.equal(readZip(zip)[0].mdate, 0x0021);
});

test('the data-descriptor flag is cleared on the way out', () => {
  // Set without emitting descriptors, it makes the archive unreadable.
  const b = bytes('x');
  const zip = writeZip([{ name: 'a', method: 0, raw: b, crc: crc32(b), uncompressedSize: 1, flags: 0x08, mtime: 0, mdate: 0x0021, external: 0 }]);
  assert.equal(readZip(zip)[0].flags & 0x08, 0);
});
