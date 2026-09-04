/**
 * Getting a message from bytes onto a matter.
 *
 * The parse is pure and lives in lib/domain/email.js. Everything with a side
 * effect — reading a File, uploading to storage, minting a signed URL — is
 * here, so the parser stays testable and the storage details stay in one place.
 *
 * The order below is deliberate: FILES FIRST, ROW LAST. If an upload fails,
 * no card appears, and the user retries. If the row were written first, a
 * failed upload would leave an email on the file whose attachments 404 — which
 * looks like the document was deleted rather than never stored, and on a legal
 * file that is the worse of the two failures by a wide margin.
 */

import { parseEml, normalizeEmail, safeFilename, storageKey } from '@/lib/domain/email';

export const BUCKET = 'case-files';

/** 50 MB, matching the bucket's own limit so the failure is caught early. */
export const MAX_EMAIL_BYTES = 50 * 1024 * 1024;

/**
 * Domains whose mail counts as "sent by us".
 *
 * Configurable because a firm acquiring another keeps both domains alive for
 * years, and a hard-coded string would silently mislabel half the file.
 */
export function firmDomains() {
  const raw = process.env.NEXT_PUBLIC_FIRM_MAIL_DOMAINS || 'higdonlawyers.com';
  return raw.split(',').map((d) => d.trim().toLowerCase()).filter(Boolean);
}

/** Storage keys are namespaced by matter, so a signed URL cannot wander. */
function storagePath(matterId, messageKey, filename) {
  // storageKey, NOT safeFilename -- see the note on storageKey. safeFilename
  // leaves `[`, `]` and `#` in place and Supabase Storage answers 400.
  return `${matterId}/email/${messageKey}/${storageKey(filename)}`;
}

/** A stable folder name per message, so re-ingesting overwrites in place. */
function messageKey(parsed) {
  const id = parsed.messageId || '';
  // Message-IDs contain @ and dots, both fine in a storage key; anything
  // stranger is normalized so a hostile header cannot build a path.
  return safeFilename(id).replace(/[^A-Za-z0-9._@-]/g, '_').slice(0, 100) || `no-id-${Date.now()}`;
}

/**
 * Parse a dropped .eml and everything the caller needs to store it.
 *
 * Split out from the upload so a drop zone can show the sender and subject
 * immediately, before any network call — the user finds out they grabbed the
 * wrong message before waiting on an upload, not after.
 */
export async function readEmailFile(file, { matterId } = {}) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length > MAX_EMAIL_BYTES) {
    return { ok: false, error: `That message is ${Math.round(bytes.length / 1048576)} MB; the limit is 50 MB.` };
  }

  // Outlook's .msg is an OLE compound file, not RFC-822 -- a completely
  // different format that this parser cannot read and never will. Detected by
  // signature rather than by extension, because a renamed file still fails.
  const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  if (bytes.length >= 8 && OLE.every((b, i) => bytes[i] === b)) {
    return {
      ok: false,
      error:
        'That is an Outlook .msg file, which is a different format this cannot read. ' +
        'Two ways round it: forward the message to this case address, or open it in ' +
        'Outlook on the web and use ⋯ → Download, which gives a .eml.',
    };
  }

  let parsed;
  try {
    parsed = parseEml(bytes);
  } catch (err) {
    return { ok: false, error: `Could not read that message: ${err?.message || 'unknown error'}` };
  }

  // A .eml with no From and no Subject is almost certainly not a .eml — a
  // renamed PDF, or a .msg, which is a different format entirely.
  if (!parsed.from && !parsed.subject && !parsed.messageId) {
    return {
      ok: false,
      error:
        'That does not look like an email file — no From, Subject or Message-ID. ' +
        'Expected a .eml. In Gmail use ⋮ → Download message; in Outlook on the ' +
        'web use ⋯ → Download; in Apple Mail drag the message to the desktop.',
    };
  }

  const normalized = normalizeEmail(parsed, { matterId, firmDomains: firmDomains() });
  return { ok: true, parsed, normalized, bytes };
}

/**
 * Upload the original message and its attachments.
 *
 * Returns the attachment list to store on the activity row: paths, never URLs.
 * A signed URL is minted at read time and expires; storing one would put a
 * long-lived credential to a medical record in a database column.
 */
export async function uploadEmailFiles(db, { matterId, parsed, bytes }) {
  const key = messageKey(parsed);
  const out = [];

  const original = {
    name: `${safeFilename(parsed.subject) || 'message'}.eml`,
    contentType: 'message/rfc822',
    role: 'original',
    size: bytes.length,
  };
  const originalPath = storagePath(matterId, key, original.name);

  const up = await db.storage
    .from(BUCKET)
    .upload(originalPath, new Blob([bytes], { type: 'message/rfc822' }), { upsert: true });
  if (up.error) return { ok: false, error: `Could not store the message: ${up.error.message}` };
  out.push({ ...original, path: originalPath });

  for (const a of parsed.attachments) {
    const path = storagePath(matterId, key, a.filename);
    const res = await db.storage
      .from(BUCKET)
      .upload(path, new Blob([a.bytes], { type: a.contentType }), { upsert: true });
    if (res.error) {
      return { ok: false, error: `Could not store "${a.filename}": ${res.error.message}` };
    }
    out.push({
      name: a.filename,
      contentType: a.contentType,
      size: a.bytes.length,
      role: 'attachment',
      path,
    });
  }

  return { ok: true, attachments: out };
}

/**
 * A short-lived read URL. Minted per click, never stored.
 *
 * Five minutes is long enough to open a PDF and short enough that a URL copied
 * out of a browser's history is useless by the time anyone tries it.
 */
export async function signAttachment(db, path, expiresIn = 300) {
  const { data, error } = await db.storage.from(BUCKET).createSignedUrl(path, expiresIn);
  if (error) return { ok: false, error: error.message };
  return { ok: true, url: data.signedUrl };
}
