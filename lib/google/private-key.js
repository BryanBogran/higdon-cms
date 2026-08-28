/**
 * Getting a PEM private key out of an environment variable in one piece.
 *
 * This is its own module, with no `server-only` import, so it can be unit
 * tested — and it is worth testing, because the failure it prevents is
 * `error:1E08010C:DECODER routines::unsupported`, an OpenSSL message that says
 * nothing whatsoever about what is actually wrong.
 *
 * A PEM key is multi-line text. Environment variables are single-line strings.
 * Every deployment tool bridges that differently, and all of these are things
 * people actually paste:
 *
 *   -----BEGIN PRIVATE KEY-----\nMIIE...      literal backslash-n (the JSON file)
 *   "-----BEGIN PRIVATE KEY-----\nMIIE..."    the above, quotes included
 *   -----BEGIN PRIVATE KEY-----\\nMIIE...     double-escaped by a shell or CI
 *   real multi-line text                       pasted into a textarea
 *   LS0tLS1CRUdJTiBQUklWQVRF...                base64 of the whole PEM
 *
 * Rejecting four of those and demanding the fifth is not robustness, it is a
 * support burden. All five are normalized here.
 *
 * What is NOT done: guessing at a key that is genuinely corrupt. If it will not
 * parse after normalization, `describeKeyProblem` says which of the likely
 * causes it looks like, because the OpenSSL error will not.
 */

import { createPrivateKey } from 'node:crypto';

const BEGIN = '-----BEGIN';

/** Best-effort reconstruction of the PEM. Never throws. */
export function normalizePrivateKey(raw) {
  let key = String(raw ?? '').trim();
  if (!key) return '';

  // Quotes that came along for the ride. A value pasted into a dashboard field
  // with its surrounding quotes is the single most common mangle.
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
    key = key.slice(1, -1).trim();
  }

  // Some CI docs suggest base64-ing the whole PEM to dodge the newline problem.
  if (!key.includes(BEGIN) && /^[A-Za-z0-9+/=\s]+$/.test(key)) {
    try {
      const decoded = Buffer.from(key, 'base64').toString('utf8');
      if (decoded.includes(BEGIN)) key = decoded.trim();
    } catch {
      // Not base64 after all. Fall through and let validation report it.
    }
  }

  // Double-escaped first: a lone \n rule would turn \\n into \<newline>.
  key = key.replace(/\\\\n/g, '\n').replace(/\\n/g, '\n').replace(/\r\n/g, '\n');

  // OpenSSL wants a trailing newline after the footer.
  return key.endsWith('\n') ? key : `${key}\n`;
}

/**
 * Does it parse? Returns a KeyObject or a human-readable reason.
 *
 * Never includes the key material in the message — these get logged.
 */
export function validatePrivateKey(raw) {
  const key = normalizePrivateKey(raw);
  if (!key.trim()) return { ok: false, error: 'GOOGLE_PRIVATE_KEY is empty.' };

  try {
    return { ok: true, key, keyObject: createPrivateKey(key) };
  } catch (err) {
    return { ok: false, error: `${describeKeyProblem(key)} (OpenSSL: ${err.code || err.message})` };
  }
}

/**
 * Name the likeliest cause, since `DECODER routines::unsupported` never will.
 *
 * Ordered by how often each one actually happens.
 */
export function describeKeyProblem(normalized) {
  const key = String(normalized || '');

  if (!key.includes(BEGIN)) {
    return 'The value does not contain "-----BEGIN". It looks like the wrong field was copied — ' +
      'you want `private_key` from the service-account JSON, not `private_key_id`, which is a short hex string.';
  }
  if (key.includes('BEGIN RSA PRIVATE KEY')) {
    return 'That is a PKCS#1 key. Google issues PKCS#8 — the header should read "BEGIN PRIVATE KEY" with no "RSA".';
  }
  if (!key.includes('-----END')) {
    return 'The "-----END PRIVATE KEY-----" footer is missing. The value was probably truncated when pasted.';
  }
  // A real key wraps at 64 characters, so a valid PEM is ~28 lines.
  const lines = key.split('\n').filter(Boolean);
  if (lines.length < 3) {
    return 'The key is all on one line — its newlines were lost. Keep them as literal \\n, ' +
      'exactly as they appear in the JSON file.';
  }
  if (/\\[nrt]/.test(key)) {
    return 'The key still contains escape sequences after unescaping, which usually means it was escaped twice.';
  }
  return 'The key could not be decoded. Re-copy `private_key` from the service-account JSON file.';
}

/**
 * A description safe to print. Says everything useful about the shape of the
 * key and nothing about its contents.
 */
export function inspectPrivateKey(raw) {
  const original = String(raw ?? '');
  const key = normalizePrivateKey(raw);
  const result = validatePrivateKey(raw);
  return {
    present: original.length > 0,
    rawLength: original.length,
    wrappedInQuotes: /^["']/.test(original.trim()),
    hadEscapedNewlines: original.includes('\\n'),
    hadRealNewlines: original.includes('\n'),
    lines: key ? key.split('\n').filter(Boolean).length : 0,
    header: key.split('\n')[0] || '(none)',
    footer: key.split('\n').filter(Boolean).pop() || '(none)',
    valid: result.ok,
    problem: result.ok ? null : result.error,
  };
}
