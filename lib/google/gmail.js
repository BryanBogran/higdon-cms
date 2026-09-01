/**
 * Sending mail as the firm, through the service account.
 *
 * Reuses the credentials that already run Drive, with a DIFFERENT scope —
 * `gmail.send` has to be added to the same client ID in the Admin console
 * alongside the Drive one, or every call comes back `unauthorized_client`.
 *
 * ── Why this does not share drive.js's token ──────────────────────────────
 *
 * That module caches one token in a module-level variable with no key. Handing
 * it a scope parameter would mean a Drive call could receive a Gmail-scoped
 * token, or the reverse, depending on which ran first — and the failure would
 * be a 403 from an unrelated feature, hours later. A separate cache for a
 * separate scope is a few duplicated lines and no such failure.
 *
 * ── It sends as `files@`, not as the person clicking ──────────────────────
 *
 * `GOOGLE_IMPERSONATE_USER` is a dedicated account. Sending as an attorney
 * would need their address in the delegation, which means the key could send
 * mail as them — a much worse thing to lose than a bug report.
 */

import 'server-only';
import { normalizePrivateKey } from './private-key';
import { buildMessage } from './mime';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GMAIL_SCOPES = ['https://www.googleapis.com/auth/gmail.send'];

export function gmailConfig() {
  return {
    clientEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '',
    privateKey: normalizePrivateKey(process.env.GOOGLE_PRIVATE_KEY),
    // Sending REQUIRES a real mailbox to send from. A service account has
    // none, so without delegation there is nothing to do -- unlike Drive,
    // which degrades to whatever has been shared with it.
    sendAs: process.env.GOOGLE_IMPERSONATE_USER || '',
  };
}

export function isGmailConfigured() {
  const c = gmailConfig();
  return Boolean(c.clientEmail && c.privateKey && c.sendAs);
}

const b64url = (input) =>
  Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

let cached = { token: '', expiresAt: 0 };

async function getToken({ now = Date.now() } = {}) {
  if (cached.token && cached.expiresAt > now + 60_000) return { ok: true, token: cached.token };

  const { clientEmail, privateKey, sendAs } = gmailConfig();
  if (!clientEmail || !privateKey) return { ok: false, error: 'Google credentials are not set.' };
  if (!sendAs) return { ok: false, error: 'GOOGLE_IMPERSONATE_USER is not set — nothing to send as.' };

  const iat = Math.floor(now / 1000);
  const claims = {
    iss: clientEmail,
    sub: sendAs,
    scope: GMAIL_SCOPES.join(' '),
    aud: TOKEN_URL,
    iat,
    exp: iat + 3600,
  };

  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(claims));
  const { createSign } = await import('node:crypto');
  const signature = createSign('RSA-SHA256').update(`${header}.${body}`).sign(privateKey, 'base64url');

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${header}.${body}.${signature}`,
    }),
  });
  const json = await res.json().catch(() => ({}));

  if (!res.ok) {
    /*
     * `unauthorized_client` here almost always means one thing, and saying it
     * saves an hour: the Drive scope is authorised for this client ID and
     * gmail.send is not. They are listed separately in the Admin console and
     * adding one does not add the other.
     */
    const hint = json.error === 'unauthorized_client'
      ? ' — add https://www.googleapis.com/auth/gmail.send to this client ID in '
        + 'Admin console → Security → API controls → Domain-wide delegation. '
        + 'The Drive scope being present does not cover it.'
      : '';
    return { ok: false, error: `${json.error || res.status}: ${json.error_description || ''}${hint}` };
  }

  cached = { token: json.access_token, expiresAt: now + (json.expires_in || 3600) * 1000 };
  return { ok: true, token: cached.token };
}

/**
 * @returns {{ok: true} | {ok: false, error: string}} Never throws — the caller
 *   is always doing something more important than sending this email.
 */
export async function sendMail({ to, subject, text, replyTo }) {
  if (!to) return { ok: false, error: 'No recipient.' };

  const auth = await getToken();
  if (!auth.ok) return auth;

  try {
    // INSIDE the try. buildMessage throws on an unsafe header, and this
    // function's contract is that it never does -- the caller is always doing
    // something more important than sending this email.
    const raw = b64url(buildMessage({ to, from: gmailConfig().sendAs, subject, text, replyTo }));

    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { authorization: `Bearer ${auth.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ raw }),
    });
    if (!res.ok) {
      const body = await res.text();
      return { ok: false, error: `Gmail ${res.status}: ${body.slice(0, 300)}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message || 'Could not reach Gmail.' };
  }
}

/** Reset between tests. */
export function __resetGmailTokenCache() {
  cached = { token: '', expiresAt: 0 };
}
