/**
 * EMAIL — turning a real message into a case-file record.
 *
 * Filevine gives every project its own address (`RiveraMarcusZ10000000`).
 * Staff put it in To, CC or BCC, and the message lands on that project's feed
 * with the original `.eml` attached. Both sides of a thread end up on the file
 * without anyone forwarding screenshots around.
 *
 * There are three ways an email can reach a matter, and they differ ONLY in
 * transport. Each one hands this module raw RFC-822 bytes and gets back the
 * same normalized object, so the parser and the card are written once:
 *
 *   1. Someone drags a .eml onto the matter.        (works today, no DNS)
 *   2. A mail provider POSTs to the inbound webhook. (needs an MX record)
 *   3. A mailbox sync polls Gmail/Graph.             (needs OAuth, later)
 *
 * WHY NO `mailparser`. It is the obvious dependency and it is a poor fit: it is
 * Node-only, so path 1 could not parse in the browser and would need an upload
 * round-trip before the user sees anything, and it pulls a large tree into a
 * project that currently has seven runtime dependencies. The subset of MIME
 * that actually shows up in law-firm mail — multipart/alternative,
 * multipart/mixed, base64, quoted-printable, RFC 2047 subjects — is small
 * enough to own, and owning it is what lets the same function run in both
 * places.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO: verify signatures, decrypt S/MIME, or
 * render HTML. The original bytes are always stored alongside the parsed
 * version, so nothing here is load-bearing for authenticity — if a parse is
 * wrong, the .eml on the record is still the evidence.
 */

/* ------------------------------------------------------------------ *
 * Bytes and characters
 *
 * A .eml is bytes, but its STRUCTURE is ASCII: headers, boundaries and
 * encodings are all in the 7-bit range. So the file is read as latin1 —
 * where one byte is exactly one character and nothing is lost — the
 * structure is parsed as text, and only then is each part's payload
 * turned back into bytes and decoded with its own charset.
 *
 * TextDecoder is not used for this step on purpose: the Encoding Standard
 * maps both `latin1` and `iso-8859-1` onto windows-1252, which rewrites
 * 0x80–0x9F. That is fine for display and silently corrupting for a
 * round-trip. fromCharCode is exact.
 * ------------------------------------------------------------------ */

export function bytesToBinary(bytes) {
  let out = '';
  // Chunked: fromCharCode.apply on a multi-megabyte attachment blows the stack.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    out += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return out;
}

export function binaryToBytes(str) {
  const out = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xff;
  return out;
}

/** Decode bytes using a MIME charset name, falling back to UTF-8. */
export function decodeCharset(bytes, charset = 'utf-8') {
  const label = String(charset || 'utf-8').toLowerCase().replace(/^["']|["']$/g, '');
  try {
    return new TextDecoder(label, { fatal: false }).decode(bytes);
  } catch {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  }
}

/* ------------------------------------------------------------------ *
 * Transfer encodings
 * ------------------------------------------------------------------ */

export function decodeBase64(str) {
  const clean = str.replace(/[^A-Za-z0-9+/=]/g, '');
  if (!clean) return new Uint8Array(0);
  // atob is global in browsers and in Node 18+. Both give a latin1 string.
  if (typeof atob === 'function') return binaryToBytes(atob(clean));
  return new Uint8Array(Buffer.from(clean, 'base64'));
}

export function decodeQuotedPrintable(str) {
  const joined = str.replace(/=\r?\n/g, ''); // soft line breaks
  const out = [];
  for (let i = 0; i < joined.length; i++) {
    if (joined[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(joined.slice(i + 1, i + 3))) {
      out.push(parseInt(joined.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      out.push(joined.charCodeAt(i) & 0xff);
    }
  }
  return new Uint8Array(out);
}

function decodeTransfer(body, encoding) {
  const e = String(encoding || '7bit').toLowerCase().trim();
  if (e === 'base64') return decodeBase64(body);
  if (e === 'quoted-printable') return decodeQuotedPrintable(body);
  return binaryToBytes(body); // 7bit, 8bit, binary — already the payload
}

/* ------------------------------------------------------------------ *
 * RFC 2047 — `=?UTF-8?B?...?=` in headers
 *
 * Subjects with an accented client name arrive encoded. Left raw, the feed
 * shows `=?UTF-8?Q?Gonz=C3=A1lez?=`, which looks like corruption.
 * ------------------------------------------------------------------ */

export function decodeWords(str) {
  if (!str || !str.includes('=?')) return str || '';
  // Whitespace BETWEEN two encoded words is not content and must be dropped.
  return str
    .replace(/(=\?[^?]+\?[QqBb]\?[^?]*\?=)\s+(?==\?)/g, '$1')
    .replace(/=\?([^?]+)\?([QqBb])\?([^?]*)\?=/g, (whole, charset, enc, text) => {
      try {
        const bytes =
          enc.toUpperCase() === 'B'
            ? decodeBase64(text)
            : decodeQuotedPrintable(text.replace(/_/g, ' ')); // _ is space in Q
        return decodeCharset(bytes, charset);
      } catch {
        return whole;
      }
    });
}

/* ------------------------------------------------------------------ *
 * Headers
 * ------------------------------------------------------------------ */

/** Split a message into its header block and its raw body. */
function splitMessage(raw) {
  const m = raw.match(/\r?\n\r?\n/);
  if (!m) return { headerText: raw, body: '' };
  return { headerText: raw.slice(0, m.index), body: raw.slice(m.index + m[0].length) };
}

/**
 * Parse a header block into a lowercase-keyed map.
 *
 * Values are arrays because `Received` legitimately repeats, and collapsing it
 * would throw away the delivery path — the one thing that can tell you when a
 * message actually arrived if the Date header is a lie.
 */
export function parseHeaders(headerText) {
  const headers = {};
  // Unfold: a leading space or tab continues the previous line.
  const lines = headerText.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/);
  for (const line of lines) {
    const i = line.indexOf(':');
    if (i < 1) continue;
    const key = line.slice(0, i).trim().toLowerCase();
    const value = line.slice(i + 1).trim();
    (headers[key] ||= []).push(value);
  }
  return headers;
}

const first = (headers, key) => (headers[key] && headers[key][0]) || '';

/** Parse `Content-Type: multipart/mixed; boundary="x"` into value + params. */
export function parseContentType(value) {
  const [head, ...rest] = String(value || '').split(';');
  const params = {};
  for (const part of rest) {
    const i = part.indexOf('=');
    if (i < 1) continue;
    params[part.slice(0, i).trim().toLowerCase()] = part
      .slice(i + 1)
      .trim()
      .replace(/^"|"$/g, '');
  }
  return { type: head.trim().toLowerCase() || 'text/plain', params };
}

/**
 * Split an address list on commas that are not inside quotes or angle brackets.
 *
 * A plain `.split(',')` breaks on `"Rivera, Marcus" <v@x.com>`, which is
 * exactly how Outlook formats a display name — so the naive version fails on
 * the most common real input.
 */
export function parseAddressList(value) {
  const raw = decodeWords(String(value || ''));
  const parts = [];
  let buf = '';
  let inQuote = false;
  let inAngle = false;
  for (const ch of raw) {
    if (ch === '"') inQuote = !inQuote;
    else if (ch === '<') inAngle = true;
    else if (ch === '>') inAngle = false;
    if (ch === ',' && !inQuote && !inAngle) {
      parts.push(buf);
      buf = '';
      continue;
    }
    buf += ch;
  }
  parts.push(buf);

  return parts
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const angle = p.match(/^(.*?)<([^>]*)>$/);
      if (angle) {
        return {
          name: angle[1].trim().replace(/^"|"$/g, '').trim(),
          email: angle[2].trim().toLowerCase(),
        };
      }
      return { name: '', email: p.replace(/^"|"$/g, '').trim().toLowerCase() };
    })
    .filter((a) => a.email);
}

/** "Dana Whitfield" when there is a name, the address when there is not. */
export function addressLabel(addr) {
  if (!addr) return '';
  return addr.name || addr.email || '';
}

/* ------------------------------------------------------------------ *
 * MIME tree
 * ------------------------------------------------------------------ */

function walkPart(raw, out, depth = 0) {
  if (depth > 12) return; // a malformed message must not spin forever
  const { headerText, body } = splitMessage(raw);
  const headers = parseHeaders(headerText);
  const ct = parseContentType(first(headers, 'content-type') || 'text/plain');
  const disposition = parseContentType(first(headers, 'content-disposition'));
  const encoding = first(headers, 'content-transfer-encoding');

  if (ct.type.startsWith('multipart/') && ct.params.boundary) {
    const b = ct.params.boundary;
    // Split on the boundary, discarding the preamble and the epilogue.
    const chunks = body.split(new RegExp(`\r?\n?--${b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(--)?\r?\n?`));
    for (let i = 1; i < chunks.length; i++) {
      if (chunks[i] === '--' || chunks[i] === undefined) continue;
      if (chunks[i].trim()) walkPart(chunks[i], out, depth + 1);
    }
    return;
  }

  const filename = decodeWords(disposition.params.filename || ct.params.name || '');
  const isAttachment = disposition.type === 'attachment' || (filename && ct.type !== 'text/plain');

  if (isAttachment || filename) {
    out.attachments.push({
      filename: filename || 'attachment',
      contentType: ct.type,
      bytes: decodeTransfer(body, encoding),
    });
    return;
  }

  const text = decodeCharset(decodeTransfer(body, encoding), ct.params.charset);
  if (ct.type === 'text/html') out.html.push(text);
  else out.text.push(text);
}

/** Strip HTML to something readable, for when there is no text/plain part. */
export function htmlToText(html) {
  return String(html || '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    // Paragraphs and headings get a blank line; list and table rows get one
    // newline. Without the distinction a quoted email thread collapses into a
    // single wall of text in the feed.
    .replace(/<\/(p|div|h[1-6])>/gi, '\n\n')
    .replace(/<\/(tr|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Parse a whole .eml.
 *
 * `input` may be a Uint8Array (a dropped file, a webhook payload) or a string
 * already read as latin1.
 */
export function parseEml(input) {
  const raw = typeof input === 'string' ? input : bytesToBinary(input);
  const { headerText } = splitMessage(raw);
  const headers = parseHeaders(headerText);

  const collected = { text: [], html: [], attachments: [] };
  walkPart(raw, collected);

  const bodyText = collected.text.join('\n').trim();
  const bodyHtml = collected.html.join('\n').trim();

  return {
    headers,
    subject: decodeWords(first(headers, 'subject')).trim(),
    from: parseAddressList(first(headers, 'from'))[0] || null,
    to: parseAddressList(first(headers, 'to')),
    cc: parseAddressList(first(headers, 'cc')),
    bcc: parseAddressList(first(headers, 'bcc')),
    replyTo: parseAddressList(first(headers, 'reply-to')),
    // Angle brackets stripped so the value is stable across providers, some of
    // which include them in webhook payloads and some of which do not.
    messageId: first(headers, 'message-id').trim().replace(/^<|>$/g, ''),
    inReplyTo: first(headers, 'in-reply-to').trim().replace(/^<|>$/g, ''),
    date: first(headers, 'date'),
    bodyText: bodyText || htmlToText(bodyHtml),
    bodyHtml,
    attachments: collected.attachments,
  };
}

/* ------------------------------------------------------------------ *
 * Normalizing into a case-file record
 * ------------------------------------------------------------------ */

/**
 * ISO timestamp from a Date header, or null.
 *
 * Unlike the date-only fields in dates.js, this IS a real instant — an email
 * was sent at a moment in time, in a stated offset — so `new Date` is correct
 * here where it would be wrong there. An unparseable header returns null rather
 * than an Invalid Date, on the same principle: never store NaN.
 */
export function parseEmailDate(value) {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/** Deterministic id, so the same message ingested twice lands on one row. */
export function emailDedupeKey(matterId, messageId) {
  return messageId ? `mail:${matterId}:${messageId}` : null;
}

/**
 * Was this sent by the firm, or received from outside?
 *
 * Filevine's badge answers a different question — it says "Received" for every
 * message the project mailbox took delivery of, including ones the firm itself
 * sent and CC'd in. That is accurate about mail flow and misleading on a case
 * file, where the useful question is who sent it. This is From-based.
 * Recorded in docs/REFERENCE_FILEVINE_AND_RLF.md as a deliberate deviation.
 */
export function emailDirection(fromAddress, firmDomains = []) {
  const domain = String(fromAddress?.email || '').split('@')[1] || '';
  if (!domain) return 'received';
  return firmDomains.some((d) => domain === String(d).toLowerCase()) ? 'sent' : 'received';
}

/** A one-line summary for the feed and for search. */
export function emailSummary(email) {
  const who = addressLabel(email.from) || 'Unknown sender';
  const verb = email.direction === 'sent' ? 'sent' : 'received';
  return `${who} — ${verb}: ${email.subject || '(no subject)'}`;
}

/**
 * Turn a parsed .eml into the shape the activity feed stores.
 *
 * Attachment BYTES are deliberately not carried here. This returns metadata
 * plus the files to upload, and the caller uploads them and writes the returned
 * paths back in — so this function stays pure and testable, and the byte
 * handling stays in one place that knows about storage.
 */
export function normalizeEmail(parsed, { matterId, firmDomains = [], receivedAt = null } = {}) {
  const direction = emailDirection(parsed.from, firmDomains);
  const sentAt = parseEmailDate(parsed.date) || receivedAt || null;

  return {
    matterId: matterId || null,
    kind: 'email',
    // The body is the message text. It is what a paralegal reads in the feed
    // and what full-text search has to hit, so it is a first-class column, not
    // something buried in the metadata blob.
    body: parsed.bodyText || '',
    meta: {
      subject: parsed.subject || '',
      from: parsed.from,
      to: parsed.to,
      cc: parsed.cc,
      replyTo: parsed.replyTo,
      messageId: parsed.messageId || '',
      inReplyTo: parsed.inReplyTo || '',
      sentAt,
      direction,
      hasHtml: Boolean(parsed.bodyHtml),
    },
    dedupeKey: emailDedupeKey(matterId, parsed.messageId),
    // Files the caller must upload: the original message first, then anything
    // that came with it. The .eml leads because it is the record of the others.
    pendingFiles: [
      {
        filename: `${safeFilename(parsed.subject) || 'message'}.eml`,
        contentType: 'message/rfc822',
        role: 'original',
      },
      ...parsed.attachments.map((a) => ({
        filename: a.filename,
        contentType: a.contentType,
        size: a.bytes.length,
        role: 'attachment',
      })),
    ],
  };
}

/** Filesystem- and URL-safe, and short enough not to trip storage key limits. */
export function safeFilename(name) {
  return String(name || '')
    .replace(/[\/\\?%*:|"<>\x00-\x1f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}
