/**
 * ZIP, enough of it to rewrite one member of a .docx and leave the rest alone.
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 *
 * A .docx is a ZIP of ~16 XML parts plus the letterhead image. Generating a
 * letter means changing exactly ONE of them, `word/document.xml`, and putting
 * the archive back together.
 *
 * `lib/domain/xlsx.js` already reads ZIPs. It is deliberately NOT reused:
 *
 *   - its `zipEntries` captures method, start and compressed size, but not the
 *     CRC or the uncompressed size, and both are needed to copy an entry
 *     through without inflating and re-deflating it;
 *   - it is the reader the Filevine spreadsheet importer depends on, and that
 *     file's comments describe a silent date corruption it exists to prevent.
 *     Widening it during a feature change means re-testing the importer.
 *
 * So there are two ZIP readers in this repo and that is a known smell. The
 * trade was deliberate: this one is additive and cannot break an import path
 * that is already working. Folding `xlsx.js` onto this file is a good
 * follow-up, on its own, with its 21 tests as the proof.
 *
 * ── The rule this file exists to enforce ─────────────────────────────────
 *
 * ⚠️ EVERY ENTRY WE ARE NOT CHANGING IS COPIED IN ITS ALREADY-COMPRESSED FORM.
 * The letterhead PNG is never decoded. styles.xml is never parsed. If a part
 * we do not touch comes out different, something is wrong -- and there is a
 * test that diffs all 15 of them.
 */

const dv = (buf) => new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

/* ------------------------------------------------------------------ *
 * CRC-32
 * ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** CRC-32 of a byte array, as an unsigned 32-bit number. */
export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/* ------------------------------------------------------------------ *
 * Reading
 * ------------------------------------------------------------------ */

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

/**
 * Every member of the archive, in the order the central directory lists them.
 *
 * Located via the End Of Central Directory record, scanned from the END --
 * never by walking local headers from the front. A local header may carry
 * sizes of zero with the real values in a trailing data descriptor, so
 * front-to-back parsing breaks on files written by streaming producers. This
 * is the same reasoning `lib/domain/xlsx.js` records.
 *
 * ⚠️ ORDER IS PRESERVED AND THAT MATTERS. The OPC spec wants
 * `[Content_Types].xml` first, and Word puts it there. Writing the entries
 * back in the order they were read keeps that true by construction rather
 * than by luck, so nothing here ever sorts.
 */
export function readZip(bytes) {
  const view = dv(bytes);

  let eocd = -1;
  // The archive comment can be 64 KB, so the signature can be that far in.
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65558); i--) {
    if (view.getUint32(i, true) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a ZIP archive — no central directory found.');

  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const entries = [];

  for (let i = 0; i < count; i++) {
    if (view.getUint32(p, true) !== CENTRAL_SIG) break;

    const flags = view.getUint16(p + 8, true);
    const method = view.getUint16(p + 10, true);
    const mtime = view.getUint16(p + 12, true);
    const mdate = view.getUint16(p + 14, true);
    const crc = view.getUint32(p + 16, true);
    const compressedSize = view.getUint32(p + 20, true);
    const uncompressedSize = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const external = view.getUint32(p + 38, true);
    const localOffset = view.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));

    if (view.getUint32(localOffset, true) !== LOCAL_SIG) {
      throw new Error(`Corrupt archive: no local header for ${name}.`);
    }
    // The LOCAL header's own name/extra lengths, not the directory's: the
    // extra field is routinely a different length in the two places.
    const start = localOffset + 30
      + view.getUint16(localOffset + 26, true)
      + view.getUint16(localOffset + 28, true);

    entries.push({
      name, flags, method, mtime, mdate, crc,
      uncompressedSize, external,
      raw: bytes.subarray(start, start + compressedSize),
    });

    p += 46 + nameLen + extraLen + commentLen;
  }

  return entries;
}

/**
 * Decompress one entry's bytes.
 *
 * `deflate-raw`, not `deflate`. Method 8 in a ZIP is raw DEFLATE with no zlib
 * header; asking for `deflate` looks for a 2-byte header that is not there.
 */
export async function inflate(bytes, method) {
  if (method === 0) return bytes;                       // stored
  if (method !== 8) throw new Error(`Unsupported ZIP compression (${method}).`);
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Compress bytes for storage as method 8. See the note on `inflate`. */
export async function deflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Replace one entry's contents, returning a new entry list.
 *
 * Deflates, and falls back to STORED when deflating made it bigger -- which
 * happens on tiny or already-compressed payloads. Stored is always valid and
 * costs three lines.
 */
export async function replaceEntry(entries, name, bytes) {
  const i = entries.findIndex((e) => e.name === name);
  if (i < 0) throw new Error(`No entry named ${name} in this archive.`);

  const packed = await deflate(bytes);
  const smaller = packed.length < bytes.length;

  const next = entries.slice();
  next[i] = {
    ...entries[i],
    method: smaller ? 8 : 0,
    raw: smaller ? packed : bytes,
    crc: crc32(bytes),
    uncompressedSize: bytes.length,
  };
  return next;
}

/* ------------------------------------------------------------------ *
 * Writing
 * ------------------------------------------------------------------ */

const MAX_U32 = 0xfffffffe;
const MAX_U16 = 0xfffe;

/**
 * Serialise entries back into an archive.
 *
 * Things that are easy to get wrong here, each of which produces a file Word
 * refuses to open -- loudly, which is the one mercy:
 *
 *   - the general-purpose flag's bit 3 (0x08) says "sizes follow in a data
 *     descriptor". We always know the sizes up front, so it is cleared.
 *     SETTING it without emitting descriptors is fatal;
 *   - the local header and the central directory must agree on the CRC and
 *     both sizes. They are adjacent fields and easy to transpose;
 *   - the central directory carries one field the local header does not: the
 *     offset of that entry's local header, accumulated as we go. An error
 *     here is the classic off-by-one;
 *   - DOS date 0 is not a legal date (month 0, day 0). Entries carry their
 *     own through; 0x0021 is 1980-01-01 for anything that has none.
 *
 * ⚠️ ZIP64 IS REFUSED, NOT ATTEMPTED. Past 4 GB or 65535 entries the offsets
 * silently wrap and the archive is quietly corrupt. A letter is 50 KB, so the
 * bound will never be met in this application -- and a clear error beats a
 * corrupt legal document if this is ever pointed at something larger.
 */
export function writeZip(entries) {
  if (entries.length > MAX_U16) {
    throw new Error(`ZIP64 needed: ${entries.length} entries. Refusing rather than writing a corrupt archive.`);
  }

  const encoder = new TextEncoder();
  const body = [];
  const directory = [];
  let offset = 0;

  for (const e of entries) {
    const name = encoder.encode(e.name);
    const compressed = e.raw.length;

    if (compressed > MAX_U32 || e.uncompressedSize > MAX_U32 || offset > MAX_U32) {
      throw new Error(`ZIP64 needed for ${e.name}. Refusing rather than writing a corrupt archive.`);
    }

    const flags = e.flags & ~0x08;       // see the note above
    const mdate = e.mdate || 0x0021;     // 1980-01-01, never 0
    const mtime = e.mtime || 0;

    const local = new Uint8Array(30 + name.length);
    const lv = dv(local);
    lv.setUint32(0, LOCAL_SIG, true);
    lv.setUint16(4, 20, true);                    // version needed
    lv.setUint16(6, flags, true);
    lv.setUint16(8, e.method, true);
    lv.setUint16(10, mtime, true);
    lv.setUint16(12, mdate, true);
    lv.setUint32(14, e.crc, true);
    lv.setUint32(18, compressed, true);
    lv.setUint32(22, e.uncompressedSize, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true);                    // no extra field
    local.set(name, 30);

    body.push(local, e.raw);

    const central = new Uint8Array(46 + name.length);
    const cv = dv(central);
    cv.setUint32(0, CENTRAL_SIG, true);
    cv.setUint16(4, 20, true);                    // version made by
    cv.setUint16(6, 20, true);                    // version needed
    cv.setUint16(8, flags, true);
    cv.setUint16(10, e.method, true);
    cv.setUint16(12, mtime, true);
    cv.setUint16(14, mdate, true);
    cv.setUint32(16, e.crc, true);
    cv.setUint32(20, compressed, true);
    cv.setUint32(24, e.uncompressedSize, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(38, e.external || 0, true);
    cv.setUint32(42, offset, true);               // where its local header is
    central.set(name, 46);

    directory.push(central);
    offset += local.length + compressed;
  }

  const directoryBytes = directory.reduce((n, d) => n + d.length, 0);

  const eocd = new Uint8Array(22);
  const ev = dv(eocd);
  ev.setUint32(0, EOCD_SIG, true);
  ev.setUint16(8, directory.length, true);        // entries on this disk
  ev.setUint16(10, directory.length, true);       // entries total
  ev.setUint32(12, directoryBytes, true);
  ev.setUint32(16, offset, true);                 // where the directory starts

  const parts = [...body, ...directory, eocd];
  const out = new Uint8Array(parts.reduce((n, a) => n + a.length, 0));
  let p = 0;
  for (const a of parts) { out.set(a, p); p += a.length; }
  return out;
}

/** True for bytes that begin with the ZIP local-header signature "PK\3\4". */
export function looksLikeZip(bytes) {
  return bytes?.length > 4
    && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}
