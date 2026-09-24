/**
 * Repairing email rows filed before attachment keys were indexed.
 *
 * Until 2026-09-24 every attachment was stored at `<folder>/<filename>`
 * with upsert, so a message carrying two `image.png` kept only the last one
 * uploaded and every card in the group opened it. See `attachmentKey`.
 *
 * Nothing was lost for good: the original .eml is stored beside the
 * attachments and holds every one of them. This plans the repair from it --
 * which entries to repoint, where, and with which bytes. Pure, so the
 * matching can be tested; scripts/repair-email-attachments.mjs does the I/O.
 *
 * ⚠️ IT REFUSES RATHER THAN GUESSES. Entries are matched to parsed parts by
 * POSITION, because that is how ingest built them -- the Nth attachment
 * entry is the Nth part. But the parser has changed since some of these
 * rows were filed, so position alone is not trusted: the name and the byte
 * count must agree too. One mismatch and the row is left untouched, because
 * repointing a medical record at the wrong image is worse than leaving it
 * pointed at the wrong image it already has.
 */

import { attachmentKey } from './email.js';

/** Paths that more than one entry on this row points at. */
export function collidingPaths(attachments = []) {
  const count = new Map();
  for (const f of attachments || []) {
    if (!f?.path) continue;
    count.set(f.path, (count.get(f.path) || 0) + 1);
  }
  return new Set([...count].filter(([, n]) => n > 1).map(([p]) => p));
}

/**
 * Did this row lose distinct files, or only repeat one?
 *
 * Each entry kept its own size, so differing sizes under one path mean
 * different files went into one object. The same size under one path is
 * almost always a signature logo quoted in every reply.
 */
export function hasRealLoss(attachments = []) {
  const shared = collidingPaths(attachments);
  const sizes = new Map();
  for (const f of attachments || []) {
    if (!shared.has(f.path)) continue;
    if (!sizes.has(f.path)) sizes.set(f.path, new Set());
    sizes.get(f.path).add(f.size);
  }
  return [...sizes.values()].some((s) => s.size > 1);
}

/**
 * The repair for one row.
 *
 * @param {object[]} attachments The row's `attachments` as stored.
 * @param {object}   parsed      `parseEml` of the stored original.
 * @returns {{ok: true, uploads: {path, bytes, contentType}[], attachments: object[]}
 *          | {ok: false, reason: string}}
 *   `attachments` is the row's list with only the colliding entries
 *   repointed. Names, sizes, roles and order are untouched, and so is every
 *   entry that already had a path of its own.
 */
export function planAttachmentRepair(attachments, parsed) {
  const list = Array.isArray(attachments) ? attachments : [];
  const shared = collidingPaths(list);
  if (!shared.size) return { ok: false, reason: 'no shared paths -- nothing to repair' };

  const original = list.find((f) => f?.role === 'original');
  if (!original?.path) return { ok: false, reason: 'no stored original .eml to recover from' };
  if (shared.has(original.path)) {
    return { ok: false, reason: 'the original .eml was itself overwritten' };
  }

  // Every key under the message folder, which is wherever the original sits.
  const folder = original.path.slice(0, original.path.lastIndexOf('/'));

  const entries = list.filter((f) => f?.role === 'attachment');
  const parts = parsed?.attachments || [];
  if (entries.length !== parts.length) {
    return {
      ok: false,
      reason: `row lists ${entries.length} attachments, the .eml parses to ${parts.length}`,
    };
  }

  const repointed = new Map(); // entry -> new path
  const uploads = [];
  for (const [i, entry] of entries.entries()) {
    const part = parts[i];
    if (entry.name !== part.filename || entry.size !== part.bytes.length) {
      return {
        ok: false,
        reason:
          `attachment ${i + 1} does not match the .eml: row has "${entry.name}" ` +
          `(${entry.size} bytes), message has "${part.filename}" (${part.bytes.length} bytes)`,
      };
    }
    if (!shared.has(entry.path)) continue;

    const path = `${folder}/${attachmentKey(i, part.filename)}`;
    repointed.set(entry, path);
    uploads.push({ path, bytes: part.bytes, contentType: part.contentType });
  }

  return {
    ok: true,
    uploads,
    attachments: list.map((f) => (repointed.has(f) ? { ...f, path: repointed.get(f) } : f)),
  };
}
