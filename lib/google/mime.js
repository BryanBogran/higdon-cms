/**
 * Building an RFC 5322 message. Pure, so it can be tested.
 *
 * Separate from gmail.js for the same reason private-key.js is separate from
 * drive.js: that module carries `server-only`, which is right for anything
 * touching the service-account key and also means the test runner cannot
 * import it. The dangerous logic here is not the credentials — it is the
 * string building — so the string building lives where it can be exercised.
 */

/**
 * ⚠️ HEADER INJECTION IS THE WHOLE RISK IN THIS FILE.
 *
 * A header value containing CR or LF opens a new header line. `\r\nBcc:` sends
 * a silent copy anywhere. `\r\n\r\n` ends the header block entirely and lets
 * whoever supplied the value author the message body.
 *
 * That matters more here than in most apps, because this sends through the
 * firm's own delegated mailbox: an injected message leaves with valid SPF and
 * a real DKIM signature for higdonlawyers.com. It would be an excellent
 * phishing primitive pointed at the firm's own clients.
 *
 * `subject` and `text` cannot do it — one is RFC 2047 base64, the other a
 * base64 body. `to` and `replyTo` are the raw ones, and `replyTo` is exactly
 * where a bug reporter's own address goes. `profile.email` is citext with no
 * format constraint and is self-writable by its owner, so it is untrusted
 * text that happens to usually look like an address.
 *
 * REJECTED, never stripped. Quietly repairing an address means sending
 * something the caller did not ask for, to someone they did not choose.
 */
const CRLF = /[\r\n]/;

export function assertHeaderSafe(label, value) {
  const s = String(value ?? '');
  if (CRLF.test(s)) throw new Error(`${label} contains a line break — refusing to send.`);
  return s;
}

/** UTF-8 subjects survive as RFC 2047; an unencoded 8-bit header is mangled silently. */
export function encodeSubject(subject) {
  return `=?UTF-8?B?${Buffer.from(String(subject ?? ''), 'utf8').toString('base64')}?=`;
}

/**
 * @returns {string} the full message. Throws if a header value is unsafe.
 *
 * The body is base64 rather than raw text so it cannot be broken by a long
 * line, a bare newline, or a line that happens to begin with "From ".
 */
export function buildMessage({ to, from, subject, text, replyTo }) {
  const headers = [
    `To: ${assertHeaderSafe('Recipient', to)}`,
    `From: ${assertHeaderSafe('Sender', from)}`,
    `Subject: ${encodeSubject(subject)}`,
    replyTo ? `Reply-To: ${assertHeaderSafe('Reply-To', replyTo)}` : '',
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
  ].filter(Boolean);

  const encoded = Buffer.from(String(text ?? ''), 'utf8')
    .toString('base64')
    .replace(/(.{76})/g, '$1\r\n');

  return `${headers.join('\r\n')}\r\n\r\n${encoded}`;
}
